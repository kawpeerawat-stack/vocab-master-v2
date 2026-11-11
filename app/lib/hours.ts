"use client";
// app/lib/hours.ts
// ─────────────────────────────────────────────────────────────
// เวลาให้บริการกล้อง + รอบที่เข้าสมุดคะแนน (11 พ.ย. 2569 · ครูสั่ง · PDPA)
//   เปิด 06.00 – 16.30 น. ทุกวัน (เวลาไทย จากนาฬิกาเซิร์ฟเวอร์ — ปรับนาฬิกาเครื่องเลี่ยงไม่ได้)
//   นอกเวลา: เปิดกล้องไม่ได้ · ทำรอบที่เข้าสมุดคะแนนไม่ได้ · ฝึกอิสระที่ไม่ใช้กล้องยังเข้าได้
//   ก่อนปิด 5 นาทีมีแถบเตือน · ถึง 16.30 น. กล้องดับทันทีและรอบที่ทำอยู่ถูกยกเลิก (ไม่บันทึกคะแนน)
//   ใช้กับนักเรียนโรงเรียนเท่านั้น — ห้องเรียนพิเศษ (/extraclass) ไม่ใช้กล้องและไม่ปิดเวลา
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { serverNow, syncClock } from "./sync";

export const OPEN_MIN = 6 * 60;        // 06.00
export const CLOSE_MIN = 16 * 60 + 30; // 16.30
export const WARN_MIN = 5;             // เตือนก่อนปิด 5 นาที

export interface Hours {
  open: boolean;
  minsLeft: number | null; // นาทีที่เหลือก่อนปิด (เฉพาะตอนเปิดอยู่)
}

// นาทีของวัน (เวลาไทย) จาก ms
const thaiMinuteOfDay = (ms: number) => {
  const d = new Date(ms + 7 * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

export function hoursAt(ms: number): Hours {
  const m = thaiMinuteOfDay(ms);
  const open = m >= OPEN_MIN && m < CLOSE_MIN;
  return { open, minsLeft: open ? CLOSE_MIN - m : null };
}
export const hoursNow = (): Hours => hoursAt(serverNow());

// ใช้ในหน้าที่ต้องตอบสนองทันทีเมื่อถึง 16.30 (ตรวจทุก 10 วินาที)
//   onClose = เรียกทุกรอบตรวจ ขณะที่ปิดอยู่ (ให้หน้านั้นเลิกรอบที่ทำค้าง/ปิดกล้อง) — ฟังก์ชันต้องไม่ทำอะไรซ้ำถ้าเลิกไปแล้ว
export function useSchoolHours(enabled = true, onClose?: () => void): Hours {
  const [h, setH] = useState<Hours>(() => hoursNow());
  const cb = useRef(onClose);
  useEffect(() => {
    cb.current = onClose;
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const n = hoursNow();
      setH((p) => (p.open === n.open && p.minsLeft === n.minsLeft ? p : n));
      if (!n.open) cb.current?.();
    };
    syncClock().then(tick);
    const t = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);
  return enabled ? h : { open: true, minsLeft: null };
}
