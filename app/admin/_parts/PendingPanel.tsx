"use client";
// app/admin/_parts/PendingPanel.tsx — 📌 งานค้างรายคน (หน้าครู · 13 พ.ย. 2569)
//   บท 🧩 / ชุด 📚 ที่เลยวันเรียนของห้องแล้วแต่ยังไม่ผ่าน แยกตามห้อง · ใช้กติกาเดียวกับห้องเรียน (lib/pending.ts)
//   ปุ่มคัดลอกข้อความไปวางในกลุ่มไลน์ (เลขที่อย่างเดียว / พร้อมชื่อ) และดาวน์โหลด CSV
//   ม.4 มีเฉพาะ 🧩 · ม.6 มี 🧩 และ 📚 · นักเรียนที่ยังไม่เคยเข้าระบบนับค้างทุกอย่างที่ถึงกำหนด · คนที่ลา/ขาด (EXCUSED) แยกไว้ ไม่นับ
import React, { useEffect, useMemo, useState } from "react";
import { mergeCourseProgress, type CourseProgress } from "../../lib/courses";
import { thaiDayOf } from "../../lib/early";
import { loadSchedule } from "../../lib/pendingData";
import { STATE_TEXT, computePending, groupByTrack, lineText, type LessonLike, type PendItem, type SetLike } from "../../lib/pending";
import { EXCUSED, ROSTER, downloadCsv, gradeOf, matchRoster, rosterKey } from "../../lib/roster";
import type { Schedule } from "../../lib/schedule";
import { serverNow, syncClock, thaiShort } from "../../lib/sync";

export interface PendStudent {
  id: string;
  name?: string;
  email?: string;
  courses?: Record<string, Record<string, LessonLike>>;
  v300?: { sets?: Record<string, SetLike> };
  unlock?: Record<string, number>;
}
interface PRow {
  key: string;
  room: string;
  no: number;
  name: string;
  entered: boolean;
  excused: string | null;
  items: PendItem[];
}

const STATE_MARK: Record<string, string> = { none: "", tried: " ✗", early: " ⏩" };

export function PendingPanel({ students, grade, roomFilter }: { students: PendStudent[]; grade: string; roomFilter: string }) {
  const [open, setOpen] = useState(false);
  const [sch, setSch] = useState<Schedule | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([loadSchedule(), syncClock()])
      .then(([s]) => {
        if (!alive) return;
        setSch(s);
        setToday(thaiDayOf(serverNow()));
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  const rows: PRow[] = useMemo(() => {
    if (!sch || !today) return [];
    const byKey = new Map<string, PendStudent[]>();
    for (const s of students) {
      const hit = matchRoster(s.name);
      if (!hit) continue;
      const k = rosterKey(hit);
      byKey.set(k, [...(byKey.get(k) ?? []), s]);
    }
    const out: PRow[] = [];
    for (const r of ROSTER) {
      if (roomFilter === "ALL" ? gradeOf(r.room) !== grade : r.room !== roomFilter) continue;
      const k = rosterKey(r);
      const docs = byKey.get(k) ?? [];
      const unlock: Record<string, number> = {};
      for (const d of docs) for (const [uk, v] of Object.entries(d.unlock || {})) if (typeof v === "number") unlock[uk] = Math.max(unlock[uk] ?? 0, v);
      const lessons: Record<string, Record<string, LessonLike>> = {};
      for (const ck of ["decoder", "decoder4"]) {
        let m: CourseProgress = {};
        for (const d of docs) if (d.courses?.[ck]) m = mergeCourseProgress(m, d.courses[ck] as CourseProgress);
        lessons[ck] = m;
      }
      const items = computePending(sch, { room: r.room, today, unlock, lessons, sets: docs.map((d) => d.v300?.sets || {}) });
      out.push({ key: k, room: r.room, no: r.no, name: r.name, entered: docs.length > 0, excused: EXCUSED[k] ?? null, items });
    }
    return out;
  }, [sch, today, students, grade, roomFilter]);

  const counted = rows.filter((r) => !r.excused);
  const lateRows = counted.filter((r) => r.items.some((i) => i.late));
  const rooms = Array.from(new Set(rows.map((r) => r.room))).sort();
  const notEntered = counted.filter((r) => !r.entered).length;
  const scope = roomFilter === "ALL" ? `ม.${grade} ทุกห้อง` : `ม.${roomFilter}`;

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
    const data: (string | number)[][] = [];
    for (const r of counted) {
      for (const i of r.items.filter((x) => x.late)) {
        data.push([r.room, r.no, r.name, r.entered ? "เข้าระบบแล้ว" : "ยังไม่เคยเข้าระบบ", `${i.icon} ${i.trackName}`, i.label, i.title, i.open, i.daysLate, STATE_TEXT[i.state]]);
      }
    }
    downloadCsv(`งานค้าง_${scope.replace(/[ .]/g, "")}_${today}.csv`, ["ห้อง", "เลขที่", "ชื่อ", "สถานะ", "ห้องเรียน", "รายการ", "ชื่อบท/ชุด", "วันเปิด", "ค้าง(วัน)", "สถานะงาน"], data);
  }

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-pending-panel>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="font-black text-gray-800">📌 งานค้างรายคน</span>
        <span className="text-xs font-bold text-gray-500" data-pend-head>
          {err ? "โหลดตารางเรียนไม่สำเร็จ" : !today ? "กำลังคำนวณ…" : `${scope}: ค้าง ${lateRows.length} จาก ${counted.length} คน`}
        </span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && today && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-[11px] font-bold text-gray-500">
            ณ {thaiShort(today)} · ค้าง = เลยวันเรียนของห้องมาแล้วแต่ยังไม่ผ่าน (ทำล่วงหน้าสัปดาห์ 3+ ไม่นับ · สัปดาห์ 1–2 อนุโลม · ครูเปิดล่วงหน้าให้ = นับ) ·{" "}
            <b>✗</b> ทำแล้วยังไม่ผ่าน · <b>⏩</b> ทำล่วงหน้า (ต้องทำใหม่) · ยังไม่เคยเข้าระบบ {notEntered} คน (นับค้างตามกำหนด)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={csv} data-pend-csv className="px-3 py-1.5 rounded-xl border-2 border-gray-200 text-xs font-black text-gray-700 hover:border-[#003399]/50">
              ⬇️ ดาวน์โหลด CSV ({scope})
            </button>
            <label className="text-xs font-bold text-gray-600 flex items-center gap-1.5">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-pend-showall /> แสดงเปิดวันนี้ด้วย
            </label>
          </div>
          {rooms.map((room) => {
            const rr = rows.filter((r) => r.room === room);
            const cnt = rr.filter((r) => !r.excused);
            const late = cnt.filter((r) => r.items.some((i) => i.late));
            const excused = rr.filter((r) => r.excused);
            const lineRows = cnt.map((r) => ({ no: r.no, name: r.name, items: r.items }));
            return (
              <div key={room} className="rounded-xl border-2 border-gray-100 p-3" data-pend-room={room} data-pend-late={late.length}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-black text-[#003399]">ม.{room}</span>
                  <span className="text-xs font-bold text-gray-500">ค้าง {late.length} จาก {cnt.length} คน</span>
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => copy(`${room}:n`, lineText(room, today, lineRows, false))} data-pend-copy="nums" className="px-2.5 py-1 rounded-lg bg-[#003399] text-white text-[11px] font-black">
                      {copied === `${room}:n` ? "คัดลอกแล้ว ✓" : "📋 คัดลอกไลน์ (เลขที่)"}
                    </button>
                    <button type="button" onClick={() => copy(`${room}:s`, lineText(room, today, lineRows, true))} data-pend-copy="names" className="px-2.5 py-1 rounded-lg border-2 border-gray-200 text-gray-700 text-[11px] font-black">
                      {copied === `${room}:s` ? "คัดลอกแล้ว ✓" : "📋 พร้อมชื่อ"}
                    </button>
                  </span>
                </div>
                {late.length === 0 && <p className="text-xs font-bold text-emerald-700">✅ ไม่มีงานค้าง</p>}
                <ul className="space-y-1">
                  {cnt
                    .filter((r) => r.items.some((i) => i.late || showAll))
                    .map((r) => {
                      const shown = r.items.filter((i) => i.late || showAll);
                      const maxLate = Math.max(0, ...r.items.filter((i) => i.late).map((i) => i.daysLate));
                      return (
                        <li key={r.key} className="flex items-start gap-2 text-xs" data-pend-row={r.key} data-pend-max={maxLate}>
                          <span className="w-8 shrink-0 text-right font-black text-gray-500">{r.no}</span>
                          <span className="min-w-0 flex-1">
                            <span className="font-black text-gray-800">{r.name}</span>
                            {!r.entered && <span className="ml-1.5 text-[10px] font-black text-rose-600 bg-rose-50 rounded px-1">ยังไม่เคยเข้าระบบ</span>}
                            <span className="block font-bold text-gray-600">
                              {groupByTrack(shown).map((g) => (
                                <span key={g.track} className="mr-3 whitespace-nowrap">
                                  {g.icon} {g.unit}{" "}
                                  {g.items.map((i, ii) => (
                                    <span key={i.id} className={i.late ? "" : "text-sky-700"}>
                                      {ii > 0 && ", "}
                                      {i.no}
                                      <span className="text-gray-400">({i.late ? `${i.daysLate}ว.` : "วันนี้"}){STATE_MARK[i.state]}</span>
                                    </span>
                                  ))}
                                </span>
                              ))}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                </ul>
                {excused.length > 0 && (
                  <p className="text-[11px] font-bold text-gray-400 mt-2" data-pend-excused>
                    ลา/ขาดเรียน (ไม่นับ): {excused.map((r) => `เลขที่ ${r.no} ${r.name} (${r.excused})`).join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
