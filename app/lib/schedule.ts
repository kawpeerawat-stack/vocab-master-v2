// app/lib/schedule.ts — ตารางเรียน (วันเปิดบท/ชุด) แบบเบา ใช้คำนวณ "งานค้าง" (13 พ.ย. 2569)
//   สร้างจากไฟล์คอร์สฝั่งเซิร์ฟเวอร์ (/api/course?id=schedule) → ไม่ส่งโจทย์/เฉลยไปกับตารางนี้
//   ไฟล์นี้ไม่ import firebase หรือรายชื่อนักเรียน — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์ หน้านักเรียน และหน้าครู
export type TrackKey = "decoder" | "decoder4" | "v300";
export interface SchedItem {
  id: string;     // รหัสบท (b01 / m01) หรือเลขชุด ("1"–"12")
  no: number;     // ลำดับบท/คาบ/ชุด (ใช้ตัดสินอนุโลมสัปดาห์ 1–2)
  title: string;  // ชื่อสั้น (ไทย)
  start: string;  // วันจันทร์ของสัปดาห์ที่เรียน (YYYY-MM-DD)
}
export interface SchedTrack {
  key: TrackKey;          // ใช้เป็นกุญแจผลการเรียน (courses[key]) และ unlock[key] — v300 = ชุดคำศัพท์แกน
  kind: "lesson" | "set";
  icon: string;
  name: string;           // ชื่อห้อง
  unit: string;           // คำเรียกหน่วย: บท / คาบ / ชุด
  grade: "4" | "6";
  classDays: Record<string, number>; // วันเรียนของแต่ละห้อง (0 = จันทร์ … 4 = ศุกร์)
  items: SchedItem[];
}
export interface Schedule {
  tracks: SchedTrack[];
}

interface RawLesson { id: string; hour: number; titleTh?: string; start?: string }
interface RawCourse { titleTh?: string; lessonWord?: string; classDays?: Record<string, number>; lessons: RawLesson[] }
interface RawVocab { titleTh?: string; classDays?: Record<string, number>; weeks: { no: number; title?: string; start?: string }[] }

export function buildSchedule(decoder: RawCourse, decoder4: RawCourse, vocab: RawVocab): Schedule {
  const lessons = (c: RawCourse): SchedItem[] =>
    c.lessons.filter((l) => !!l.start).map((l) => ({ id: l.id, no: l.hour, title: l.titleTh || "", start: l.start! }));
  return {
    tracks: [
      { key: "decoder", kind: "lesson", icon: "🧩", name: decoder.titleTh || "ถอดรหัสคำศัพท์", unit: decoder.lessonWord || "บท", grade: "6", classDays: decoder.classDays || {}, items: lessons(decoder) },
      { key: "v300", kind: "set", icon: "📚", name: vocab.titleTh || "คำศัพท์แกน 120 คำ", unit: "ชุด", grade: "6", classDays: vocab.classDays || {}, items: vocab.weeks.filter((w) => !!w.start).map((w) => ({ id: String(w.no), no: w.no, title: w.title || "", start: w.start! })) },
      { key: "decoder4", kind: "lesson", icon: "🧩", name: decoder4.titleTh || "ถอดรหัสคำศัพท์ ม.4", unit: decoder4.lessonWord || "คาบ", grade: "4", classDays: decoder4.classDays || {}, items: lessons(decoder4) },
    ],
  };
}
