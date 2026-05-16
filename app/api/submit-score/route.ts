import { NextResponse } from "next/server";

// นำลิงก์ที่ก๊อปปี้มาใหม่ วางแทนที่คำว่า วางลิงก์ใหม่ของคุณครูที่นี่ (อย่าลบเครื่องหมาย " " ออกนะครับ)
const WEBHOOK_URL = "วางลิงก์ใหม่ของคุณครูที่นี่";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!WEBHOOK_URL) {
      throw new Error("Webhook URL is missing!");
    }

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
