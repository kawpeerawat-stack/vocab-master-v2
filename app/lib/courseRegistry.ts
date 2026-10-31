// app/lib/courseRegistry.ts
// ทะเบียนคอร์สบทเรียน (ไฟล์นี้ไม่ import firebase — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าจอ)
//   เพิ่มคอร์สใหม่: วางไฟล์ JSON ใน data/ (โครงสร้างเดียวกับ decoder_lessons.json)
//   แล้วเพิ่ม 1 แถวด้านล่าง + เพิ่ม 1 บรรทัดใน app/api/course/route.ts
export interface CourseMeta {
  id: string;        // ใช้เป็น key ใน Firestore — ห้ามเปลี่ยนหลังเปิดใช้จริง
  title: string;
  titleTh: string;
  icon: string;
  grade: "6" | "4"; // ระดับชั้นที่ใช้คอร์สนี้ (หน้าครูแสดงตามระดับชั้นที่เลือก)
}
export const COURSE_REGISTRY: CourseMeta[] = [
  { id: "decoder", title: "Root Words Decoder", titleTh: "ถอดรหัสคำศัพท์", icon: "🧩", grade: "6" },
  { id: "decoder4", title: "Root Words Decoder · Foundation", titleTh: "ถอดรหัสคำศัพท์ ม.4", icon: "🧩", grade: "4" },
];
export function courseMeta(id: string): CourseMeta | undefined {
  return COURSE_REGISTRY.find((c) => c.id === id);
}
