import { NextRequest, NextResponse } from "next/server";

const WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Apps Script ต้องการ redirect
      redirect: "follow",
    });

    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Score submission error:", error);
    return NextResponse.json({ success: false });
  }
}
