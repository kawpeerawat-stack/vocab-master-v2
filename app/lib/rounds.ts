// app/lib/rounds.ts
// ─────────────────────────────────────────────────────────────
// นับ "รอบที่เข้าสมุดคะแนนที่ถูกยกเลิก" ต่อวัน (v8.5) — กันดูโจทย์แล้วออก/รีเฟรชเพื่อให้รอบเป็นโมฆะ ค้นคำตอบ แล้วทำใหม่
//   นับเมื่อ: กดออกกลางรอบ · ระบบหยุดรอบเพราะแบ่งจอ · ปิดแท็บ/รีเฟรช/กลับหน้าก่อนจบรอบ (ตรวจจากป้ายค้างในเครื่อง)
//   ไม่นับ: ปิดระบบหลัง 16.30 น. (ไม่ใช่ความผิดนักเรียน) · ข้ามข้อ/หมดเวลา (ยังเป็นรอบที่ทำจบ)
//   ครบ ROUND_CAP ครั้งต่อวัน → วันนี้เริ่มรอบเข้าสมุดคะแนนไม่ได้ (ครูปลดล็อกรายคนด้วยรหัส "lift" ได้) · พรุ่งนี้เริ่มใหม่
//   เก็บในเครื่อง + สำเนาบนระบบ students/{id}.rounds.{วัน} = { a: ยกเลิกกี่รอบ, l: ครูปลดล็อกแล้ว } (เล็กมาก)
//   เครื่องที่ล้างข้อมูลเพื่อรีเซ็ตตัวนับ → ใช้ค่าบนระบบ (ค่ามากสุดของสองฝั่ง)
// ─────────────────────────────────────────────────────────────
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { serverNow, serverToday } from "./sync";
import { redeemCode, CLOUD_WAIT_MS, type CodeKind } from "./teacherCode";

export const ROUND_CAP = 3;
export type AbandonWhy = "quit" | "split" | "reload";
export interface DayRounds { a: number; l: boolean; w: AbandonWhy[] }

const idOf = (email: string) => email.trim().toLowerCase().replace(/\//g, "_");
const dayKey = (email: string, day: string) => `rd:${idOf(email)}:${day}`;
const markKey = (email: string) => `rd:mark:${idOf(email)}`;
const MARK_MIN_AGE = 4000; // ป้ายที่เพิ่งตั้งไม่ถึง 4 วินาที = รอบที่กำลังเริ่ม ไม่ใช่รอบค้างจากรอบก่อน

const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ไม่เป็นไร */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ไม่เป็นไร */
    }
  },
};

export function readDay(email: string, day = serverToday()): DayRounds {
  try {
    const j = JSON.parse(ls.get(dayKey(email, day)) || "null") as Partial<DayRounds> | null;
    return { a: Math.max(0, Number(j?.a) || 0), l: !!j?.l, w: Array.isArray(j?.w) ? (j!.w as AbandonWhy[]) : [] };
  } catch {
    return { a: 0, l: false, w: [] };
  }
}
function writeDay(email: string, day: string, d: DayRounds) {
  ls.set(dayKey(email, day), JSON.stringify(d));
  if (!db) return;
  try {
    setDoc(doc(db, "students", idOf(email)), { rounds: { [day]: { a: d.a, l: d.l } } }, { merge: true }).catch((e) => console.warn("rounds:", e));
  } catch {
    /* ไม่กระทบการทำข้อสอบ */
  }
}

// เริ่มรอบเข้าสมุดคะแนน
export function roundBegin(email: string) {
  ls.set(markKey(email), JSON.stringify({ at: Date.now(), day: serverToday() }));
}
// จบรอบตามปกติ / ระบบปิดรอบเอง (ไม่นับว่ายกเลิก)
export function roundEnd(email: string) {
  ls.del(markKey(email));
}
// ยกเลิกรอบ → นับเพิ่ม 1
export function roundAbandon(email: string, why: AbandonWhy, day = serverToday()): DayRounds {
  ls.del(markKey(email));
  const d = readDay(email, day);
  const next = { ...d, a: d.a + 1, w: [...d.w, why].slice(-10) };
  writeDay(email, day, next);
  return next;
}
// เปิดห้อง: ถ้ามีป้ายค้างจากหน้าเดิมที่ปิด/รีเฟรชไปกลางรอบ → นับเป็นยกเลิก 1 ครั้ง
export function roundSweep(email: string): boolean {
  try {
    const m = JSON.parse(ls.get(markKey(email)) || "null") as { at: number; day: string } | null;
    if (!m) return false;
    if (Date.now() - m.at < MARK_MIN_AGE) return false;
    roundAbandon(email, "reload", m.day || serverToday());
    return true;
  } catch {
    ls.del(markKey(email));
    return false;
  }
}
// รวมค่าบนระบบ (ถ้ามากกว่าในเครื่อง) — เรียกตอนเปิดห้อง
export async function roundsSync(email: string, day = serverToday()): Promise<DayRounds> {
  const local = readDay(email, day);
  if (!db) return local;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "students", idOf(email))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), CLOUD_WAIT_MS * 2)),
    ]);
    const r = (snap.data() as { rounds?: Record<string, { a?: number; l?: boolean }> } | undefined)?.rounds?.[day];
    if (!r) return local;
    const merged: DayRounds = { a: Math.max(local.a, Number(r.a) || 0), l: local.l || !!r.l, w: local.w };
    if (merged.a !== local.a || merged.l !== local.l) ls.set(dayKey(email, day), JSON.stringify(merged));
    return merged;
  } catch {
    return local;
  }
}
export const capReached = (d: DayRounds) => d.a >= ROUND_CAP && !d.l;

// ปลดล็อกวันนี้ด้วยรหัสครู (kind "lift") → ใช้ได้ครั้งเดียว
export async function liftCap(email: string, code: string) {
  const out = await redeemCode("lift", email, code, serverNow(), codeCloud("lift", email));
  if (out.result === "ok") writeDay(email, serverToday(), { ...readDay(email), l: true });
  return out;
}

// ── ป้ายใช้รหัสแล้วบนระบบ ──
export function codeCloud(kind: CodeKind, email: string) {
  return {
    isUsed: async (win: number) => {
      if (!db) return false;
      const snap = await getDoc(doc(db, "students", idOf(email)));
      return !!(snap.data() as { codeUsed?: Record<string, boolean> } | undefined)?.codeUsed?.[`${kind}${win}`];
    },
    markUsed: async (win: number) => {
      if (!db) return;
      await setDoc(doc(db, "students", idOf(email)), { codeUsed: { [`${kind}${win}`]: true } }, { merge: true });
    },
  };
}
