// app/lib/reading.ts
// ─────────────────────────────────────────────────────────────
// ชนิดข้อมูลกลางของ "ห้องฝึกการอ่าน" (Reading)
//   - ใช้ร่วมกันทั้งฝั่ง API (/api/reading) และฝั่งหน้าจอ
//   - เนื้อหาจริงอยู่ในไฟล์ data/reading.json (AI ร่าง → ครูตรวจก่อนใช้)
// ─────────────────────────────────────────────────────────────

export type ReadingQuestionType =
  | "MAIN_IDEA"
  | "SUPPORTING_DETAIL"
  | "INFERENCE"
  | "VOCAB_IN_CONTEXT"
  | "REFERENCE"
  | "PURPOSE_TONE"
  | "ORGANIZATION";

export type ExamStyle = "A-LEVEL" | "TGAT" | "NETSAT";
export type ReadingLevel = "B1" | "B2" | "C1";
export type ReadingCategory =
  | "ad"
  | "review"
  | "science"
  | "article"
  | "story"
  | "other";

export interface ReadingQuestion {
  id: string;
  type: ReadingQuestionType;
  question: string;
  choices: string[]; // 4 ตัวเลือก
  answerIndex: number; // 0–3 (ตำแหน่งคำตอบที่ถูก)
  explanation_th: string; // คำอธิบายว่าทำไมตอบข้อนี้ (ภาษาไทย)
}

export interface ReadingPassage {
  id: string;
  level: ReadingLevel;
  examStyle: ExamStyle;
  genre?: string;
  category?: ReadingCategory; // หมวดเรื่อง (โฆษณา/รีวิว/วิทยาศาสตร์...) สำหรับจัดกลุ่ม-กรอง
  title: string;
  passage: string;
  wordCount: number;
  targetVocab: string[]; // คำที่ดึงมาจากคลัง vocab.json (ลิงก์ดูคำแปลได้)
  verified: boolean; // ครูตรวจแล้วหรือยัง — false = ยังไม่ปล่อยให้เด็กใช้จริง
  source: string;
  questions: ReadingQuestion[];
}

// ป้ายชื่อชนิดคำถามเป็นภาษาไทย (สำหรับแสดงบน badge)
export const RQTYPE_LABELS: Record<ReadingQuestionType, string> = {
  MAIN_IDEA: "ใจความหลัก",
  SUPPORTING_DETAIL: "รายละเอียด",
  INFERENCE: "การอนุมาน",
  VOCAB_IN_CONTEXT: "ศัพท์ในบริบท",
  REFERENCE: "การอ้างถึง",
  PURPOSE_TONE: "จุดประสงค์/น้ำเสียง",
  ORGANIZATION: "การจัดเรียงเนื้อหา",
};

// หมวดเรื่องของบทอ่าน (ภาษาไทย) สำหรับตัวกรอง/จัดกลุ่ม
export const CATEGORY_LABELS: Record<string, string> = {
  ad: "โฆษณา",
  review: "รีวิวสินค้า",
  science: "วิทยาศาสตร์ & สิ่งแวดล้อม",
  article: "บทความ/ความคิดเห็น",
  story: "เรื่องเล่า & ข่าว",
  other: "อื่น ๆ",
};
export const CATEGORY_ORDER: string[] = [
  "ad",
  "review",
  "science",
  "article",
  "story",
  "other",
];

// ── โหลดบทอ่านจาก API ──
//   verifiedOnly = true  → เอาเฉพาะบทที่ครูตรวจแล้ว (ใช้ตอนเปิดให้เด็กจริง)
//   verifiedOnly = false → เอาทั้งหมด (ใช้ตอนครูพรีวิว/ตรวจ)
export async function loadReadingPassages(
  opts?: { verifiedOnly?: boolean }
): Promise<ReadingPassage[]> {
  const res = await fetch("/api/reading");
  if (!res.ok) throw new Error("โหลดบทอ่านไม่สำเร็จ");
  const data: ReadingPassage[] = await res.json();
  if (opts?.verifiedOnly) return data.filter((p) => p.verified);
  return data;
}
