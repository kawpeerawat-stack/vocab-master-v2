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
  stats: { mastered: number; learning: number; seen: number; total: number };
  lastScore: number;
  streak?: StreakState;
}): Promise<boolean> {
  const { email, name, srs, stats, lastScore, streak } = params;
  if (!email || !db) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));

    // ดึง bestScore เดิม + แต้มรายสัปดาห์เดิม มาคำนวณต่อ
    const weekId = currentWeekId();
    let bestScore = lastScore;
    let weeklyXp = lastScore; // ค่าเริ่มต้น (สัปดาห์ใหม่ หรือยังไม่มีข้อมูล)
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const pd = prev.data() as CloudProgress;
        bestScore = Math.max(pd.bestScore ?? 0, lastScore);
        // สัปดาห์เดิม → สะสมต่อ, สัปดาห์ใหม่ → เริ่มนับใหม่จากรอบนี้
        weeklyXp = pd.weekId === weekId ? (pd.weeklyXp ?? 0) + lastScore : lastScore;
      }
    } catch {
      // อ่านค่าเดิมไม่ได้ก็ใช้ค่าเริ่มต้นไปก่อน
    }

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
}): Promise<boolean> {
  const { email, name, correct, total, byType, streak } = params;
  if (!email || !db) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const weekId = currentWeekId();

    // ดึงค่าเดิมมาคำนวณต่อ
    let prevReading: ReadingStat | undefined;
    let prevWeeklyXp = 0;
    let prevWeekId = "";
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const pd = prev.data() as CloudProgress;
        prevReading = pd.reading;
        prevWeeklyXp = pd.weeklyXp ?? 0;
        prevWeekId = pd.weekId ?? "";
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
    };

    // แต้มรายสัปดาห์ (สัปดาห์เดิม → บวกต่อ, สัปดาห์ใหม่ → เริ่มจากรอบนี้)
    const weeklyXp = prevWeekId === weekId ? prevWeeklyXp + correct : correct;

    await setDoc(
      ref,
      {
        name,
        email: email.trim().toLowerCase(),
        reading,
        weeklyXp,
        weekId,
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
}): Promise<boolean> {
  const { email, name, correct, total, byFormat, streak } = params;
  if (!email || !db) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const weekId = currentWeekId();

    let prevConv: ConversationStat | undefined;
    let prevWeeklyXp = 0;
    let prevWeekId = "";
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const pd = prev.data() as CloudProgress;
        prevConv = pd.conversation;
        prevWeeklyXp = pd.weeklyXp ?? 0;
        prevWeekId = pd.weekId ?? "";
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

    await setDoc(
      ref,
      {
        name,
        email: email.trim().toLowerCase(),
        conversation,
        weeklyXp,
        weekId,
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
