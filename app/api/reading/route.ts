// app/api/reading/route.ts
// ─────────────────────────────────────────────────────────────
// ส่งบทอ่านทั้งหมดจาก data/reading.json ให้ฝั่งหน้าจอ
//   - ใช้แพทเทิร์นเดียวกับ /api/vocab (กันการเรียกจากนอกเว็บแบบหลวม ๆ)
//   - ไม่กรอง verified ที่นี่ เพราะหน้าครูต้องเห็นบทที่ยังไม่ตรวจด้วย
//     (การกรอง "เฉพาะที่ตรวจแล้ว" ทำที่ฝั่งหน้าจอผ่าน loadReadingPassages)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { ReadingPassage } from "../../lib/reading";

interface ReadingFile {
  version: number;
  note: string;
  passages: ReadingPassage[];
}

export async function GET(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";

  if (host && !referer.includes(host)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const filePath = join(process.cwd(), "data", "reading.json");
  const raw = readFileSync(filePath, "utf-8");
  const file: ReadingFile = JSON.parse(raw);
  return NextResponse.json(file.passages);
}
