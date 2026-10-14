// app/api/course/route.ts
// ─────────────────────────────────────────────────────────────
// ส่งเนื้อหาคอร์สบทเรียน (เช่น Root Words Decoder) ให้หน้านักเรียนและหน้าครู
//   เรียกแบบ /api/course?id=decoder
//   ใช้แพทเทิร์นเดียวกับ /api/vocab (กันการเรียกจากนอกเว็บแบบหลวม ๆ)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// อ่านไฟล์ด้วย path ตายตัวต่อคอร์ส (ให้ Vercel แนบไฟล์ข้อมูลไปกับ deployment แน่นอน)
function readCourseFile(id: string): string | null {
  try {
    switch (id) {
      case "decoder":
        return readFileSync(join(process.cwd(), "data", "decoder_lessons.json"), "utf-8");
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";
  if (host && !referer.includes(host)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id") || "";
  const raw = readCourseFile(id);
  if (!raw) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  return new NextResponse(raw, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
