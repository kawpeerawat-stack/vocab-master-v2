// app/lib/live.ts
// ─────────────────────────────────────────────────────────────
// รายงานสด "กำลังทำอยู่ตอนนี้" ให้หน้าครู (เฉพาะรอบที่เข้าสมุดคะแนน)
//   - เขียนฟิลด์เล็ก ๆ students/{email}.live : ตอนเริ่ม · ทุกครั้งที่มีเหตุการณ์ (ออกจากหน้า / บังหน้า / หมดเวลา) · ทุก 3 ข้อ · ตอนจบ
//   - ประมาณ 6–10 ครั้งต่อนักเรียน 1 รอบ (ห้อง 40 คน ≈ 300–600 ครั้งต่อคาบ) — อยู่ในโควตาฟรีของ Firebase
//   - ส่งแบบไม่รอผล: ส่งไม่ได้ก็ไม่กระทบการทำข้อสอบหรือการบันทึกคะแนน
//   - ไม่มีภาพ ไม่มีเสียง · มีแค่ตัวเลขความคืบหน้าและจำนวนเหตุการณ์
// ─────────────────────────────────────────────────────────────
import { doc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { serverNow } from "./sync";
import type { CamMode } from "./guard";

export type LiveEv = "leave" | "face" | "time" | "phone" | "far";
export interface LiveDoc {
  room: string | null;
  a: "course" | "v300"; // ห้อง 🧩 หรือ 📚
  c: string;            // รหัสคอร์ส
  l: string;            // บท / ชุด
  t: string;            // ชื่อที่ครูเห็น เช่น "บทที่ 3"
  q: number;            // ทำไปแล้วกี่ข้อ
  tot: number;          // ทั้งหมดกี่ข้อ
  cm: CamMode;          // ใช้กล้อง / ไม่ใช้ / กล้องใช้ไม่ได้
  lv: number;           // ออกจากหน้า (รวมหน้าต่างอื่นบังนานเกิน 3 วินาที)
  cv: number;           // มีอะไรบังใบหน้า
  to: number;           // หมดเวลา
  ph: number;           // พบมือถือในกล้อง (ใกล้ / แตะขอบ → ข้ามข้อ)
  pf?: number;          // เห็นมือถือเล็ก ๆ ไกล ๆ (น่าจะของเพื่อนด้านหลัง · ไม่ข้ามข้อ)
  pd?: string;          // ตัวตรวจมือถือ (ready / slow / error)
  ev: LiveEv | null;    // เหตุการณ์ล่าสุด
  evAt: number;
  st: number;           // เวลาเริ่ม
  at: number;           // อัปเดตล่าสุด
  done: boolean;        // จบรอบแล้ว (ส่งผล หรือออกกลางคัน)
  quit: boolean;        // ออกกลางคัน
  sc: number | null;    // คะแนน (เมื่อจบ)
}

const STEP_EVERY = 3;
let cur: { id: string; d: LiveDoc } | null = null;

const idOf = (email: string) => email.trim().toLowerCase().replace(/\//g, "_");

function push() {
  if (!cur || !db) return;
  const { id, d } = cur;
  d.at = serverNow();
  try {
    setDoc(doc(db, "students", id), { live: Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) }, { merge: true }).catch((e) => console.warn("live:", e));
  } catch {
    /* ไม่กระทบการทำข้อสอบ */
  }
}

export function liveStart(email: string, info: Pick<LiveDoc, "room" | "a" | "c" | "l" | "t" | "tot" | "cm" | "pd">) {
  if (!email) return;
  const now = serverNow();
  cur = { id: idOf(email), d: { ...info, q: 0, lv: 0, cv: 0, to: 0, ph: 0, pf: 0, ev: null, evAt: 0, st: now, at: now, done: false, quit: false, sc: null } };
  push();
}

// เหตุการณ์ → ส่งทันที (ครูเห็นกรอบแดงกระพริบ)
export function liveEvent(kind: "face" | "time" | "phone" | "far") {
  if (!cur || cur.d.done) return;
  if (kind === "face") cur.d.cv++;
  else if (kind === "phone") cur.d.ph = (cur.d.ph || 0) + 1;
  else if (kind === "far") cur.d.pf = (cur.d.pf || 0) + 1;
  else cur.d.to++;
  cur.d.ev = kind;
  cur.d.evAt = serverNow();
  push();
}
// จำนวนครั้งที่ออกจากหน้า (นับจากระบบกันสลับหน้าจอ)
export function liveLeaves(n: number) {
  if (!cur || cur.d.done || n <= cur.d.lv) return;
  cur.d.lv = n;
  cur.d.ev = "leave";
  cur.d.evAt = serverNow();
  push();
}
// ทำไปแล้ว n ข้อ → ส่งทุก 3 ข้อ
export function liveStep(n: number) {
  if (!cur || cur.d.done || n <= cur.d.q) return;
  cur.d.q = Math.min(n, cur.d.tot);
  if (cur.d.q % STEP_EVERY === 0 && cur.d.q < cur.d.tot) push();
}
export function liveEnd(score: number) {
  if (!cur || cur.d.done) return;
  cur.d.q = cur.d.tot;
  cur.d.done = true;
  cur.d.sc = score;
  push();
}
// ออกจากรอบกลางคัน (กดออก / กลับ)
export function liveQuit() {
  if (!cur || cur.d.done) return;
  cur.d.done = true;
  cur.d.quit = true;
  push();
}
