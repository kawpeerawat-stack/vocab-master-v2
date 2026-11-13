"use client";
// app/admin/_parts/BookletPanel.tsx — 📒 Smart Booklet M.6: ใครผ่าน Part ไหนแล้วบ้าง (หน้าครู · 13 พ.ย. 2569)
//   ตารางรายคน × Part 1–8 (✓ เขียว = ถูกครบทุกข้อ) แยกตามห้อง · ม.6 เท่านั้น
//   คนที่มีหลายบัญชี: ผ่านในบัญชีไหนก็นับ · คนลา/ขาด (EXCUSED) แยกไว้ ไม่นับ · คัดลอกข้อความไลน์ / ดาวน์โหลด CSV
import React, { useMemo, useState } from "react";
import { PARTS, bookLineText, mergeBooklet, parseCloudBooklet, partMonthText, partUnit, passedCount, type BookProg } from "../../lib/booklet";
import { EXCUSED, ROSTER, downloadCsv, gradeOf, matchRoster, rosterKey } from "../../lib/roster";

export interface BookStudent {
  id: string;
  name?: string;
  email?: string;
  booklet?: unknown;
}
interface BRow {
  key: string;
  room: string;
  no: number;
  name: string;
  entered: boolean;
  excused: string | null;
  prog: BookProg;
  n: number;
  last?: number;
}

const fmt = (ms?: number) => (ms ? new Date(ms + 7 * 3600000).toISOString().replace("T", " ").slice(0, 16) : "");
const PART_NUMS = Array.from({ length: PARTS }, (_, i) => i + 1);

export function BookletPanel({ students, grade, roomFilter }: { students: BookStudent[]; grade: string; roomFilter: string }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const rows: BRow[] = useMemo(() => {
    if (grade !== "6") return [];
    const byKey = new Map<string, BookStudent[]>();
    for (const s of students) {
      const hit = matchRoster(s.name);
      if (!hit) continue;
      const k = rosterKey(hit);
      byKey.set(k, [...(byKey.get(k) ?? []), s]);
    }
    const out: BRow[] = [];
    for (const r of ROSTER) {
      if (roomFilter === "ALL" ? gradeOf(r.room) !== "6" : r.room !== roomFilter) continue;
      const k = rosterKey(r);
      const docs = byKey.get(k) ?? [];
      let prog: BookProg = {};
      for (const d of docs) prog = mergeBooklet(prog, parseCloudBooklet(d));
      const ats = Object.values(prog).map((x) => x.at).filter((x): x is number => typeof x === "number");
      out.push({ key: k, room: r.room, no: r.no, name: r.name, entered: docs.length > 0, excused: EXCUSED[k] ?? null, prog, n: passedCount(prog), last: ats.length ? Math.max(...ats) : undefined });
    }
    return out;
  }, [students, grade, roomFilter]);

  if (grade !== "6") return null;

  const counted = rows.filter((r) => !r.excused);
  const all8 = counted.filter((r) => r.n === PARTS).length;
  const any1 = counted.filter((r) => r.n > 0).length;
  const rooms = Array.from(new Set(rows.map((r) => r.room))).sort();
  const scope = roomFilter === "ALL" ? "ม.6 ทุกห้อง" : `ม.${roomFilter}`;
  const perPart = PART_NUMS.map((n) => counted.filter((r) => r.prog[String(n)]?.p).length);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ไม่เป็นไร */
      }
      document.body.removeChild(ta);
    }
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2500);
  }

  function csv() {
    const data: (string | number)[][] = counted.map((r) => [r.room, r.no, r.name, r.entered ? "เข้าระบบแล้ว" : "ยังไม่เคยเข้าระบบ", ...PART_NUMS.map((n) => (r.prog[String(n)]?.p ? "✓" : "")), r.n, fmt(r.last)]);
    downloadCsv(`SmartBooklet_${scope.replace(/[ .]/g, "")}.csv`, ["ห้อง", "เลขที่", "ชื่อ", "สถานะ", ...PART_NUMS.map((n) => `Part ${n}`), "ผ่านกี่ Part", "ผ่านล่าสุด"], data);
  }

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-book-panel>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className="font-black text-gray-800">📒 Smart Booklet M.6</span>
        <span className="text-xs font-bold text-gray-500" data-book-head>
          {scope}: ผ่านครบ {PARTS} Part {all8} คน · ผ่านอย่างน้อย 1 Part {any1} จาก {counted.length} คน
        </span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-[11px] font-bold text-gray-500">
            ✓ เขียว = ถูกครบทุกข้อใน Part นั้น (คำในแต่ละ Part ของแต่ละคนสุ่มตามอีเมล · Part 1–2 = พ.ย./Unit 6, 3–4 = ธ.ค./Unit 7, 5–6 = ม.ค./Unit 8, 7–8 = ก.พ./Unit 9) · ผ่านบัญชีไหนก็นับ · คนที่ยังไม่เคยเข้าระบบแสดงเป็นว่าง
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={csv} data-book-csv className="px-3 py-1.5 rounded-xl border-2 border-gray-200 text-xs font-black text-gray-700 hover:border-[#003399]/50">
              ⬇️ ดาวน์โหลด CSV ({scope})
            </button>
            <label className="text-xs font-bold text-gray-600 flex items-center gap-1.5">
              ข้อความไลน์:
              <select value={sel} onChange={(e) => setSel(Number(e.target.value))} data-book-sel className="border-2 border-gray-200 rounded-lg px-2 py-1 text-xs font-black text-gray-700 bg-white">
                <option value={0}>ยังทำไม่ครบ {PARTS} Part</option>
                {PART_NUMS.map((n) => (
                  <option key={n} value={n}>
                    ยังไม่ผ่าน Part {n} ({partMonthText(n)} · Unit {partUnit(n)})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="text-[11px] font-bold border-collapse" data-book-sum>
              <tbody>
                <tr>
                  <td className="pr-2 text-gray-500 whitespace-nowrap">ผ่านแล้วต่อ Part ({scope}):</td>
                  {PART_NUMS.map((n, i) => (
                    <td key={n} className="px-2 py-0.5 text-center rounded bg-gray-50 text-gray-700" data-book-sumcell={n}>
                      P{n}: <b className="text-emerald-700">{perPart[i]}</b>/{counted.length}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {rooms.map((room) => {
            const rr = rows.filter((r) => r.room === room);
            const cnt = rr.filter((r) => !r.excused);
            const excused = rr.filter((r) => r.excused);
            const lineRows = cnt.map((r) => ({ no: r.no, name: r.name, prog: r.prog }));
            return (
              <div key={room} className="rounded-xl border-2 border-gray-100 p-3" data-book-room={room} data-book-all8={cnt.filter((r) => r.n === PARTS).length}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-black text-[#003399]">ม.{room}</span>
                  <span className="text-xs font-bold text-gray-500">
                    ผ่านครบ {cnt.filter((r) => r.n === PARTS).length} · ผ่านอย่างน้อย 1 Part {cnt.filter((r) => r.n > 0).length} จาก {cnt.length} คน
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => copy(`${room}:n`, bookLineText(room, lineRows, sel, false))} data-book-copy="nums" className="px-2.5 py-1 rounded-lg bg-[#003399] text-white text-[11px] font-black">
                      {copied === `${room}:n` ? "คัดลอกแล้ว ✓" : "📋 คัดลอกไลน์ (เลขที่)"}
                    </button>
                    <button type="button" onClick={() => copy(`${room}:s`, bookLineText(room, lineRows, sel, true))} data-book-copy="names" className="px-2.5 py-1 rounded-lg border-2 border-gray-200 text-gray-700 text-[11px] font-black">
                      {copied === `${room}:s` ? "คัดลอกแล้ว ✓" : "📋 พร้อมชื่อ"}
                    </button>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse min-w-[520px]">
                    <thead>
                      <tr className="text-[10px] text-gray-500">
                        <th className="text-right w-8 pr-2 font-black">ที่</th>
                        <th className="text-left font-black">ชื่อ</th>
                        {PART_NUMS.map((n) => (
                          <th key={n} className="w-9 text-center font-black" title={`${partMonthText(n)} · Unit ${partUnit(n)}`}>
                            P{n}
                          </th>
                        ))}
                        <th className="w-12 text-center font-black">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cnt.map((r) => (
                        <tr key={r.key} className="border-t border-gray-100" data-book-row={r.key} data-book-total={r.n}>
                          <td className="text-right pr-2 font-black text-gray-500">{r.no}</td>
                          <td className="py-1 font-black text-gray-800">
                            {r.name}
                            {!r.entered && <span className="ml-1.5 text-[10px] font-black text-rose-600 bg-rose-50 rounded px-1">ยังไม่เคยเข้าระบบ</span>}
                          </td>
                          {PART_NUMS.map((n) => {
                            const p = !!r.prog[String(n)]?.p;
                            const tried = !p && (r.prog[String(n)]?.a ?? 0) > 0;
                            return (
                              <td key={n} className="text-center" data-book-cell={n} data-passed={p ? "1" : "0"} title={p ? `ผ่านเมื่อ ${fmt(r.prog[String(n)].at)}` : tried ? `ทำไป ${r.prog[String(n)].a} รอบ ดีสุด ${r.prog[String(n)].b}/25` : ""}>
                                {p ? (
                                  <span className="inline-flex w-6 h-6 rounded-full bg-emerald-500 text-white items-center justify-center font-black">✓</span>
                                ) : tried ? (
                                  <span className="text-amber-500 font-black" aria-label="ทำแล้วยังไม่ผ่าน">
                                    ●
                                  </span>
                                ) : (
                                  <span className="text-gray-300">–</span>
                                )}
                              </td>
                            );
                          })}
                          <td className={`text-center font-black ${r.n === PARTS ? "text-emerald-700" : "text-gray-600"}`}>
                            {r.n}/{PARTS}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {excused.length > 0 && (
                  <p className="text-[11px] font-bold text-gray-400 mt-2" data-book-excused>
                    ลา/ขาดเรียน (ไม่นับ): {excused.map((r) => `เลขที่ ${r.no} ${r.name} (${r.excused})`).join(", ")}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-[11px] font-bold text-gray-400">● = ทำแล้วแต่ยังไม่ผ่าน (เอาเมาส์ชี้/กดค้างดูจำนวนรอบและคะแนนดีสุด) · – = ยังไม่ได้ทำ</p>
        </div>
      )}
    </section>
  );
}
