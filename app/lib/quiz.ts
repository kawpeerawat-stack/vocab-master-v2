// app/lib/quiz.ts
// ─────────────────────────────────────────────────────────────
// ตัวช่วยสำหรับโหมด "นึกเอง" (พิมพ์คำ/ฟังเสียง) และตัวลวงที่ฉลาดขึ้น
//   - normalizeAnswer / checkTypedAnswer: ตรวจคำที่นักเรียนพิมพ์ แบบยืดหยุ่น
//     (ไม่สนตัวพิมพ์เล็กใหญ่/ช่องว่าง และยอมพิมพ์ผิดเล็กน้อย 1 ตัวอักษร)
//   - pickSmartDistractors: เลือกตัวลวงที่ "ชวนสับสน" กับคำตอบจริง
//     (ขึ้นต้นตัวเดียวกัน/ความยาวใกล้กัน/สะกดคล้ายกัน) แทนการสุ่มมั่ว
// ─────────────────────────────────────────────────────────────

// ── ระยะแก้ไข (Levenshtein) ระหว่างสองสตริง ──
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ── ทำให้คำตอบเป็นรูปมาตรฐานก่อนเทียบ ──
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:"']/g, '');
}

export interface TypedCheck {
  correct: boolean; // ถือว่าถูก (ตรงเป๊ะ หรือพิมพ์ผิดแค่ 1 ตัว)
  exact: boolean;   // ตรงเป๊ะทุกตัวอักษร
}

// ── ตรวจคำที่พิมพ์ เทียบกับคำเป้าหมาย (ยอมพิมพ์ผิดเล็กน้อยสำหรับคำยาว) ──
export function checkTypedAnswer(input: string, target: string): TypedCheck {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(target);
  if (!a) return { correct: false, exact: false };
  if (a === b) return { correct: true, exact: true };
  // คำที่ยาวพอ (>=4) ยอมพิมพ์ผิด 1 ตัวอักษร เพื่อไม่ลงโทษการสะกดพลาดนิดเดียว
  if (b.length >= 4 && levenshtein(a, b) <= 1) return { correct: true, exact: false };
  return { correct: false, exact: false };
}

// ── คะแนน "ความชวนสับสน" ระหว่างตัวลวงกับคำตอบ (ยิ่งน้อย = ยิ่งคล้าย = ตัวลวงดี) ──
function confusabilityScore(target: string, candidate: string): number {
  const t = target.toLowerCase();
  const c = candidate.toLowerCase();
  let score = levenshtein(t, c);            // สะกดคล้าย → คะแนนต่ำ
  if (t[0] !== c[0]) score += 2;            // ขึ้นต้นต่างตัว → ลวงน้อยลง
  score += Math.abs(t.length - c.length);   // ความยาวต่างมาก → ลวงน้อยลง
  return score;
}

// ── เลือกตัวลวงที่ชวนสับสนที่สุด N ตัว จาก pool ──
// candidates = คำที่เป็นตัวเลือกได้ (ไม่รวมคำตอบ), targetWord = คำตอบจริง
export function pickSmartDistractors(
  targetWord: string,
  candidates: string[],
  count: number
): string[] {
  const unique = Array.from(new Set(candidates.filter((w) => w && w !== targetWord)));
  if (unique.length <= count) return shuffle(unique);

  // จัดอันดับตามความชวนสับสน (คล้ายที่สุดก่อน)
  const ranked = unique
    .map((w) => ({ w, s: confusabilityScore(targetWord, w) }))
    .sort((a, b) => a.s - b.s);

  // หยิบกลุ่มที่คล้ายสุดมาเผื่อไว้ (count * 3) แล้วสุ่มภายในกลุ่มนั้น
  // เพื่อให้ "ยากแต่ไม่ซ้ำเดิมทุกครั้ง"
  const poolSize = Math.min(unique.length, Math.max(count * 3, count + 4));
  const topPool = ranked.slice(0, poolSize).map((r) => r.w);
  return shuffle(topPool).slice(0, count);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────
// เลือก "ชนิดคำถาม" ตามระดับความคุ้น (กล่อง SRS) ของคำนั้น
//   - คำใหม่/กล่องต่ำ  → เลือกตอบ (recognition) ง่ายกว่า
//   - คำที่เริ่มจำได้    → ผสมพิมพ์เอง
//   - คำที่จำได้แม่น    → พิมพ์เอง/ฟังเสียง (recall) ยากขึ้น
// box = -1 หมายถึงยังไม่เคยเจอ (คำใหม่)
// ─────────────────────────────────────────────────────────────
export type QType = 'SENTENCE' | 'SYNONYM' | 'ANTONYM' | 'TYPE' | 'LISTEN' | 'MEANING';

export interface TypeFlags {
  hasSynonym: boolean;
  hasAntonym: boolean;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function chooseQuestionType(box: number, flags: TypeFlags): QType {
  // โจทย์เลือกตอบ (recognition): บริบท + อังกฤษ→ไทย เป็นฐาน, เติม synonym/antonym ถ้ามี
  const recognition: QType[] = ['SENTENCE', 'MEANING'];
  if (flags.hasSynonym) recognition.push('SYNONYM');
  if (flags.hasAntonym) recognition.push('ANTONYM');

  // คำใหม่หรือกล่อง 0–1: เลือกตอบล้วน
  if (box < 0 || box <= 1) return pick(recognition);

  // กล่อง 2–3: ครึ่งหนึ่งเริ่มให้พิมพ์เอง
  if (box <= 3) return Math.random() < 0.5 ? 'TYPE' : pick(recognition);

  // กล่อง 4–5: เน้น recall (พิมพ์เอง/ฟังเสียง)
  return Math.random() < 0.5 ? 'TYPE' : 'LISTEN';
}
