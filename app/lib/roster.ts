// app/lib/roster.ts
// ─────────────────────────────────────────────────────────────
// รายชื่อนักเรียนทางการ (data/roster.json) + จับคู่ชื่อที่นักเรียนพิมพ์ในแอป
//   ใช้ร่วมกันในหน้าครู (/admin) ทุกมุมมอง
// ─────────────────────────────────────────────────────────────
import ROSTER_JSON from "../../data/roster.json";
import { roomOf, extractNo, displayName, gradeOf, GRADES } from "./names";
export { roomOf, extractNo, displayName, gradeOf, GRADES };

export type RosterEntry = { room: string; no: number; name: string };
export const ROSTER = ROSTER_JSON as RosterEntry[];
export const ROOMS = Array.from(new Set(ROSTER.map((r) => r.room))).sort();

export function normName(s?: string): string {
  return (s || "")
    .replace(/(นางสาว|เด็กชาย|เด็กหญิง|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.|น\.ส(?=\s)|ด\.ช(?=\s)|ด\.ญ(?=\s))/g, "")
    .replace(/no\.?\s*\d+|เลขที่\s*\d+|m\.?\s*[46]\s*\/\s*[1-9]|ม\.?\s*[46]\s*\/\s*[1-9]|[46]\s*\/\s*[1-9]/gi, "")
    .replace(/[^ก-๙a-zA-Z]/g, "")
    // 11 พ.ย.: พิมพ์คลาดเคลื่อนเล็กน้อยก็ยังจับคู่ได้ — ตัดวรรณยุกต์/ทัณฑฆาต และให้ ำ = า ("คำวัน" = "ค่าวัน")
    .replace(/[\u0E48-\u0E4C]/g, "")
    .replace(/\u0E33/g, "\u0E32")
    .toLowerCase();
}
const rosterIndex: Record<string, RosterEntry[]> = {};
for (const r of ROSTER) (rosterIndex[normName(r.name)] ||= []).push(r);

// ชื่อที่นักเรียนพิมพ์เป็นภาษาอังกฤษ (จับคู่จากข้อความไม่ได้) — ครูยืนยันแล้ว: ชื่อที่ normName แล้ว → "ห้อง|เลขที่"
const ALIASES: Record<string, string> = {
  kannatchakorthong: "4/2|30", // กัญญ์ณัชชา กองทอง
};

// นักเรียนที่ลา/ขาดเรียน (ครูแจ้ง) — กล่อง ✅ ตรวจรายสัปดาห์ จะแยกไว้ ไม่นับเป็น "ยังไม่ได้ทำ" · คีย์ = "ห้อง|เลขที่"
export const EXCUSED: Record<string, string> = {
  "4/2|30": "ลาป่วย", // กัญญ์ณัชชา กองทอง (ครูแจ้ง 11 พ.ย.)
};

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function matchRoster(name?: string): RosterEntry | null {
  const n = normName(name);
  if (n && rosterIndex[n]) return rosterIndex[n][0]; // 1) ชื่อไทยตรง
  const room = roomOf(name);
  if (n && ALIASES[n]) {
    const [ar, an] = ALIASES[n].split("|");
    const hit = ROSTER.find((r) => r.room === ar && r.no === Number(an));
    if (hit) return hit;
  }
  if (n.length >= 6 && /[ก-๙]/.test(n)) {
    // 2) ชื่อใกล้เคียง (พิมพ์ผิด 1–2 ตัวอักษร) — ต้องมีคนเดียวที่ใกล้ที่สุด · ชนะเลขที่ที่อาจเป็นเลขเก่าก่อนเพิ่มนักเรียน
    const maxD = n.length >= 12 ? 2 : 1;
    let best = maxD + 1, second = maxD + 1, bestR: RosterEntry | null = null;
    for (const r of ROSTER) {
      if (room && r.room !== room) continue;
      const d = lev(n, normName(r.name), maxD);
      if (d < best) { second = best; best = d; bestR = r; }
      else if (d < second) second = d;
    }
    if (bestR && best <= maxD && second > best) return bestR;
  }
  const no = extractNo(name);
  if (room && no != null) {
    const hit = ROSTER.find((r) => r.room === room && r.no === no); // 3) ห้อง + เลขที่
    if (hit) return hit;
  }
  if (!n) return null;
  const cand: RosterEntry[] = []; // 4) ชื่อบางส่วน (เฉพาะเมื่อไม่กำกวม)
  for (const k in rosterIndex) if (k.startsWith(n) || n.startsWith(k)) cand.push(...rosterIndex[k]);
  return cand.length === 1 ? cand[0] : null;
}
export const rosterKey = (r: RosterEntry) => `${r.room}|${r.no}`;
// ชื่อที่นักเรียนพิมพ์ซึ่งไม่ตรงกับชื่อในรายชื่อ (เช่น กรอกเลขที่ผิด) — ใช้เตือนครูในหน้าครู
export function typedMismatch(rosterName: string, typed: string[]): string[] {
  const n = normName(rosterName);
  return typed.filter((t) => normName(t) && normName(t) !== n).map(displayName);
}

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
