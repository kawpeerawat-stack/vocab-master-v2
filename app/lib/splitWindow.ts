// app/lib/splitWindow.ts — ตรวจ "หน้าต่างแอปไม่เต็มจอ" (แบ่งจอ / หน้าต่างลอย) · แยกไฟล์เพื่อทดสอบได้โดยไม่พึ่ง React
export const SPLIT_RATIO = 0.7;      // ด้านยาวของหน้าต่างเล็กกว่า 70% ของด้านยาวของจอ = ไม่เต็มจอ (เต็มจอปกติ ≥ ~77%)
export const SPLIT_HOLD_MS = 1200;   // ต้องเล็กค้างเกินนี้จึงนับ (กันแป๊บเดียวตอนหมุนจอ)
export const SPLIT_GRACE_MS = 10000; // ขยายคืนภายในเวลานี้ = ไปต่อได้ (ข้อนั้นไม่นับ) · เกิน = หยุดรอบ
export const SPLIT_STOP_AT = 2;      // ครั้งที่ 2 ในรอบเดียว = หยุดรอบทันที
export interface WinMetrics { iw: number; ih: number; sw: number; sh: number; coarse: boolean; typing: boolean }
// ใช้กับจอสัมผัสเท่านั้น (มือถือ/แท็บเล็ต) · กำลังพิมพ์ (แป้นพิมพ์ดันหน้าจอเล็กลง) ไม่นับ · ใช้ "ด้านยาว" จึงไม่เพี้ยนตอนหมุนจอ
export function isSplitWindow(m: WinMetrics): boolean {
  if (!m.coarse || m.typing) return false;
  if (!(m.sw > 0 && m.sh > 0 && m.iw > 0 && m.ih > 0)) return false;
  return Math.max(m.iw, m.ih) / Math.max(m.sw, m.sh) < SPLIT_RATIO;
}
