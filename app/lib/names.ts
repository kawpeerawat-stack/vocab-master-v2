// app/lib/names.ts
// ─────────────────────────────────────────────────────────────
// ตัวช่วยเรื่องชื่อ/ห้อง/เลขที่ (ไม่มี import ใด ๆ — ใช้ได้ทั้งหน้านักเรียน หน้าครู และ API)
// ─────────────────────────────────────────────────────────────

// ชั้นเรียนที่เลือกได้ แยกตามระดับชั้น (ให้ตรงกับ data/roster.json — ม.4/2 ยังไม่มีรายชื่อ เลือกได้แต่ระบบจะไม่ตรวจกับรายชื่อ)
export const GRADES = [
  { grade: "6", label: "ม.6", hub: "Grade 12 Mastery Hub", rooms: ["6/1", "6/2", "6/3", "6/4", "6/5"] },
  { grade: "4", label: "ม.4", hub: "Grade 10 Foundation Hub", rooms: ["4/1", "4/2", "4/3"] },
];
export const ROOM_OPTIONS = GRADES.flatMap((g) => g.rooms);
// ระดับชั้นของห้อง เช่น "4/1" → "4"
export function gradeOf(room?: string | null): string | null {
  const m = (room || "").match(/^([46])\//);
  return m ? m[1] : null;
}
export const MAX_NO = 60;

export interface StudentProfile {
  first: string;
  last: string;
  no: number;
  room: string;
  email: string;
}
export type ProfileField = "first" | "last" | "no" | "room" | "email";

const PREFIX_RE = /^(นางสาว|เด็กชาย|เด็กหญิง|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.|mr\.?|mrs\.?|miss|ms\.?)\s*/i;
// ตัดช่องว่างเกิน และคำนำหน้าชื่อที่นักเรียนเผลอพิมพ์มา
export function cleanNamePart(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(PREFIX_RE, "").trim();
}

export function composeName(p: Pick<StudentProfile, "first" | "last" | "no" | "room">): string {
  return `${p.first} ${p.last} No.${p.no} M.${p.room}`;
}

// ชื่อสำหรับแสดงผล (ตัดเลขที่/ห้องท้ายชื่อออก) เช่น ในตารางอันดับ
export function displayName(name?: string): string {
  return (name || "")
    .replace(/\s*(no\.?\s*\d{1,2}|เลขที่\s*\d{1,2}|#\s*\d{1,2})\b/gi, "")
    .replace(/\s*(m\.?|ม\.?)\s*[1-6]\s*\/\s*\d{1,2}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ห้องจากชื่อรวม เช่น "สมชาย รักดี No.5 M.4/1" → "4/1" (ดู M./ม. ก่อน แล้วค่อยหาแบบ 6/2 · 6.2)
export function roomOf(name?: string): string | null {
  const s = name || "";
  const m = s.match(/(?:m|ม)\.?\s*([46])\s*\/\s*([1-9])/i) || s.match(/([46])\s*[\/._-]\s*([1-9])/);
  return m ? `${m[1]}/${m[2]}` : null;
}
export function extractNo(s?: string): number | null {
  const m = (s || "").match(/no\.?\s*(\d{1,2})\b/i) || (s || "").match(/เลขที่\s*(\d{1,2})/) || (s || "").match(/#\s*(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}

// เติมช่องจากชื่อแบบเดิม (พิมพ์รวมช่องเดียว) ให้นักเรียนที่เคยเข้าระบบแล้วตรวจและแก้ได้ง่าย
export function profileFromLegacyName(name?: string): Partial<StudentProfile> {
  const room = roomOf(name) ?? undefined;
  const no = extractNo(name) ?? undefined;
  const parts = displayName(name).split(" ").map(cleanNamePart).filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" "), room: room && ROOM_OPTIONS.includes(room) ? room : undefined, no };
}

// ตรวจว่ากรอกครบและถูกรูปแบบ — คืนข้อความผิดพลาดรายช่อง (ว่าง = ผ่าน)
export function validateProfile(p: { first: string; last: string; no: string; room: string; email: string }): Partial<Record<ProfileField, string>> {
  const e: Partial<Record<ProfileField, string>> = {};
  const first = cleanNamePart(p.first);
  const last = cleanNamePart(p.last);
  if (!first) e.first = "กรอกชื่อจริง";
  else if (/\d/.test(first) || first.length < 2) e.first = "ชื่อต้องเป็นตัวอักษรอย่างน้อย 2 ตัว";
  if (!last) e.last = "กรอกนามสกุล";
  else if (/\d/.test(last) || last.length < 2) e.last = "นามสกุลต้องเป็นตัวอักษรอย่างน้อย 2 ตัว";
  const noStr = p.no.trim();
  const no = Number(noStr);
  if (!noStr) e.no = "กรอกเลขที่";
  else if (!/^\d{1,2}$/.test(noStr) || no < 1 || no > MAX_NO) e.no = `เลขที่ต้องเป็นตัวเลข 1–${MAX_NO}`;
  if (!p.room) e.room = "เลือกชั้นเรียน";
  else if (!ROOM_OPTIONS.includes(p.room)) e.room = "เลือกชั้นเรียนจากรายการ";
  const m = p.email.trim().toLowerCase();
  if (!m) e.email = "กรอกอีเมล";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) e.email = "อีเมลไม่ถูกต้อง เช่น somchai.r@gmail.com";
  return e;
}

