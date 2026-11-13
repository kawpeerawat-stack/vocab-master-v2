// app/lib/pendingData.ts — โหลดข้อมูลของนักเรียน "คนนี้" เพื่อคำนวณงานค้าง (หน้านักเรียน · 13 พ.ย. 2569)
//   อ่านเฉพาะเอกสารของอีเมลที่เข้าอยู่ (students/{อีเมล}) + ข้อมูลในเครื่อง — ไม่อ่านข้อมูลของคนอื่น
//   แสดงผลจากข้อมูลในเครื่องทันที แล้วรวมกับข้อมูลบนระบบเมื่ออ่านได้ (ไม่เขียนอะไรกลับ)
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { loadLocalCourseProgress, mergeCourseProgress, type CourseProgress } from "./courses";
import { loadLocal } from "./vocab300";
import { fetchJsonRetry } from "./fetchRetry";
import { thaiDayOf } from "./early";
import { loadLocalUnlock, serverNow, syncClock } from "./sync";
import { computePending, type PendInput, type PendItem } from "./pending";
import type { Schedule } from "./schedule";

const idOf = (email: string) => email.trim().toLowerCase().replace(/\//g, "_");

let schedP: Promise<Schedule> | null = null;
export function loadSchedule(): Promise<Schedule> {
  if (!schedP) {
    schedP = fetchJsonRetry<Schedule>("/api/course?id=schedule").catch((e) => {
      schedP = null;
      throw e;
    });
  }
  return schedP;
}

function localInput(email: string, room: string | null, today: string): PendInput {
  return {
    room,
    today,
    unlock: loadLocalUnlock(email),
    lessons: { decoder: loadLocalCourseProgress("decoder", email), decoder4: loadLocalCourseProgress("decoder4", email) },
    sets: [loadLocal(email).sets || {}],
  };
}

type CloudDoc = { courses?: Record<string, CourseProgress>; v300?: { sets?: Record<string, { day?: string; prev?: unknown }> }; unlock?: Record<string, number> };
async function readMyDoc(email: string): Promise<CloudDoc | null> {
  if (!email || !db) return null;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "students", idOf(email))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000)),
    ]);
    return snap.exists() ? (snap.data() as CloudDoc) : null;
  } catch (e) {
    console.warn("pending cloud:", e);
    return null;
  }
}

function withCloud(inp: PendInput, d: CloudDoc): PendInput {
  const lessons = { ...inp.lessons };
  for (const k of ["decoder", "decoder4"] as const) {
    const c = d.courses?.[k];
    if (c) lessons[k] = mergeCourseProgress((inp.lessons[k] || {}) as CourseProgress, c);
  }
  const unlock = { ...inp.unlock };
  for (const [k, v] of Object.entries(d.unlock || {})) if (typeof v === "number") unlock[k] = Math.max(unlock[k] ?? 0, v);
  return { ...inp, lessons, unlock, sets: d.v300?.sets ? [...inp.sets, d.v300.sets] : inp.sets };
}

// onUpdate ถูกเรียก 1–2 ครั้ง: ครั้งแรกจากข้อมูลในเครื่อง · ครั้งที่สองหลังรวมกับข้อมูลบนระบบ (ถ้าอ่านได้)
export async function watchMyPending(email: string, room: string | null, onUpdate: (items: PendItem[]) => void, alive: () => boolean): Promise<void> {
  const [sch] = await Promise.all([loadSchedule(), syncClock()]);
  if (!alive()) return;
  const today = thaiDayOf(serverNow());
  const base = localInput(email, room, today);
  onUpdate(computePending(sch, base));
  const d = await readMyDoc(email);
  if (!alive() || !d) return;
  onUpdate(computePending(sch, withCloud(base, d)));
}
