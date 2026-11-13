// app/lib/booklet.ts — 📒 Smart Booklet M.6 (13 พ.ย. 2569)
//   คำศัพท์ 200 คำจาก ANR English Booklet M.6 (Gold Experience 6 · Unit 6–9) แบ่งเป็น 8 Part × 25 คำ
//   • สุ่มภายในเดือน: Part 1–2 = Unit 6 (พ.ย.) · 3–4 = Unit 7 (ธ.ค.) · 5–6 = Unit 8 (ม.ค.) · 7–8 = Unit 9 (ก.พ.)
//     แต่ละอีเมลได้ 25 คำของแต่ละ Part ไม่เหมือนกัน (สุ่มจากอีเมล · อีเมลเดิมได้ชุดเดิมเสมอ ไม่ต้องเก็บไว้)
//   • ข้อสอบ 25 ข้อ/รอบ: ทุกคำถามครั้งเดียว ครึ่งหนึ่ง อังกฤษ→ไทย อีกครึ่ง ไทย→อังกฤษ · ปรนัย 4 ตัวเลือก
//     ตัวเลือกลวงเป็นคำอื่นที่ชนิดคำเหมือนกัน (เดือนเดียวกันก่อน) · ลำดับข้อ/ตัวเลือก/ทิศทางสุ่มใหม่ทุกรอบ
//   • ผ่าน Part = ถูกครบทุกข้อ · ทำซ้ำได้ไม่จำกัด · ผ่านแล้วไม่ถูกลดสถานะ (ทบทวนซ้ำไม่บันทึกผล)
//   ไฟล์นี้ไม่ใช้ firebase / รายชื่อนักเรียน → ทดสอบแยกได้ และไม่พาข้อมูลของคนอื่นเข้าหน้านักเรียน
import RAW from "../../data/booklet200.json";

export interface BWord {
  no: number; // เลขที่คำใน Booklet 1–200
  en: string;
  pos: string; // ชนิดคำตาม Booklet
  th: string; // คำแปลไทย (ครูตรวจก่อนใช้)
  unit: number; // Unit 6–9
  g?: string; // กลุ่มคำใกล้เคียงกัน — ห้ามเป็นตัวเลือกลวงของกันและกัน
}
export const WORDS = RAW as BWord[];
export const PARTS = 8;
export const PART_SIZE = 25;
export const Q_PER_PART = PART_SIZE;
const MONTH_TH = ["พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ."];
export const partMonthNo = (part: number) => Math.ceil(part / 2); // 1..4
export const partUnit = (part: number) => 5 + partMonthNo(part); // 6..9
export const partMonthText = (part: number) => MONTH_TH[partMonthNo(part) - 1];
export const partLabel = (part: number) => `Part ${part} · ${partMonthText(part)} · Unit ${partUnit(part)}`;

// ── สุ่มแบบกำหนดจากอีเมล ──
export const emailId = (email: string) => email.trim().toLowerCase().replace(/\//g, "_");
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SALT = "anr-booklet-m6|v1";
const cache = new Map<string, Record<number, number[]>>();
// เลขที่คำ (no) ของแต่ละ Part ของอีเมลนี้
export function partition(email: string): Record<number, number[]> {
  const id = emailId(email);
  const hit = cache.get(id);
  if (hit) return hit;
  const out: Record<number, number[]> = {};
  for (let m = 1; m <= 4; m++) {
    const pool = WORDS.filter((w) => w.unit === 5 + m).map((w) => w.no);
    const s = shuffled(pool, mulberry32(fnv1a(`${SALT}|${id}|${m}`)));
    out[2 * m - 1] = s.slice(0, PART_SIZE).sort((a, b) => a - b);
    out[2 * m] = s.slice(PART_SIZE, 2 * PART_SIZE).sort((a, b) => a - b);
  }
  if (cache.size > 50) cache.clear();
  cache.set(id, out);
  return out;
}
const byNo = new Map(WORDS.map((w) => [w.no, w]));
export const wordOf = (no: number) => byNo.get(no)!;
export const partWords = (email: string, part: number): BWord[] => (partition(email)[part] ?? []).map(wordOf);

// ── ข้อสอบ ──
export type Dir = "en2th" | "th2en";
export interface BQuestion {
  no: number; // คำที่ถาม
  dir: Dir;
  prompt: string;
  pos: string;
  options: { no: number; text: string }[]; // 4 ตัวเลือก (no = คำเจ้าของตัวเลือก)
}

// ชนิดคำสำหรับเลือกตัวเลือกลวง (รูปแบบคล้ายกัน)
export function classOf(pos: string): string {
  switch (pos) {
    case "noun":
      return "n";
    case "verb":
      return "v";
    case "adjective":
      return "a";
    case "adverb":
      return "d";
    case "noun phrase":
      return "np";
    case "phrasal verb":
      return "pv";
    default:
      return "ph"; // phrase · prep. phrase · adj. + prep. · preposition
  }
}

export function pickDistractors(w: BWord, rnd: () => number, n = 3): BWord[] {
  const ok = (x: BWord) => x.no !== w.no && x.th !== w.th && x.en !== w.en && !(w.g && x.g === w.g);
  const cls = classOf(w.pos);
  const same = WORDS.filter((x) => ok(x) && classOf(x.pos) === cls);
  const picks: BWord[] = shuffled(same.filter((x) => x.unit === w.unit), rnd).slice(0, n);
  if (picks.length < n) {
    const have = new Set(picks.map((x) => x.no));
    for (const x of shuffled(same.filter((x) => x.unit !== w.unit && !have.has(x.no)), rnd)) {
      if (picks.length >= n) break;
      picks.push(x);
    }
  }
  if (picks.length < n) {
    const have = new Set(picks.map((x) => x.no));
    for (const x of shuffled(WORDS.filter((x) => ok(x) && !have.has(x.no)), rnd)) {
      if (picks.length >= n) break;
      picks.push(x);
    }
  }
  return picks;
}

export function buildQuiz(email: string, part: number, rnd: () => number = Math.random): BQuestion[] {
  const words = shuffled(partWords(email, part), rnd);
  const half = Math.floor(words.length / 2);
  const base: Dir[] = [...Array<Dir>(half).fill("en2th"), ...Array<Dir>(half).fill("th2en")];
  if (words.length % 2) base.push(rnd() < 0.5 ? "en2th" : "th2en"); // ข้อที่เกินมา 1 ข้อ สุ่มทิศทาง
  const dirs = shuffled(base, rnd);
  return words.map((w, i) => {
    const dir: Dir = dirs[i];
    const opts = shuffled([w, ...pickDistractors(w, rnd)], rnd);
    return {
      no: w.no,
      dir,
      prompt: dir === "en2th" ? w.en : w.th,
      pos: w.pos,
      options: opts.map((o) => ({ no: o.no, text: dir === "en2th" ? o.th : o.en })),
    };
  });
}

export interface Graded {
  correct: number;
  total: number;
  pass: boolean;
  wrong: { q: BQuestion; picked: number | null }[]; // picked = no ของตัวเลือกที่เลือก
}
export function gradeQuiz(qs: BQuestion[], picked: (number | null)[]): Graded {
  const wrong: Graded["wrong"] = [];
  qs.forEach((q, i) => {
    if (picked[i] !== q.no) wrong.push({ q, picked: picked[i] ?? null });
  });
  return { correct: qs.length - wrong.length, total: qs.length, pass: qs.length > 0 && wrong.length === 0, wrong };
}

// ── ความก้าวหน้า (เก็บในเครื่อง + สำเนาบนระบบ students/{id}.booklet.parts.{1..8}) ──
export interface PartRec {
  p: boolean; // ผ่านแล้ว (ถูกครบทุกข้อ)
  at?: number; // เวลาที่ผ่าน (ms)
  a: number; // ทำไปกี่รอบ (นับก่อนผ่าน)
  b: number; // คะแนนดีที่สุดที่เคยทำได้ (ข้อถูก)
}
export type BookProg = Record<string, PartRec>;

const key = (email: string) => `booklet:${emailId(email)}`;
export function loadLocalBooklet(email: string): BookProg {
  try {
    const j = JSON.parse(localStorage.getItem(key(email)) || "{}") as BookProg;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}
export function saveLocalBooklet(email: string, prog: BookProg) {
  try {
    localStorage.setItem(key(email), JSON.stringify(prog));
  } catch {
    /* ไม่เป็นไร */
  }
}
export function mergePart(a?: PartRec, b?: PartRec): PartRec | undefined {
  if (!a) return b;
  if (!b) return a;
  const p = !!a.p || !!b.p;
  const ats = [a.at, b.at].filter((x): x is number => typeof x === "number");
  return { p, at: p && ats.length ? Math.min(...ats) : undefined, a: Math.max(a.a || 0, b.a || 0), b: Math.max(a.b || 0, b.b || 0) };
}
export function mergeBooklet(a: BookProg, b: BookProg): BookProg {
  const out: BookProg = {};
  for (const k of Array.from(new Set(Object.keys(a).concat(Object.keys(b))))) {
    const m = mergePart(a[k], b[k]);
    if (m) out[k] = m;
  }
  return out;
}
export const passedParts = (prog: BookProg): number[] =>
  Array.from({ length: PARTS }, (_, i) => i + 1).filter((n) => prog[String(n)]?.p);
export const passedCount = (prog: BookProg) => passedParts(prog).length;
export const passedPartsLocal = (email: string) => passedCount(loadLocalBooklet(email));

// บันทึกผลรอบที่ทำจบ · ผ่านแล้ว = โหมดทบทวน ไม่บันทึกอะไร
export function recordAttempt(prog: BookProg, part: number, g: Graded, now: number): { prog: BookProg; rec: PartRec; changed: boolean; firstPass: boolean } {
  const k = String(part);
  const old = prog[k];
  if (old?.p) return { prog, rec: old, changed: false, firstPass: false };
  const rec: PartRec = { p: g.pass, a: (old?.a || 0) + 1, b: Math.max(old?.b || 0, g.correct) };
  if (g.pass) rec.at = now;
  return { prog: { ...prog, [k]: rec }, rec, changed: true, firstPass: g.pass };
}

// ข้อมูลที่เขียนขึ้นระบบ: ไม่ผ่าน = ส่งเฉพาะจำนวนรอบ/คะแนนดีสุด (ไม่ไปทับสถานะผ่านที่อาจมีอยู่บนระบบ)
export function cloudPartData(rec: PartRec): Record<string, unknown> {
  return rec.p ? { p: true, at: rec.at ?? Date.now(), a: rec.a, b: rec.b } : { a: rec.a, b: rec.b };
}
// อ่านเอกสารบนระบบให้เป็น BookProg (ทนข้อมูลผิดรูป)
export function parseCloudBooklet(d: unknown): BookProg {
  const parts = (d as { booklet?: { parts?: Record<string, { p?: unknown; at?: unknown; a?: unknown; b?: unknown }> } } | null | undefined)?.booklet?.parts;
  const out: BookProg = {};
  if (!parts || typeof parts !== "object") return out;
  for (let n = 1; n <= PARTS; n++) {
    const r = parts[String(n)];
    if (!r || typeof r !== "object") continue;
    out[String(n)] = { p: r.p === true, at: typeof r.at === "number" ? r.at : undefined, a: Number(r.a) || 0, b: Number(r.b) || 0 };
  }
  return out;
}

// ── หน้าครู: ข้อความวางกลุ่มไลน์ ──
export interface BookLineRow {
  no: number;
  name: string;
  prog: BookProg;
}
// sel = 0 → ยังไม่ผ่านครบ 8 Part (แสดง Part ที่ค้างของแต่ละคน) · sel = 1..8 → ยังไม่ผ่าน Part นั้น
export function bookLineText(room: string, rows: BookLineRow[], sel: number, withNames: boolean): string {
  const who = (r: BookLineRow) => (withNames ? `${r.no} ${r.name}` : `${r.no}`);
  const head = sel === 0 ? `📒 Smart Booklet ม.${room} — ยังทำไม่ครบ ${PARTS} Part` : `📒 Smart Booklet ม.${room} — ยังไม่ผ่าน Part ${sel}`;
  const miss = rows
    .map((r) => ({ r, left: Array.from({ length: PARTS }, (_, i) => i + 1).filter((n) => !r.prog[String(n)]?.p) }))
    .filter((x) => (sel === 0 ? x.left.length > 0 : x.left.includes(sel)));
  if (!miss.length) return `${head}\n✅ ผ่านครบทุกคนแล้ว`;
  const body = withNames
    ? miss.map((x) => (sel === 0 ? `${who(x.r)} (ค้าง ${x.left.join(",")})` : who(x.r))).join("\n")
    : sel === 0
      ? miss.map((x) => `${x.r.no}(ค้าง ${x.left.join(",")})`).join(" · ")
      : "เลขที่ " + miss.map((x) => x.r.no).join(", ");
  return `${head}\n${body}\n(ต้องถูกครบทุกข้อใน Part จึงผ่าน — ทำใหม่ได้ไม่จำกัด)`;
}
