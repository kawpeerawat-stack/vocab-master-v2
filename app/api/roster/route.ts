// app/api/roster/route.ts
// ─────────────────────────────────────────────────────────────
// ตรวจข้อมูลที่นักเรียนกรอกตอนเข้าสู่ระบบกับรายชื่อของครู (data/roster.json) — ทำที่เซิร์ฟเวอร์
//   /api/roster?room=6/1&no=5&first=สมชาย&last=รักดี
//   ตอบกลับเฉพาะผลตรวจ ไม่ส่งชื่อในรายชื่อกลับไป (กันรายชื่อนักเรียนหลุดออกนอกระบบ)
//     ok        = ห้อง + เลขที่ + ชื่อ-นามสกุล ตรงกัน
//     partial   = ห้อง + เลขที่ตรง แต่ชื่อหรือนามสกุลสะกดไม่ตรง 1 อย่าง
//     elsewhere = ชื่อ-นามสกุลอยู่ในรายชื่อ แต่คนละห้องหรือคนละเลขที่
//     mismatch  = มีเลขที่นี้ในห้อง แต่ชื่อไม่ตรงกับใครเลย
//     notfound  = ไม่มีเลขที่นี้ในห้องนั้น
//     unknown   = ห้องนี้ยังไม่มีรายชื่อในระบบ (ไม่ตรวจ)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { ROSTER, normName } from "../../lib/roster";

const PREFIX_RE = /^(นางสาว|เด็กชาย|เด็กหญิง|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.)\s*/;
function splitRosterName(full: string): { first: string; last: string } {
  const parts = full.replace(PREFIX_RE, "").trim().split(/\s+/);
  return { first: normName(parts[0] || ""), last: normName(parts.slice(1).join(" ")) };
}

export async function GET(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";
  if (host && !referer.includes(host)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const sp = request.nextUrl.searchParams;
  const room = (sp.get("room") || "").trim();
  const no = parseInt(sp.get("no") || "", 10);
  const first = normName(sp.get("first") || "");
  const last = normName(sp.get("last") || "");
  if (!room || !Number.isFinite(no) || !first || !last) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // ห้องที่ยังไม่มีรายชื่อในระบบ → ไม่ตรวจ ให้เข้าได้ตามปกติ (ตอนนี้มีรายชื่อครบทุกห้องแล้ว: ม.6/1–6/5 · ม.4/1–4/3)
  if (!ROSTER.some((r) => r.room === room)) {
    return NextResponse.json({ result: "unknown" }, { headers: { "Cache-Control": "no-store" } });
  }
  const hit = ROSTER.find((r) => r.room === room && r.no === no);
  const fullMatch = (r: { name: string }) => {
    const n = splitRosterName(r.name);
    return n.first === first && n.last === last;
  };
  let result: "ok" | "partial" | "elsewhere" | "mismatch" | "notfound";
  if (hit && fullMatch(hit)) result = "ok";
  else if (ROSTER.some((r) => r !== hit && fullMatch(r))) result = "elsewhere";
  else if (hit) {
    const n = splitRosterName(hit.name);
    result = n.first === first || n.last === last ? "partial" : "mismatch";
  } else result = "notfound";

  return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
}
