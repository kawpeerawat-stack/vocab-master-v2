// app/lib/teacherCode.ts
// ─────────────────────────────────────────────────────────────
// รหัสครู "ห้องละ 1 รหัสต่อคาบ" (v8.6) — ครูเลือกห้องในหน้าครู แล้วบอกรหัสเดียวให้เครื่องของนักเรียนห้องนั้นที่ครูไปตรวจแล้ว
//   • ผูกกับ "ห้อง" (เช่น ม.6/5) → นักเรียนห้องอื่นใช้ไม่ได้
//   • เปลี่ยนรหัสทุก 30 นาที (หน้าต่างเวลาของเซิร์ฟเวอร์ · ปัจจุบัน + ก่อนหน้า → ใช้ได้ 30–60 นาที = 1 คาบ)
//   • ผิดครบ 5 ครั้ง → ล็อกเครื่องนั้น 10 นาที (กันไล่เดารหัส)
//   kind: nocam = กล้องเปิดไม่ได้จริง (ทำแบบจับเวลา ครูเห็น ⚠️) · lift = ปลดล็อกรอบที่ยกเลิกครบกำหนดของวันนี้
//   (v8.5 เป็นรหัสรายคนใช้ครั้งเดียว — ครูปรับเป็นรหัสห้องเพื่อลดภาระการออกรหัส)
// ข้อจำกัด: รหัสห้องส่งต่อให้เพื่อนในห้องเดียวกันได้ภายในช่วงเวลานั้น และสูตรอยู่ในโค้ดฝั่งเครื่อง
//   ผู้เชี่ยวชาญที่ถอดโค้ดอ่านคำนวณเองได้ — ป้องกันการส่งต่อตามปกติ ไม่ใช่ระบบความปลอดภัยเต็มรูปแบบ
// ─────────────────────────────────────────────────────────────
export type CodeKind = "nocam" | "lift";
export const CODE_WIN_MS = 30 * 60 * 1000;
export const CODE_TRIES = 5;
export const CODE_LOCK_MS = 10 * 60 * 1000;
const SALT = "anukoolnaree|vocab-master|tcode|v3-room";

export const winOf = (ms: number) => Math.floor(ms / CODE_WIN_MS);
// "ม.6/5" · "M.6/5" · " 6 / 5 " → "6/5" (ไม่ใช่รูปแบบห้องที่รู้จัก → null)
export function normRoom(r?: string | null): string | null {
  const m = (r || "").match(/([46])\s*[\/._-]\s*([1-9])/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
// 6 หลัก (100000–999999) ของห้อง + ชนิด + หน้าต่างเวลา
export function codeFor(kind: CodeKind, room: string, win: number): string {
  const s = `${SALT}|${kind}|${normRoom(room) ?? room.trim()}|${win}`;
  const a = fnv(s, 0x811c9dc5);
  const b = fnv(`${s}|${a}`, 0x01000193 ^ a);
  return String(100000 + ((a ^ Math.imul(b, 0x9e3779b1)) >>> 0) % 900000);
}

// รหัสที่ครูเห็นตอนนี้ + เวลาที่เหลือก่อนหมดอายุ (ใช้ได้ถึงสิ้นหน้าต่างถัดไป = อย่างน้อย minMs)
export function issueCode(kind: CodeKind, room: string, nowMs: number) {
  const w = winOf(nowMs);
  return { code: codeFor(kind, room, w), win: w, expiresInMs: (w + 2) * CODE_WIN_MS - nowMs, minMs: (w + 1) * CODE_WIN_MS - nowMs };
}

// ตรวจรหัสที่นักเรียนกรอก → true ถ้าตรงกับรหัสของห้องนี้ (ปัจจุบันหรือหน้าต่างก่อนหน้า)
export function matchCode(kind: CodeKind, room: string, input: string, nowMs: number): boolean {
  const v = input.replace(/\D/g, "");
  if (v.length !== 6) return false;
  const w = winOf(nowMs);
  return [w, w - 1].some((x) => codeFor(kind, room, x) === v);
}

// ── จำจำนวนครั้งที่กรอกผิด (ในเครื่อง) ──
const FAIL_KEY = "tc:fail:v3";
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
export function lockLeftMs(nowMs: number): number {
  try {
    const f = JSON.parse(lsGet(FAIL_KEY) || "null") as { n: number; until: number } | null;
    return f && f.until > nowMs ? f.until - nowMs : 0;
  } catch {
    return 0;
  }
}
export function noteFail(nowMs: number): number {
  let f: { n: number; until: number } = { n: 0, until: 0 };
  try {
    f = JSON.parse(lsGet(FAIL_KEY) || "null") || f;
  } catch {
    /* เริ่มใหม่ */
  }
  if (f.until && f.until <= nowMs) f = { n: 0, until: 0 };
  f.n++;
  if (f.n >= CODE_TRIES) f = { n: 0, until: nowMs + CODE_LOCK_MS };
  lsSet(FAIL_KEY, JSON.stringify(f));
  return f.until > nowMs ? 0 : CODE_TRIES - f.n; // เหลือกี่ครั้งก่อนล็อก (0 = ล็อกแล้ว)
}
export function clearFails() {
  try {
    localStorage.removeItem(FAIL_KEY);
  } catch {
    /* ไม่เป็นไร */
  }
}

export type CodeResult = "ok" | "wrong" | "locked" | "noroom";
// ตรวจรหัสห้อง (ไม่ต้องต่อเน็ต — คำนวณในเครื่อง) · room = ห้องของนักเรียนคนนี้ (ไม่รู้ห้อง → noroom)
export function redeemCode(kind: CodeKind, room: string | null | undefined, input: string, nowMs: number): { result: CodeResult; left?: number; lockMs?: number } {
  const lock = lockLeftMs(nowMs);
  if (lock > 0) return { result: "locked", lockMs: lock };
  const r = normRoom(room);
  if (!r) return { result: "noroom" };
  if (!matchCode(kind, r, input, nowMs)) {
    const left = noteFail(nowMs);
    return left === 0 ? { result: "locked", lockMs: CODE_LOCK_MS } : { result: "wrong", left };
  }
  clearFails();
  return { result: "ok" };
}
