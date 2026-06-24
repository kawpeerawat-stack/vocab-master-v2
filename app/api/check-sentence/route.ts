// app/api/check-sentence/route.ts
// ─────────────────────────────────────────────────────────────
// ⛔ "โหมดแต่งประโยค" ถูกปิดใช้งาน — ไม่เรียก AI (Claude) เพื่อไม่ให้เกิดค่าใช้จ่าย API
//
// ต้องการเปิดกลับในอนาคต:
//   1) เติมเครดิตที่ https://console.anthropic.com
//   2) กู้โค้ดเวอร์ชันเดิมที่เรียก Anthropic API กลับมา (ดูประวัติ Git)
//      แล้วตั้งค่า Environment Variable ชื่อ ANTHROPIC_API_KEY บน Vercel
// ─────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "โหมดแต่งประโยคถูกปิดใช้งาน" },
    { status: 503 }
  );
}
