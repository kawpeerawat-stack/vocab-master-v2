// app/lib/reading.ts
// ─────────────────────────────────────────────────────────────
// v9.9 (18 พ.ย. 2569) · Reading เชื่อมคำศัพท์ ม.6 — ฝึก ไม่นับคะแนน ทำซ้ำได้
//   📰 บทอ่านพรีวิว (คาบ 2 · หลังผ่านรอบทบทวนชุดคำศัพท์แกน) ใช้ครบ 10 คำของชุด + คำถามแบบข้อสอบ
//   🔎 บทอ่านถอดรหัส (คาบ 1 · หลังทำตั๋วออกของบทถอดรหัส) คำใหม่ที่ถอดได้ด้วยรหัสของบท
//   🔗 กล่องเชื่อมรหัส (bridge) ในบัตรคำ: รหัสในคำนี้เรียนบทไหน + คำตระกูลที่ใช้รหัสของบทถอดรหัส
//   เนื้อหา: data/reading.json (สร้างจากต้นฉบับที่ครูตรวจแล้ว) · ไม่ import firebase
//   ผลการทำเก็บในเครื่องเท่านั้น (คะแนนดีที่สุด) — ไม่ขึ้นระบบ ไม่เข้าสมุดคะแนน
// ─────────────────────────────────────────────────────────────
import RAW from "../../data/reading.json";

export interface RQuestion { q: string; o: string[]; a: number; why: string }
export interface RCover { w: string; s?: number; l?: string } // s = ชุดคำศัพท์แกน · l = บทถอดรหัส (id)
export interface RPreview { title: string; topic: string; sents: string[]; qs: RQuestion[]; cover: RCover[]; nWords: number }
export interface RDecodeWord { w: string; code: string; th: string; kind: "new" | "recap" | "trap" }
export interface RDecode { title: string; topic: string; sents: string[]; words: RDecodeWord[]; qs: RQuestion[]; also: RCover[] }
export interface RWeek { week: number; lesson: string; lessonHour: number; lessonTitle: string; set: number | null; dateLabel: string; preview: RPreview | null; decode: RDecode }
export interface RBridge { parts?: { c: string; m: string; l: number }[]; fam?: { w: string; c: string; l: number }[]; trap?: string }
export type RSkill = "V" | "D" | "M" | "I" | "C";
export interface RReviewQ extends RQuestion { t: RSkill; id: string }
export interface RReview { title: string; topic: string; sents: string[]; pool: RReviewQ[] }
interface RData { version: string; weeks: RWeek[]; bridge: Record<string, RBridge>; review: Record<string, RReview> }

const DATA = RAW as unknown as RData;

export const READING_WEEKS: RWeek[] = DATA.weeks;
export const readingBySet = (k: number): RWeek | undefined => DATA.weeks.find((w) => w.set === k && !!w.preview);
export const readingByLesson = (lessonId: string): RWeek | undefined => DATA.weeks.find((w) => w.lesson === lessonId);
export const bridgeOf = (word: string): RBridge | undefined => DATA.bridge[word];

// ── v10.0: บทอ่านในรอบทบทวนชุดคำศัพท์แกน (ชุด 1–12) ──
//   คลังบทละ 8 ข้อ (V2 D2 M1 I2 C1) → สุ่มทักษะละ 1 ข้อ = 5 ข้อ · ลำดับ: รายละเอียด → ความหมายในบริบท → อ้างอิง/อนุมาน → คำเชื่อม/รหัส → ใจความหลัก
export const SKILL_LABEL: Record<RSkill, string> = { V: "ความหมายในบริบท", D: "รายละเอียด", M: "ใจความหลัก", I: "อ้างอิง / อนุมาน", C: "คำเชื่อม / รหัสคำ" };
const SKILL_ORDER: RSkill[] = ["D", "V", "I", "C", "M"];
export const reviewOf = (k: number): RReview | undefined => DATA.review?.[String(k)];
export function drawReview(k: number): RReviewQ[] {
  const r = reviewOf(k);
  if (!r) return [];
  return SKILL_ORDER.map((t) => {
    const c = r.pool.filter((q) => q.t === t);
    return c[Math.floor(Math.random() * c.length)];
  }).filter(Boolean);
}
// เวลาต่อข้อของคำถามบทอ่าน: ข้อแรกรวมเวลาอ่านบท
export const READ_FIRST_MS = 120000;
export const READ_Q_MS = 60000;

// ── แถบ "คุณรู้แล้ว X%" ──
export interface CoverResult { known: number; total: number; pct: number; rows: { w: string; known: boolean; where: string }[] }
export function coverOf(p: RPreview, knownCore: (setNo: number, w: string) => boolean, lessonDone: (lessonId: string) => boolean): CoverResult {
  const rows = p.cover.map((c) => {
    const k = (c.s ? knownCore(c.s, c.w) : false) || (c.l ? lessonDone(c.l) : false);
    const where = c.s ? `ชุดที่ ${c.s}` : c.l ? `บทถอดรหัส ${Number(c.l.replace(/\D/g, ""))}` : "";
    return { w: c.w, known: k, where };
  });
  const known = rows.filter((r) => r.known).length;
  const total = rows.length;
  return { known, total, pct: total ? Math.round((100 * known) / total) : 0, rows };
}

// ── คะแนนดีที่สุด (ในเครื่องเท่านั้น) ──
export interface RBest { b: number; t: number; n: number; at: number }
const KEY = (email: string) => `vm:reading:v1:${email.toLowerCase()}`;
export function loadReadingBest(email: string): Record<string, RBest> {
  try {
    const raw = window.localStorage.getItem(KEY(email));
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
export function saveReadingBest(email: string, id: string, score: number, total: number): Record<string, RBest> {
  const all = loadReadingBest(email);
  const cur = all[id];
  all[id] = { b: Math.max(cur?.b ?? 0, score), t: total, n: (cur?.n ?? 0) + 1, at: Date.now() };
  try {
    window.localStorage.setItem(KEY(email), JSON.stringify(all));
  } catch {
    /* เก็บไม่ได้ก็ไม่เป็นไร (ฝึกอย่างเดียว) */
  }
  return all;
}

// ── รายชื่อข้อสอบแบบย่อ: "GAT 63", "GAT 65" → "GAT 63/65" ──
export function groupExams(ex: string[]): string {
  const order: string[] = [];
  const years: Record<string, string[]> = {};
  for (const e of ex) {
    const m = /^(.*?)\s(\d{2}(?:\d{2})?)$/.exec(e);
    const k = m ? m[1] : e;
    if (!(k in years)) {
      years[k] = [];
      order.push(k);
    }
    if (m) years[k].push(m[2]);
  }
  return order.map((k) => (years[k].length ? `${k} ${years[k].join("/")}` : k)).join(" · ");
}

// ── สลับตัวเลือก (ตอนทำในแอป) ──
export function shuffleQ(q: RQuestion): RQuestion {
  const idx = [0, 1, 2, 3].slice(0, q.o.length);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return { q: q.q, o: idx.map((i) => q.o[i]), a: idx.indexOf(q.a), why: q.why };
}
