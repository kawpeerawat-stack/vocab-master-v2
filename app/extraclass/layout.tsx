import type { Metadata } from "next";

// ห้องเรียนพิเศษ: ไม่ให้เสิร์ชเอนจินเก็บ (ลิงก์ให้เฉพาะนักเรียนที่ครูให้รหัส)
export const metadata: Metadata = {
  title: "Vocab Master · Extra Class",
  description: "ห้องเรียนพิเศษคำศัพท์ภาษาอังกฤษ",
  robots: { index: false, follow: false },
};

export default function ExtraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
