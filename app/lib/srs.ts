// app/lib/srs.ts
// ─────────────────────────────────────────────────────────────
// ระบบทบทวนซ้ำตามช่วงเวลา (Spaced Repetition System) แบบกล่อง Leitner
//
// แนวคิด: ทุกคำมี "กล่อง" (box 0–5) ยิ่งกล่องสูง = จำได้แม่นขึ้น
//   - ตอบถูก  → เลื่อนขึ้น 1 กล่อง, นัดทบทวนครั้งหน้าให้ห่างขึ้น
//   - ตอบผิด  → ตกลงมากล่อง 0 (นับเป็น lapse) แล้วนัดทบทวนทันทีในรอบถัด ๆ ไป
//   - คำจะถูก "เลือกมาออกข้อสอบ" เมื่อ "ถึงกำหนด" (due <= ตอนนี้)
//   - คำที่ขึ้นถึงกล่องบนสุด + ตอบถูกหลายครั้ง = ถือว่า Mastered จริง
//
// เก็บข้อมูลใน localStorage แยกตามอีเมลนักเรียน
// ออกแบบให้ย้ายไปเก็บบน Firestore ภายหลังได้ (ดูฟังก์ชัน serialize/deserialize)
// ─────────────────────────────────────────────────────────────

export interface SrsCard {
  box: number;          // 0..MAX_BOX (กล่อง "ปัจจุบัน" — ใช้กำหนดว่าจะถามซ้ำเมื่อไหร่)
  bestBox: number;      // กล่องสูงสุดที่เคยทำได้ (ใช้คำนวณ % ความก้าวหน้า — ตอบผิดภายหลังไม่ลดค่านี้)
  masteredEver: boolean;// เคย "เชี่ยวชาญ" มาก่อนไหม (ติดค้างตลอดไป แม้ภายหลังจะตอบผิด)
  due: number;          // timestamp (ms) ครั้งต่อไปที่ควรทบทวน
  reps: number;         // จำนวนครั้งที่ตอบถูกสะสม
  lapses: number;       // จำนวนครั้งที่ "ลืม" (ตอบผิดหลังเคยถูก)
  streak: number;       // ตอบถูกติดต่อกันกี่ครั้ง
  lastReviewed: number; // timestamp ครั้งล่าสุดที่ทบทวน
}

export type SrsStore = Record<string, SrsCard>; // key = word

// ระดับคำศัพท์ (ใช้คงบันไดความยากเดิม B1 → B2 → C1)
export interface LevelWord {
  word: string;
  level: string;
}

const DAY = 24 * 60 * 60 * 1000;

export const MAX_BOX = 5;

// ระยะห่างของแต่ละกล่อง (มิลลิวินาที) — box 0 = ทบทวนทันที (รอบถัดไป)
const BOX_INTERVALS_MS: number[] = [
  0,          // box 0: ถึงกำหนดทันที
  1 * DAY,    // box 1
  3 * DAY,    // box 2
  7 * DAY,    // box 3
  16 * DAY,   // box 4
  35 * DAY,   // box 5 (ทบทวนนาน ๆ ครั้งเพื่อกันลืม)
];

// ถือว่า "ผ่าน/เชี่ยวชาญ" ทันทีที่ตอบถูก 1 ครั้ง (ไม่ต้องไต่กล่องทีละขั้นอีกต่อไป — เน้นให้เจอคำใหม่ได้กว้างที่สุด)
const MASTERED_BOX = MAX_BOX;

const STORAGE_PREFIX = 'vocab_srs::';
const LEGACY_KEY = 'vocab_mastered_progress'; // ระบบเก่า: array ของคำที่ผ่านแล้ว

// ── helper: key ของ localStorage ต่อนักเรียน ──
function storageKeyFor(email: string): string {
  return STORAGE_PREFIX + email.trim().toLowerCase();
}

function now(): number {
  return Date.now();
}

// ── สร้างการ์ดใหม่สำหรับคำที่ยังไม่เคยเจอ ──
export function newCard(): SrsCard {
  return { box: 0, bestBox: 0, masteredEver: false, due: 0, reps: 0, lapses: 0, streak: 0, lastReviewed: 0 };
}

// ── อัปเดตการ์ดหลังตอบ 1 ข้อ (correct = true/false) ──
export function review(card: SrsCard | undefined, correct: boolean): SrsCard {
  const c: SrsCard = card ? { ...card } : newCard();
  // รองรับการ์ดเก่าจาก localStorage/cloud ที่ยังไม่มี field ใหม่ (กันพัง)
  if (c.bestBox == null) c.bestBox = c.box;
  if (c.masteredEver == null) c.masteredEver = false;
  const t = now();
  c.lastReviewed = t;

  if (correct) {
    c.reps += 1;
    c.streak += 1;
    // ตอบถูก = "ผ่าน" ทันที (ไม่ต้องไต่กล่องทีละขั้นแบบเดิมอีกแล้ว)
    //   ทั้งตอบถูกครั้งแรกเจอเลย และตอบถูกตอนกลับมาแก้คำที่เคยพลาด ล้วนถือว่าผ่านเท่ากัน
    c.box = MAX_BOX;
  } else {
    // ตอบผิด: ถ้าเคยผ่านไปแล้วแล้วมาตอบผิดอีกครั้ง (ไม่ค่อยเกิดเพราะคำที่ผ่านแล้วจะไม่ถูกดึงมาถามซ้ำ)
    // นับเป็น lapse แล้วต้องกลับไปเริ่มใหม่ที่กล่อง 0 (รอกลับมาแก้ตัว)
    if (c.box > 0) c.lapses += 1;
    c.box = 0;
    c.streak = 0;
  }

  // อัปเดตสถิติ "จุดสูงสุดที่เคยทำได้" — เพิ่มขึ้นได้อย่างเดียว ไม่มีวันลดจากตอบผิด
  c.bestBox = Math.max(c.bestBox, c.box);
  if (c.box >= MASTERED_BOX) c.masteredEver = true;

  c.due = t + BOX_INTERVALS_MS[c.box];
  return c;
}

export function isMastered(card: SrsCard | undefined): boolean {
  if (!card) return false;
  // เคยผ่านมาก่อน (ค้างตลอดไป) หรือกำลังอยู่ในสถานะผ่านตอนนี้พอดี — ไม่ต้องเช็ค streak อีกต่อไป
  return !!card.masteredEver || card.box >= MASTERED_BOX;
}

export function isDue(card: SrsCard | undefined, at: number = now()): boolean {
  if (!card) return false; // คำที่ยังไม่เคยเจอ ไม่นับว่า "ถึงกำหนดทบทวน" (เป็นคำใหม่)
  return card.due <= at;
}

// ── สถิติภาพรวม สำหรับแสดงบน Dashboard ──
export interface SrsStats {
  total: number;       // จำนวนคำทั้งคลัง
  seen: number;        // เคยเจอแล้ว (มีการ์ด)
  learning: number;    // กำลังเรียน (เห็นแล้วแต่ยังไม่ mastered)
  mastered: number;    // เชี่ยวชาญจริง
  dueNow: number;      // ถึงกำหนดทบทวนตอนนี้
  newRemaining: number;// คำใหม่ที่ยังไม่เคยเจอ
  coverage: number;    // % ของคำที่เริ่มเรียนแล้ว (เห็น ÷ ทั้งหมด)
  weightedProgress: number; // % ความก้าวหน้าแบบให้คะแนนบางส่วน (ตามกล่อง SRS)
}

export function computeStats(store: SrsStore, allWords: string[]): SrsStats {
  const t = now();
  let seen = 0, mastered = 0, dueNow = 0, boxSum = 0;
  for (const w of allWords) {
    const card = store[w];
    if (!card) continue;
    seen += 1;
    // ใช้ "กล่องสูงสุดที่เคยทำได้" (bestBox) ไม่ใช่กล่องปัจจุบัน — กันไม่ให้ % ลดลงเมื่อตอบผิดคำที่เคยทำถูกแล้ว
    boxSum += card.bestBox ?? card.box;
    if (isMastered(card)) mastered += 1;
    if (card.due <= t) dueNow += 1;
  }
  const total = allWords.length;
  // ── ความก้าวหน้ารวม (headline %) ──
  // ครึ่งหนึ่งจาก "จำนวนคำที่เริ่มเรียนแล้ว" (เห็น ÷ ทั้งหมด) → กดผ่านคำใหม่ % ขยับทันที
  // อีกครึ่งจาก "ระดับความจำเฉลี่ย" (ผลรวมกล่อง ÷ (กล่องสูงสุด × ทั้งหมด)) → ทบทวนจนแม่น % ยิ่งเพิ่ม
  // แตะ 100% เมื่อ "เรียนครบทุกคำ + จำแม่นทุกคำ (box 5)"
  const COVERAGE_WEIGHT = 0.5; // น้ำหนัก "จำนวนคำที่เรียนแล้ว" (0–1) ปรับได้
  const coverageRatio = total > 0 ? seen / total : 0;
  // มาสเตอรี่คิดจาก "เฉลี่ยกล่องของคำที่เคยเจอแล้ว" (หารด้วย seen ไม่ใช่ total)
  //   เดิมหารด้วย total ทำให้แม้เชี่ยวชาญคำที่เจอครบ 100% ก็ยังโชว์ % ต่ำ (ถูกเจือจางด้วยคำที่ยังไม่เจอ)
  //   ตอนนี้ coverageRatio (เจอไปกี่% ของคลัง) รับหน้าที่นับคำที่ยังไม่เจอแทนอยู่แล้ว ไม่ต้องนับซ้ำสองรอบ
  const masteryRatio = seen > 0 ? boxSum / (MAX_BOX * seen) : 0;
  const weightedProgress = (COVERAGE_WEIGHT * coverageRatio + (1 - COVERAGE_WEIGHT) * masteryRatio) * 100;
  return {
    total,
    seen,
    learning: seen - mastered,
    mastered,
    dueNow,
    newRemaining: total - seen,
    coverage: coverageRatio * 100,
    weightedProgress,
  };
}

// ── เลือกคำมาออกข้อสอบ 1 รอบ ──
// คงบันได B1(4) → B2(4) → C1(2) เดิม แต่ในแต่ละระดับ ให้ความสำคัญ:
//   1) คำที่ "ถึงกำหนดทบทวน" (เรียงด่วนสุดก่อน)
//   2) คำใหม่ที่ยังไม่เคยเจอ
//   3) คำที่เคยเจอแต่ยังไม่ถึงกำหนด (กล่องต่ำก่อน)
// ผลที่ได้: เด็กจะได้ทบทวนคำที่เคยเดา/พลาดเสมอ ผสมกับคำใหม่
export interface PickRoundOptions {
  total?: number;                       // จำนวนข้อต่อรอบ (ค่าเริ่มต้น 10)
  levelPlan?: { level: string; count: number }[]; // แผนบันไดความยาก
}

const DEFAULT_LEVEL_PLAN = [
  { level: 'B1', count: 4 },
  { level: 'B2', count: 4 },
  { level: 'C1', count: 2 },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickRound(
  store: SrsStore,
  vocab: LevelWord[],
  options: PickRoundOptions = {}
): string[] {
  const total = options.total ?? 10;
  const plan = options.levelPlan ?? DEFAULT_LEVEL_PLAN;
  const t = now();

  const chosen: string[] = [];
  const chosenSet = new Set<string>();

  // คัดคำตามลำดับความสำคัญภายใน "พูล" ที่กำหนด
  const pickFromPool = (pool: LevelWord[], count: number) => {
    if (count <= 0) return;
    const candidates = pool.filter((w) => !chosenSet.has(w.word));

    // ทบทวนเฉพาะคำที่ "ยังไม่ผ่าน" (เคยตอบผิดค้างอยู่ที่กล่อง 0) — คำที่ผ่านแล้ว (box สูงสุด) จะไม่ถูกดึงมาถามซ้ำอัตโนมัติอีกเลย
    //   เพื่อเปิดทางให้เจอ "คำใหม่" ได้กว้างที่สุด แทนที่จะเสียโควตาไปกับคำที่ทำได้แล้ว
    const due = candidates
      .filter((w) => store[w.word] && store[w.word].box < MAX_BOX && store[w.word].due <= t)
      .sort((a, b) => store[a.word].due - store[b.word].due); // ด่วนสุดก่อน

    const fresh = shuffle(candidates.filter((w) => !store[w.word]));

    const seenNotDue = candidates
      .filter((w) => store[w.word] && store[w.word].box < MAX_BOX && store[w.word].due > t)
      .sort((a, b) => store[a.word].due - store[b.word].due); // ใกล้ครบกำหนดก่อน (กันคำที่เพิ่งตอบถูกหมาด ๆ ถูกดึงกลับมาซ้ำเร็วเกินไป)

    const ordered = [...due, ...fresh, ...seenNotDue];
    for (const w of ordered) {
      if (chosen.length >= total) break;
      if (count <= 0) break;
      if (chosenSet.has(w.word)) continue;
      chosen.push(w.word);
      chosenSet.add(w.word);
      count -= 1;
    }
  };

  // 1) เดินตามแผนบันไดความยาก
  for (const step of plan) {
    const pool = vocab.filter((w) => w.level === step.level);
    pickFromPool(pool.length > 0 ? pool : vocab, step.count);
  }

  // 2) ถ้ายังไม่ครบ (เช่นบางระดับคำหมด) เติมจากทั้งคลัง โดยใช้เกณฑ์เดียวกัน
  if (chosen.length < total) {
    pickFromPool(vocab, total - chosen.length);
  }

  return chosen;
}

// ─────────────────────────────────────────────────────────────
// การอ่าน/บันทึก (localStorage) — แยกตามอีเมล
// ─────────────────────────────────────────────────────────────

export function loadStore(email: string): SrsStore {
  if (typeof window === 'undefined' || !email) return {};
  try {
    const raw = window.localStorage.getItem(storageKeyFor(email));
    if (raw) return JSON.parse(raw) as SrsStore;
  } catch (e) {
    console.error('SRS loadStore error:', e);
  }
  return {};
}

export function saveStore(email: string, store: SrsStore): void {
  if (typeof window === 'undefined' || !email) return;
  try {
    window.localStorage.setItem(storageKeyFor(email), JSON.stringify(store));
  } catch (e) {
    console.error('SRS saveStore error:', e);
  }
}

// ── ย้ายข้อมูลจากระบบเก่า (array ของคำที่ "ผ่านแล้ว") มาเป็นการ์ด box สูง ──
// เรียกครั้งเดียวตอนล็อกอิน ถ้ายังไม่มีข้อมูล SRS ของอีเมลนี้
export function migrateLegacyIfNeeded(email: string, store: SrsStore): SrsStore {
  if (typeof window === 'undefined') return store;
  if (Object.keys(store).length > 0) return store; // มีข้อมูลแล้ว ไม่ต้องย้าย
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return store;
    const masteredWords = JSON.parse(raw) as string[];
    if (!Array.isArray(masteredWords) || masteredWords.length === 0) return store;
    const migrated: SrsStore = {};
    const t = now();
    for (const w of masteredWords) {
      // ใส่ไว้กล่องกลาง ๆ (box 3) เพื่อให้ระบบพากลับมาทบทวนยืนยันอีกครั้ง
      migrated[w] = {
        box: 3,
        bestBox: 3,
        masteredEver: false,
        due: t + BOX_INTERVALS_MS[3],
        reps: 1,
        lapses: 0,
        streak: 1,
        lastReviewed: t,
      };
    }
    saveStore(email, migrated);
    return migrated;
  } catch (e) {
    console.error('SRS migrate error:', e);
    return store;
  }
}
