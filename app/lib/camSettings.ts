// app/lib/camSettings.ts — ค่าตั้งค่ากล้องที่ครูปรับได้จากหน้า /admin (12 พ.ย. 2569)
//   • เวลาบังหน้าต่อเนื่อง (coverMs) ก่อนนับ 1 ครั้ง · ค่าเริ่มต้น 1.5 วินาที · ปรับได้ 1.0–3.0 วินาที
//   • เก็บใน students/cfg:camera@settings.local — รูปแบบเดียวกับเอกสารตั้งค่าห้องเรียนพิเศษ (cfg:extra…)
//     ใช้ Rules เดิมได้เลย (ต้องมี name + email = รหัสเอกสาร) · หน้าครู/อันดับกรอง "cfg:" ออกอยู่แล้ว
//   • หน้านักเรียนอ่านตอนเปิดกล้อง (หมดเวลา 4 วินาที ก็ใช้ค่าที่จำไว้ในเครื่อง หรือค่าเริ่มต้น) — กล้องไม่รอค่านี้
//   • ค่าถูกบีบให้อยู่ในช่วง 1.0–3.0 เสมอ ไม่ว่าในฐานข้อมูลจะเป็นอะไร
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export const CAM_CFG_ID = "cfg:camera@settings.local";
export const COVER_MS_DEFAULT = 1500;
export const COVER_MS_MIN = 1000;
export const COVER_MS_MAX = 3000;
export const COVER_MS_STEP = 100;
const CACHE_KEY = "vm:camCfg:v1";

export function clampCoverMs(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : COVER_MS_DEFAULT;
  const r = Math.round(v / COVER_MS_STEP) * COVER_MS_STEP;
  return Math.min(COVER_MS_MAX, Math.max(COVER_MS_MIN, r));
}

// รูปแบบเอกสารที่เขียนลง Firestore (ต้องมี name + email เท่ากับรหัสเอกสาร ตาม Rules ของโรงเรียน)
export function camCfgDocData(coverMs: number, now: number) {
  return { name: "ตั้งค่ากล้อง", email: CAM_CFG_ID, coverMs: clampCoverMs(coverMs), updatedAt: now };
}

let coverMs = COVER_MS_DEFAULT;
let loadedCache = false;
function readCache() {
  if (loadedCache) return;
  loadedCache = true;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) coverMs = clampCoverMs((JSON.parse(raw) as { coverMs?: number }).coverMs);
  } catch {
    /* ไม่เป็นไร ใช้ค่าเริ่มต้น */
  }
}
// ค่าที่ตัวตรวจกล้องใช้อยู่ตอนนี้ (อ่านทุกครั้งที่ตัดสิน → เปลี่ยนค่ากลางคันก็มีผลทันที)
export function getCoverMs(): number {
  readCache();
  return coverMs;
}
export function applyCoverMs(n: unknown) {
  readCache();
  coverMs = clampCoverMs(n);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ coverMs, at: Date.now() }));
  } catch {
    /* ไม่เป็นไร */
  }
}

export interface CamCfg {
  coverMs: number;
  updatedAt: number | null;
  found: boolean; // false = ยังไม่เคยตั้งค่า (ใช้ค่าเริ่มต้น)
}

// อ่านจากฐานข้อมูล · ไม่ throw · อ่านไม่ได้ = คืน null และไม่เปลี่ยนค่าที่ใช้อยู่
export async function fetchCamCfg(timeoutMs = 4000): Promise<CamCfg | null> {
  if (!db) return null;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "students", CAM_CFG_ID)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    if (!snap.exists()) return { coverMs: COVER_MS_DEFAULT, updatedAt: null, found: false };
    const d = snap.data() as { coverMs?: number; updatedAt?: number };
    return { coverMs: clampCoverMs(d.coverMs), updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : null, found: true };
  } catch (e) {
    console.warn("camCfg:", e);
    return null;
  }
}

// หน้านักเรียนเรียกตอนเปิดกล้อง (ไม่ต้อง await)
export async function refreshCamSettings(): Promise<void> {
  const c = await fetchCamCfg();
  if (c) applyCoverMs(c.coverMs);
}

// ครูบันทึก · คืน null = สำเร็จ · ไม่เช่นนั้นคืนข้อความสาเหตุ
export async function saveCoverMs(ms: number): Promise<string | null> {
  if (!db) return "ยังเชื่อมต่อ Firebase ไม่ได้ (db ว่าง)";
  try {
    await Promise.race([
      setDoc(doc(db, "students", CAM_CFG_ID), camCfgDocData(ms, Date.now()), { merge: true }),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), 15000)),
    ]);
    applyCoverMs(ms);
    return null;
  } catch (e) {
    console.error("saveCoverMs:", e);
    return String((e as { code?: string })?.code || (e as Error)?.message || "unknown");
  }
}
