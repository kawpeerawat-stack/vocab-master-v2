// app/lib/courses.ts
// ─────────────────────────────────────────────────────────────
// "คอร์สบทเรียน" แบบแบ่งบท (เช่น Root Words Decoder 18 บท บทละ 20 ข้อ)
//   - เนื้อหาแต่ละคอร์สอยู่ใน data/<file>.json แล้วส่งผ่าน /api/course?id=<courseId>
//   - ความก้าวหน้าเก็บใน Firestore: students/{email}.courses.{courseId}.{lessonId}
//   - เพิ่มคอร์สใหม่ในอนาคต: วางไฟล์ JSON รูปแบบเดียวกันใน data/ แล้วเพิ่ม 1 แถวใน COURSE_REGISTRY
//     (หน้า /admin และหน้านักเรียนจะรู้จักคอร์สใหม่เองโดยไม่ต้องแก้ส่วนอื่น)
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

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
export interface CourseLesson {
  id: string;
  hour: number;
  unit: number;
  titleEn: string;
  titleTh: string;
  goal: string;
  recap: { parts: RecapPart[]; tips: string[] };
  questions: CourseQuestion[];
}
export interface Course {
  id: string;
  version: number;
  title: string;
  titleTh: string;
  subtitle: string;
  passRule: "all";
  units: { no: number; title: string }[];
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
  passed: boolean;      // เคยได้ครบทุกข้อ (เช่น 20/20) อย่างน้อย 1 ครั้ง
  passedAt?: number;    // เวลา (ms) ที่ผ่านครั้งแรก
  best: number;         // คะแนนดีที่สุด
  last: number;         // คะแนนรอบล่าสุด
  total: number;        // จำนวนข้อในบท
  attempts: number;     // จำนวนรอบที่ทำจบ
  lastAt: number;       // เวลา (ms) ที่ทำจบรอบล่าสุด
  missed?: Record<string, number>; // id ข้อ → จำนวนครั้งที่ตอบผิดสะสม (ไว้ดูข้อที่ยาก)
}
export type CourseProgress = Record<string, LessonProgress>; // key = lessonId

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
  const newer = (b.lastAt ?? 0) >= (a.lastAt ?? 0) ? b : a;
  const passedAts = [a.passedAt, b.passedAt].filter((x): x is number => typeof x === "number");
  const missed: Record<string, number> = { ...(a.missed || {}) };
  for (const [k, v] of Object.entries(b.missed || {})) missed[k] = Math.max(missed[k] ?? 0, v);
  return {
    passed: a.passed || b.passed,
    ...(passedAts.length ? { passedAt: Math.min(...passedAts) } : {}),
    best: Math.max(a.best ?? 0, b.best ?? 0),
    last: newer.last ?? 0,
    total: newer.total ?? a.total ?? b.total ?? 0,
    attempts: Math.max(a.attempts ?? 0, b.attempts ?? 0),
    lastAt: Math.max(a.lastAt ?? 0, b.lastAt ?? 0),
    missed,
  };
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
    const cloud = (snap.exists() ? (snap.data()?.courses?.[courseId] as CourseProgress | undefined) : undefined) || {};
    const merged = mergeCourseProgress(local, cloud);
    saveLocalCourseProgress(courseId, email, merged);
    // หาบทที่ในเครื่อง "ใหม่กว่า" คลาวด์
    const behind: CourseProgress = {};
    for (const [id, m] of Object.entries(merged)) {
      const c = cloud[id];
      if (!c || (c.lastAt ?? 0) < (m.lastAt ?? 0) || (!c.passed && m.passed) || (c.attempts ?? 0) < (m.attempts ?? 0)) behind[id] = m;
    }
    if (Object.keys(behind).length > 0) {
      withTimeout(
        setDoc(
          ref,
          {
            ...(name ? { name } : {}),
            email: email.trim().toLowerCase(),
            courses: { [courseId]: behind },
            courseActiveAt: Math.max(...Object.values(behind).map((x) => x.lastAt ?? 0)),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        10000
      ).catch((e) => console.error("resync course progress failed:", e));
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
}): Promise<{ lesson: LessonProgress; cloudOk: boolean }> {
  const { courseId, lessonId, email, name, score, total, wrongIds } = params;
  const now = Date.now();
  const allLocal = loadLocalCourseProgress(courseId, email);
  let base: LessonProgress | undefined = allLocal[lessonId];
  let cloudOk = false;

  // ดึงค่าบนคลาวด์มารวมก่อน (กันเคสทำจากหลายเครื่อง)
  let ref = null as ReturnType<typeof doc> | null;
  if (email && db) {
    try {
      ref = doc(db, "students", emailToId(email));
      const snap = await withTimeout(getDoc(ref), 6000);
      const cloudLesson = snap.exists() ? (snap.data()?.courses?.[courseId]?.[lessonId] as LessonProgress | undefined) : undefined;
      base = mergeLesson(base, cloudLesson);
    } catch (e) {
      console.error("read before save failed:", e);
    }
  }

  const passedNow = score >= total && total > 0;
  const missed: Record<string, number> = { ...(base?.missed || {}) };
  for (const id of wrongIds) missed[id] = (missed[id] ?? 0) + 1;
  const lesson: LessonProgress = {
    passed: (base?.passed ?? false) || passedNow,
    ...(base?.passedAt ? { passedAt: base.passedAt } : passedNow ? { passedAt: now } : {}),
    best: Math.max(base?.best ?? 0, score),
    last: score,
    total,
    attempts: (base?.attempts ?? 0) + 1,
    lastAt: now,
    missed,
  };

  saveLocalCourseProgress(courseId, email, { ...allLocal, [lessonId]: lesson });

  if (ref) {
    try {
      await withTimeout(setDoc(
        ref,
        {
          name,
          email: email.trim().toLowerCase(),
          courses: { [courseId]: { [lessonId]: lesson } },
          courseActiveAt: now,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ), 10000);
      cloudOk = true;
    } catch (e) {
      console.error("saveLessonAttempt error:", e);
    }
  }
  return { lesson, cloudOk };
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
