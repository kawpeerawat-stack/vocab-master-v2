// app/lib/streak.ts
// ─────────────────────────────────────────────────────────────
// ระบบ "วันติดต่อกัน" (streak) + เป้าหมายรายวัน เพื่อสร้างนิสัยทบทวนทุกวัน
//   - เล่นวันนี้ต่อจากเมื่อวาน → streak +1
//   - เว้นไปเกิน 1 วัน → streak เริ่มนับใหม่
//   - เป้าหมายรายวัน: ทบทวนให้ครบ N คำต่อวัน (todayCount/dailyGoal)
// เก็บใน localStorage แยกตามอีเมล และซิงก์ขึ้นคลาวด์ผ่าน cloud.ts
// ─────────────────────────────────────────────────────────────

export interface StreakState {
  streak: number;        // จำนวนวันติดต่อกัน
  bestStreak: number;    // สถิติสูงสุด
  lastStudyDate: string; // วันล่าสุดที่เล่น (YYYY-MM-DD, เวลาท้องถิ่น)
  todayCount: number;    // จำนวนคำที่ทำ "วันนี้"
  dailyGoal: number;     // เป้าหมายต่อวัน
}

export const DEFAULT_DAILY_GOAL = 20;

const STORAGE_PREFIX = 'vocab_streak::';

export function emptyStreak(): StreakState {
  return { streak: 0, bestStreak: 0, lastStudyDate: '', todayCount: 0, dailyGoal: DEFAULT_DAILY_GOAL };
}

// วันที่วันนี้ตามเวลาท้องถิ่น (YYYY-MM-DD)
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// จำนวนวันห่างกันระหว่างสองวันที่ (ตามปฏิทินท้องถิ่น)
function diffDays(from: string, to: string): number {
  if (!from || !to) return Infinity;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.round((b - a) / 86400000);
}

// ปรับสถานะให้ตรงกับ "วันนี้" สำหรับการแสดงผล
//  - เล่นวันนี้แล้ว → คงค่าไว้
//  - เล่นล่าสุดเมื่อวาน → streak ยังไม่ขาด แต่ todayCount เริ่มใหม่ (วันใหม่)
//  - เว้นเกิน 1 วัน → streak ขาด (แสดงเป็น 0) todayCount = 0
export function normalize(state: StreakState, today: string = todayStr()): StreakState {
  const s = { ...state };
  if (!s.dailyGoal) s.dailyGoal = DEFAULT_DAILY_GOAL;
  const gap = diffDays(s.lastStudyDate, today);
  if (gap === 0) {
    // เล่นวันนี้แล้ว — คงค่าไว้
  } else if (gap === 1) {
    s.todayCount = 0; // วันใหม่ ยังไม่ขาด streak
  } else {
    s.streak = 0;     // ขาดช่วง — streak เป็น 0 (จะเริ่มใหม่เมื่อเล่น)
    s.todayCount = 0;
  }
  return s;
}

// บันทึกกิจกรรม (จบ 1 รอบ = ทบทวนไปกี่คำ) แล้วอัปเดต streak/เป้าหมาย
export function applyActivity(state: StreakState, wordsDone: number, today: string = todayStr()): StreakState {
  const s = normalize(state, today);
  const gap = diffDays(s.lastStudyDate, today);

  if (gap === 0) {
    // เล่นเพิ่มในวันเดิม — สะสมจำนวนคำ, streak คงเดิม
    s.todayCount += wordsDone;
  } else {
    // วันใหม่
    if (gap === 1) s.streak += 1;   // ต่อเนื่องจากเมื่อวาน
    else s.streak = 1;              // เริ่มใหม่ (ครั้งแรก หรือขาดช่วง)
    s.lastStudyDate = today;
    s.todayCount = wordsDone;
  }
  if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  return s;
}

export function goalReached(state: StreakState): boolean {
  return state.todayCount >= state.dailyGoal;
}

// ── localStorage ──
function keyFor(email: string): string {
  return STORAGE_PREFIX + email.trim().toLowerCase();
}

export function loadStreak(email: string): StreakState {
  if (typeof window === 'undefined' || !email) return emptyStreak();
  try {
    const raw = window.localStorage.getItem(keyFor(email));
    if (raw) return normalize({ ...emptyStreak(), ...JSON.parse(raw) });
  } catch (e) {
    console.error('loadStreak error:', e);
  }
  return emptyStreak();
}

export function saveStreak(email: string, state: StreakState): void {
  if (typeof window === 'undefined' || !email) return;
  try {
    window.localStorage.setItem(keyFor(email), JSON.stringify(state));
  } catch (e) {
    console.error('saveStreak error:', e);
  }
}
