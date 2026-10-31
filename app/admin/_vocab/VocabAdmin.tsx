"use client";
// app/admin/_vocab/VocabAdmin.tsx
// ─────────────────────────────────────────────────────────────
// หน้าครู · คำศัพท์แกน 120 คำ (12 ชุด ชุดละ 10 คำ · เรียนตามแผน 14 สัปดาห์ ภาคเรียนที่ 2/2569)
//   • ตารางรายคน: รู้แล้ว / กำลังเรียน / ค้างทวน / วันที่เข้าเรียนใน 7 วัน / ทักษะเดาก่อน + รายสัปดาห์
//   • รายสัปดาห์: ภาพรวมทั้งห้อง + คำที่นักเรียนพลาดบ่อยในสัปดาห์นั้น
//   • คำที่ควรสอนซ่อม: จัดอันดับคำยากจากข้อมูลจริงทุกคน
//   • ส่งออก CSV
// “รู้แล้ว” = ตอบถูกตั้งแต่ครั้งแรกในวันที่ต่างกันอย่างน้อย 2 วัน (ลืมแล้วนับใหม่)
// ─────────────────────────────────────────────────────────────

import React, { useMemo, useState } from "react";
import { BEHIND_DUE, VCourse, VProgress, VWord, computeStats, emptyProgress, isKnown, mergeProgress, plannedWeekNo, plannedWords, todayStr } from "../../lib/vocab300";
import { ROOMS, ROSTER, extractNo, fmtThaiTime, gradeOf, matchRoster, roomOf, rosterKey, downloadCsv, typedMismatch } from "../../lib/roster";

export type V300Doc = { id: string; name?: string; email?: string; v300?: VProgress; v300At?: number };

type VRow = {
  key: string;
  room: string | null;
  no: number | null;
  name: string;
  typedNames: string[];
  emails: string[];
  prog: VProgress;
  at: number;
  inRoster: boolean;
};

function pct(a: number, b: number) {
  return b ? Math.round((a / b) * 100) : 0;
}

export default function VocabAdmin({
  course,
  students,
  roomFilter,
  grade,
  search,
}: {
  course: VCourse;
  students: V300Doc[];
  roomFilter: string;
  grade: string; // "6" หรือ "4" — "ทุกห้อง" หมายถึงทุกห้องในระดับชั้นนี้
  search: string;
}) {
  const today = todayStr();
  const [mode, setMode] = useState<"people" | "weeks" | "hard">("people");
  const [weekNo, setWeekNo] = useState(1);
  const [sortBy, setSortBy] = useState<"roster" | "known" | "inactive" | "behind">("roster");
  const words = course.words;
  const total = words.length;

  // ── รวมข้อมูลเป็นแถวตามรายชื่อทางการ (รวมหลายบัญชีของคนเดียวกัน) ──
  const rows: VRow[] = useMemo(() => {
    const byRoster: Record<string, VRow> = {};
    for (const r of ROSTER) {
      byRoster[rosterKey(r)] = { key: rosterKey(r), room: r.room, no: r.no, name: r.name, typedNames: [], emails: [], prog: emptyProgress(), at: 0, inRoster: true };
    }
    const extra: VRow[] = [];
    for (const s of students) {
      const p = s.v300;
      const has = !!p && Object.keys(p.cards || {}).length > 0;
      const hit = matchRoster(s.name);
      if (hit) {
        const row = byRoster[rosterKey(hit)];
        if (s.name && !row.typedNames.includes(s.name)) row.typedNames.push(s.name);
        if (s.email) row.emails.push(s.email);
        if (has) row.prog = mergeProgress(row.prog, { cards: p!.cards || {}, days: p!.days || {} });
        row.at = Math.max(row.at, s.v300At ?? 0);
      } else if (has) {
        extra.push({
          key: `x|${s.id}`, room: roomOf(s.name), no: extractNo(s.name), name: s.name || s.email || s.id,
          typedNames: s.name ? [s.name] : [], emails: s.email ? [s.email] : [], prog: { cards: p!.cards || {}, days: p!.days || {} },
          at: s.v300At ?? 0, inRoster: false,
        });
      }
    }
    const rr = Object.values(byRoster).sort((a, b) => (a.room! < b.room! ? -1 : a.room! > b.room! ? 1 : (a.no ?? 0) - (b.no ?? 0)));
    return [...rr, ...extra];
  }, [students]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (roomFilter === "ALL" ? (r.room ? gradeOf(r.room) === grade : grade === "6") : r.room === roomFilter) &&
      (!q || r.name.toLowerCase().includes(q) || r.typedNames.some((t) => t.toLowerCase().includes(q)) || r.emails.some((e) => e.includes(q)))
  );

  // ── ตัวชี้วัดรายคน ──
  const metrics = useMemo(() => {
    const m: Record<string, ReturnType<typeof rowMetrics>> = {};
    for (const r of rows) m[r.key] = rowMetrics(r.prog, words, today);
    return m;
  }, [rows, words, today]);

  const sorted = useMemo(() => {
    const list = [...visible];
    if (sortBy === "known") list.sort((a, b) => metrics[b.key].known - metrics[a.key].known || metrics[b.key].seen - metrics[a.key].seen);
    if (sortBy === "inactive") list.sort((a, b) => metrics[a.key].todayN + metrics[a.key].todayR - (metrics[b.key].todayN + metrics[b.key].todayR) || metrics[b.key].due - metrics[a.key].due);
    if (sortBy === "behind") list.sort((a, b) => metrics[a.key].seen - metrics[b.key].seen || metrics[b.key].due - metrics[a.key].due);
    return list;
  }, [visible, sortBy, metrics]);

  // คำที่ควรเรียนแล้วตามแผน ณ วันนี้ — คิดตามวันเรียนของแต่ละห้อง (ห้องที่ยังไม่ถึงคาบในสัปดาห์นี้ จะยังไม่นับชุดใหม่)
  const planRoom = roomFilter === "ALL" ? null : roomFilter;
  const planTarget = plannedWords(course, today, planRoom);
  const planNo = plannedWeekNo(course, today, planRoom);
  const roomTargets: Record<string, number | null> = Object.fromEntries(ROOMS.map((rm) => [rm, plannedWords(course, today, rm)]));
  const targetOf = (room: string | null) => (room && room in roomTargets ? roomTargets[room] : planTarget);

  const inRosterVisible = visible.filter((r) => r.inRoster);
  const summary = (() => {
    const list = inRosterVisible;
    const started = list.filter((r) => metrics[r.key].seen > 0);
    const sumKnown = list.reduce((s, r) => s + metrics[r.key].known, 0);
    const sumSeen = list.reduce((s, r) => s + metrics[r.key].seen, 0);
    const active7 = list.filter((r) => metrics[r.key].active7 > 0).length;
    const behind = started.filter((r) => metrics[r.key].due >= BEHIND_DUE).length;
    const doneToday = list.filter((r) => metrics[r.key].todayN + metrics[r.key].todayR > 0).length;
    const onPlan = planTarget === null ? null : list.filter((r) => metrics[r.key].seen >= (targetOf(r.room) ?? 0)).length;
    return { n: list.length, started: started.length, avgKnown: list.length ? sumKnown / list.length : 0, avgSeen: list.length ? sumSeen / list.length : 0, active7, behind, doneToday, onPlan };
  })();

  // ── สถิติรายคำ (ในกลุ่มที่เลือก) ──
  const wordStats = (() => {
    const out: Record<string, { learners: number; known: number; asked: number; wrong: number; lapses: number; guess: number; part: number; partN: number }> = {};
    for (const w of words) out[w.id] = { learners: 0, known: 0, asked: 0, wrong: 0, lapses: 0, guess: 0, part: 0, partN: 0 };
    for (const r of visible) {
      for (const [id, c] of Object.entries(r.prog.cards)) {
        const s = out[id];
        if (!s) continue;
        s.learners++;
        if (isKnown(c)) s.known++;
        s.asked += c.n || 0;
        s.wrong += c.w || 0;
        s.lapses += c.lap || 0;
        s.guess += c.g === 1 ? 1 : 0;
        if (c.p === 0 || c.p === 1) { s.partN++; s.part += c.p; }
      }
    }
    return out;
  })();

  const difficulty = (id: string) => {
    const s = wordStats[id];
    return s.learners ? (s.wrong + s.lapses) / s.learners : 0;
  };
  const hardWords = words.filter((w) => wordStats[w.id].learners >= 3).sort((a, b) => difficulty(b.id) - difficulty(a.id)).slice(0, 20);

  const exportCsv = () => {
    const headers = ["ห้อง", "เลขที่", "ชื่อ-สกุล", "ชื่อที่พิมพ์ในแอป", "อีเมล", "รู้แล้ว", "กำลังเรียน", "เรียนแล้ว", "ค้างทวน", "วันที่เข้าเรียน (7 วัน)", "วันติดต่อกัน", "เดาความหมายถูก %", "ผ่าคำถูก %", ...course.weeks.map((w) => `ชุด ${w.no} รู้แล้ว`), `ตามแผน${planRoom ? ` (ควรเรียนแล้ว ${planTarget ?? "-"} คำ)` : " (คิดตามวันเรียนของแต่ละห้อง)"}`, "วันนี้ คำใหม่", "วันนี้ ทวน", "ทำล่าสุด"];
    const data = sorted.map((r) => {
      const m = metrics[r.key];
      return [r.room ?? "", r.no ?? "", r.name, r.typedNames.join(" / "), r.emails.join(" / "), m.known, m.learning, m.seen, m.due, m.active7, m.streak, m.seen ? m.guessPct : "", m.partN ? m.partPct : "", ...m.weekKnown, planText(targetOf(r.room), m.seen), m.todayN, m.todayR, m.lastAt ? new Date(m.lastAt).toLocaleString("th-TH") : ""];
    });
    downloadCsv(`vocab300-${roomFilter === "ALL" ? `m${grade}-all` : roomFilter.replace("/", "-")}-${today}.csv`, headers, data);
  };

  return (
    <div>
      {/* ── การ์ดสรุป ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          [summary.n, `นักเรียนในรายชื่อ ${roomFilter === "ALL" ? `ม.${grade} ทุกห้อง` : `ม.${roomFilter}`}`],
          [summary.doneToday, "ทำในแอปวันนี้แล้ว"],
          [summary.onPlan === null ? summary.started : summary.onPlan, summary.onPlan === null ? "เริ่มเรียนแล้ว" : planRoom ? `ทันแผน (เรียนถึงชุดที่ ${planNo})` : "ทันแผน (ตามคาบของแต่ละห้อง)"],
          [summary.avgKnown.toFixed(1), `รู้แล้วเฉลี่ย (คำ/คน จาก ${total})`],
          [summary.behind, `ค้างทวน ≥ ${BEHIND_DUE} คำ`],
        ].map(([v, l], i) => (
          <div key={i} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className={`text-3xl font-black tabular-nums ${i === 4 && Number(v) > 0 ? "text-rose-600" : "text-[#003399]"}`}>{v}</div>
            <div className="text-xs text-gray-500 font-bold">{l}</div>
          </div>
        ))}
      </div>

      {/* ── โหมด ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {([
          ["people", "ตารางรายคน"],
          ["weeks", "รายชุด"],
          ["hard", "คำที่ควรสอนซ่อม"],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 rounded-full text-sm font-bold ${mode === k ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            {l}
          </button>
        ))}
        {mode === "people" && (
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="border-2 border-gray-200 rounded-xl px-3 py-1.5 text-sm font-bold bg-white">
            <option value="roster">เรียงตามเลขที่</option>
            <option value="known">เรียงตามคำที่รู้แล้ว (มาก → น้อย)</option>
            <option value="inactive">คนที่ยังไม่ได้ทำวันนี้ขึ้นก่อน</option>
            <option value="behind">คนที่ช้ากว่าแผนขึ้นก่อน</option>
          </select>
        )}
        <button onClick={exportCsv} className="ml-auto px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl text-sm">⬇ CSV คำศัพท์แกน</button>
      </div>

      {/* ── ตารางรายคน ── */}
      {mode === "people" && (
        <div className="bg-white rounded-2xl border border-gray-100 mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#003399] text-white text-[11px]">
                  <th className="sticky left-0 z-10 bg-[#003399] text-left px-3 py-2 font-black min-w-[210px]">นักเรียน</th>
                  <th className="px-2 py-2 font-black min-w-[120px]">รู้แล้ว / {total}</th>
                  <th className="px-2 py-2 font-black">กำลังเรียน</th>
                  <th className="px-2 py-2 font-black">ค้างทวน</th>
                  <th className="px-2 py-2 font-black whitespace-nowrap">ตามแผน</th>
                  <th className="px-2 py-2 font-black whitespace-nowrap">วันนี้ (ใหม่ · ทวน)</th>
                  <th className="px-2 py-2 font-black whitespace-nowrap">เดาถูก</th>
                  {course.weeks.map((w) => (
                    <th key={w.no} className="px-0.5 py-2 font-black min-w-[30px]" title={`${w.title}${w.label ? ` · ${w.label}` : ""}`}>ช.{w.no}</th>
                  ))}
                  <th className="px-3 py-2 font-black text-left whitespace-nowrap">ทำล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i, arr) => {
                  const m = metrics[r.key];
                  const showRoom = sortBy === "roster" && roomFilter === "ALL" && r.inRoster && (i === 0 || arr[i - 1].room !== r.room);
                  const firstExtra = !r.inRoster && (i === 0 || arr[i - 1].inRoster);
                  const cols = 8 + course.weeks.length;
                  return (
                    <React.Fragment key={r.key}>
                      {showRoom && <tr><td colSpan={cols} className="bg-[#FFD700]/30 text-[#003399] font-black px-3 py-1.5 text-xs">ม.{r.room}</td></tr>}
                      {firstExtra && <tr><td colSpan={cols} className="bg-rose-50 text-rose-700 font-black px-3 py-1.5 text-xs">บัญชีที่จับคู่รายชื่อไม่ได้ (พิมพ์ชื่อไม่ตรงรายชื่อทางการ)</td></tr>}
                      <tr className="border-b border-gray-100 hover:bg-blue-50/40">
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                          <div className="font-bold text-gray-900 truncate max-w-[250px]">
                            {r.no != null && <span className="text-gray-400 font-black mr-1 tabular-nums">{r.no}.</span>}
                            {r.name}
                          </div>
                          {r.inRoster && typedMismatch(r.name, r.typedNames).length > 0 && (
                            <div className="text-[10px] font-bold text-amber-700 truncate max-w-[250px]" title="ชื่อที่นักเรียนกรอกในแอปไม่ตรงกับรายชื่อ — ตรวจว่ากรอกเลขที่/ห้องถูกไหม">
                              ⚠️ กรอกว่า: {typedMismatch(r.name, r.typedNames).join(" / ")}
                            </div>
                          )}
                          {!r.inRoster && <div className="text-[10px] text-gray-400 truncate max-w-[250px]">{r.emails.join(" / ")}</div>}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <span className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden relative min-w-[60px]">
                              <span className="absolute inset-y-0 left-0 bg-[#003399]/25" style={{ width: `${pct(m.seen, total)}%` }} />
                              <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(m.known, total)}%` }} />
                            </span>
                            <span className="text-xs font-black tabular-nums w-8 text-right">{m.known}</span>
                          </div>
                        </td>
                        <td className="text-center text-xs font-bold tabular-nums">{m.learning || <span className="text-gray-300">0</span>}</td>
                        <td className={`text-center text-xs font-black tabular-nums ${m.due >= BEHIND_DUE ? "text-rose-600" : m.due > 0 ? "text-amber-700" : "text-gray-300"}`}>{m.due}</td>
                        <td className="text-center text-xs font-black tabular-nums whitespace-nowrap">
                          <PlanCell target={targetOf(r.room)} seen={m.seen} />
                        </td>
                        <td className="text-center text-xs font-bold tabular-nums whitespace-nowrap">
                          {m.todayN + m.todayR === 0 ? (
                            <span className="text-gray-300">ยังไม่ทำ</span>
                          ) : (
                            <span className={m.todayN >= 10 && m.due === 0 ? "text-emerald-600" : "text-[#003399]"}>
                              {m.todayN} · {m.todayR}
                              {m.due === 0 ? " ✓" : ""}
                            </span>
                          )}
                        </td>
                        <td className="text-center text-xs tabular-nums text-gray-600">{m.seen ? `${m.guessPct}%` : "–"}</td>
                        {m.weekKnown.map((k, wi) => {
                          const s = m.weekSeen[wi];
                          const n = course.weeks[wi].count;
                          return (
                            <td key={wi} className="text-center px-0.5 py-1" title={`ชุด ${wi + 1}: รู้แล้ว ${k} · เรียนแล้ว ${s} / ${n}`}>
                              {s === 0 ? (
                                <span className="inline-flex w-7 h-6 rounded-md bg-gray-50 text-gray-300 items-center justify-center text-xs">·</span>
                              ) : k === n ? (
                                <span className="inline-flex w-7 h-6 rounded-md bg-emerald-500 text-white font-black items-center justify-center text-[11px]">✓</span>
                              ) : (
                                <span className={`inline-flex w-7 h-6 rounded-md font-black items-center justify-center text-[11px] tabular-nums ${k > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-50 text-amber-700"}`}>{k}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-1 text-xs text-gray-500 whitespace-nowrap">{m.lastAt ? fmtThaiTime(m.lastAt) : "–"}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 px-4 py-3 leading-relaxed">
            แถบเขียว = รู้แล้ว (ถูกต่างวัน 2 วัน) · แถบฟ้าจาง = เรียนแล้ว · ค้างทวน = คำที่ถึงกำหนดแต่ยังไม่ทวน (แดงเมื่อ ≥ {BEHIND_DUE}) ·
            ตามแผน = เทียบคำที่เรียนแล้วกับแผนรายสัปดาห์ นับถึงคาบล่าสุดของห้องนั้น{planRoom && planTarget !== null ? ` (ม.${planRoom} วันนี้ควรเรียนแล้ว ${planTarget} คำ)` : ""} · วันนี้ = คำใหม่ · ข้อทวน ที่ทำวันนี้ (✓ = ไม่มีค้างทวน — ใช้เช็กก่อนหมดคาบ) ·
            เดาถูก = สัดส่วนที่ขั้น “เดาก่อนรู้” เดาความหมายถูก (บอกทักษะถอดรหัสคำ) · ช.1–ช.{course.weeks.length} = จำนวนคำที่รู้แล้วในแต่ละชุด (✓ = ครบ {course.weeks[0]?.count ?? 10})
          </p>
        </div>
      )}

      {/* ── รายสัปดาห์ ── */}
      {mode === "weeks" && (
        <div className="mb-5">
          <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-4">
            <h2 className="font-black text-gray-900 mb-3">ภาพรวมรายชุด (นักเรียนในรายชื่อที่เลือก {inRosterVisible.length} คน)</h2>
            <div className="space-y-1.5">
              {course.weeks.map((wk) => {
                const ws = words.filter((w) => w.week === wk.no);
                const n = inRosterVisible.length * ws.length || 1;
                let seen = 0, known = 0;
                for (const r of inRosterVisible) for (const w of ws) { const c = r.prog.cards[w.id]; if (c) { seen++; if (isKnown(c)) known++; } }
                return (
                  <button key={wk.no} onClick={() => setWeekNo(wk.no)} className={`w-full flex items-center gap-2 text-left rounded-lg px-1 ${weekNo === wk.no ? "bg-[#FFD700]/20" : "hover:bg-gray-50"}`}>
                    <span className="w-20 shrink-0 text-xs font-black text-[#003399]" title={wk.label}>ชุด {wk.no}</span>
                    <span className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden relative">
                      <span className="absolute inset-y-0 left-0 bg-[#003399]/30" style={{ width: `${(seen / n) * 100}%` }} />
                      <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${(known / n) * 100}%` }} />
                    </span>
                    <span className="w-40 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-600">เรียน {pct(seen, n)}% · รู้แล้ว {pct(known, n)}%</span>
                  </button>
                );
              })}
            </div>
          </div>
          <WordTable title={`คำในชุดที่ ${weekNo}${course.weeks[weekNo - 1]?.label ? ` · ${course.weeks[weekNo - 1].label}` : ""} (เรียงจากคำที่พลาดบ่อย)`} list={words.filter((w) => w.week === weekNo).sort((a, b) => difficulty(b.id) - difficulty(a.id))} stats={wordStats} />
        </div>
      )}

      {/* ── คำที่ควรสอนซ่อม ── */}
      {mode === "hard" && (
        <div className="mb-5">
          <p className="text-xs text-gray-500 mb-2">จัดอันดับจาก (จำนวนครั้งที่ตอบผิด + จำนวนครั้งที่ลืม) ÷ จำนวนคนที่เรียนคำนั้น · แสดงเฉพาะคำที่มีคนเรียนแล้วอย่างน้อย 3 คน · เหมาะใช้สอนซ่อม 3–5 นาทีต้นคาบ</p>
          <WordTable title="20 คำที่นักเรียนพลาดบ่อยที่สุด" list={hardWords} stats={wordStats} showWeek />
        </div>
      )}
      {visible.length === 0 && <p className="text-center text-gray-400 py-6">ไม่พบนักเรียนตามเงื่อนไข</p>}
    </div>
  );
}

function rowMetrics(p: VProgress, words: VWord[], today: string) {
  const st = computeStats(p, today);
  const nWeeks = words.reduce((m, w) => Math.max(m, w.week), 0);
  const weekKnown = Array(nWeeks).fill(0) as number[];
  const weekSeen = Array(nWeeks).fill(0) as number[];
  let g = 0, part = 0, partN = 0, lastAt = 0;
  const byId: Record<string, VWord> = {};
  for (const w of words) byId[w.id] = w;
  for (const [id, c] of Object.entries(p.cards)) {
    const w = byId[id];
    if (!w) continue;
    weekSeen[w.week - 1]++;
    if (isKnown(c)) weekKnown[w.week - 1]++;
    if (c.g === 1) g++;
    if (c.p === 0 || c.p === 1) { partN++; part += c.p; }
    lastAt = Math.max(lastAt, c.at || 0);
  }
  const td = p.days?.[today];
  return {
    todayN: td?.n ?? 0,
    todayR: td?.r ?? 0,
    known: st.known,
    learning: st.learning,
    seen: st.seen,
    due: st.due,
    active7: st.activeDays7,
    streak: st.streak,
    guessPct: pct(g, st.seen),
    partPct: pct(part, partN),
    partN,
    weekKnown,
    weekSeen,
    lastAt,
  };
}

function WordTable({
  title,
  list,
  stats,
  showWeek,
}: {
  title: string;
  list: VWord[];
  stats: Record<string, { learners: number; known: number; asked: number; wrong: number; lapses: number; guess: number; part: number; partN: number }>;
  showWeek?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-2 font-black text-sm bg-gray-50 text-gray-800">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-500 border-b border-gray-100">
              <th className="text-left px-3 py-2">คำ</th>
              {showWeek && <th className="px-2 py-2">ชุด</th>}
              <th className="px-2 py-2">เรียนแล้ว (คน)</th>
              <th className="px-2 py-2">รู้แล้ว (คน)</th>
              <th className="px-2 py-2">ตอบผิด (ครั้ง)</th>
              <th className="px-2 py-2">ลืม (ครั้ง)</th>
              <th className="px-2 py-2">เดาถูก</th>
              <th className="px-2 py-2">ผ่าคำถูก</th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => {
              const s = stats[w.id];
              return (
                <tr key={w.id} className="border-b border-gray-50">
                  <td className="px-3 py-1.5">
                    <b className="font-serif">{w.w}</b> <span className="text-xs text-gray-400">{w.pos}</span>
                    <div className="text-xs text-gray-500">{w.th}</div>
                  </td>
                  {showWeek && <td className="text-center text-xs font-bold">{w.week}</td>}
                  <td className="text-center tabular-nums">{s.learners}</td>
                  <td className="text-center tabular-nums text-emerald-700 font-bold">{s.known}</td>
                  <td className={`text-center tabular-nums ${s.wrong > 0 ? "text-rose-600 font-bold" : "text-gray-300"}`}>{s.wrong}</td>
                  <td className={`text-center tabular-nums ${s.lapses > 0 ? "text-rose-600 font-bold" : "text-gray-300"}`}>{s.lapses}</td>
                  <td className="text-center tabular-nums text-gray-600">{s.learners ? `${pct(s.guess, s.learners)}%` : "–"}</td>
                  <td className="text-center tabular-nums text-gray-600">{s.partN ? `${pct(s.part, s.partN)}%` : "–"}</td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={8} className="text-center text-xs text-gray-400 py-4">ยังไม่มีข้อมูลพอ</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ช่อง “ตามแผน” ──
function planText(target: number | null, seen: number): string {
  return target === null ? "" : seen >= target ? "ทัน" : `ขาด ${target - seen}`;
}
function PlanCell({ target, seen }: { target: number | null; seen: number }) {
  if (target === null) return <span className="text-gray-300">–</span>;
  if (seen >= target) return <span className="text-emerald-600">✓ ทัน</span>;
  return <span className={target - seen > 10 ? "text-rose-600" : "text-amber-700"}>ขาด {target - seen}</span>;
}
