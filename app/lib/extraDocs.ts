// app/lib/extraDocs.ts — รูปแบบเอกสารห้องเรียนพิเศษที่เขียนลง Firestore (ไม่พึ่ง Firebase เพื่อให้ทดสอบเทียบกับ Rules ได้)
//
// Firebase Rules ของโรงเรียน (students/{studentId}) อนุญาตสร้าง/แก้เฉพาะเมื่อเอกสารที่ได้หลังรวมค่า มี
//   email เป็นข้อความ (< 200) · name เป็นข้อความ (< 100) · และ รหัสเอกสาร == email
// → ทุกเอกสารที่เราเขียน (รวมเอกสารตั้งค่ารหัสเข้าชั้น) ต้องมี name + email ที่เท่ากับรหัสเอกสารเสมอ
export const EXTRA_PREFIX = "ex:";
export const CONFIG_ID = "cfg:extra@extraclass.local";
export const extraIdentity = (email: string) => EXTRA_PREFIX + email.trim().toLowerCase();

export function codeDocData(codeHash: string, now: number) {
  return { name: "ตั้งค่าห้องเรียนพิเศษ", email: CONFIG_ID, codeHash, updatedAt: now };
}

export interface ProfileLike {
  first: string;
  last: string;
  level: "4" | "6";
  email: string;
}
export const extraName = (p: Pick<ProfileLike, "first" | "last" | "level">) => `${p.first} ${p.last} (เรียนพิเศษ ม.${p.level})`;

export function profileDocData(p: ProfileLike, now: number) {
  const id = extraIdentity(p.email);
  return { id, data: { name: extraName(p), email: id, profile: { first: p.first, last: p.last, level: p.level }, group: "extra", updatedAt: now } };
}
