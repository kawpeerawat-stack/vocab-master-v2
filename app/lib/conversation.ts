// app/lib/conversation.ts
// ─────────────────────────────────────────────────────────────
// ชนิดข้อมูลของ "ห้องฝึกบทสนทนา" (Conversation)
//   - เนื้อหาจริงอยู่ใน data/conversation.json (AI ร่าง → ครูตรวจก่อนใช้)
//   - โครงสร้างคล้ายห้อง Reading แต่ใช้ "รูปแบบบทสนทนา" (format) แทนชนิดคำถาม
// ─────────────────────────────────────────────────────────────
import type { ExamStyle, ReadingLevel } from "./reading";

export type ConvFormat = "QUESTION_RESPONSE" | "SHORT_CONVO" | "LONG_CONVO";
export type ConvCategory =
  | "daily"
  | "school"
  | "travel"
  | "shopping"
  | "work"
  | "other";

export interface ConvQuestion {
  id: string;
  question: string;
  choices: string[]; // 4 ตัวเลือก
  answerIndex: number; // 0–3
  explanation_th: string;
}

export interface ConvSet {
  id: string;
  level: ReadingLevel;
  examStyle: ExamStyle;
  format: ConvFormat;
  category?: ConvCategory; // หมวดสถานการณ์ (ชีวิตประจำวัน/โรงเรียน/เดินทาง...) สำหรับกรอง
  title: string;
  scenario_th?: string; // บริบทภาษาไทยสั้น ๆ
  dialogue: string; // บทสนทนา (อาจว่างได้ในแบบถาม–ตอบ)
  targetVocab: string[]; // คำจากคลัง vocab.json (แตะดูคำแปลได้)
  verified: boolean;
  source: string;
  questions: ConvQuestion[];
}

// ป้ายชื่อรูปแบบบทสนทนาเป็นภาษาไทย
export const CONV_FORMAT_LABELS: Record<ConvFormat, string> = {
  QUESTION_RESPONSE: "ถาม–ตอบ",
  SHORT_CONVO: "เติมบทสนทนา",
  LONG_CONVO: "บทสนทนายาว",
};

// หมวดสถานการณ์ของบทสนทนา (ภาษาไทย) สำหรับตัวกรอง
export const CONV_CATEGORY_LABELS: Record<string, string> = {
  daily: "ชีวิตประจำวัน",
  school: "โรงเรียน & การเรียน",
  travel: "เดินทาง & ท่องเที่ยว",
  shopping: "ช้อปปิ้ง & บริการ",
  work: "การงาน & มืออาชีพ",
  other: "อื่น ๆ",
};
export const CONV_CATEGORY_ORDER: string[] = [
  "daily",
  "school",
  "travel",
  "shopping",
  "work",
  "other",
];

// โหลดชุดบทสนทนาจาก API
export async function loadConversationSets(
  opts?: { verifiedOnly?: boolean }
): Promise<ConvSet[]> {
  const res = await fetch("/api/conversation");
  if (!res.ok) throw new Error("โหลดบทสนทนาไม่สำเร็จ");
  const data: ConvSet[] = await res.json();
  if (opts?.verifiedOnly) return data.filter((s) => s.verified);
  return data;
}
