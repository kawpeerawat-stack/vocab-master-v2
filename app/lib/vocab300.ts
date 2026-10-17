// app/lib/vocab300.ts
// ─────────────────────────────────────────────────────────────
// คำศัพท์แกน 300 คำ (TGAT / A-Level) — เรียนแบบ 5 ขั้น + ทวนแบบเว้นวัน
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
export interface VWeek { no: number; title: string; count: number }
export interface VCourse {
  id: string;
  version: number;
  title: string;
  titleTh: string;
  subtitle: string;
  papers: number;
  weeks: VWeek[];
  words: VWord[];
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

export const NEW_PER_DAY = 10;   // คำใหม่สูงสุดต่อวัน
export const BATCH_SIZE = 5;     // คำต่อชุดเรียน
export const REVIEW_LIMIT = 20;  // คำทวนสูงสุดต่อรอบ
const GAP = [1, 2, 4, 7, 14, 30];

export const emptyProgress = (): VProgress => ({ cards: {}, days: {} });

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
  for (const c of Object.values(p.cards)) {
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

export async function loadProgress(email: string): Promise<VProgress> {
  const local = loadLocal(email);
  if (!email || !db) return local;
  try {
    const snap = await withTimeout(getDoc(doc(db, "students", emailToId(email))), 8000);
    const cloud = (snap.exists() ? (snap.data()?.v300 as VProgress | undefined) : undefined) ?? emptyProgress();
    const merged = mergeProgress(local, { cards: cloud.cards || {}, days: cloud.days || {} });
    saveLocal(email, merged);
    return merged;
  } catch (e) {
    console.error("loadProgress v300 error:", e);
    return local;
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
