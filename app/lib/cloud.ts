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
  // ── streak (อาจไม่มีในเอกสารเก่า) ──
  streak?: number;
  bestStreak?: number;
  lastStudyDate?: string;
  todayCount?: number;
  dailyGoal?: number;
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

    // ดึง bestScore เดิมมาเทียบ เพื่อเก็บคะแนนสูงสุดไว้
    let bestScore = lastScore;
    try {
      const prev = await getDoc(ref);
      if (prev.exists()) {
        const prevBest = (prev.data() as CloudProgress).bestScore ?? 0;
        bestScore = Math.max(prevBest, lastScore);
      }
    } catch {
      // อ่านค่าเดิมไม่ได้ก็ใช้ lastScore ไปก่อน
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
  points: number;
  mastered: number;
  streak: number;
}

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    const entries: LeaderboardEntry[] = [];
    snap.forEach((d) => {
      const data = d.data() as {
        email?: string; name?: string; mastered?: number; streak?: number;
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
