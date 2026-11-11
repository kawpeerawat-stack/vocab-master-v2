// app/lib/vocab300.ts
// ─────────────────────────────────────────────────────────────
// คำศัพท์แกน 120 คำ (TGAT / A-Level · ลดจาก 300 คำ ให้พอดีรายวิชา 2 ชม./สัปดาห์ · 12 ชุด ชุดละ 10 คำ) — เรียนแบบ 5 ขั้น จบในคาบ
//   เนื้อหา: data/vocab300.json → /api/course?id=vocab300
//   ความก้าวหน้า: students/{email}.v300 = { cards, days, sets }
//     + ฟิลด์สรุป v300Known / v300Seen / v300Sets / v300At (ไว้ให้หน้าครูและอันดับอ่านเร็ว)
//
// กติกา "ผ่านชุด" (ปรับ 2 พ.ย. 2569 ตามที่ครูขอ — จบในคาบเดียว ไม่ต้องรอวันอื่นมาทวน):
//   ① เรียนคำใหม่ของชุด 10 คำ (5 คำ × 2 รอบ) · ขั้นที่ 4 ข้อที่ผิดวนกลับมาจนถูกครบ
//   ② รอบทบทวนทั้ง 10 คำอีก 1 รอบ · ข้อที่ผิดวนเฉพาะข้อนั้นจนถูกครบ
//   ③ ครบแล้ว = ผ่านชุด (sets[k]) → หน้าครูขึ้น ✓ สีเขียวทันที · คำทั้ง 10 คำนับว่า "รู้แล้ว"
//   ชุดที่เรียนครบ 10 คำด้วยแอปแบบเดิม (ก่อนมีรอบทบทวน) นับว่าผ่าน (legacy) — ตามที่ครูให้ลงผ่านคาบ ม.6/5 วันที่ 2 พ.ย.
//   คะแนนชุด (เต็ม 10) = จำนวนคำที่ตอบถูกตั้งแต่ครั้งแรกในรอบทบทวน (ชุดแบบเดิมคิดจากขั้นที่ 4)
// การทวนคำของชุดก่อน ๆ ตามนัด (คาบหน้า → 2 → 4 → 8 → 12 สัปดาห์) ยังมีให้ทำ แต่ไม่บังคับและไม่มีผลต่อการผ่านชุด
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase";
import { collection, doc, FieldPath, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { saveLocalUnlock, serial, verifiedWrite, type SyncIssue } from "./sync";

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
  v?: number;     // 2 = เรียนด้วยแอปแบบใหม่ (มีรอบทบทวนชุด) · ไม่มี = แบบเดิม
  k?: number;     // เวลา (ms) ที่ชุดของคำนี้ผ่าน → "รู้แล้ว"
}
export interface VDay { n: number; r: number; c: number; x: number } // คำใหม่ / ข้อทวน / ถูก / ผิด
// ผลการผ่านชุด (key = เลขชุด "1"–"12")
export interface VSetPass {
  at: number;               // เวลาที่ผ่าน (ms)
  day: string;              // วันที่ผ่าน (YYYY-MM-DD)
  score: number;            // คะแนนชุด เต็ม 10
  learn?: [number, number]; // ขั้นที่ 4 ตอบถูกตั้งแต่ครั้งแรก / จำนวนข้อ (ทั้งชุด)
  legacy?: 1;               // ผ่านจากการเรียนครบ 10 คำด้วยแอปแบบเดิม
  // ระบบกัน AI ในรอบทบทวน: ออกจากหน้ากี่ครั้ง · เวลาที่หายไป (ms) · เสียโฟกัสกี่ครั้ง · คำที่ไม่นับคะแนน · โหมด
  gl?: number;
  ga?: number;
  gb?: number;
  gv?: number;
  gm?: "log" | "enforce";
  cm?: "cam" | "nocam" | "camfail"; // ใช้กล้องในรอบทบทวนหรือไม่ · gc = ถูกบังใบหน้ากี่ครั้ง · gca = เวลารวม (ms)
  gc?: number;
  gca?: number;
  gt?: number; // หมดเวลากี่คำ (ไม่ใช้กล้อง)
  gp?: number; // พบมือถือในกล้องกี่ครั้ง · gpf = มือถือไกล ๆ (ไม่ข้าม) · gpd = ตัวตรวจมือถือทำงานไหม
  gpf?: number;
  gpd?: "ready" | "slow" | "error" | "loading" | "off";
  prev?: { day: string; score: number; at: number }; // ผลเดิมที่ทำล่วงหน้า (ไม่นับ) — รอบนี้คือรอบทำใหม่พร้อมกล้อง
}
export interface VProgress { cards: Record<string, VCard>; days: Record<string, VDay>; sets?: Record<string, VSetPass> }

export const NEW_PER_DAY = 10;   // คำใหม่ต่อคาบ (1 ชุดสัปดาห์ = 10 คำ = 2 ชุดเรียน)
export const CATCHUP_PER_DAY = 20; // คนที่ช้ากว่าแผน (เช่น ขาดเรียน) เรียนได้ถึง 20 คำในคาบเดียว เพื่อตามให้ทัน
export const BATCH_SIZE = 5;     // คำต่อชุดเรียน
export const REVIEW_LIMIT = 20;  // คำทวนสูงสุดต่อรอบ
// ระยะนัดทวน (วัน) — ออกแบบให้ทุกกิจกรรมจบในคาบ (เรียนในห้อง สัปดาห์ละครั้ง ไม่มีการบ้าน)
//   ผิด → ขึ้นให้ทวนตั้งแต่ครั้งถัดไปที่เปิดแอป · ถูกครั้งแรก → คาบหน้า · จากนั้น 2 → 4 → 8 → 12 สัปดาห์
const GAP = [1, 7, 14, 28, 56, 84];

export const emptyProgress = (): VProgress => ({ cards: {}, days: {}, sets: {} });

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
// "รู้แล้ว" = ชุดของคำนี้ผ่านแล้ว (ดู normalizeProgress / passSet)
export const isKnown = (c?: VCard) => !!c && !!c.k;
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
    v: 2,
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

// ── ผ่านชุด ──
export const setWords = (words: VWord[], k: number) => words.filter((w) => w.week === k);
export const setPassOf = (p: VProgress, k: number): VSetPass | undefined => p.sets?.[String(k)];
export const passedCount = (p: VProgress) => Object.keys(p.sets || {}).length;
// สถานะชุด: none = ยังไม่เรียน · part = เรียนบางคำ · ready = เรียนครบ รอรอบทบทวน · passed = ผ่านแล้ว
export type SetState = "none" | "part" | "ready" | "passed";
export function setState(p: VProgress, words: VWord[], k: number): SetState {
  if (setPassOf(p, k)) return "passed";
  const ws = setWords(words, k);
  const n = ws.filter((w) => p.cards[w.id]).length;
  return n === 0 ? "none" : n < ws.length ? "part" : "ready";
}
// คะแนนจากขั้นที่ 4 (ถูกตั้งแต่ครั้งแรก / จำนวนข้อ) ของคำในชุด — ใช้กับชุดแบบเดิม และเก็บไว้ดูประกอบ
function learnFirstTry(p: VProgress, ws: VWord[]): [number, number] {
  let n = 0, w = 0;
  for (const x of ws) {
    const c = p.cards[x.id];
    if (!c) continue;
    n += c.n || 0;
    w += c.w || 0;
  }
  return [Math.max(0, n - w), n];
}
// บันทึกผ่านชุด k: ทุกคำในชุด "รู้แล้ว" · นัดทวนคาบหน้า (ไม่บังคับ)
export function passSet(p: VProgress, words: VWord[], k: number, today: string, info: { score: number; legacy?: boolean; at?: number; prev?: VSetPass["prev"] }): VProgress {
  const ws = setWords(words, k);
  const at = info.at ?? Date.now();
  const cards = { ...p.cards };
  for (const w of ws) {
    const c = cards[w.id];
    if (!c) continue;
    cards[w.id] = info.legacy
      ? { ...c, k: c.k || at }
      : { ...c, k: c.k || at, s: Math.max(1, c.s), due: addDays(today, GAP[1]), cd: c.cd.includes(today) ? c.cd : [...c.cd, today].slice(-5), at: Math.max(c.at || 0, at) };
  }
  const rec: VSetPass = { at, day: today, score: Math.max(0, Math.min(10, Math.round(info.score))), learn: learnFirstTry(p, ws) };
  if (info.legacy) rec.legacy = 1;
  if (info.prev) rec.prev = info.prev;
  return { ...p, cards, sets: { ...(p.sets || {}), [String(k)]: rec } };
}
// ชุดที่เรียนครบ 10 คำด้วยแอปแบบเดิม (ไม่มีคำไหนเรียนแบบใหม่) → นับว่าผ่าน · และทำให้คำในชุดที่ผ่านแล้วเป็น "รู้แล้ว" ครบ
// คืนค่าเดิม (อ้างอิงเดิม) ถ้าไม่มีอะไรเปลี่ยน
export function normalizeProgress(p: VProgress, words: VWord[]): VProgress {
  if (!words.length) return p;
  const nSets = words.reduce((m, w) => Math.max(m, w.week), 0);
  let out = p;
  for (let k = 1; k <= nSets; k++) {
    const ws = setWords(words, k);
    const rec = setPassOf(out, k);
    if (rec) {
      if (ws.some((w) => out.cards[w.id] && !out.cards[w.id].k)) {
        const cards = { ...out.cards };
        for (const w of ws) if (cards[w.id] && !cards[w.id].k) cards[w.id] = { ...cards[w.id], k: rec.at };
        out = { ...out, cards };
      }
      continue;
    }
    const cs = ws.map((w) => out.cards[w.id]);
    if (ws.length && cs.every((c) => c && c.v !== 2)) {
      const [c1, n1] = learnFirstTry(out, ws);
      const at = Math.max(...cs.map((c) => c!.at || 0));
      const day = cs.map((c) => c!.last || c!.first || "").sort().pop() || todayStr(new Date(at || Date.now()));
      out = passSet(out, words, k, day, { score: n1 ? (10 * c1) / n1 : 10, legacy: true, at });
    }
  }
  return out;
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
  const k = a.k && b.k ? Math.min(a.k, b.k) : a.k || b.k;
  const out: VCard = { ...newer, n: Math.max(a.n ?? 0, b.n ?? 0), w: Math.max(a.w ?? 0, b.w ?? 0), lap: Math.max(a.lap ?? 0, b.lap ?? 0), first: [a.first, b.first].filter(Boolean).sort()[0] ?? newer.first };
  if (k) out.k = k;
  if (a.v === 2 || b.v === 2) out.v = 2;
  return out;
}
export function mergeProgress(a: VProgress, b: VProgress): VProgress {
  const cards: Record<string, VCard> = { ...(a.cards || {}) };
  for (const [k, v] of Object.entries(b.cards || {})) cards[k] = mergeCard(cards[k], v) ?? v;
  const days: Record<string, VDay> = { ...(a.days || {}) };
  for (const [k, v] of Object.entries(b.days || {})) {
    const x = days[k];
    days[k] = x ? { n: Math.max(x.n, v.n), r: Math.max(x.r, v.r), c: Math.max(x.c, v.c), x: Math.max(x.x, v.x) } : v;
  }
  const sets: Record<string, VSetPass> = { ...(a.sets || {}) };
  for (const [k, v] of Object.entries(b.sets || {})) {
    const x = sets[k];
    // รอบทำใหม่ (มี prev) ชนะผลเดิมที่ทำล่วงหน้าเสมอ
    sets[k] = !x ? v : !!x.prev !== !!v.prev ? (x.prev ? x : v) : x.legacy && !v.legacy ? v : !x.legacy && v.legacy ? x : x.at <= v.at ? x : v;
  }
  return { cards, days, sets };
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
    return { cards: p.cards || {}, days: p.days || {}, sets: p.sets || {} };
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

// ── ส่งเฉพาะส่วนที่เปลี่ยน ──
// เก็บ "ลายนิ้วมือ" ของข้อมูลที่ขึ้นระบบแล้ว (ต่อการ์ด / ต่อวัน / ต่อชุด) ไว้ในเครื่อง
//   ครั้งต่อไปส่งเฉพาะการ์ด/วัน/ชุดที่ต่างจากที่ขึ้นระบบแล้ว → ข้อมูลที่ส่งเล็กลงหลายสิบเท่า (ปลายภาค ~150 KB → 2–5 KB)
interface SyncMeta { c: Record<string, string>; d: Record<string, string>; s: Record<string, string> }
const metaKey = (email: string) => `v300sync:${emailToId(email)}`;
// เรียงชื่อฟิลด์ก่อน (ข้อมูลจากระบบอาจเรียงฟิลด์ต่างจากในเครื่อง)
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}
function fp(x: unknown): string {
  const t = stable(x);
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + t.length.toString(36);
}
function loadMeta(email: string): SyncMeta {
  try {
    const m = JSON.parse(localStorage.getItem(metaKey(email)) || "null") as SyncMeta | null;
    if (m && m.c && m.d && m.s) return m;
  } catch {
    /* เริ่มใหม่ */
  }
  return { c: {}, d: {}, s: {} };
}
function saveMeta(email: string, m: SyncMeta) {
  try {
    localStorage.setItem(metaKey(email), JSON.stringify(m));
  } catch {
    /* ไม่เป็นไร */
  }
}
const metaOf = (p: VProgress): SyncMeta => ({
  c: Object.fromEntries(Object.entries(p.cards || {}).map(([k, v]) => [k, fp(v)])),
  d: Object.fromEntries(Object.entries(p.days || {}).map(([k, v]) => [k, fp(v)])),
  s: Object.fromEntries(Object.entries(p.sets || {}).map(([k, v]) => [k, fp(v)])),
});
// ส่วนที่ยังไม่ขึ้นระบบ
function diffOf(p: VProgress, m: SyncMeta): { part: VProgress; n: number } {
  const cards: Record<string, VCard> = {};
  const days: Record<string, VDay> = {};
  const sets: Record<string, VSetPass> = {};
  for (const [k, v] of Object.entries(p.cards || {})) if (m.c[k] !== fp(v)) cards[k] = v;
  for (const [k, v] of Object.entries(p.days || {})) if (m.d[k] !== fp(v)) days[k] = v;
  for (const [k, v] of Object.entries(p.sets || {})) if (m.s[k] !== fp(v)) sets[k] = v;
  return { part: { cards, days, sets }, n: Object.keys(cards).length + Object.keys(days).length + Object.keys(sets).length };
}
// ในเครื่องมีผลที่ยังไม่ขึ้นระบบหรือไม่
export const hasUnsynced = (email: string, p: VProgress) => diffOf(p, loadMeta(email)).n > 0;

// คืนค่า needSync = true ถ้าในเครื่องมีผลที่ยังไม่ขึ้นคลาวด์ (เช่น คาบก่อนเน็ตหลุด) → ห้องคำศัพท์จะส่งขึ้นให้ทันที
// cloudSets = ชุดที่ผ่านแล้วซึ่งอยู่บนระบบแล้ว · null = เชื่อมระบบไม่ได้
export async function loadProgress(email: string): Promise<{ p: VProgress; needSync: boolean; cloudSets: string[] | null }> {
  const local = loadLocal(email);
  if (!email || !db) return { p: local, needSync: false, cloudSets: null };
  try {
    const snap = await withTimeout(getDoc(doc(db, "students", emailToId(email))), 8000);
    const data = snap.exists() ? snap.data() : undefined;
    saveLocalUnlock(email, data?.unlock ?? {});
    const cloud = (data?.v300 as VProgress | undefined) ?? emptyProgress();
    const cloudP: VProgress = { cards: cloud.cards || {}, days: cloud.days || {}, sets: cloud.sets || {} };
    saveMeta(email, metaOf(cloudP)); // สิ่งที่อยู่บนระบบตอนนี้
    const merged = mergeProgress(local, cloudP);
    saveLocal(email, merged);
    return { p: merged, needSync: diffOf(merged, metaOf(cloudP)).n > 0, cloudSets: Object.keys(cloudP.sets || {}) };
  } catch (e) {
    console.error("loadProgress v300 error:", e);
    // เชื่อมระบบไม่ได้ → ดูจากที่จำไว้ว่าขึ้นระบบอะไรไปแล้ว
    return { p: local, needSync: hasUnsynced(email, local), cloudSets: null };
  }
}

// บันทึก (เครื่องทันที + ส่งขึ้นระบบเฉพาะส่วนที่เปลี่ยน) — ส่งทีละครั้งต่อนักเรียน
export type SaveResult = { ok: true } | { ok: false; issue: SyncIssue };
export async function saveProgress(email: string, name: string, p: VProgress, onSlow?: () => void): Promise<SaveResult> {
  const data = trimDays(p);
  saveLocal(email, data);
  if (!email || !db) return { ok: false, issue: "error" };
  return serial(emailToId(email), async () => {
    const meta = loadMeta(email);
    const { part, n } = diffOf(data, meta);
    if (n === 0) return { ok: true as const };
    const st = computeStats(data);
    // ⚠️ 9 พ.ย.: ต้นเหตุที่หน้าครูขึ้น R ค้าง — เดิมส่ง v300: { cards, days, sets } แบบ merge
    //   ถ้ากล่องไหนว่าง ({}) Firebase จะเขียนทับกล่องบนระบบให้ว่าง (ชุดที่ผ่านแล้วหาย)
    //   แก้: ระบุ "ช่องที่เปลี่ยน" ทีละช่อง (mergeFields) → แตะเฉพาะการ์ด/วัน/ชุดที่เปลี่ยน · ช่องที่ส่งถูกแทนทั้งก้อน (ไม่มีค่าเก่าค้าง)
    const v300: Partial<VProgress> = {};
    const fields: (string | FieldPath)[] = ["name", "email", "v300Known", "v300Seen", "v300Sets", "v300At", "updatedAt"];
    for (const key of ["cards", "days", "sets"] as const) {
      const box = (part[key] || {}) as Record<string, unknown>;
      if (!Object.keys(box).length) continue;
      (v300 as Record<string, unknown>)[key] = box;
      for (const id of Object.keys(box)) fields.push(new FieldPath("v300", key, id));
    }
    const r = await verifiedWrite(() =>
      setDoc(
        doc(db, "students", emailToId(email)),
        {
          name,
          email: email.trim().toLowerCase(),
          v300,
          v300Known: st.known,
          v300Seen: st.seen,
          v300Sets: passedCount(data),
          v300At: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { mergeFields: fields }
      ),
      onSlow
    );
    if (r.ok) {
      const m = loadMeta(email);
      const pm = metaOf(part);
      saveMeta(email, { c: { ...m.c, ...pm.c }, d: { ...m.d, ...pm.d }, s: { ...m.s, ...pm.s } });
    }
    return r;
  });
}

// ── อันดับ (คำที่รู้แล้ว) ──
export interface RankEntry { email: string; name: string; known: number; seen: number; at: number }
// เก็บผลอันดับไว้ใช้ซ้ำ 10 นาที (อ่านข้อมูลทั้งห้องครั้งเดียว — ประหยัดโควตาฟรีของ Firebase)
let rankCache: { at: number; list: RankEntry[] } | null = null;
const RANK_TTL = 10 * 60 * 1000;
// ห้องเรียนพิเศษ (รหัส ex:…) แยกอันดับจากนักเรียนโรงเรียน — ไม่ปนกันทั้งสองทาง
const isExtraKey = (k: string) => k.startsWith("ex:");
export async function loadRanking(extra = false): Promise<RankEntry[]> {
  const all = await loadRankingAll();
  return all.filter((e) => isExtraKey(e.email) === extra);
}
async function loadRankingAll(): Promise<RankEntry[]> {
  if (!db) return [];
  if (rankCache && Date.now() - rankCache.at < RANK_TTL) return rankCache.list;
  try {
    const raw = sessionStorage.getItem("v300rank");
    if (raw) {
      const c = JSON.parse(raw) as { at: number; list: RankEntry[] };
      if (Date.now() - c.at < RANK_TTL) {
        rankCache = c;
        return c.list;
      }
    }
  } catch {
    /* ไม่เป็นไร */
  }
  try {
    const snap = await withTimeout(getDocs(collection(db, "students")), 12000);
    const out: RankEntry[] = [];
    snap.forEach((d) => {
      const v = d.data() as { email?: string; name?: string; v300Known?: number; v300Seen?: number; v300At?: number; hidden?: boolean };
      if (!v.v300Seen || v.hidden || d.id.startsWith("cfg:")) return;
      out.push({ email: (v.email || d.id).toLowerCase(), name: v.name || "(ไม่มีชื่อ)", known: v.v300Known ?? 0, seen: v.v300Seen ?? 0, at: v.v300At ?? 0 });
    });
    out.sort((a, b) => b.known - a.known || b.seen - a.seen || a.at - b.at);
    rankCache = { at: Date.now(), list: out };
    try {
      sessionStorage.setItem("v300rank", JSON.stringify(rankCache));
    } catch {
      /* ไม่เป็นไร */
    }
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
