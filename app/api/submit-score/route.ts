import { NextRequest, NextResponse } from "next/server";

const WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Debug: log URL ที่ใช้
    console.log("Webhook URL:", WEBHOOK_URL);

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
    });

    const text = await res.text(); // อ่านเป็น text ก่อน
    console.log("Apps Script response:", text);

    try {
      const result = JSON.parse(text);
      return NextResponse.json(result);
    } catch {
      return NextResponse.json({ success: false, raw: text });
    }

  } catch (error: any) {
    console.error("Fetch error:", error.message);
    return NextResponse.json({ success: false, error: error.message });
  }
}
