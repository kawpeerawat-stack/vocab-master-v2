// app/api/check-sentence/route.ts
// ─────────────────────────────────────────────────────────────
// API สำหรับ "โหมดแต่งประโยค" — รับคำศัพท์ + ประโยคของนักเรียน
// แล้วส่งให้ AI (Claude) ตรวจ คืนผลเป็น JSON
//
// วิธีตั้งค่า (ทำครั้งเดียว):
//   1. สมัครคีย์ที่ https://console.anthropic.com  แล้วคัดลอก API key
//   2. บน Vercel: โปรเจกต์ → Settings → Environment Variables
//      เพิ่มชื่อ  ANTHROPIC_API_KEY  ค่า = คีย์ของคุณครู  แล้ว Redeploy
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";

interface CheckBody {
  word: string;
  thai?: string;
  definition?: string;
  sentence: string;
}

export async function POST(request: NextRequest) {
  // กันการเรียกจากนอกเว็บแบบหลวมๆ (รูปแบบเดียวกับ /api/vocab เดิม)
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";
  if (host && !referer.includes(host)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY" }, { status: 500 });
  }

  let body: CheckBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { word, thai = "", definition = "", sentence } = body;
  if (!word || !sentence || sentence.trim().length === 0) {
    return NextResponse.json({ error: "ต้องมีคำศัพท์และประโยค" }, { status: 400 });
  }
  // กันการส่งข้อความยาวเกินเหตุ (ลดต้นทุน/กันสแปม)
  if (sentence.length > 400) {
    return NextResponse.json({ error: "ประโยคยาวเกินไป" }, { status: 400 });
  }

  const prompt = `You are a warm, encouraging English teacher for Thai Grade-12 (M.6) students.
The student must write ONE original English sentence that correctly uses the target word.

Target word: "${word}" (Thai meaning: ${thai}; definition: ${definition})
Student's sentence: "${sentence.trim()}"

Evaluate fairly but kindly. Any correctly inflected form of the word counts as "used".
Respond with ONLY a JSON object (no markdown, no backticks, no extra text) in exactly this shape:
{
  "usedWord": true/false,
  "meaningCorrect": true/false,
  "grammarOk": true/false,
  "verdict": "excellent" | "good" | "needs_work",
  "scoreOutOf5": 0-5,
  "feedback_th": "warm, specific feedback in THAI, 1-2 sentences, say what is good and what to fix and WHY",
  "corrected": "an improved/corrected version of the STUDENT'S sentence in English, kept close to theirs; if perfect, return it unchanged",
  "tip_th": "one short practical learning tip in THAI"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const text = (data.content || [])
      .map((b: { type: string; text?: string }) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    return NextResponse.json(result);
  } catch (error) {
    console.error("check-sentence error:", error);
    return NextResponse.json({ error: "ตรวจประโยคไม่สำเร็จ" }, { status: 500 });
  }
}
