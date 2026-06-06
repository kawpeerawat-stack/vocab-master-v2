// app/api/conversation/route.ts
// ─────────────────────────────────────────────────────────────
// ส่งชุดบทสนทนาทั้งหมดจาก data/conversation.json ให้ฝั่งหน้าจอ
//   - แพทเทิร์นเดียวกับ /api/reading และ /api/vocab
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { ConvSet } from "../../lib/conversation";

interface ConvFile {
  version: number;
  note: string;
  sets: ConvSet[];
}

export async function GET(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";

  if (host && !referer.includes(host)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const filePath = join(process.cwd(), "data", "conversation.json");
  const raw = readFileSync(filePath, "utf-8");
  const file: ConvFile = JSON.parse(raw);
  return NextResponse.json(file.sets);
}
