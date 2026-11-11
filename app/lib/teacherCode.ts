// app/lib/teacherCode.ts
// ─────────────────────────────────────────────────────────────
// รหัสครู "รายคน · ใช้ครั้งเดียว · หมดอายุ" (v8.5) — แทนรหัสประจำวัน 4 หลักที่ใครก็ส่งต่อกันในไลน์ได้
//   • ผูกกับอีเมลของนักเรียนคนนั้น → ส่งต่อให้เพื่อนใช้ไม่ได้
//   • อายุรหัส 10–20 นาที (หน้าต่างเวลาของเซิร์ฟเวอร์ 10 นาที: ปัจจุบัน + ก่อนหน้า)
//   • ใช้ได้ครั้งเดียวต่อหน้าต่างเวลา (จำไว้ในเครื่อง + บนระบบ)
//   • ผิดครบ 5 ครั้ง → ล็อก 10 นาที (กันไล่เดารหัส)
//   kind: nocam = กล้องเปิดไม่ได้จริง (ทำแบบจับเวลา) · lift = ปลดล็อกรอบที่ยกเลิกครบกำหนดของวันนี้
// ข้อจำกัด: สูตรอยู่ในโค้ดฝั่งเครื่อง ผู้เชี่ยวชาญที่ถอดโค้ดอ่านคำนวณเองได้ — ป้องกันการแชร์รหัสกันตามปกติ ไม่ใช่ระบบความปลอดภัยเต็มรูปแบบ
// ─────────────────────────────────────────────────────────────
export type CodeKind = "nocam" | "lift";
export const CODE_WIN_MS = 10 * 60 * 1000;
export const CODE_TRIES = 5;
export const CODE_LOCK_MS = 10 * 60 * 1000;
export const CLOUD_WAIT_MS = 1500;
const SALT = "anukoolnaree|vocab-master|tcode|v2";

export const winOf = (ms: number) => Math.floor(ms / CODE_WIN_MS);
export const normEmail = (e: string) => e.trim().toLowerCase();

function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
// 6 หลัก (100000–999999)
export function codeFor(kind: CodeKind, email: string, win: number): string {
  const s = `${SALT}|${kind}|${normEmail(email)}|${win}`;
  const a = fnv(s, 0x811c9dc5);
  const b = fnv(`${s}|${a}`, 0x01000193 ^ a);
  return String(100000 + ((a ^ Math.imul(b, 0x9e3779b1)) >>> 0) % 900000);
}

// รหัสที่ครูเห็นตอนนี้ + เวลาที่เหลือก่อนหมดอายุ (ใช้ได้ถึงสิ้นหน้าต่างถัดไป = อย่างน้อย 10 นาที)
export function issueCode(kind: CodeKind, email: string, nowMs: number) {
  const w = winOf(nowMs);
  return { code: codeFor(kind, email, w), win: w, expiresInMs: (w + 2) * CODE_WIN_MS - nowMs, minMs: (w + 1) * CODE_WIN_MS - nowMs };
}

// ตรวจรหัสที่นักเรียนกรอก → คืนเลขหน้าต่างที่ตรง (หรือ null) · ไม่ตรวจ "ใช้แล้ว" ที่นี่
export function matchCode(kind: CodeKind, email: string, input: string, nowMs: number): number | null {
  const v = input.replace(/\D/g, "");
  if (v.length !== 6) return null;
  const w = winOf(nowMs);
  for (const x of [w, w - 1]) if (codeFor(kind, email, x) === v) return x;
  return null;
}

// ── จำว่าใช้ไปแล้ว / ผิดกี่ครั้ง (ในเครื่อง) ──
const usedKey = (kind: CodeKind, email: string, win: number) => `tc:used:${kind}:${normEmail(email)}:${win}`;
const failKey = (email: string) => `tc:fail:${normEmail(email)}`;
const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ไม่เป็นไร */
  }
};
export const isUsed = (kind: CodeKind, email: string, win: number) => lsGet(usedKey(kind, email, win)) === "1";
export const markUsed = (kind: CodeKind, email: string, win: number) => lsSet(usedKey(kind, email, win), "1");

export function lockLeftMs(email: string, nowMs: number): number {
  try {
    const f = JSON.parse(lsGet(failKey(email)) || "null") as { n: number; until: number } | null;
    return f && f.until > nowMs ? f.until - nowMs : 0;
  } catch {
    return 0;
  }
}
export function noteFail(email: string, nowMs: number): number {
  let f: { n: number; until: number } = { n: 0, until: 0 };
  try {
    f = JSON.parse(lsGet(failKey(email)) || "null") || f;
  } catch {
    /* เริ่มใหม่ */
  }
  if (f.until && f.until <= nowMs) f = { n: 0, until: 0 };
  f.n++;
  if (f.n >= CODE_TRIES) f = { n: 0, until: nowMs + CODE_LOCK_MS };
  lsSet(failKey(email), JSON.stringify(f));
  return f.until > nowMs ? 0 : CODE_TRIES - f.n; // เหลือกี่ครั้งก่อนล็อก (0 = ล็อกแล้ว)
}
export function clearFails(email: string) {
  try {
    localStorage.removeItem(failKey(email));
  } catch {
    /* ไม่เป็นไร */
  }
}

export type CodeResult = "ok" | "wrong" | "used" | "locked";
// ตรวจและ "ใช้" รหัส (ใช้ครั้งเดียว) · cloudUsed = ฟังก์ชันตรวจ/บันทึกบนระบบ (ไม่บังคับ)
export async function redeemCode(
  kind: CodeKind,
  email: string,
  input: string,
  nowMs: number,
  cloud?: { isUsed: (win: number) => Promise<boolean>; markUsed: (win: number) => Promise<void> }
): Promise<{ result: CodeResult; left?: number; lockMs?: number }> {
  const lock = lockLeftMs(email, nowMs);
  if (lock > 0) return { result: "locked", lockMs: lock };
  const win = matchCode(kind, email, input, nowMs);
  if (win === null) {
    const left = noteFail(email, nowMs);
    return left === 0 ? { result: "locked", lockMs: CODE_LOCK_MS } : { result: "wrong", left };
  }
  if (isUsed(kind, email, win)) return { result: "used" };
  try {
    // เช็คบนระบบว่าถูกใช้ไปแล้วไหม (เครื่องอื่น/ล้างข้อมูล) — รอไม่เกิน 1.5 วินาที ระบบช้าหรือเน็ตหลุดก็ไม่ค้างหน้า
    if (cloud && (await Promise.race([cloud.isUsed(win), new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error("timeout")), CLOUD_WAIT_MS))]))) {
      markUsed(kind, email, win);
      return { result: "used" };
    }
  } catch {
    /* ระบบไม่ตอบ → ใช้ตามข้อมูลในเครื่อง */
  }
  markUsed(kind, email, win);
  clearFails(email);
  void Promise.resolve(cloud?.markUsed(win)).catch(() => undefined); // ส่งขึ้นระบบแบบไม่รอผล
  return { result: "ok" };
}
