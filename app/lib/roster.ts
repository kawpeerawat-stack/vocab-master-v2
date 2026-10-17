// app/lib/roster.ts
// ─────────────────────────────────────────────────────────────
// รายชื่อนักเรียนทางการ (data/roster.json) + จับคู่ชื่อที่นักเรียนพิมพ์ในแอป
//   ใช้ร่วมกันในหน้าครู (/admin) ทุกมุมมอง
// ─────────────────────────────────────────────────────────────
import ROSTER_JSON from "../../data/roster.json";

export type RosterEntry = { room: string; no: number; name: string };
export const ROSTER = ROSTER_JSON as RosterEntry[];
export const ROOMS = Array.from(new Set(ROSTER.map((r) => r.room))).sort();

export function roomOf(name?: string): string | null {
  const m = (name || "").match(/6\s*[\/._-]\s*([1-9])/);
  return m ? `6/${m[1]}` : null;
}
export function normName(s?: string): string {
  return (s || "")
    .replace(/(นางสาว|เด็กชาย|เด็กหญิง|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.)/g, "")
    .replace(/no\.?\s*\d+|เลขที่\s*\d+|m\.?\s*6\s*\/\s*[1-9]|ม\.?\s*6\s*\/\s*[1-9]|6\s*\/\s*[1-9]/gi, "")
    .replace(/[^ก-๙a-zA-Z]/g, "")
    .toLowerCase();
}
export function extractNo(s?: string): number | null {
  const m = (s || "").match(/no\.?\s*(\d{1,2})\b/i) || (s || "").match(/เลขที่\s*(\d{1,2})/) || (s || "").match(/#\s*(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}
const rosterIndex: Record<string, RosterEntry[]> = {};
for (const r of ROSTER) (rosterIndex[normName(r.name)] ||= []).push(r);

export function matchRoster(name?: string): RosterEntry | null {
  const n = normName(name);
  if (n && rosterIndex[n]) return rosterIndex[n][0]; // 1) ชื่อไทยตรง
  const room = roomOf(name);
  const no = extractNo(name);
  if (room && no != null) {
    const hit = ROSTER.find((r) => r.room === room && r.no === no); // 2) ห้อง + เลขที่
    if (hit) return hit;
  }
  if (!n) return null;
  const cand: RosterEntry[] = []; // 3) ชื่อบางส่วน (เฉพาะเมื่อไม่กำกวม)
  for (const k in rosterIndex) if (k.startsWith(n) || n.startsWith(k)) cand.push(...rosterIndex[k]);
  return cand.length === 1 ? cand[0] : null;
}
export const rosterKey = (r: RosterEntry) => `${r.room}|${r.no}`;

export function fmtThaiTime(ms?: number): string {
  if (!ms) return "–";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  const d = new Date(ms);
  const th = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d.getDate()} ${th[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ดาวน์โหลด CSV (เปิดใน Excel ภาษาไทยได้ — ใส่ BOM)
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
