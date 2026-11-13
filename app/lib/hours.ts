"use client";
// app/lib/hours.ts
// ─────────────────────────────────────────────────────────────
// เวลาให้บริการกล้อง + รอบที่เข้าสมุดคะแนน (11 พ.ย. 2569 · ครูสั่ง · PDPA)
//   เปิด 06.00 – 16.30 น. ทุกวัน (เวลาไทย จากนาฬิกาเซิร์ฟเวอร์ — ปรับนาฬิกาเครื่องเลี่ยงไม่ได้)
//   นอกเวลา: เปิดกล้องไม่ได้ · ทำรอบที่เข้าสมุดคะแนนไม่ได้ · ฝึกอิสระที่ไม่ใช้กล้องยังเข้าได้
//   ก่อนปิด 5 นาทีมีแถบเตือน · ถึง 16.30 น. กล้องดับทันทีและรอบที่ทำอยู่ถูกยกเลิก (ไม่บันทึกคะแนน)
//   ใช้กับนักเรียนโรงเรียนเท่านั้น — ห้องเรียนพิเศษ (/extraclass) ไม่ใช้กล้องและไม่ปิดเวลา
// 13 พ.ย. 2569 (ครูสั่ง): ปิด "ทั้งวัน" ในวันเสาร์-อาทิตย์ และวันหยุดราชการตามรายการใน holidays.ts — ถึง 1 เม.ย. 2570 เท่านั้น — ใช้กติกานอกเวลาแบบเดียวกัน
//   (ปิดกล้อง · รอบที่เข้าสมุดคะแนน/แบบฝึกหัดทำไม่ได้ · ฝึกอิสระที่ไม่ใช้กล้องยังเข้าได้) · 📒 Smart Booklet ม.6 ไม่ผ่านไฟล์นี้ จึงเปิดทุกวัน
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { serverNow, syncClock } from "./sync";
import { CLOSED_DAYS, CLOSE_UNTIL } from "./holidays";

export const OPEN_MIN = 6 * 60;        // 06.00
export const CLOSE_MIN = 16 * 60 + 30; // 16.30
export const WARN_MIN = 5;             // เตือนก่อนปิด 5 นาที

export interface Hours {
  open: boolean;
  minsLeft: number | null; // นาทีที่เหลือก่อนปิด (เฉพาะตอนเปิดอยู่)
  // เฉพาะตอนปิดเพราะเป็นวันหยุดทั้งวัน (เสาร์-อาทิตย์/วันหยุดราชการ)
  closedDay?: { kind: "weekend" | "holiday"; name: string };
  // วันที่เปิดครั้งถัดไป (YYYY-MM-DD เวลาไทย · 06.00 น.) — เฉพาะตอนปิดและยังไม่ใช่วันนี้ (ก่อน 06.00 น. ของวันเรียน = ไม่ใส่ เพราะเปิดวันนี้)
  reopen?: string;
}

// นาทีของวัน (เวลาไทย) จาก ms
const thaiMinuteOfDay = (ms: number) => {
  const d = new Date(ms + 7 * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

// วันที่ไทย (YYYY-MM-DD) จาก ms
const thaiYmd = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
const TH_WEEKDAY = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];

// วันหยุดทั้งวัน? (วันหยุดราชการมาก่อน แล้วค่อยเสาร์-อาทิตย์) — null = เป็นวันเรียนปกติ
export function closedDayOf(ymd: string): { kind: "weekend" | "holiday"; name: string } | null {
  if (ymd > CLOSE_UNTIL) return null; // หลังสิ้นสุดปฏิทินการศึกษา (1 เม.ย. 2570) ไม่ปิดวันหยุดอีก
  const hol = CLOSED_DAYS[ymd];
  if (hol) return { kind: "holiday", name: hol };
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return { kind: "weekend", name: TH_WEEKDAY[wd] };
  return null;
}

// วันเปิดถัดจากวันที่ ymd (ไม่นับ ymd เอง) — เผื่อหาไม่เจอใน 60 วัน คืนวันถัดไป
export function nextOpenDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  for (let i = 1; i <= 60; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (!closedDayOf(t)) return t;
  }
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function hoursAt(ms: number): Hours {
  const ymd = thaiYmd(ms);
  const closedDay = closedDayOf(ymd);
  if (closedDay) return { open: false, minsLeft: null, closedDay, reopen: nextOpenDay(ymd) };
  const m = thaiMinuteOfDay(ms);
  const open = m >= OPEN_MIN && m < CLOSE_MIN;
  if (open) return { open: true, minsLeft: CLOSE_MIN - m };
  // ก่อน 06.00 น. = เปิดวันนี้ (ไม่ใส่ reopen) · หลัง 16.30 น. = เปิดวันเรียนถัดไป
  return m < OPEN_MIN ? { open: false, minsLeft: null } : { open: false, minsLeft: null, reopen: nextOpenDay(ymd) };
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
      setH((p) => (p.open === n.open && p.minsLeft === n.minsLeft && p.reopen === n.reopen && p.closedDay?.name === n.closedDay?.name ? p : n));
      if (!n.open) cb.current?.();
    };
    syncClock().then(tick);
    const t = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);
  return enabled ? h : { open: true, minsLeft: null };
}
