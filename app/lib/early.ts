// app/lib/early.ts
// ─────────────────────────────────────────────────────────────
// "ทำล่วงหน้า" (9 พ.ย. · ครูสั่ง): ผล 🧩 บท / 📚 ชุด ที่ทำก่อนวันเรียนของห้องตัวเอง ไม่นับ
//   - ยังไม่ผ่านระบบคัดกรองการเปิดกล้องในคาบ → ต้องทำใหม่ทั้งรอบพร้อมกล้องเมื่อถึงวันเรียน
//   - ยกเว้นบท/ชุดที่ครูกดเปิดล่วงหน้าให้คนนั้น (unlock) — ครูอนุญาตเอง
//   - ผลเก่าเก็บไว้ในรอบใหม่ (early / prev) ให้ครูดูได้ ไม่ลบทิ้ง
// ─────────────────────────────────────────────────────────────

// วันที่ (YYYY-MM-DD) เวลาประเทศไทย จากเวลา ms
export const thaiDayOf = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);

// 11 พ.ย. (ครูสั่ง): สัปดาห์ที่ 1–2 (ทั้ง ม.4 และ ม.6) อนุโลมให้ผ่าน แม้ทำล่วงหน้า — นับผ่านตามคะแนนที่ทำ และแสดงป้าย "อนุโลม" ให้ครูแยกได้
//   สัปดาห์ 3 เป็นต้นไปยังใช้กติกาเดิม (ทำล่วงหน้า = ไม่นับ ต้องทำใหม่พร้อมกล้อง)
export const GRACE_UNTIL = 2;

// ทำก่อนวันเปิดของห้อง (ยังไม่ดูว่าอนุโลมหรือไม่)
const beforeOpen = (day: string | null | undefined, open: string | null | undefined, unlocked: boolean) => !!day && !!open && !unlocked && day < open;

// ทำล่วงหน้าแบบ "ไม่นับ" หรือไม่ (openDay = null → ไม่ล็อก ไม่นับว่าล่วงหน้า) · n = ลำดับบท/ชุด (สัปดาห์)
export function doneEarly(day: string | null | undefined, open: string | null | undefined, unlocked: boolean, n: number): boolean {
  return n > GRACE_UNTIL && beforeOpen(day, open, unlocked);
}
// ทำล่วงหน้าแต่ได้รับอนุโลม (สัปดาห์ 1–2) → นับผ่าน + ป้าย "อนุโลม"
export function doneGraced(day: string | null | undefined, open: string | null | undefined, unlocked: boolean, n: number): boolean {
  return n <= GRACE_UNTIL && beforeOpen(day, open, unlocked);
}
