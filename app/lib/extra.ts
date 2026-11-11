// app/lib/extra.ts
// ─────────────────────────────────────────────────────────────
// ห้องเรียนพิเศษ (/extraclass · 11 พ.ย. 2569) — นักเรียนที่เรียนพิเศษกับครู แยกจากนักเรียนโรงเรียนทั้งหมด
//   - เก็บในที่เดิม (students) แต่เอกสารขึ้นต้นด้วย "ex:" → ไม่ต้องแก้ Rules ของ Firebase
//     หน้าครูโรงเรียน (/admin) และอันดับของนักเรียนโรงเรียนมองไม่เห็น · ดูได้ที่ /admin/extraclass เท่านั้น
//   - เข้าด้วย "รหัสเข้าชั้น" ที่ครูตั้ง (เก็บแบบแฮชใน students/cfg:extra — ไม่เก็บรหัสจริง)
//   - ไม่ใช้กล้อง · ไม่ปิด 16.30 น. · ไม่ล็อกตามวันเรียน · ฟังก์ชันของห้องเรียนเหมือนเดิมทุกอย่าง
// ─────────────────────────────────────────────────────────────
import { doc, getDoc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

import { EXTRA_PREFIX, CONFIG_ID, codeDocData, profileDocData, extraIdentity, extraName } from "./extraDocs";
export { EXTRA_PREFIX, CONFIG_ID, extraIdentity, extraName };
export const isExtraId = (id: string) => id.startsWith(EXTRA_PREFIX);
export const isConfigId = (id: string) => id.startsWith("cfg:");
export const realEmail = (id: string) => (isExtraId(id) ? id.slice(EXTRA_PREFIX.length) : id);

export type ExtraLevel = "4" | "6";
export const EXTRA_LEVELS: { level: ExtraLevel; label: string }[] = [
  { level: "6", label: "ม.6" },
  { level: "4", label: "ม.4" },
];
export const extraCourseOf = (level: ExtraLevel) => (level === "4" ? "decoder4" : "decoder");

export interface ExtraProfile {
  first: string;
  last: string;
  level: ExtraLevel;
  email: string; // อีเมลจริง (ไม่มี ex:)
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const cleanPart = (s: string) => clean(s).slice(0, 35);

export function validateExtra(f: { first: string; last: string; level: string; email: string; code: string }) {
  const e: Partial<Record<"first" | "last" | "level" | "email" | "code", string>> = {};
  if (!clean(f.first)) e.first = "กรอกชื่อ";
  if (!clean(f.last)) e.last = "กรอกนามสกุล";
  if (f.level !== "4" && f.level !== "6") e.level = "เลือกระดับชั้น";
  const m = f.email.trim().toLowerCase();
  if (!m) e.email = "กรอกอีเมล";
  else if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(m)) e.email = "อีเมลไม่ถูกต้อง เช่น somchai.r@gmail.com";
  if (!clean(f.code)) e.code = "กรอกรหัสเข้าชั้นที่ครูให้";
  return e;
}

// ── รหัสเข้าชั้น (เก็บแฮช SHA-256 ไม่เก็บรหัสจริง) ──
const SALT = "vocab-master-extra-v1";
export const normCode = (c: string) => c.replace(/\s+/g, "").toLowerCase();
export async function hashCode(code: string): Promise<string> {
  const buf = new TextEncoder().encode(`${SALT}|${normCode(code)}`);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export type CodeCheck = "ok" | "wrong" | "unset" | "error";
export async function checkExtraCode(code: string): Promise<CodeCheck> {
  if (!db) return "error";
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "students", CONFIG_ID)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
    ]);
    const h = snap.exists() ? (snap.data() as { codeHash?: string }).codeHash : undefined;
    if (!h) return "unset";
    return h === (await hashCode(code)) ? "ok" : "wrong";
  } catch (e) {
    console.warn("extra code:", e);
    return "error";
  }
}
// คืน null = สำเร็จ · ไม่เช่นนั้นคืนข้อความสาเหตุ (รหัสข้อผิดพลาดของ Firebase) เพื่อให้ครูเห็นว่าติดอะไร
export async function saveExtraCode(code: string): Promise<string | null> {
  if (!db) return "ยังเชื่อมต่อ Firebase ไม่ได้ (db ว่าง)";
  try {
    await Promise.race([
      setDoc(doc(db, "students", CONFIG_ID), codeDocData(await hashCode(code), Date.now()), { merge: true }),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), 15000)),
    ]);
    return null;
  } catch (e) {
    console.error("saveExtraCode:", e);
    const c = (e as { code?: string })?.code || (e as Error)?.message || "unknown";
    return String(c);
  }
}

// บันทึกข้อมูลนักเรียนห้องเรียนพิเศษ (ตอนเข้าระบบ) — ไม่สำเร็จก็ไม่เป็นไร ชื่อยังถูกบันทึกพร้อมผลการเรียน
export async function saveExtraProfile(p: ExtraProfile): Promise<boolean> {
  if (!db) return false;
  const prof = profileDocData(p, Date.now());
  try {
    await Promise.race([
      setDoc(doc(db, "students", prof.id), prof.data, { merge: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    return true;
  } catch (e) {
    console.warn("saveExtraProfile:", e);
    return false;
  }
}

// ── ซ่อน/กู้คืนรายชื่อในหน้าครู (ใช้ทั้งโรงเรียนและห้องเรียนพิเศษ) — ไม่ลบข้อมูลจริง กู้คืนได้ ──
//   ซ่อนแล้ว: ไม่ถูกนับในตาราง/สรุป/อันดับ/แผงสด · เครื่องเดิมส่งข้อมูลเพิ่มก็ไม่โผล่กลับมา (ธงซ่อนอยู่ในเอกสารเดิม)
export async function setHidden(ids: string[], hidden: boolean): Promise<boolean> {
  if (!db || !ids.length) return false;
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const b = writeBatch(db);
      for (const id of ids.slice(i, i + 400)) {
        b.set(doc(db, "students", id), hidden ? { hidden: true, hiddenAt: Date.now() } : { hidden: false }, { merge: true });
      }
      await b.commit();
    }
    return true;
  } catch (e) {
    console.error("setHidden:", e);
    return false;
  }
}
