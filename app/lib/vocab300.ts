// app/lib/vocab300.ts
// ─────────────────────────────────────────────────────────────
// คำศัพท์แกน 120 คำ (TGAT / A-Level · ลดจาก 300 คำ ให้พอดีรายวิชา 2 ชม./สัปดาห์ · 12 สัปดาห์ สัปดาห์ละ 10 คำ) — เรียนแบบ 5 ขั้น + ทวนแบบเว้นวัน
//   เนื้อหา: data/vocab300.json → /api/course?id=vocab300
//   ความก้าวหน้า: students/{email}.v300 = { cards, days }
//     + ฟิลด์สรุป v300Known / v300Seen / v300At (ไว้ให้หน้าครูและอันดับอ่านเร็ว)
//
// กติกา "รู้แล้ว" (กันการจำแบบชั่วคราว):
//   คำหนึ่งจะนับว่า "รู้แล้ว" เมื่อตอบถูกตั้งแต่ครั้งแรกใน "วันที่ต่างกัน" อย่างน้อย 2 วัน
//   ถ้าตอบผิดตอนทวน → กลับไปเป็น "กำลังเรียน" และนับวันใหม่ทั้งหมด
// ระยะทวน (วัน) ตามขั้น: ขั้น 0 → พรุ่งนี้, 1 → +2, 2 → +4, 3 → +7, 4 → +14, 5 → +30
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";

// ── เนื้อหา ──
export type PosKey = "n" | "v" | "adj" | "adv" | "prep" | "conj";
export interface VForm { s: string; o: string[]; a: number; why: string }
export interface VWord {
  id: string;
  w: string;
  week: number;
  level: string;
  papers: number;
  exams: string[];
  pos: string;
  pk: PosKey;
  pron: string;
  th: string;
  def: string;
  sent: string;            // ประโยคแบบข้อสอบ (มี **คำ**)
  clue: string;            // คำใบ้ชนิดคำจากตำแหน่งในประโยค
  guess: string[];         // [0] = ความหมายที่ถูก, [1..2] = ตัวลวง
  parts: [string, "p" | "r" | "s" | "b", string][];
  pq: { part: string; kind: string; o: string[] } | null; // คำถามชิ้นส่วนคำ ([0] = ถูก)
  fam: [string, string, string][];
  col: string[];
  ex2: string;
  trap: string;
  proc: { q: string; o: string[]; why: string }; // o[0] = ถูก
  ctx: string;             // ประโยคบริบทใหม่ มีช่อง ___
  cx: string[];            // ตัวลวงของข้อบริบท (คำในชุด)
  form: VForm | null;      // ข้อรูปคำ (ตระกูลคำ)
}
// start / end = วันจันทร์–ศุกร์ของสัปดาห์ในภาคเรียนที่แผนการสอนกำหนดให้เรียนชุดนี้ (YYYY-MM-DD) · label = ข้อความวันที่ · sem = สัปดาห์ที่ของภาคเรียน
export interface VWeek { no: number; title: string; count: number; start?: string; end?: string; label?: string; sem?: number }
export interface VCourse {
  id: string;
  version: number;
  title: string;
  titleTh: string;
  subtitle: string;
  papers: number;
  weeks: VWeek[];
  words: VWord[];
  /** วันที่เรียนของแต่ละห้องนับจากวันจันทร์ของสัปดาห์ (0 = จ. … 4 = ศ.) — ใช้คิดแผน “ถึงคาบของห้องนี้หรือยัง” */
  classDays?: Record<string, number>;
}

let courseCache: VCourse | null = null;
export async function loadVocab300(): Promise<VCourse> {
  if (courseCache) return courseCache;
  const res = await fetch("/api/course?id=vocab300");
  if (!res.ok) throw new Error(`load vocab300 failed: ${res.status}`);
  courseCache = (await res.json()) as VCourse;
  return courseCache;
}

// ── ความก้าวหน้า ──
export interface VCard {
  s: number;      // ขั้นความจำ 0–5
  due: string;    // วันที่ต้องทวน (YYYY-MM-DD)
  cd: string[];   // วันที่ตอบถูกตั้งแต่ครั้งแรก (ไม่ซ้ำวัน) — ครบ 2 วัน = รู้แล้ว
  first: string;  // วันที่เรียนคำนี้ครั้งแรก
  last: string;   // วันที่ทำล่าสุด (นับผลได้วันละครั้ง)
  at: number;     // เวลา (ms) ที่อัปเดตล่าสุด
  n: number;      // จำนวนครั้งที่ถูกถาม (นับเฉพาะครั้งแรกของแต่ละข้อ)
  w: number;      // จำนวนครั้งที่ตอบผิดสะสม
  lap: number;    // จำนวนครั้งที่ลืม (ทวนแล้วผิด)
  g: number;      // ขั้นที่ 1 เดาความหมายถูก: 1 / 0
  p: number;      // ขั้นที่ 1 ผ่าคำถูก: 1 / 0 / -1 (ไม่มีข้อผ่าคำ)
  pc: number;     // ขั้นที่ 3 ทำให้คิด ตอบถูก: 1 / 0
}
export interface VDay { n: number; r: number; c: number; x: number } // คำใหม่ / ข้อทวน / ถูก / ผิด
export interface VProgress { cards: Record<string, VCard>; days: Record<string, VDay> }

export const NEW_PER_DAY = 10;   // คำใหม่ต่อคาบ (1 ชุดสัปดาห์ = 10 คำ = 2 ชุดเรียน)
export const CATCHUP_PER_DAY = 20; // คนที่ช้ากว่าแผน (เช่น ขาดเรียน) เรียนได้ถึง 20 คำในคาบเดียว เพื่อตามให้ทัน
export const BATCH_SIZE = 5;     // คำต่อชุดเรียน
export const REVIEW_LIMIT = 20;  // คำทวนสูงสุดต่อรอบ
// ระยะนัดทวน (วัน) — ออกแบบให้ทุกกิจกรรมจบในคาบ (เรียนในห้อง สัปดาห์ละครั้ง ไม่มีการบ้าน)
//   ผิด → ขึ้นให้ทวนตั้งแต่ครั้งถัดไปที่เปิดแอป · ถูกครั้งแรก → คาบหน้า · จากนั้น 2 → 4 → 8 → 12 สัปดาห์
const GAP = [1, 7, 14, 28, 56, 84];

export const emptyProgress = (): VProgress => ({ cards: {}, days: {} });

// ชื่อห้องและแผนการเรียน (ใช้ร่วมกันในเมนูหลักและหน้าครู — แก้ที่นี่ที่เดียว)
export const CORE_NAME = "คำศัพท์แกน 120 คำ";
export const CORE_PLAN = "12 ชุด ชุดละ 10 คำ · คาบที่ 2 ของคาบคู่";
export const BEHIND_DUE = 10; // ค้างทวนตั้งแต่กี่คำ ถือว่าตามไม่ทัน (หน้าครู)

// คำ 180 คำที่ตัดออกเมื่อลดจาก 300 เหลือ 120 คำ (ต.ค. 2569) — ความก้าวหน้าเดิมของคำเหล่านี้ยังเก็บไว้ แต่ไม่นับในสถิติและไม่ถูกเรียกมาทวน
export const RETIRED_IDS = new Set<string>([
  "w091", "w116", "w117", "w118", "w119", "w124", "w125", "w126", "w127", "w128", "w129", "w130",
  "w133", "w134", "w135", "w136", "w137", "w138", "w139", "w140", "w141", "w142", "w143", "w144",
  "w145", "w146", "w147", "w148", "w149", "w150", "w151", "w152", "w153", "w154", "w155", "w156",
  "w157", "w158", "w159", "w160", "w161", "w162", "w163", "w164", "w165", "w166", "w167", "w168",
  "w169", "w170", "w171", "w172", "w173", "w174", "w175", "w176", "w177", "w178", "w179", "w180",
  "w181", "w182", "w183", "w184", "w185", "w186", "w187", "w188", "w189", "w190", "w191", "w192",
  "w193", "w194", "w195", "w196", "w197", "w198", "w199", "w200", "w201", "w202", "w203", "w204",
  "w205", "w206", "w207", "w208", "w209", "w210", "w211", "w212", "w213", "w214", "w215", "w216",
  "w217", "w218", "w219", "w220", "w221", "w222", "w223", "w224", "w225", "w226", "w227", "w228",
  "w229", "w230", "w231", "w232", "w233", "w234", "w235", "w236", "w237", "w238", "w239", "w240",
  "w241", "w242", "w243", "w244", "w245", "w246", "w247", "w248", "w249", "w250", "w251", "w252",
  "w253", "w254", "w255", "w256", "w257", "w258", "w259", "w260", "w261", "w262", "w263", "w264",
  "w265", "w266", "w267", "w268", "w269", "w270", "w271", "w272", "w273", "w274", "w275", "w276",
  "w277", "w278", "w279", "w280", "w281", "w282", "w283", "w284", "w285", "w286", "w287", "w288",
  "w289", "w290", "w291", "w292", "w293", "w294", "w295", "w296", "w297", "w298", "w299", "w300",
]);
export const isActiveCard = (id: string) => !RETIRED_IDS.has(id);

// ── แผนการสอนตามปฏิทิน (จาก weeks[].start) ──
// สัปดาห์ของแอปที่แผนกำหนดให้เรียนถึงแล้ว ณ วันนี้ (0 = ยังไม่เริ่ม · null = ไม่มีแผนวันที่)
// room = ห้องของนักเรียน (เช่น "6/2") — ถ้ารู้ห้อง จะนับสัปดาห์นั้นก็ต่อเมื่อถึงวันเรียนของห้องแล้ว
export function plannedWeekNo(course: VCourse | null, today: string, room?: string | null): number | null {
  if (!course || !course.weeks.some((w) => w.start)) return null;
  const off = (room && course.classDays?.[room]) || 0;
  return course.weeks.filter((w) => w.start && addDays(w.start, off) <= today).reduce((m, w) => Math.max(m, w.no), 0);
}
// จำนวนคำที่ควรเรียนแล้วตามแผน ณ วันนี้
export function plannedWords(course: VCourse | null, today: string, room?: string | null): number | null {
  const k = plannedWeekNo(course, today, room);
  if (k === null || !course) return null;
  return course.weeks.filter((w) => w.no <= k).reduce((s, w) => s + w.count, 0);
}
// จำนวนคำที่เรียนแล้ว (ไม่นับคำที่ตัดออก) — before = นับเฉพาะคำที่เริ่มเรียนก่อนวันนี้
export function learnedCount(p: VProgress, before?: string): number {
  return Object.entries(p.cards).filter(([id, c]) => isActiveCard(id) && (!before || (c.first || "") < before)).length;
}
// สัปดาห์ทวน = เลยสัปดาห์ของชุดล่าสุดในแผนไปแล้ว แต่ยังไม่ถึงชุดถัดไป (เช่น สัปดาห์ที่ 6 และ 14 ของภาค)
export function isReviewWeek(course: VCourse | null, today: string, room?: string | null): boolean {
  const k = plannedWeekNo(course, today, room);
  if (!course || !k) return false;
  const wk = course.weeks[k - 1];
  const off = (room && course.classDays?.[room]) || 0;
  return !!wk?.start && addDays(wk.start, 7 + off) <= today;
}
// คำใหม่ที่เรียนได้ในวันนี้: ปกติ 10 คำ · ถ้าช้ากว่าแผนเกิน 10 คำ เปิดให้ถึง 20 คำ
// สัปดาห์ทวน: ไม่มีชุดใหม่ — เปิดคำใหม่เฉพาะคนที่ยังขาดตามแผน (ไม่เกิน 20 คำ)
export function newCapToday(course: VCourse | null, p: VProgress, today: string, room?: string | null): number {
  const target = plannedWords(course, today, room);
  if (target === null) return NEW_PER_DAY;
  const need = target - learnedCount(p, today);
  if (isReviewWeek(course, today, room)) return Math.min(CATCHUP_PER_DAY, Math.max(0, need));
  return Math.min(CATCHUP_PER_DAY, Math.max(NEW_PER_DAY, need));
}

// วันที่ตามเครื่อง (ประเทศไทย) แบบ YYYY-MM-DD
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}
export function dayDiff(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export type WordStatus = "new" | "learning" | "known";
export const isKnown = (c?: VCard) => !!c && c.cd.length >= 2;
export const statusOf = (c?: VCard): WordStatus => (!c ? "new" : isKnown(c) ? "known" : "learning");
export const isDue = (c: VCard | undefined, today: string) => !!c && c.due <= today;

// ผลการเรียนครั้งแรก (จบขั้นที่ 4 ของชุดเรียน)
export function cardAfterLearning(
  prev: VCard | undefined,
  today: string,
  r: { firstTry: boolean; asked: number; wrong: number; g: number; p: number; pc: number }
): VCard {
  const base: VCard = prev ?? { s: 0, due: today, cd: [], first: today, last: "", at: 0, n: 0, w: 0, lap: 0, g: r.g, p: r.p, pc: r.pc };
  return {
    ...base,
    s: r.firstTry ? 1 : 0,
    due: addDays(today, r.firstTry ? GAP[1] : GAP[0]),
    cd: r.firstTry ? [today] : [],
    first: base.first || today,
    last: today,
    at: Date.now(),
    n: base.n + r.asked,
    w: base.w + r.wrong,
    g: r.g,
    p: r.p,
    pc: r.pc,
  };
}

// ผลการทวน 1 ข้อ (นับเฉพาะครั้งแรกของคำนั้นในวันนั้น)
export function cardAfterReview(c: VCard, today: string, correct: boolean): VCard {
  if (correct) {
    const s = Math.min(5, c.s + 1);
    const cd = c.cd.includes(today) ? c.cd : [...c.cd, today].slice(-5);
    return { ...c, s, due: addDays(today, GAP[s]), cd, last: today, at: Date.now(), n: c.n + 1 };
  }
  return { ...c, s: 0, due: addDays(today, GAP[0]), cd: [], last: today, at: Date.now(), n: c.n + 1, w: c.w + 1, lap: c.lap + 1 };
}

export function addDay(p: VProgress, today: string, d: Partial<VDay>): VProgress {
  const cur = p.days[today] ?? { n: 0, r: 0, c: 0, x: 0 };
  return {
    ...p,
    days: { ...p.days, [today]: { n: cur.n + (d.n ?? 0), r: cur.r + (d.r ?? 0), c: cur.c + (d.c ?? 0), x: cur.x + (d.x ?? 0) } },
  };
}

// ── สถิติ ──
export interface VStats {
  known: number;
  learning: number;
  seen: number;
  due: number;
  newToday: number;
  streak: number;
  activeDays7: number;
}
export function computeStats(p: VProgress, today: string = todayStr()): VStats {
  let known = 0, learning = 0, due = 0;
  for (const [id, c] of Object.entries(p.cards)) {
    if (!isActiveCard(id)) continue;
    if (isKnown(c)) known++;
    else learning++;
    if (c.due <= today) due++;
  }
  // วันติดต่อกัน (นับวันนี้ ถ้ายังไม่ทำวันนี้ให้นับต่อจากเมื่อวาน)
  const active = (d: string) => {
    const x = p.days[d];
    return !!x && x.n + x.r > 0;
  };
  let streak = 0;
  let d = active(today) ? today : addDays(today, -1);
  while (active(d)) {
    streak++;
    d = addDays(d, -1);
  }
  let activeDays7 = 0;
  for (let i = 0; i < 7; i++) if (active(addDays(today, -i))) activeDays7++;
  return { known, learning, seen: known + learning, due, newToday: p.days[today]?.n ?? 0, streak, activeDays7 };
}

// ── รวมข้อมูลจากหลายแหล่ง (เครื่อง + คลาวด์ / หลายบัญชี) โดยไม่ให้ถอยหลัง ──
export function mergeCard(a?: VCard, b?: VCard): VCard | undefined {
  if (!a) return b;
  if (!b) return a;
  const newer = (b.at ?? 0) >= (a.at ?? 0) ? b : a;
  return { ...newer, n: Math.max(a.n ?? 0, b.n ?? 0), w: Math.max(a.w ?? 0, b.w ?? 0), lap: Math.max(a.lap ?? 0, b.lap ?? 0), first: [a.first, b.first].filter(Boolean).sort()[0] ?? newer.first };
}
export function mergeProgress(a: VProgress, b: VProgress): VProgress {
  const cards: Record<string, VCard> = { ...(a.cards || {}) };
  for (const [k, v] of Object.entries(b.cards || {})) cards[k] = mergeCard(cards[k], v) ?? v;
  const days: Record<string, VDay> = { ...(a.days || {}) };
  for (const [k, v] of Object.entries(b.days || {})) {
    const x = days[k];
    days[k] = x ? { n: Math.max(x.n, v.n), r: Math.max(x.r, v.r), c: Math.max(x.c, v.c), x: Math.max(x.x, v.x) } : v;
  }
  return { cards, days };
}

// ── บันทึก / โหลด ──
function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}
const localKey = (email: string) => `v300:${emailToId(email)}`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function loadLocal(email: string): VProgress {
  try {
    const raw = localStorage.getItem(localKey(email));
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as VProgress;
    return { cards: p.cards || {}, days: p.days || {} };
  } catch {
    return emptyProgress();
  }
}
function saveLocal(email: string, p: VProgress) {
  try {
    localStorage.setItem(localKey(email), JSON.stringify(p));
  } catch {
    /* เครื่องไม่ให้เก็บ — ใช้คลาวด์แทน */
  }
}

// เก็บเฉพาะ 120 วันล่าสุดใน log กิจกรรม (กันเอกสารโตเกินไป)
function trimDays(p: VProgress): VProgress {
  const keys = Object.keys(p.days).sort();
  if (keys.length <= 120) return p;
  const days: Record<string, VDay> = {};
  for (const k of keys.slice(-120)) days[k] = p.days[k];
  return { ...p, days };
}

// คืนค่า needSync = true ถ้าในเครื่องมีผลที่ยังไม่ขึ้นคลาวด์ (เช่น คาบก่อนเน็ตหลุด) → ห้องคำศัพท์จะส่งขึ้นให้ทันที
export async function loadProgress(email: string): Promise<{ p: VProgress; needSync: boolean }> {
  const local = loadLocal(email);
  if (!email || !db) return { p: local, needSync: false };
  try {
    const snap = await withTimeout(getDoc(doc(db, "students", emailToId(email))), 8000);
    const cloud = (snap.exists() ? (snap.data()?.v300 as VProgress | undefined) : undefined) ?? emptyProgress();
    const cc = cloud.cards || {};
    const needSync = Object.entries(local.cards).some(([id, c]) => !cc[id] || (cc[id].at ?? 0) < (c.at ?? 0));
    const merged = mergeProgress(local, { cards: cc, days: cloud.days || {} });
    saveLocal(email, merged);
    return { p: merged, needSync };
  } catch (e) {
    console.error("loadProgress v300 error:", e);
    // เชื่อมระบบไม่ได้ (เน็ตหลุด) → ถือว่าผลในเครื่องยังไม่ขึ้นระบบ เพื่อให้หน้าแอปขึ้นแถบ ⚠️ พร้อมปุ่ม “ส่งอีกครั้ง”
    return { p: local, needSync: Object.keys(local.cards).length > 0 };
  }
}

// บันทึก (เครื่องทันที + คลาวด์) — คืน true ถ้าขึ้นคลาวด์สำเร็จ
export async function saveProgress(email: string, name: string, p: VProgress): Promise<boolean> {
  const data = trimDays(p);
  saveLocal(email, data);
  if (!email || !db) return false;
  const st = computeStats(data);
  try {
    await withTimeout(
      setDoc(
        doc(db, "students", emailToId(email)),
        {
          name,
          email: email.trim().toLowerCase(),
          v300: data,
          v300Known: st.known,
          v300Seen: st.seen,
          v300At: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      10000
    );
    return true;
  } catch (e) {
    console.error("saveProgress v300 error:", e);
    return false;
  }
}

// ── อันดับ (คำที่รู้แล้ว) ──
export interface RankEntry { email: string; name: string; known: number; seen: number; at: number }
export async function loadRanking(): Promise<RankEntry[]> {
  if (!db) return [];
  try {
    const snap = await withTimeout(getDocs(collection(db, "students")), 12000);
    const out: RankEntry[] = [];
    snap.forEach((d) => {
      const v = d.data() as { email?: string; name?: string; v300Known?: number; v300Seen?: number; v300At?: number };
      if (!v.v300Seen) return;
      out.push({ email: (v.email || d.id).toLowerCase(), name: v.name || "(ไม่มีชื่อ)", known: v.v300Known ?? 0, seen: v.v300Seen ?? 0, at: v.v300At ?? 0 });
    });
    out.sort((a, b) => b.known - a.known || b.seen - a.seen || a.at - b.at);
    return out;
  } catch (e) {
    console.error("loadRanking error:", e);
    return [];
  }
}

// ── ตัวช่วย ──
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
