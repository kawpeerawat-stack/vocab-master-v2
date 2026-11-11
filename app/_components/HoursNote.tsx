"use client";
// แถบแจ้งเวลาให้บริการกล้อง (ปิด 16.30 น. · PDPA) — ใช้ร่วมหน้าเลือกห้องและห้องเรียน
import type { Hours } from "../lib/hours";

export function HoursNote({ hours, compact }: { hours: Hours; compact?: boolean }) {
  if (!hours.open) {
    return (
      <div data-hours="closed" className={`rounded-2xl border-2 border-indigo-200 bg-indigo-50 text-left ${compact ? "px-3 py-2 mb-2" : "p-4 mb-5"}`}>
        <p className={`font-black text-indigo-900 ${compact ? "text-xs" : "text-sm"}`}>🌙 ปิดกล้องและรอบที่เข้าสมุดคะแนนแล้ว (หลัง 16.30 น.)</p>
        <p className="text-xs font-bold text-indigo-800 mt-1">เปิดใหม่ 06.00 น. · ตอนนี้ฝึกอิสระที่ไม่ใช้กล้องได้ตามปกติ · ระบบไม่เปิดกล้องนอกเวลาเรียน เพื่อความเป็นส่วนตัวของนักเรียน</p>
      </div>
    );
  }
  if (hours.minsLeft !== null && hours.minsLeft <= 5) {
    return (
      <div data-hours="warn" className={`rounded-2xl border-2 border-amber-300 bg-amber-50 text-left ${compact ? "px-3 py-2 mb-2" : "px-4 py-3 mb-4"}`}>
        <p className="text-xs font-black text-amber-900">⏰ อีก {hours.minsLeft} นาที (16.30 น.) ระบบจะปิดกล้องและรอบที่เข้าสมุดคะแนน — รอบที่ทำค้างอยู่จะถูกยกเลิก ไม่บันทึกคะแนน</p>
      </div>
    );
  }
  return null;
}
