// app/api/time/route.ts
// เวลาของเซิร์ฟเวอร์ (ms) — ใช้ตัดสินว่า "ถึงวันเรียนของบทนี้แล้วหรือยัง"
// นักเรียนแก้นาฬิกาในมือถือเพื่อเปิดบทล่วงหน้าไม่ได้
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  void request.nextUrl; // อ่านคำขอทุกครั้ง (ไม่เก็บ cache)
  return NextResponse.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
