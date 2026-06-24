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
  // ⛔ โหมดแต่งประโยคถูกปิดใช้งาน — ไม่เรียก AI (Claude) เพื่อไม่ให้เกิดค่าใช้จ่าย API
  // ถ้าต้องการเปิดกลับในอนาคต: ลบ 4 บรรทัดนี้ออก แล้วเติมเครดิตที่ console.anthropic.com
  return NextResponse.json(
    { error: "โหมดแต่งประโยคถูกปิดใช้งาน" },
    { status: 503 }
  );

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
        // ใช้รุ่น Haiku — ถูกและเร็ว เหมาะกับงานตรวจประโยคสั้น ๆ
        // (อยากได้ผลละเอียดขึ้นเปลี่ยนกลับเป็น "claude-sonnet-4-5" ได้)
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();

    // ถ้า Anthropic ตอบกลับเป็น error (เช่น เครดิตหมด / ชื่อรุ่นผิด / คีย์ไม่ถูก)
    // ให้ดึงข้อความจริงมาโชว์ใน log + ส่งกลับ จะได้รู้สาเหตุชัด ๆ
    if (!res.ok || data?.type === "error") {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      console.error("Anthropic API error:", res.status, JSON.stringify(data));
      return NextResponse.json({ error: `เรียก AI ไม่สำเร็จ: ${msg}` }, { status: 502 });
    }

    const text = (data.content || [])
      .map((b: { type: string; text?: string }) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    if (!text) {
      console.error("Anthropic returned empty content:", JSON.stringify(data));
      return NextResponse.json({ error: "AI ไม่ได้ส่งข้อความกลับ" }, { status: 502 });
    }

    let result;
    try {
      const clean = text.replace(/```json|```/g, "").trim();
      result = JSON.parse(clean);
    } catch {
      console.error("Failed to parse AI JSON. Raw text:", text);
      return NextResponse.json({ error: "AI ตอบกลับไม่เป็นรูปแบบที่อ่านได้" }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("check-sentence error:", error);
    return NextResponse.json({ error: "ตรวจประโยคไม่สำเร็จ" }, { status: 500 });
  }
}
