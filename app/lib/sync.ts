// app/lib/sync.ts
// ─────────────────────────────────────────────────────────────
// ส่งข้อมูลขึ้นระบบ (Firestore) แบบไม่สะดุด — ใช้ร่วมกันทั้งห้อง 📚 และ 🧩
//   - ส่งทีละครั้งต่อนักเรียน 1 คน (ไม่ต่อคิวซ้อนกัน) · ครั้งถัดไปเริ่มหลังครั้งก่อนจบ
//   - เน็ตช้า: ไม่ตัดสินว่า "ล้มเหลว" ทันที → แจ้ง "กำลังส่ง…" แล้วรอผลจริงต่อ (ระบบส่งต่อเองเบื้องหลัง)
//   - แยกสาเหตุที่ส่งไม่ได้ (เน็ต / ใบยืนยันแอป / ที่เก็บเต็ม / โควตา) เพื่อบอกนักเรียนตรง ๆ
//   - เวลาของเซิร์ฟเวอร์ (ใช้ล็อกบทตามวันเรียน — แก้นาฬิกาในมือถือไม่ได้ผล)
// ─────────────────────────────────────────────────────────────
import { refreshAppCheck } from "./firebase";

// สาเหตุที่ส่งไม่สำเร็จ
//   offline = เน็ตหลุด/ช้ามาก · verify = ใบยืนยันแอปไม่ผ่าน · full = ที่เก็บข้อมูลของอีเมลนี้เต็ม
//   quota = ระบบใช้โควตาฟรีของวันนี้หมด · error = อื่น ๆ
export type SyncIssue = "offline" | "verify" | "full" | "quota" | "error";
export type SyncState = "idle" | "saving" | "slow" | "ok" | SyncIssue;

export function classifyError(e: unknown): SyncIssue {
  const code = String((e as { code?: string })?.code || "");
  const msg = String((e as { message?: string })?.message || e || "").toLowerCase();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (msg.includes("index entries") || msg.includes("maximum allowed size") || msg.includes("exceeds the maximum")) return "full";
  if (code === "permission-denied" || code === "unauthenticated" || code.startsWith("appCheck/") || msg.includes("app check") || msg.includes("appcheck")) return "verify";
  if (code === "resource-exhausted" || msg.includes("quota")) return "quota";
  if (code === "unavailable" || code === "deadline-exceeded" || msg === "timeout" || msg.includes("offline") || msg.includes("network")) return "offline";
  return "error";
}

// รหัสสั้นสำหรับนักเรียนถ่ายรูปส่งครู
export const ISSUE_CODE: Record<SyncIssue, string> = { offline: "N1", verify: "V2", full: "F3", quota: "Q4", error: "E5" };

// ข้อความบอกนักเรียน (สั้น อ่านเข้าใจทันที)
export function issueText(s: SyncState): string {
  switch (s) {
    case "saving":
      return "⏳ กำลังส่งผลขึ้นระบบ…";
    case "slow":
      return "⏳ เน็ตช้า กำลังส่งอยู่ — ทำต่อได้เลย ระบบจะขึ้น ✓ เองเมื่อส่งถึง";
    case "ok":
      return "✓ ส่งผลขึ้นระบบแล้ว";
    case "offline":
      return `⚠️ ยังส่งไม่ได้ เพราะเน็ตหลุดหรือช้ามาก — ผลอยู่ในเครื่องแล้ว ระบบจะลองส่งให้เองเรื่อย ๆ (รหัส ${ISSUE_CODE.offline})`;
    case "verify":
      return `⚠️ ระบบยืนยันแอปไม่ผ่าน — ปิดแท็บนี้แล้วเปิดเว็บใหม่ (ไม่ใช่แค่รีเฟรช) ผลในเครื่องจะส่งขึ้นให้เอง (รหัส ${ISSUE_CODE.verify})`;
    case "full":
      return `⚠️ ที่เก็บข้อมูลของอีเมลนี้เต็ม — แจ้งครู ผลยังอยู่ในเครื่อง ไม่หาย (รหัส ${ISSUE_CODE.full})`;
    case "quota":
      return `⚠️ ระบบรับข้อมูลวันนี้ครบโควตาแล้ว — ผลอยู่ในเครื่อง จะส่งให้เองเมื่อเปิดห้องนี้วันถัดไป (รหัส ${ISSUE_CODE.quota})`;
    case "error":
      return `⚠️ ส่งไม่สำเร็จ — ผลอยู่ในเครื่องแล้ว กด "ส่งอีกครั้ง" หรือแจ้งครู (รหัส ${ISSUE_CODE.error})`;
    default:
      return "";
  }
}
export const isIssue = (s: SyncState): s is SyncIssue => s === "offline" || s === "verify" || s === "full" || s === "quota" || s === "error";

// ── ส่งทีละครั้งต่อ key (เช่น อีเมลนักเรียน) ──
const chains: Record<string, Promise<unknown>> = {};
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains[key] ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  chains[key] = run.catch(() => undefined);
  return run;
}

// รอผลการเขียน: แจ้ง "ช้า" หลัง slowMs · ยอมแพ้ (รายงานว่าเน็ตหลุด) หลัง giveUpMs — การเขียนจริงยังส่งต่อเบื้องหลัง
export async function awaitWrite(
  p: Promise<unknown>,
  opt: { slowMs?: number; giveUpMs?: number; onSlow?: () => void } = {}
): Promise<{ ok: true } | { ok: false; issue: SyncIssue }> {
  const { slowMs = 8000, giveUpMs = 40000, onSlow } = opt;
  let slowT: ReturnType<typeof setTimeout> | undefined;
  let giveT: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      slowT = setTimeout(() => onSlow?.(), slowMs);
      giveT = setTimeout(() => reject(new Error("timeout")), giveUpMs);
      p.then(() => resolve(), reject);
    });
    return { ok: true };
  } catch (e) {
    console.error("write failed:", e);
    return { ok: false, issue: classifyError(e) };
  } finally {
    if (slowT) clearTimeout(slowT);
    if (giveT) clearTimeout(giveT);
  }
}

// ก่อนส่ง: ต่ออายุใบยืนยันแอป · ถ้าต่ออายุไม่ผ่าน ยังลองส่ง (ระบบอาจไม่บังคับ) แต่ถ้าส่งไม่ผ่านจะบอกว่าเป็นเรื่องใบยืนยัน
export async function ensureVerified(): Promise<boolean> {
  try {
    return await refreshAppCheck();
  } catch {
    return true;
  }
}
export async function verifiedWrite(
  start: () => Promise<unknown>,
  onSlow?: () => void
): Promise<{ ok: true } | { ok: false; issue: SyncIssue }> {
  const tokenOk = await ensureVerified();
  const r = await awaitWrite(start(), { onSlow });
  if (!r.ok && !tokenOk && r.issue !== "full" && r.issue !== "quota") return { ok: false, issue: "verify" };
  return r;
}

// ── เวลาของเซิร์ฟเวอร์ ──
let clockOffset: number | null = null;
let clockPromise: Promise<number> | null = null;
export function serverNow(): number {
  return Date.now() + (clockOffset ?? 0);
}
export function syncClock(): Promise<number> {
  if (clockOffset !== null) return Promise.resolve(clockOffset);
  if (clockPromise) return clockPromise;
  clockPromise = (async () => {
    try {
      const t0 = Date.now();
      const res = await fetch("/api/time", { cache: "no-store" });
      const j = (await res.json()) as { now?: number };
      const t1 = Date.now();
      if (typeof j.now === "number") clockOffset = j.now - (t0 + t1) / 2;
    } catch {
      /* ใช้นาฬิกาเครื่องไปก่อน */
    }
    clockPromise = null;
    return clockOffset ?? 0;
  })();
  return clockPromise;
}
// วันที่ (YYYY-MM-DD) ตามเวลาเซิร์ฟเวอร์ ในเขตเวลาประเทศไทย
export function serverToday(): string {
  const d = new Date(serverNow() + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}

// ── บทที่ครูเปิดให้ล่วงหน้า (รายคน) — เก็บใน students/{email}.unlock = { decoder: 5, v300: 3, ... } ──
const unlockKey = (email: string) => `unlock:${email.trim().toLowerCase()}`;
export type UnlockMap = Record<string, number>;
export function loadLocalUnlock(email: string): UnlockMap {
  try {
    return JSON.parse(localStorage.getItem(unlockKey(email)) || "{}") as UnlockMap;
  } catch {
    return {};
  }
}
export function saveLocalUnlock(email: string, u: unknown) {
  if (!u || typeof u !== "object") return;
  try {
    localStorage.setItem(unlockKey(email), JSON.stringify(u));
  } catch {
    /* ไม่เป็นไร */
  }
}

// วันเปิดบท = วันจันทร์ของสัปดาห์ในแผน + วันเรียนของห้อง (0 = จันทร์ ... 4 = ศุกร์)
export function openDay(start: string | undefined, room: string | null | undefined, classDays?: Record<string, number>): string | null {
  if (!start) return null;
  const off = (room && classDays?.[room]) || 0;
  const [y, m, d] = start.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + off));
  return t.toISOString().slice(0, 10);
}
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DAY = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export function thaiDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `วัน${TH_DAY[wd]}ที่ ${d} ${TH_MONTH[m - 1]}`;
}
const TH_DAY_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export function thaiShort(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${TH_DAY_SHORT[wd]} ${d} ${TH_MONTH[m - 1]}`;
}
