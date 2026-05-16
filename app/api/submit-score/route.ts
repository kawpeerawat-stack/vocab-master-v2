import { NextResponse } from "next/server";

// ฝังลิงก์ Google Apps Script ของคุณครูลงไปโดยตรงเพื่อแก้ปัญหา Vercel หาลิงก์ไม่เจอ
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycby4W4DvZVWfNhE1dLIPKaWCxd7qJ64aLBjDo_LvbXY2v815i-Z-jkx2TaSyo4KsTfb-CQ/exec";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ป้องกันกรณีที่ลิงก์มีปัญหา
    if (!WEBHOOK_URL) {
      throw new Error("Webhook URL is missing!");
    }

    // ส่งข้อมูลไปที่ Google Sheet
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
    });

    const text = await res.text(); 
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
