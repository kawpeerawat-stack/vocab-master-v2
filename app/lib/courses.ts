// app/lib/courses.ts
// ─────────────────────────────────────────────────────────────
// "คอร์สบทเรียน" แบบแบ่งบท (เช่น Root Words Decoder 14 บท บทละ 15 ข้อ — ตรงกับแบบเรียน)
//   - เนื้อหาแต่ละคอร์สอยู่ใน data/<file>.json แล้วส่งผ่าน /api/course?id=<courseId>
//   - ความก้าวหน้าเก็บใน Firestore: students/{email}.courses.{courseId}.{lessonId}
//   - เพิ่มคอร์สใหม่ในอนาคต: วางไฟล์ JSON รูปแบบเดียวกันใน data/ แล้วเพิ่ม 1 แถวใน COURSE_REGISTRY
//     (หน้า /admin และหน้านักเรียนจะรู้จักคอร์สใหม่เองโดยไม่ต้องแก้ส่วนอื่น)
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase";
import { doc, FieldPath, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { saveLocalUnlock, serial, verifiedWrite, type SyncIssue } from "./sync";
import type { GuardStats } from "./guard";

export { COURSE_REGISTRY, courseMeta } from "./courseRegistry";
export type { CourseMeta } from "./courseRegistry";

// ── โครงสร้างเนื้อหา ──
export interface CourseQuestion {
  id: string;
  type: string;
  q: string;          // รองรับ **ตัวหนา**
  options: string[];  // 5 ตัวเลือก
  answer: number;     // index ของตัวเลือกที่ถูก (ก่อนสลับ)
  hint?: string;
  explain?: string;
}
export interface RecapExample { word: string; th: string }
export interface RecapPart { part: string; kind: string; meaning: string; examples: RecapExample[] }
// คำศัพท์ประจำบท (ตรงกับตารางพับในแบบเรียน) — n = จำนวนฉบับข้อสอบที่พบคำนี้, core = อยู่ในคำแกน 120 คำ
// n = ออกสอบกี่ฉบับ (ม.6) · core = อยู่ในคำแกน 120 คำ (ม.6) · x = คำขยาย (ม.4) · tg / al = พบในข้อสอบจริง TGAT/GAT กี่ฉบับ (จาก 7) · A-Level/9 วิชาสามัญ กี่ฉบับ (จาก 6)
export interface LessonWord { w: string; pos: string; parts: string; th: string; n?: number; core?: boolean; x?: boolean; tg?: number; al?: number }
export interface CourseLesson {
  id: string;
  hour: number; // เลขบท (ตรงกับ "บทที่ / คาบที่" ในแบบเรียน)
  unit: number;
  titleEn: string;
  titleTh: string;
  goal: string;
  recap: { parts: RecapPart[]; tips: string[] };
  words?: LessonWord[];
  // แผนการสอน: สัปดาห์ที่ของภาคเรียน · วันจันทร์ของสัปดาห์ (YYYY-MM-DD) · ข้อความวันที่ เช่น "2–6 พ.ย. 69"
  week?: number;
  start?: string;
  dateLabel?: string;
  pairNote?: string; // ฉบับคาบคู่ ม.6: คาบที่ 2 ของสัปดาห์นี้เรียนอะไรในห้อง 📚 เช่น "คาบที่ 2 → 📚 ชุดที่ 1"
  questions: CourseQuestion[];
}
export interface Course {
  id: string;
  version: number;
  title: string;
  titleTh: string;
  subtitle: string;
  passRule: "all";
  passMin?: number;    // ถูกกี่ข้อขึ้นไปจึงผ่าน (ไม่ระบุ = ต้องถูกครบทุกข้อ) เช่น ฉบับ ม.4 = 8 จาก 10
  lessonWord?: string; // คำเรียกหน่วยบทเรียน (ค่าเริ่มต้น "บท" · ฉบับ ม.4 = "คาบ")
  classNote?: string; // วิธีใช้ในคาบ (แสดงบนการ์ดความก้าวหน้า)
  gradeBy?: "first" | "best"; // สมุดคะแนนใช้คะแนนรอบแรกหรือคะแนนดีที่สุด (ไม่ระบุ = ดีที่สุด)
  classDays?: Record<string, number>; // วันเรียนของแต่ละห้องนับจากวันจันทร์ (0–4) — บทเปิดเมื่อถึงวันเรียนของห้องในสัปดาห์นั้น
  units: { no: number; title: string; code?: string }[]; // code = ภาค A / B / C / D ในแบบเรียน
  lessons: CourseLesson[];
}

// โหลดเนื้อหาคอร์สจาก API (เก็บ cache ในหน่วยความจำ — โหลดครั้งเดียวต่อการเปิดหน้า)
const courseCache: Record<string, Course> = {};
export async function loadCourse(courseId: string): Promise<Course> {
  if (courseCache[courseId]) return courseCache[courseId];
  const res = await fetch(`/api/course?id=${encodeURIComponent(courseId)}`);
  if (!res.ok) throw new Error(`load course failed: ${res.status}`);
  const c = (await res.json()) as Course;
  courseCache[courseId] = c;
  return c;
}

// ── ความก้าวหน้ารายบท ──
export interface LessonProgress {
  passed: boolean;      // เคยผ่านเกณฑ์อย่างน้อย 1 ครั้ง (ฉบับ ม.6 = ถูกครบทุกข้อ · ฉบับ ม.4 = ถูก 8/10 ขึ้นไป)
  passedAt?: number;    // เวลา (ms) ที่ผ่านครั้งแรก
  first?: number;       // คะแนนรอบแรก (เริ่มเก็บ 4 พ.ย. 2569 · ใช้ลงสมุดคะแนนของคอร์สที่ gradeBy = "first")
  firstTotal?: number;  // จำนวนข้อตอนทำรอบแรก
  firstAt?: number;     // เวลา (ms) ที่ทำรอบแรกเสร็จ
  firstMs?: number;     // เวลาที่ใช้ทำรอบแรก (ms)
  lastMs?: number;      // เวลาที่ใช้ทำรอบล่าสุด (ms)
  fast?: number;        // จำนวนรอบที่ทำเร็วผิดปกติ (เฉลี่ยไม่ถึง FAST_MS_PER_Q ต่อข้อ)
  best: number;         // คะแนนดีที่สุด
  last: number;         // คะแนนรอบล่าสุด
  total: number;        // จำนวนข้อในบท
  attempts: number;     // จำนวนรอบที่ทำจบ
  lastAt: number;       // เวลา (ms) ที่ทำจบรอบล่าสุด
  missed?: Record<string, number>; // id ข้อ → จำนวนครั้งที่ตอบผิดสะสม (ไว้ดูข้อที่ยาก)
  // ระบบกัน AI (รอบแรก): ออกจากหน้ากี่ครั้ง · เวลาที่หายไป (ms) · เสียโฟกัสกี่ครั้ง · ข้อที่ไม่นับคะแนน · โหมด (log = ทดลอง / enforce = หักคะแนน)
  gl?: number;
  ga?: number;
  gb?: number;
  gv?: number;
  gm?: "log" | "enforce";
  fqt?: number[];       // เวลาที่ใช้รายข้อของรอบแรก (วินาที ตามลำดับที่ทำ)
  // กล้องกันกล้องซ้อน (รอบแรก): cm = cam ใช้กล้อง · nocam ไม่ใช้กล้อง · camfail เลือกกล้องแต่ใช้ไม่ได้ · gc = ถูกบังหน้ากี่ครั้ง · gca = เวลารวม (ms)
  cm?: "cam" | "nocam" | "camfail";
  gc?: number;
  gca?: number;
  gt?: number;          // หมดเวลากี่ข้อ (ไม่ใช้กล้อง · จับเวลาข้อละ 20 วินาที)
  gp?: number;          // พบมือถือในกล้องกี่ครั้ง (9 พ.ย. · ใกล้/แตะขอบ = ข้ามข้อ)
  gpf?: number;         // เห็นมือถือเล็ก ๆ ไกล ๆ กี่ครั้ง (ไม่ข้ามข้อ · ให้ครูดู)
  gpd?: "ready" | "slow" | "error" | "loading" | "off"; // ตัวตรวจมือถือทำงานไหม (slow = เครื่องช้า ปิดชั้นนี้)
  pm?: "cam" | "nocam" | "camfail"; // ผ่านบทนี้ด้วยรอบแบบไหน (ใช้กล้อง = เกณฑ์ 80% · ไม่ใช้กล้อง = ครบทุกข้อ)
  // 9 พ.ย.: ผลเดิมที่ "ทำล่วงหน้า" (ก่อนวันเรียนของห้อง) — ไม่นับ เก็บไว้ให้ครูดู · บทนี้ต้องทำใหม่ทั้งรอบพร้อมกล้อง
  early?: { first?: number; best: number; firstAt?: number; passedAt?: number; attempts: number };
}
// ฟิลด์ที่ติดไปกับคะแนนรอบแรก
const FIRST_KEYS = ["first", "firstTotal", "firstAt", "firstMs", "gl", "ga", "gb", "gv", "gm", "fqt", "cm", "gc", "gca", "gt", "gp", "gpf", "gpd"] as const;
function pickFirst(x: LessonProgress): Partial<LessonProgress> {
  const out: Record<string, unknown> = {};
  for (const k of FIRST_KEYS) if (x[k] !== undefined && x[k] !== null) out[k] = x[k];
  return out as Partial<LessonProgress>;
}
export type CourseProgress = Record<string, LessonProgress>; // key = lessonId

// ทำเร็วผิดปกติ = เฉลี่ยไม่ถึง 5 วินาทีต่อข้อ (อ่านโจทย์ 5 ตัวเลือกไม่ทัน) → หน้าครูขึ้น ⚡
export const FAST_MS_PER_Q = 5000;
export const isFastAttempt = (ms: number | undefined, total: number | undefined) => !!ms && !!total && ms < total * FAST_MS_PER_Q;

// กันค้าง: ถ้าเน็ตช้า/หลุด อย่ารอคลาวด์นานเกินไป (ข้อมูลยังเก็บในเครื่องเสมอ)
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}
const cacheKey = (courseId: string, email: string) => `course:${courseId}:${emailToId(email)}`;

export function loadLocalCourseProgress(courseId: string, email: string): CourseProgress {
  try {
    const raw = localStorage.getItem(cacheKey(courseId, email));
    return raw ? (JSON.parse(raw) as CourseProgress) : {};
  } catch {
    return {};
  }
}
function saveLocalCourseProgress(courseId: string, email: string, p: CourseProgress) {
  try {
    localStorage.setItem(cacheKey(courseId, email), JSON.stringify(p));
  } catch {
    /* เครื่องไม่ให้เก็บ — ข้ามไป ใช้ข้อมูลบนคลาวด์แทน */
  }
}

// รวมข้อมูล 2 แหล่ง (เครื่อง + คลาวด์) โดยไม่ให้ความก้าวหน้าถอยหลัง
export function mergeLesson(a?: LessonProgress, b?: LessonProgress): LessonProgress | undefined {
  if (!a) return b;
  if (!b) return a;
  // ฝั่งที่ล้างผลทำล่วงหน้าแล้ว (มี early) ชนะผลเดิมที่ทำล่วงหน้า (อีกฝั่งยังเป็นข้อมูลเก่าก่อนล้าง)
  if (!!a.early !== !!b.early) {
    const r = a.early ? a : b, o = a.early ? b : a;
    if ((o.firstAt ?? o.lastAt ?? 0) <= (r.early!.firstAt ?? Infinity) || (o.attempts ?? 0) <= (r.early!.attempts ?? 0)) return r;
  }
  const newer = (b.lastAt ?? 0) >= (a.lastAt ?? 0) ? b : a;
  const passedAts = [a.passedAt, b.passedAt].filter((x): x is number => typeof x === "number");
  const missed: Record<string, number> = { ...(a.missed || {}) };
  for (const [k, v] of Object.entries(b.missed || {})) missed[k] = Math.max(missed[k] ?? 0, v);
  // รอบแรก: เอาจากฝั่งที่ทำรอบแรกก่อน
  const fa = typeof a.first === "number" ? a : undefined;
  const fb = typeof b.first === "number" ? b : undefined;
  const fr = fa && fb ? ((fa.firstAt ?? 0) <= (fb.firstAt ?? 0) ? fa : fb) : fa || fb;
  return {
    passed: a.passed || b.passed,
    ...(passedAts.length ? { passedAt: Math.min(...passedAts) } : {}),
    ...(a.pm || b.pm ? { pm: ((a.passedAt ?? Infinity) <= (b.passedAt ?? Infinity) ? a.pm ?? b.pm : b.pm ?? a.pm)! } : {}),
    ...(fr ? pickFirst(fr) : {}),
    ...(newer.lastMs ? { lastMs: newer.lastMs } : {}),
    ...(a.fast || b.fast ? { fast: Math.max(a.fast ?? 0, b.fast ?? 0) } : {}),
    best: Math.max(a.best ?? 0, b.best ?? 0),
    last: newer.last ?? 0,
    total: newer.total ?? a.total ?? b.total ?? 0,
    attempts: Math.max(a.attempts ?? 0, b.attempts ?? 0),
    lastAt: Math.max(a.lastAt ?? 0, b.lastAt ?? 0),
    missed,
    ...(a.early || b.early ? { early: (a.early ?? b.early)! } : {}),
  };
}

// ผลบทที่ "ทำล่วงหน้า" (ก่อนวันเรียนของห้อง) → มองเป็นยังไม่ได้ทำ (รอบใหม่ = รอบแรก พร้อมกล้อง) · ผลเดิมย้ายไปเก็บที่ early
//   ใช้กับมุมมองในหน้านักเรียน / หน้าครู · ข้อมูลบนระบบเปลี่ยนเมื่อทำรอบใหม่เสร็จ (ครูเห็น ⏩ จนกว่าจะทำใหม่)
export function earlyReset(x: LessonProgress): LessonProgress {
  return {
    passed: false,
    best: 0,
    last: 0,
    total: x.total,
    attempts: 0,
    lastAt: x.lastAt,
    missed: x.missed || {},
    early: { ...(typeof x.first === "number" ? { first: x.first } : {}), best: x.best ?? 0, ...(x.firstAt ? { firstAt: x.firstAt } : {}), ...(x.passedAt ? { passedAt: x.passedAt } : {}), attempts: x.attempts },
  };
}
export function applyEarly(p: CourseProgress, isEarly: (lessonId: string, x: LessonProgress) => boolean): CourseProgress {
  let out: CourseProgress | null = null;
  for (const [id, x] of Object.entries(p)) {
    if (x.early || !(x.attempts > 0) || !isEarly(id, x)) continue;
    out = out ?? { ...p };
    out[id] = earlyReset(x);
  }
  return out ?? p;
}
export function mergeCourseProgress(a: CourseProgress, b: CourseProgress): CourseProgress {
  const out: CourseProgress = {};
  for (const id of Array.from(new Set(Object.keys(a).concat(Object.keys(b))))) {
    const m = mergeLesson(a[id], b[id]);
    if (m) out[id] = m;
  }
  return out;
}

// โหลดความก้าวหน้าของคอร์ส (คลาวด์ + เครื่อง)
//   ถ้าในเครื่องมีผลที่ยังไม่ขึ้นคลาวด์ (เช่น ตอนส่งผลเน็ตหลุด) จะส่งขึ้นให้อัตโนมัติ เพื่อให้ครูเห็นครบ
export async function loadCourseProgress(courseId: string, email: string, name?: string): Promise<CourseProgress> {
  const local = loadLocalCourseProgress(courseId, email);
  if (!email || !db) return local;
  try {
    const ref = doc(db, "students", emailToId(email));
    const snap = await withTimeout(getDoc(ref), 8000);
    const data = snap.exists() ? snap.data() : undefined;
    saveLocalUnlock(email, data?.unlock ?? {});
    const cloud = (data?.courses?.[courseId] as CourseProgress | undefined) || {};
    const merged = mergeCourseProgress(local, cloud);
    saveLocalCourseProgress(courseId, email, merged);
    // หาบทที่ในเครื่อง "ใหม่กว่า" คลาวด์
    const behind: CourseProgress = {};
    for (const [id, m] of Object.entries(merged)) {
      const c = cloud[id];
      if (!c || (c.lastAt ?? 0) < (m.lastAt ?? 0) || (!c.passed && m.passed) || (c.attempts ?? 0) < (m.attempts ?? 0)) behind[id] = m;
    }
    if (Object.keys(behind).length > 0) {
      void writeLessons(courseId, email, name, behind);
    }
    return merged;
  } catch (e) {
    console.error("loadCourseProgress error:", e);
    return local;
  }
}

// บันทึกผล 1 รอบ (ทำครบทุกข้อแล้ว) — คืนความก้าวหน้าใหม่ของบทนั้น + สถานะการบันทึกขึ้นคลาวด์
export async function saveLessonAttempt(params: {
  courseId: string;
  lessonId: string;
  email: string;
  name: string;
  score: number;
  total: number;
  wrongIds: string[];
  passMin?: number; // ถูกกี่ข้อขึ้นไปจึงผ่าน (ไม่ระบุ = ครบทุกข้อ)
  ms?: number;      // เวลาที่ใช้ทำรอบนี้ (ms)
  guard?: GuardStats; // ระบบกัน AI (เฉพาะรอบที่เข้าสมุดคะแนน)
  qt?: number[];      // เวลาที่ใช้รายข้อ (วินาที)
  cam?: { mode: "cam" | "nocam" | "camfail"; covers: number; coverMs: number; timeouts?: number; phones?: number; phonesFar?: number; pd?: string }; // กล้องในรอบนี้ (รอบที่เข้าสมุดคะแนน)
  early?: boolean;    // บทนี้เคยทำล่วงหน้า (ไม่นับ) → รอบนี้คือรอบแรกใหม่
  onSlow?: () => void;
}): Promise<{ lesson: LessonProgress; cloudOk: boolean; issue?: SyncIssue }> {
  const { courseId, lessonId, email, name, score, total, wrongIds, passMin, ms, guard, qt, cam, early, onSlow } = params;
  const now = Date.now();
  const allLocal = loadLocalCourseProgress(courseId, email);
  let base: LessonProgress | undefined = allLocal[lessonId];
  let cloudOk = false;

  // ดึงค่าบนคลาวด์มารวมก่อน (กันเคสทำจากหลายเครื่อง)
  let ref = null as ReturnType<typeof doc> | null;
  if (email && db) {
    try {
      ref = doc(db, "students", emailToId(email));
      const snap = await withTimeout(getDoc(ref), 5000);
      const cloudLesson = snap.exists() ? (snap.data()?.courses?.[courseId]?.[lessonId] as LessonProgress | undefined) : undefined;
      base = mergeLesson(base, cloudLesson);
    } catch (e) {
      console.error("read before save failed:", e);
    }
  }

  if (early && base && !base.early && base.attempts > 0) base = earlyReset(base);
  const passedNow = total > 0 && score >= Math.min(total, passMin ?? total);
  const missed: Record<string, number> = { ...(base?.missed || {}) };
  for (const id of wrongIds) missed[id] = (missed[id] ?? 0) + 1;
  // รอบแรกของบทนี้ (ยังไม่เคยทำเลย) → เก็บคะแนนรอบแรกไว้ลงสมุดคะแนน
  const isFirst = !base || !(base.attempts > 0);
  const fast = isFastAttempt(ms, total);
  const lesson: LessonProgress = {
    passed: (base?.passed ?? false) || passedNow,
    ...(base?.passedAt ? { passedAt: base.passedAt } : passedNow ? { passedAt: now } : {}),
    ...(base?.pm ? { pm: base.pm } : passedNow && !base?.passed && cam ? { pm: cam.mode } : {}),
    ...(isFirst
      ? {
          first: score,
          firstTotal: total,
          firstAt: now,
          ...(ms ? { firstMs: ms } : {}),
          ...(guard ? { gl: guard.leaves, ga: guard.awayMs, gb: guard.blurs, gv: guard.voided, gm: guard.mode } : {}),
          ...(qt && qt.length ? { fqt: qt } : {}),
          ...(cam ? { cm: cam.mode, gc: cam.covers, gca: cam.coverMs, gt: cam.timeouts ?? 0, ...(cam.mode === "cam" ? { gp: cam.phones ?? 0, gpf: cam.phonesFar ?? 0, gpd: (cam.pd ?? "off") as LessonProgress["gpd"] } : {}) } : {}),
        }
      : typeof base?.first === "number"
      ? pickFirst(base)
      : {}),
    ...(ms ? { lastMs: ms } : {}),
    ...((base?.fast ?? 0) + (fast ? 1 : 0) > 0 ? { fast: (base?.fast ?? 0) + (fast ? 1 : 0) } : {}),
    best: Math.max(base?.best ?? 0, score),
    last: score,
    total,
    attempts: (base?.attempts ?? 0) + 1,
    lastAt: now,
    missed,
    ...(base?.early ? { early: base.early } : {}),
  };

  saveLocalCourseProgress(courseId, email, { ...allLocal, [lessonId]: lesson });
  markPending(courseId, email, [lessonId], true);

  let issue: SyncIssue | undefined;
  if (ref) {
    const r = await writeLessons(courseId, email, name, { [lessonId]: lesson }, onSlow);
    cloudOk = r.ok;
    if (!r.ok) issue = r.issue;
  }
  return { lesson, cloudOk, issue };
}

// ── บทที่ยังไม่ขึ้นระบบ (ไว้ส่งซ้ำอัตโนมัติ) ──
const pendKey = (courseId: string, email: string) => `coursePending:${courseId}:${emailToId(email)}`;
function loadPending(courseId: string, email: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(pendKey(courseId, email)) || "[]") as string[];
  } catch {
    return [];
  }
}
function markPending(courseId: string, email: string, ids: string[], on: boolean) {
  try {
    const cur = new Set(loadPending(courseId, email));
    for (const id of ids) {
      if (on) cur.add(id);
      else cur.delete(id);
    }
    localStorage.setItem(pendKey(courseId, email), JSON.stringify(Array.from(cur)));
  } catch {
    /* ไม่เป็นไร */
  }
}
export const hasPendingLessons = (courseId: string, email: string) => loadPending(courseId, email).length > 0;

// เขียนผลรายบทขึ้นระบบ (ส่งทีละครั้งต่อนักเรียน · เน็ตช้าไม่ตัดสินว่าล้มเหลวทันที)
async function writeLessons(
  courseId: string,
  email: string,
  name: string | undefined,
  lessons: CourseProgress,
  onSlow?: () => void
): Promise<{ ok: true } | { ok: false; issue: SyncIssue }> {
  if (!email || !db) return { ok: false, issue: "error" };
  const ids = Object.keys(lessons);
  // 9 พ.ย.: ระบุช่องรายบท (mergeFields) → บทที่ส่งถูกแทนทั้งก้อนบนระบบ ไม่มีค่าเก่าค้าง (เช่น ผลที่ทำล่วงหน้า)
  const fields: (string | FieldPath)[] = ["email", "courseActiveAt", "updatedAt", ...(name ? ["name"] : []), ...ids.map((id) => new FieldPath("courses", courseId, id))];
  return serial(emailToId(email), async () => {
    const r = await verifiedWrite(() =>
      setDoc(
        doc(db, "students", emailToId(email)),
        {
          ...(name ? { name } : {}),
          email: email.trim().toLowerCase(),
          courses: { [courseId]: lessons },
          courseActiveAt: Math.max(...Object.values(lessons).map((x) => x.lastAt ?? 0)),
          updatedAt: serverTimestamp(),
        },
        { mergeFields: fields }
      ),
      onSlow
    );
    if (r.ok) markPending(courseId, email, ids, false);
    return r;
  });
}

// ส่งบทที่ค้างในเครื่องขึ้นระบบอีกครั้ง (ปุ่ม "ส่งอีกครั้ง" / ลองใหม่อัตโนมัติ)
export async function resendPendingLessons(courseId: string, email: string, name: string, onSlow?: () => void): Promise<{ ok: true } | { ok: false; issue: SyncIssue }> {
  const ids = loadPending(courseId, email);
  if (!ids.length) return { ok: true };
  const local = loadLocalCourseProgress(courseId, email);
  const lessons: CourseProgress = {};
  for (const id of ids) if (local[id]) lessons[id] = local[id];
  if (!Object.keys(lessons).length) {
    markPending(courseId, email, ids, false);
    return { ok: true };
  }
  return writeLessons(courseId, email, name, lessons, onSlow);
}

// ── ตัวช่วยทั่วไป ──
export function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
