// app/lib/cloud.ts
// ─────────────────────────────────────────────────────────────
// ซิงก์ความก้าวหน้า (SRS) ของนักเรียนแต่ละคนขึ้น Firestore
//   - ใช้ "อีเมล" เป็นกุญแจระบุตัวนักเรียน (ไม่ต้องมีระบบล็อกอิน/รหัสผ่าน)
//   - โหลดกลับตอนล็อกอิน → เด็กเปลี่ยนเครื่องแล้ว progress ไม่หาย
//   - บันทึกตอนจบรอบ → ครูเห็นข้อมูลรายคนได้ (ใช้ในหน้า /admin)
//
// เก็บไว้ใน collection "students" โดย document id = อีเมล (ตัวพิมพ์เล็ก)
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs } from "firebase/firestore";
import type { SrsStore } from "./srs";
import type { StreakState } from "./streak";

const COLLECTION = "students";

// แปลงอีเมลเป็น document id ที่ปลอดภัย (Firestore id ห้ามมี "/")
function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}

// รหัสสัปดาห์ = วันที่ของ "วันจันทร์" ของสัปดาห์นั้น (เวลาท้องถิ่น) → อันดับรีเซ็ตทุกวันจันทร์
export function currentWeekId(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // จันทร์=0 ... อาทิตย์=6
  x.setDate(x.getDate() - day);     // ถอยไปวันจันทร์
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

// ── สถิติห้อง Reading รายคน (เก็บใน students/{email}.reading) ──
export interface ReadingByType {
  answered: number;
  correct: number;
}
export interface ReadingStat {
  attempts: number; // จำนวนรอบที่ทำเสร็จ
  totalAnswered: number; // ข้อสะสมที่ตอบทั้งหมด
  totalCorrect: number; // ข้อสะสมที่ถูก
  lastCorrect: number; // รอบล่าสุด: ถูกกี่ข้อ
  lastTotal: number; // รอบล่าสุด: จากกี่ข้อ
  bestPct: number; // เปอร์เซ็นต์ที่ดีที่สุด
  byType: Record<string, ReadingByType>; // ความแม่นรายชนิดคำถาม
  totalLeaves?: number; // กันโกง: ครั้งที่ออกจากหน้าจอสะสมรวมทุกบท
  autoSubmits?: number; // กันโกง: ถูกส่งคำตอบอัตโนมัติสะสมรวมทุกบท
}

// กันโกง: รายละเอียดการออกจากหน้าจอราย "บท" (เก็บเฉพาะบทที่เคยออกจากจอ)
export interface ReadingLeaveEntry {
  title?: string;      // ชื่อบท (ไว้โชว์ในแดชบอร์ด)
  examStyle?: string;  // สนามสอบของบท
  leaves: number;      // ออกจากจอรวมในบทนี้ (สะสมทุกรอบ)
  attempts: number;    // จำนวนรอบที่ออกจากจอในบทนี้
  lastLeaves: number;  // ออกจากจอรอบล่าสุด
  autoSubmits?: number; // ถูกส่งคำตอบอัตโนมัติกี่ครั้งในบทนี้ (เพราะออกจากจอเกินเกณฑ์)
}

// ── สถิติห้อง Conversation รายคน (เก็บใน students/{email}.conversation) ──
export interface ConvByFormat {
  answered: number;
  correct: number;
}
export interface ConversationStat {
  attempts: number;
  totalAnswered: number;
  totalCorrect: number;
  lastCorrect: number;
  lastTotal: number;
  bestPct: number;
  byFormat: Record<string, ConvByFormat>; // ความแม่นรายรูปแบบบทสนทนา
}

export interface CloudProgress {
  name: string;
  email: string;
  srs: SrsStore;
  mastered: number;
  learning: number;
  seen: number;
  total: number;
  bestScore: number;
  lastScore: number;
  // ── สถิติห้องอ่าน (อาจไม่มีในเอกสารเก่า) ──
  reading?: ReadingStat;
  // ── กันโกง: การออกจากหน้าจอราย "บท" (key = passageId) ──
  readingLeaves?: Record<string, ReadingLeaveEntry>;
  // ── สถิติห้องบทสนทนา (อาจไม่มีในเอกสารเก่า) ──
  conversation?: ConversationStat;
  // ── streak (อาจไม่มีในเอกสารเก่า) ──
  streak?: number;
  bestStreak?: number;
  lastStudyDate?: string;
  todayCount?: number;
  dailyGoal?: number;
  // ── แต้มรายสัปดาห์ (รีเซ็ตทุกวันจันทร์) ──
  weeklyXp?: number;
  weekId?: string;
  // ── แถบความสำเร็จห้องอ่าน ──
  masteredPassages?: string[];  // id บทที่ "พิชิต" (ตอบถูกครบทุกข้อ) — สะสมตลอดกาล
  completedPassages?: string[]; // id บทที่เคยทำจบ (ถูกครบหรือไม่ก็ตาม)
  // ── บทที่พิชิต "สัปดาห์นี้" (รีเซ็ตทุกวันจันทร์) สำหรับ Top 3 หน้า Reading ──
  weeklyReading?: { weekId: string; masteredIds: string[] };
  // ── แถบความสำเร็จห้องสนทนา ──
  masteredConvos?: string[];  // id ชุดที่ "พิชิต" (ตอบถูกครบทุกข้อ) — สะสมตลอดกาล
  completedConvos?: string[]; // id ชุดที่เคยทำจบ (ถูกครบหรือไม่ก็ตาม)
  // ── ความก้าวหน้าคำศัพท์ (สำหรับหน้า /admin) ──
  percent?: number;            // % ก้าวหน้า ณ บันทึกล่าสุด
  answered?: number;           // จำนวนข้อที่ตอบสะสม (ผลรวม reps ของทุกคำ)
  lastDeltaPercent?: number;   // % ที่ขยับจากการบันทึกครั้งก่อน
  lastDeltaAnswered?: number;  // จำนวนข้อที่ทำเพิ่มจากครั้งก่อน
  lastActiveAt?: number;       // เวลา (ms) ที่เข้าทำล่าสุด
  history?: { ts: number; percent: number; answered: number; seen: number }[]; // snapshot ย้อนหลัง
}

// ── โหลดความก้าวหน้าจากคลาวด์ (คืน null ถ้ายังไม่มี) ──
export async function loadCloudProgress(email: string): Promise<CloudProgress | null> {
  if (!email || !db) return null;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as CloudProgress;
  } catch (e) {
    console.error("loadCloudProgress error:", e);
    return null;
  }
}

// ── บันทึกความก้าวหน้าขึ้นคลาวด์ (merge — เก็บ bestScore สูงสุดไว้) ──
export async function saveCloudProgress(params: {
  email: string;
  name: string;
  srs: SrsStore;
  stats: { mastered: number; learning: number; seen: number; total: number; weightedProgress?: number };
  lastScore: number;
  streak?: StreakState;
}): Promise<boolean> {
  const { email, name, srs, stats, lastScore, streak } = params;
  if (!email || !db) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));

    // ดึง bestScore เดิม + แต้มรายสัปดาห์เดิม มาคำนวณต่อ
    const weekId = currentWeekId();
    const nowMs = Date.now();
    // จำนวนข้อที่ตอบสะสม = ผลรวม reps ของทุกคำใน SRS
    const answered = Object.values(srs).reduce((sum, c) => sum + (c?.reps ?? 0), 0);
    // % ก้าวหน้าปัจจุบัน (สูตรเดียวกับที่นักเรียนเห็นบนแถบ)
    const percent = Math.round((stats.weightedProgress ?? 0) * 10) / 10;
    let bestScore = lastScore;
    let weeklyXp = lastScore; // ค่าเริ่มต้น (สัปดาห์ใหม่ หรือยังไม่มีข้อมูล)
    let prevPercent = 0;
    let prevAnswered = 0;
    let history: { ts: number; percent: number; answered: number; seen: number }[] = [];
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const pd = prev.data() as CloudProgress;
        bestScore = Math.max(pd.bestScore ?? 0, lastScore);
        // สัปดาห์เดิม → สะสมต่อ, สัปดาห์ใหม่ → เริ่มนับใหม่จากรอบนี้
        weeklyXp = pd.weekId === weekId ? (pd.weeklyXp ?? 0) + lastScore : lastScore;
        prevPercent = pd.percent ?? 0;
        prevAnswered = pd.answered ?? 0;
        history = Array.isArray(pd.history) ? pd.history : [];
      }
    } catch {
      // อ่านค่าเดิมไม่ได้ก็ใช้ค่าเริ่มต้นไปก่อน
    }
    // ส่วนต่างจากการบันทึกครั้งก่อน + เก็บ snapshot (เก็บ 60 ครั้งล่าสุด)
    const lastDeltaPercent = Math.round((percent - prevPercent) * 10) / 10;
    const lastDeltaAnswered = Math.max(0, answered - prevAnswered);
    const history2 = [...history, { ts: nowMs, percent, answered, seen: stats.seen }].slice(-60);

    await setDoc(
      ref,
      {
        name,
        email: email.trim().toLowerCase(),
        srs,
        mastered: stats.mastered,
        learning: stats.learning,
        seen: stats.seen,
        total: stats.total,
        // ── ความก้าวหน้า + ส่วนต่าง + เวลา + ประวัติ (สำหรับ /admin) ──
        percent,
        answered,
        lastDeltaPercent,
        lastDeltaAnswered,
        lastActiveAt: nowMs,
        history: history2,
        // หน้า /admin เดิมเรียงตาม field "score" — ใส่ทั้ง score และ bestScore ให้เข้ากันได้
        score: bestScore,
        bestScore,
        lastScore,
        // แต้มรายสัปดาห์
        weeklyXp,
        weekId,
        // streak (ถ้ามี)
        ...(streak
          ? {
              streak: streak.streak,
              bestStreak: streak.bestStreak,
              lastStudyDate: streak.lastStudyDate,
              todayCount: streak.todayCount,
              dailyGoal: streak.dailyGoal,
            }
          : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.error("saveCloudProgress error:", e);
    return false;
  }
}

// ── จัดอันดับ "คนขยัน" ──
// แต้มสะสม = ผลรวมระดับกล่อง SRS ของทุกคำ (ยิ่งเลื่อนคำขึ้นกล่องเยอะ ยิ่งได้แต้ม)
// สะท้อนความขยันสะสมจริง ไม่ใช่คะแนนรอบเดียว
export interface LeaderboardEntry {
  email: string;
  name: string;
  points: number;     // แต้มสะสมตลอดกาล (ผลรวมกล่อง SRS)
  weeklyXp: number;   // แต้มสัปดาห์นี้ (0 ถ้าข้อมูลเป็นของสัปดาห์ก่อน)
  mastered: number;
  streak: number;
}

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!db) return [];
  try {
    const thisWeek = currentWeekId();
    const snap = await getDocs(collection(db, COLLECTION));
    const entries: LeaderboardEntry[] = [];
    snap.forEach((d) => {
      const data = d.data() as {
        email?: string; name?: string; mastered?: number; streak?: number;
        weeklyXp?: number; weekId?: string;
        srs?: Record<string, { box?: number }>;
      };
      let points = 0;
      if (data.srs) {
        for (const k in data.srs) {
          const c = data.srs[k];
          if (c && typeof c.box === "number") points += c.box;
        }
      }
      entries.push({
        email: (data.email || d.id).toLowerCase(),
        name: data.name || "(ไม่มีชื่อ)",
        points,
        // ถ้าแต้มรายสัปดาห์เป็นของสัปดาห์ก่อน ให้นับเป็น 0 (เริ่มใหม่)
        weeklyXp: data.weekId === thisWeek ? (data.weeklyXp ?? 0) : 0,
        mastered: data.mastered ?? 0,
        streak: data.streak ?? 0,
      });
    });
    entries.sort((a, b) => b.points - a.points || b.mastered - a.mastered || b.streak - a.streak);
    return entries;
  } catch (e) {
    console.error("loadLeaderboard error:", e);
    return [];
  }
}

// ── บันทึกผลรอบ Reading (merge) ──
//   - อัปเดตสถิติสะสมใน field "reading"
//   - บวกแต้มรายสัปดาห์ (weeklyXp) ด้วย เพื่อให้ "อันดับคนขยันรายสัปดาห์" นับรวมห้องอ่าน
//   - เขียน streak (ส่งมาจากหน้าจอ) เพื่อให้ streak นับรวมกิจกรรมทุกห้อง
export async function saveReadingProgress(params: {
  email: string;
  name: string;
  correct: number;
  total: number;
  byType: Record<string, ReadingByType>;
  streak?: StreakState;
  passageId?: string;  // บทที่เพิ่งทำจบ (ใช้ทำ "แถบความสำเร็จ/พิชิตบท")
  mastered?: boolean;  // ทำจบแบบถูกครบทุกข้อหรือไม่ (= พิชิตบท)
  leaves?: number;     // กันโกง: ออกจากหน้าจอกี่ครั้งในรอบนี้
  passageTitle?: string; // ชื่อบท (ไว้โชว์ในแดชบอร์ดครู)
  examStyle?: string;  // สนามสอบของบท
  autoSubmitted?: boolean; // กันโกง: รอบนี้ถูกส่งคำตอบอัตโนมัติหรือไม่
}): Promise<boolean> {
  const { email, name, correct, total, byType, streak, passageId, mastered, leaves, passageTitle, examStyle, autoSubmitted } = params;
  if (!email || !db) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const weekId = currentWeekId();

    // ดึงค่าเดิมมาคำนวณต่อ
    let prevReading: ReadingStat | undefined;
    let prevWeeklyXp = 0;
    let prevWeekId = "";
    let prevMastered: string[] = [];
    let prevCompleted: string[] = [];
    let prevWeeklyReading: { weekId: string; masteredIds: string[] } | undefined;
    let prevLeaves: Record<string, ReadingLeaveEntry> = {};
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const pd = prev.data() as CloudProgress;
        prevReading = pd.reading;
        prevWeeklyXp = pd.weeklyXp ?? 0;
        prevWeekId = pd.weekId ?? "";
        prevMastered = pd.masteredPassages ?? [];
        prevCompleted = pd.completedPassages ?? [];
        prevWeeklyReading = pd.weeklyReading;
        prevLeaves = pd.readingLeaves ?? {};
      }
    } catch {
      // อ่านค่าเดิมไม่ได้ก็ใช้ค่าเริ่มต้น
    }

    // รวม byType เดิม + รอบนี้
    const mergedByType: Record<string, ReadingByType> = { ...(prevReading?.byType ?? {}) };
    for (const k in byType) {
      const cur = mergedByType[k] ?? { answered: 0, correct: 0 };
      mergedByType[k] = {
        answered: cur.answered + byType[k].answered,
        correct: cur.correct + byType[k].correct,
      };
    }

    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const reading: ReadingStat = {
      attempts: (prevReading?.attempts ?? 0) + 1,
      totalAnswered: (prevReading?.totalAnswered ?? 0) + total,
      totalCorrect: (prevReading?.totalCorrect ?? 0) + correct,
      lastCorrect: correct,
      lastTotal: total,
      bestPct: Math.max(prevReading?.bestPct ?? 0, pct),
      byType: mergedByType,
      totalLeaves: (prevReading?.totalLeaves ?? 0) + (leaves ?? 0),
      autoSubmits: (prevReading?.autoSubmits ?? 0) + (autoSubmitted ? 1 : 0),
    };

    // รวมรายการ "บทที่ทำจบ" และ "บทที่พิชิต" (union กันซ้ำ — Firestore merge ทับ array ทั้งก้อน จึงต้องรวมเอง)
    const completedPassages = passageId && !prevCompleted.includes(passageId)
      ? [...prevCompleted, passageId] : prevCompleted;
    const masteredPassages = passageId && mastered && !prevMastered.includes(passageId)
      ? [...prevMastered, passageId] : prevMastered;

    // บทที่พิชิต "สัปดาห์นี้" — distinct (กันปั่นซ้ำ) + รีเซ็ตเมื่อขึ้นสัปดาห์ใหม่
    const weeklyMasteredPrev = prevWeeklyReading && prevWeeklyReading.weekId === weekId
      ? (prevWeeklyReading.masteredIds ?? []) : [];
    const weeklyMasteredIds = passageId && mastered && !weeklyMasteredPrev.includes(passageId)
      ? [...weeklyMasteredPrev, passageId] : weeklyMasteredPrev;
    const weeklyReading = { weekId, masteredIds: weeklyMasteredIds };

    // แต้มรายสัปดาห์ (สัปดาห์เดิม → บวกต่อ, สัปดาห์ใหม่ → เริ่มจากรอบนี้)
    const weeklyXp = prevWeekId === weekId ? prevWeeklyXp + correct : correct;

    // กันโกง: อัปเดตการออกจากหน้าจอราย "บท" (เก็บเฉพาะบทที่เคยออกจากจอ)
    const thisLeaves = leaves ?? 0;
    const readingLeaves: Record<string, ReadingLeaveEntry> = { ...prevLeaves };
    const leavesChanged = !!passageId && (thisLeaves > 0 || autoSubmitted || !!prevLeaves[passageId]);
    if (passageId && leavesChanged) {
      const e = readingLeaves[passageId] ?? { leaves: 0, attempts: 0, lastLeaves: 0 };
      readingLeaves[passageId] = {
        title: passageTitle ?? e.title,
        examStyle: examStyle ?? e.examStyle,
        leaves: e.leaves + thisLeaves,
        attempts: e.attempts + (thisLeaves > 0 ? 1 : 0),
        lastLeaves: thisLeaves,
        autoSubmits: (e.autoSubmits ?? 0) + (autoSubmitted ? 1 : 0),
      };
    }

    await setDoc(
      ref,
      {
        name,
        email: email.trim().toLowerCase(),
        reading,
        weeklyXp,
        weekId,
        ...(passageId ? { masteredPassages, completedPassages, weeklyReading } : {}),
        ...(leavesChanged ? { readingLeaves } : {}),
        ...(streak
          ? {
              streak: streak.streak,
              bestStreak: streak.bestStreak,
              lastStudyDate: streak.lastStudyDate,
              todayCount: streak.todayCount,
              dailyGoal: streak.dailyGoal,
            }
          : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.error("saveReadingProgress error:", e);
    return false;
  }
}

// ── บันทึกผลรอบ Conversation (merge) ──
//   - อัปเดตสถิติสะสมใน field "conversation"
//   - บวกแต้มรายสัปดาห์ (weeklyXp) + เขียน streak เพื่อให้นับรวมทุกห้อง
export async function saveConversationProgress(params: {
  email: string;
  name: string;
  correct: number;
  total: number;
  byFormat: Record<string, ConvByFormat>;
  streak?: StreakState;
  convId?: string;
  mastered?: boolean;
}): Promise<boolean> {
  const { email, name, correct, total, byFormat, streak, convId, mastered } = params;
  if (!email || !db) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const weekId = currentWeekId();

    let prevConv: ConversationStat | undefined;
    let prevWeeklyXp = 0;
    let prevWeekId = "";
    let prevMasteredConvos: string[] = [];
    let prevCompletedConvos: string[] = [];
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const pd = prev.data() as CloudProgress;
        prevConv = pd.conversation;
        prevWeeklyXp = pd.weeklyXp ?? 0;
        prevWeekId = pd.weekId ?? "";
        prevMasteredConvos = pd.masteredConvos ?? [];
        prevCompletedConvos = pd.completedConvos ?? [];
      }
    } catch {
      // ใช้ค่าเริ่มต้น
    }

    const mergedByFormat: Record<string, ConvByFormat> = { ...(prevConv?.byFormat ?? {}) };
    for (const k in byFormat) {
      const cur = mergedByFormat[k] ?? { answered: 0, correct: 0 };
      mergedByFormat[k] = {
        answered: cur.answered + byFormat[k].answered,
        correct: cur.correct + byFormat[k].correct,
      };
    }

    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const conversation: ConversationStat = {
      attempts: (prevConv?.attempts ?? 0) + 1,
      totalAnswered: (prevConv?.totalAnswered ?? 0) + total,
      totalCorrect: (prevConv?.totalCorrect ?? 0) + correct,
      lastCorrect: correct,
      lastTotal: total,
      bestPct: Math.max(prevConv?.bestPct ?? 0, pct),
      byFormat: mergedByFormat,
    };

    const weeklyXp = prevWeekId === weekId ? prevWeeklyXp + correct : correct;

    const completedConvos = convId && !prevCompletedConvos.includes(convId)
      ? [...prevCompletedConvos, convId] : prevCompletedConvos;
    const masteredConvos = convId && mastered && !prevMasteredConvos.includes(convId)
      ? [...prevMasteredConvos, convId] : prevMasteredConvos;

    await setDoc(
      ref,
      {
        name,
        email: email.trim().toLowerCase(),
        conversation,
        weeklyXp,
        weekId,
        ...(convId ? { masteredConvos, completedConvos } : {}),
        ...(streak
          ? {
              streak: streak.streak,
              bestStreak: streak.bestStreak,
              lastStudyDate: streak.lastStudyDate,
              todayCount: streak.todayCount,
              dailyGoal: streak.dailyGoal,
            }
          : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.error("saveConversationProgress error:", e);
    return false;
  }
}

// ── อันดับ "นักพิชิตบทอ่าน" รายสัปดาห์ (Top 3 หน้า Reading) ──
//   นับจากจำนวนบทที่ "พิชิต" (ตอบถูกครบทุกข้อ) ในสัปดาห์นี้ — รีเซ็ตทุกวันจันทร์
//   เสมอกัน → ตัดสินด้วยจำนวนบทที่พิชิตสะสมตลอดกาล
export interface ReadingLeaderboardEntry {
  email: string;
  name: string;
  weeklyMastered: number; // บทที่พิชิตสัปดาห์นี้
  totalMastered: number;  // บทที่พิชิตสะสมตลอดกาล
}

export async function loadReadingLeaderboard(): Promise<ReadingLeaderboardEntry[]> {
  if (!db) return [];
  try {
    const thisWeek = currentWeekId();
    const snap = await getDocs(collection(db, COLLECTION));
    const entries: ReadingLeaderboardEntry[] = [];
    snap.forEach((d) => {
      const data = d.data() as {
        email?: string; name?: string;
        masteredPassages?: string[];
        weeklyReading?: { weekId?: string; masteredIds?: string[] };
      };
      const weeklyMastered =
        data.weeklyReading && data.weeklyReading.weekId === thisWeek
          ? (data.weeklyReading.masteredIds?.length ?? 0) : 0;
      const totalMastered = data.masteredPassages?.length ?? 0;
      // เก็บเฉพาะคนที่เคยพิชิต (สัปดาห์นี้หรือสะสม) เพื่อไม่ให้ลิสต์รก
      if (weeklyMastered > 0 || totalMastered > 0) {
        entries.push({
          email: (data.email || d.id).toLowerCase(),
          name: data.name || "(ไม่มีชื่อ)",
          weeklyMastered,
          totalMastered,
        });
      }
    });
    entries.sort((a, b) => b.weeklyMastered - a.weeklyMastered || b.totalMastered - a.totalMastered);
    return entries;
  } catch (e) {
    console.error("loadReadingLeaderboard error:", e);
    return [];
  }
}
