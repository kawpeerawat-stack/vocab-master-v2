"use client";
// app/admin/_vocab/VocabAdmin.tsx
// ─────────────────────────────────────────────────────────────
// หน้าครู · คำศัพท์แกน 120 คำ (12 ชุด ชุดละ 10 คำ · เรียนตามแผน 14 สัปดาห์ ภาคเรียนที่ 2/2569)
//   • ตารางรายคน: ผ่านชุดไหนแล้ว (✓ เขียว) / ตามแผน / วันนี้ / ทักษะเดาก่อน — อัปเดตสดตามที่นักเรียนส่งผล
//   • รายชุด: ภาพรวมทั้งห้อง + คำที่นักเรียนพลาดบ่อยในชุดนั้น
//   • คำที่ควรสอนซ่อม: จัดอันดับคำยากจากข้อมูลจริงทุกคน
//   • สมุดคะแนน: คะแนนชุดละ 10 (รอบทบทวน ถูกตั้งแต่ครั้งแรก) รวมเต็ม 120 → ส่งออก CSV
// “ผ่านชุด” = เรียนครบ 10 คำ + รอบทบทวนถูกครบ · “รู้แล้ว” = คำในชุดที่ผ่านแล้ว
// ชุดที่เรียนครบ 10 คำด้วยแอปแบบเดิม (ก่อน 4 พ.ย. 2569) นับว่าผ่าน — คะแนนคิดจากขั้นที่ 4 (มี * ในสมุดคะแนน)
// ─────────────────────────────────────────────────────────────

import React, { useMemo, useState } from "react";
import { VCourse, VProgress, VSetPass, VWord, computeStats, emptyProgress, isKnown, mergeProgress, normalizeProgress, plannedWeekNo, setPassOf, setState, todayStr } from "../../lib/vocab300";
import { ROOMS, ROSTER, extractNo, fmtThaiTime, gradeOf, matchRoster, roomOf, rosterKey, downloadCsv, typedMismatch } from "../../lib/roster";
import { doneEarly, doneGraced } from "../../lib/early";
import { openDay } from "../../lib/sync";
import { GuardMark, SpotCheck, UnlockButton, WeekTabs, guardEvents, guardTip, isFlagged, pickSpot, type SpotCand } from "../_parts/AdminTools";

export type V300Doc = { id: string; name?: string; email?: string; v300?: VProgress; v300At?: number; unlock?: Record<string, number> };

type VRow = {
  key: string;
  room: string | null;
  no: number | null;
  name: string;
  typedNames: string[];
  emails: string[];
  ids: string[];
  unlock: number; // ครูเปิดชุดล่วงหน้าถึงชุดที่ … (0 = ไม่ได้เปิด)
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
  const [mode, setMode] = useState<"people" | "grades" | "weeks" | "hard">("people");
  const [setSel, setSetSel] = useState(0); // 9 พ.ย.: แถบแยกรายสัปดาห์ (0 = ทุกชุด)
  const shownWeeks = setSel ? course.weeks.filter((w) => w.no === setSel) : course.weeks;
  const [weekNo, setWeekNo] = useState(1);
  const [sortBy, setSortBy] = useState<"roster" | "known" | "inactive" | "behind">("roster");
  const words = course.words;
  const total = words.length;

  // ── รวมข้อมูลเป็นแถวตามรายชื่อทางการ (รวมหลายบัญชีของคนเดียวกัน) ──
  const rows: VRow[] = useMemo(() => {
    const byRoster: Record<string, VRow> = {};
    for (const r of ROSTER) {
      byRoster[rosterKey(r)] = { key: rosterKey(r), room: r.room, no: r.no, name: r.name, typedNames: [], emails: [], ids: [], unlock: 0, prog: emptyProgress(), at: 0, inRoster: true };
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
        row.ids.push(s.id);
        row.unlock = Math.max(row.unlock, s.unlock?.v300 ?? 0);
        if (has) row.prog = mergeProgress(row.prog, { cards: p!.cards || {}, days: p!.days || {}, sets: p!.sets || {} });
        row.at = Math.max(row.at, s.v300At ?? 0);
      } else if (has) {
        extra.push({
          key: `x|${s.id}`, room: roomOf(s.name), no: extractNo(s.name), name: s.name || s.email || s.id,
          typedNames: s.name ? [s.name] : [], emails: s.email ? [s.email] : [], ids: [s.id], unlock: s.unlock?.v300 ?? 0, prog: { cards: p!.cards || {}, days: p!.days || {}, sets: p!.sets || {} },
          at: s.v300At ?? 0, inRoster: false,
        });
      }
    }
    const rr = Object.values(byRoster).sort((a, b) => (a.room! < b.room! ? -1 : a.room! > b.room! ? 1 : (a.no ?? 0) - (b.no ?? 0)));
    // ชุดที่เรียนครบด้วยแอปแบบเดิม → นับผ่าน (ให้ตรงกับหน้านักเรียน แม้นักเรียนยังไม่เปิดแอปอีก)
    return [...rr, ...extra].map((r) => ({ ...r, prog: normalizeProgress(r.prog, course.words) }));
  }, [students, course]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (roomFilter === "ALL" ? (r.room ? gradeOf(r.room) === grade : grade === "6") : r.room === roomFilter) &&
      (!q || r.name.toLowerCase().includes(q) || r.typedNames.some((t) => t.toLowerCase().includes(q)) || r.emails.some((e) => e.includes(q)))
  );

  // ── ตัวชี้วัดรายคน ──
  const metrics = useMemo(() => {
    const m: Record<string, ReturnType<typeof rowMetrics>> = {};
    for (const r of rows) m[r.key] = rowMetrics(r.prog, words, today, { course, room: r.room ?? null, unlock: r.unlock });
    return m;
  }, [rows, words, today, course]);

  const sorted = useMemo(() => {
    const list = [...visible];
    if (sortBy === "known") list.sort((a, b) => metrics[b.key].passed - metrics[a.key].passed || metrics[b.key].seen - metrics[a.key].seen);
    if (sortBy === "inactive") list.sort((a, b) => metrics[a.key].todayN + metrics[a.key].todayR + metrics[a.key].passedToday - (metrics[b.key].todayN + metrics[b.key].todayR + metrics[b.key].passedToday));
    if (sortBy === "behind") list.sort((a, b) => metrics[a.key].passed - metrics[b.key].passed || metrics[a.key].seen - metrics[b.key].seen);
    return list;
  }, [visible, sortBy, metrics]);

  // ── 🎯 สุ่มตรวจคาบนี้: คนที่ผ่านรอบทบทวนวันนี้ (ห้องที่เลือก) ──
  const spot = (() => {
    if (roomFilter === "ALL") return null;
    const cands: SpotCand[] = [];
    for (const r of visible) {
      const recs = Object.entries(r.prog.sets || {}).filter(([, x]) => x.day === today && !x.legacy);
      if (!recs.length) continue;
      const reasons: string[] = [];
      let w = 0;
      for (const [k, x] of recs) {
        if (isFlagged(x)) { w += 3; reasons.push(`ชุด ${k} 🚩`); }
        if (x.cm === "nocam" || x.cm === "camfail") { w += 1; reasons.push(`ชุด ${k} ${x.cm === "nocam" ? "🚫 ไม่ใช้กล้อง" : "⚠️ กล้องใช้ไม่ได้"}`); }
        if (x.score >= 10) { w += 1; reasons.push(`ชุด ${k} รอบทบทวน 10/10`); }
        if ((x.gt ?? 0) >= 3) { w += 1; reasons.push(`ชุด ${k} หมดเวลา ${x.gt} คำ`); }
      }
      cands.push({ key: r.key, name: `${r.no != null ? `${r.no}. ` : ""}${r.name}`, reasons, weight: w });
    }
    return cands.length ? { picks: pickSpot(cands, `${today}|${roomFilter}|v300`, 3), total: cands.length } : null;
  })();

  // ชุดที่ควรผ่านแล้วตามแผน ณ วันนี้ — คิดตามวันเรียนของแต่ละห้อง (ห้องที่ยังไม่ถึงคาบในสัปดาห์นี้ จะยังไม่นับชุดใหม่)
  const planRoom = roomFilter === "ALL" ? null : roomFilter;
  const planNo = plannedWeekNo(course, today, planRoom);
  const roomPlans: Record<string, number | null> = Object.fromEntries(ROOMS.map((rm) => [rm, plannedWeekNo(course, today, rm)]));
  const planOf = (room: string | null) => (room && room in roomPlans ? roomPlans[room] : planNo);
  // ผ่านครบทุกชุดถึงชุดตามแผนของห้องแล้วหรือยัง
  const behindOf = (r: VRow) => {
    const k = planOf(r.room);
    if (!k) return 0;
    let n = 0;
    for (let i = 1; i <= k; i++) if (!setPassOf(r.prog, i)) n++;
    return n;
  };

  const inRosterVisible = visible.filter((r) => r.inRoster);
  const summary = (() => {
    const list = inRosterVisible;
    const sumPassed = list.reduce((s, r) => s + metrics[r.key].passed, 0);
    const doneToday = list.filter((r) => metrics[r.key].todayN + metrics[r.key].todayR + metrics[r.key].passedToday > 0).length;
    const passedNow = list.filter((r) => { const k = planOf(r.room); return !!k && !!setPassOf(r.prog, k); }).length;
    const ready = list.filter((r) => metrics[r.key].ready > 0).length;
    const onPlan = planNo === null ? null : list.filter((r) => behindOf(r) === 0).length;
    return { n: list.length, avgPassed: list.length ? sumPassed / list.length : 0, doneToday, passedNow, ready, onPlan };
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

  const fileScope = roomFilter === "ALL" ? `m${grade}-all` : roomFilter.replace("/", "-");
  const exportCsv = () => {
    const headers = ["ห้อง", "เลขที่", "ชื่อ-สกุล", "ชื่อที่พิมพ์ในแอป", "อีเมล", "ผ่าน (ชุด)", "รู้แล้ว (คำ)", "กำลังเรียน", "เรียนแล้ว", "ทวนได้ (ไม่บังคับ)", "วันที่เข้าเรียน (7 วัน)", "เดาความหมายถูก %", "ผ่าคำถูก %", ...course.weeks.map((w) => `ชุด ${w.no}`), `ตามแผน${planRoom ? ` (ควรผ่านถึงชุดที่ ${planNo ?? "-"})` : " (คิดตามวันเรียนของแต่ละห้อง)"}`, "วันนี้ คำใหม่", "วันนี้ ทวน", "ทำล่าสุด"];
    const data = sorted.map((r) => {
      const m = metrics[r.key];
      return [r.room ?? "", r.no ?? "", r.name, r.typedNames.join(" / "), r.emails.join(" / "), m.passed, m.known, m.learning, m.seen, m.due, m.active7, m.seen ? m.guessPct : "", m.partN ? m.partPct : "", ...m.sets.map((x) => (x.rec ? (x.grace ? "ผ่าน (อนุโลม)" : "ผ่าน") : x.early ? "ทำล่วงหน้า (ไม่นับ)" : x.seen ? `เรียน ${x.seen}/${x.n}` : "")), planText(planOf(r.room), behindOf(r)), m.todayN, m.todayR, m.lastAt ? new Date(m.lastAt).toLocaleString("th-TH") : ""];
    });
    downloadCsv(`vocab300-${fileScope}-${today}.csv`, headers, data);
  };
  // สมุดคะแนน: ชุดละ 10 คะแนน (รอบทบทวน ตอบถูกตั้งแต่ครั้งแรก) · * = ผ่านจากแอปแบบเดิม (คิดจากขั้นที่ 4)
  const exportGrades = () => {
    const headers = ["ห้อง", "เลขที่", "ชื่อ-สกุล", ...course.weeks.map((w) => `ชุด ${w.no} (10)`), "ผ่าน (ชุด)", `คะแนนรวม (เต็ม ${course.weeks.length * 10})`, "หมายเหตุ", "อีเมล"];
    const data = sorted.map((r) => {
      const m = metrics[r.key];
      const legacy = m.sets.filter((x) => x.rec?.legacy).map((x) => x.no);
      return [
        r.room ?? "", r.no ?? "", r.name,
        ...m.sets.map((x) => (x.rec ? x.rec.score : x.early ? "ทำล่วงหน้า" : "")),
        m.passed, m.score,
        [
          legacy.length ? `ชุด ${legacy.join(", ")} ผ่านจากแอปแบบเดิม (คะแนนคิดจากขั้นที่ 4)` : "",
          ...m.sets.filter((x) => guardEvents(x.rec) > 0).map((x) => `ชุด ${x.no} ออกจากหน้า ${x.rec!.gl ?? 0} · บังใบหน้า ${x.rec!.gc ?? 0} · มือถือ ${x.rec!.gp ?? 0} ครั้ง${isFlagged(x.rec) ? " 🚩" : ""}`),
          ...m.sets.filter((x) => x.rec?.cm === "nocam" || x.rec?.cm === "camfail").map((x) => `ชุด ${x.no} ${x.rec!.cm === "nocam" ? "ไม่ใช้กล้อง" : "กล้องใช้ไม่ได้"}`),
        ].filter(Boolean).join(" · "),
        r.emails.join(" / "),
      ];
    });
    downloadCsv(`vocab300-grades-${fileScope}-${today}.csv`, headers, data);
  };

  return (
    <div>
      {/* ── การ์ดสรุป ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          [summary.n, `นักเรียนในรายชื่อ ${roomFilter === "ALL" ? `ม.${grade} ทุกห้อง` : `ม.${roomFilter}`}`, "text-[#003399]"],
          [summary.doneToday, "ทำในแอปวันนี้แล้ว", "text-[#003399]"],
          [summary.passedNow, planRoom && planNo ? `ผ่านชุดที่ ${planNo} แล้ว (ชุดของสัปดาห์นี้)` : "ผ่านชุดของสัปดาห์นี้แล้ว (ตามคาบของแต่ละห้อง)", "text-emerald-600"],
          [summary.ready, "เรียนครบ 10 คำ รอทำรอบทบทวน", summary.ready > 0 ? "text-amber-600" : "text-gray-300"],
          [summary.avgPassed.toFixed(1), `ผ่านเฉลี่ย (ชุด/คน จาก ${course.weeks.length})`, "text-[#003399]"],
        ].map(([v, l, cls], i) => (
          <div key={i} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className={`text-3xl font-black tabular-nums ${cls}`}>{v}</div>
            <div className="text-xs text-gray-500 font-bold">{l}</div>
          </div>
        ))}
      </div>

      {spot && <SpotCheck title={`ม.${roomFilter} · คำศัพท์แกน 120 คำ`} picks={spot.picks} total={spot.total} />}

      {/* ── โหมด ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {([
          ["people", "ตารางรายคน"],
          ["grades", "📒 สมุดคะแนน"],
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
            <option value="known">เรียงตามชุดที่ผ่าน (มาก → น้อย)</option>
            <option value="inactive">คนที่ยังไม่ได้ทำวันนี้ขึ้นก่อน</option>
            <option value="behind">คนที่ช้ากว่าแผนขึ้นก่อน</option>
          </select>
        )}
        {mode === "grades" ? (
          <button onClick={exportGrades} className="ml-auto px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl text-sm">⬇ สมุดคะแนน CSV</button>
        ) : (
          <button onClick={exportCsv} className="ml-auto px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl text-sm">⬇ CSV คำศัพท์แกน</button>
        )}
      </div>

      {(mode === "people" || mode === "grades") && (
        <WeekTabs
          items={course.weeks.map((w) => ({ key: w.no, label: `ชุด ${w.no}`, sub: w.label }))}
          sel={setSel}
          setSel={setSetSel}
          summary={
            setSel
              ? (() => {
                  const c = { pass: 0, grace: 0, early: 0, ready: 0, part: 0, none: 0 };
                  for (const r of visible) {
                    const x = metrics[r.key]?.sets[setSel - 1];
                    if (!x) continue;
                    if (x.rec) { c.pass++; if (x.grace) c.grace++; }
                    else if (x.early) c.early++;
                    else if (x.state === "ready") c.ready++;
                    else if (x.seen) c.part++;
                    else c.none++;
                  }
                  return `ชุด ${setSel}: ✓ ผ่าน ${c.pass}${c.grace ? ` (อนุโลม ${c.grace})` : ""} · ⏩ ทำล่วงหน้า ${c.early} · เรียนครบรอรอบทบทวน ${c.ready} · กำลังเรียน ${c.part} · ยังไม่เรียน ${c.none} (จาก ${visible.length} คน)`;
                })()
              : ""
          }
        />
      )}

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
                  <th className="px-2 py-2 font-black whitespace-nowrap">ทวนได้</th>
                  <th className="px-2 py-2 font-black whitespace-nowrap">ตามแผน</th>
                  <th className="px-2 py-2 font-black whitespace-nowrap">วันนี้ (ใหม่ · ทวน)</th>
                  <th className="px-2 py-2 font-black whitespace-nowrap">เดาถูก</th>
                  {shownWeeks.map((w) => (
                    <th key={w.no} className="px-0.5 py-2 font-black min-w-[30px]" title={`ชุดที่ ${w.no} · ${w.title}${w.label ? ` · ${w.label}` : ""}`}>ชุด{w.no}</th>
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
                          <UnlockButton ids={r.ids} keyName="v300" current={r.unlock} max={course.weeks.length} unit="ชุด" />
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
                        <td className={`text-center text-xs font-bold tabular-nums ${m.due > 0 ? "text-gray-600" : "text-gray-300"}`}>{m.due}</td>
                        <td className="text-center text-xs font-black tabular-nums whitespace-nowrap">
                          <PlanCell plan={planOf(r.room)} behind={behindOf(r)} />
                        </td>
                        <td className="text-center text-xs font-bold tabular-nums whitespace-nowrap">
                          {m.todayN + m.todayR + m.passedToday === 0 ? (
                            <span className="text-gray-300">ยังไม่ทำ</span>
                          ) : (
                            <span className={m.passedToday > 0 ? "text-emerald-600" : "text-[#003399]"}>
                              {m.todayN} · {m.todayR}
                              {m.passedToday > 0 ? " ✓ ผ่าน" : ""}
                            </span>
                          )}
                        </td>
                        <td className="text-center text-xs tabular-nums text-gray-600">{m.seen ? `${m.guessPct}%` : "–"}</td>
                        {m.sets.filter((x) => !setSel || x.no === setSel).map((x) => (
                          <td key={x.no} className="text-center px-0.5 py-1 relative" title={setTip(x)}>
                            <GuardMark g={x.rec} />
                            <SetCell x={x} />
                          </td>
                        ))}
                        <td className="px-3 py-1 text-xs text-gray-500 whitespace-nowrap">{m.lastAt ? fmtThaiTime(m.lastAt) : "–"}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 px-4 py-3 leading-relaxed">
            <b>ชุด1–ชุด{course.weeks.length}</b>: <span className="text-emerald-700 font-black">✓ เขียว = ผ่านชุดแล้ว</span> (เรียนครบ 10 คำ + รอบทบทวนถูกครบ) ·
            <span className="text-amber-700 font-black"> R = เรียนครบ 10 คำแล้ว รอทำรอบทบทวน</span> · ตัวเลข = เรียนแล้วกี่คำในชุดนั้น · ชี้ที่ช่องเพื่อดูเวลาที่ผ่านและคะแนน · ↗n = ออกจากหน้า · 📷n = บังใบหน้า (รอบทบทวน) · 🚫 = ไม่ใช้กล้อง · 🚩 = รวม 3 ครั้งขึ้นไป (ควรเรียกมาถาม) · 🔓 = เปิดชุดล่วงหน้าให้รายคน ·
            รู้แล้ว = คำในชุดที่ผ่านแล้ว · ทวนได้ = คำของชุดก่อน ๆ ที่ถึงนัดทวน (ไม่บังคับ ไม่มีผลกับการผ่าน) ·
            ตามแผน = ผ่านครบถึงชุดของสัปดาห์นี้ของห้องนั้นหรือยัง{planRoom && planNo ? ` (ม.${planRoom} วันนี้ควรผ่านถึงชุดที่ ${planNo})` : ""} · วันนี้ = คำใหม่ · ข้อทวน ที่ทำวันนี้ (✓ ผ่าน = ผ่านชุดในวันนี้) ·
            เดาถูก = สัดส่วนที่ขั้น “เดาก่อนรู้” เดาความหมายถูก · หน้านี้อัปเดตเองทันทีที่นักเรียนส่งผล
            <br /><span className="text-orange-700 font-black">⏩</span> = ทำล่วงหน้าก่อนวันเรียนของห้อง ไม่นับ ต้องทำรอบทบทวนใหม่พร้อมกล้อง · <span className="text-emerald-700 font-black">✓<sup>อ</sup></span> = ทำล่วงหน้าแต่ได้รับอนุโลม (ชุด 1–2 นับผ่านตามคะแนนที่ทำ)
          </p>
        </div>
      )}

      {/* ── สมุดคะแนน ── */}
      {mode === "grades" && (
        <div className="bg-white rounded-2xl border border-gray-100 mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#003399] text-white text-[11px]">
                  <th className="sticky left-0 z-10 bg-[#003399] text-left px-3 py-2 font-black min-w-[210px]">นักเรียน</th>
                  {shownWeeks.map((w) => (
                    <th key={w.no} className="px-0.5 py-2 font-black min-w-[34px]" title={`ชุดที่ ${w.no}${w.label ? ` · ${w.label}` : ""} (เต็ม 10)`}>ชุด{w.no}</th>
                  ))}
                  <th className="px-2 py-2 font-black whitespace-nowrap">ผ่าน</th>
                  <th className="px-3 py-2 font-black whitespace-nowrap">รวม / {course.weeks.length * 10}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i, arr) => {
                  const m = metrics[r.key];
                  const showRoom = sortBy === "roster" && roomFilter === "ALL" && r.inRoster && (i === 0 || arr[i - 1].room !== r.room);
                  return (
                    <React.Fragment key={r.key}>
                      {showRoom && <tr><td colSpan={course.weeks.length + 3} className="bg-[#FFD700]/30 text-[#003399] font-black px-3 py-1.5 text-xs">ม.{r.room}</td></tr>}
                      <tr className="border-b border-gray-100 hover:bg-blue-50/40">
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                          <div className="font-bold text-gray-900 truncate max-w-[250px]">
                            {r.no != null && <span className="text-gray-400 font-black mr-1 tabular-nums">{r.no}.</span>}
                            {r.name}
                          </div>
                        </td>
                        {m.sets.filter((x) => !setSel || x.no === setSel).map((x) => (
                          <td key={x.no} className="text-center px-0.5 py-1 relative" title={setTip(x)}>
                            <GuardMark g={x.rec} />
                            {x.grace && <span data-grace="1" className="absolute -top-0.5 left-0 text-[9px] leading-none font-black text-sky-800 bg-sky-100 rounded px-0.5" aria-label="อนุโลม">อ</span>}
                            {x.rec ? (
                              <span className="inline-flex w-8 h-6 rounded-md bg-emerald-500 text-white font-black items-center justify-center text-[11px] tabular-nums">
                                {x.rec.score}{x.rec.legacy ? "*" : ""}
                              </span>
                            ) : x.early ? (
                              <span className="inline-flex w-8 h-6 rounded-md bg-orange-100 text-orange-700 font-black items-center justify-center text-[11px] ring-1 ring-orange-300">⏩</span>
                            ) : (
                              <span className="inline-flex w-8 h-6 rounded-md bg-gray-50 text-gray-300 items-center justify-center text-xs">·</span>
                            )}
                          </td>
                        ))}
                        <td className="text-center px-2 py-1 font-black tabular-nums text-[#003399]">{m.passed}</td>
                        <td className="text-center px-3 py-1 font-black tabular-nums">{m.score}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 px-4 py-3 leading-relaxed">
            คะแนนชุด (เต็ม 10) = จำนวนคำที่ตอบถูกตั้งแต่ครั้งแรกในรอบทบทวน · ช่องเขียว = ผ่านชุดแล้ว · <b>*</b> = ผ่านจากแอปแบบเดิมก่อนมีรอบทบทวน (คะแนนคิดจากสัดส่วนที่ตอบถูกตั้งแต่ครั้งแรกในขั้นที่ 4) ·
            รวม = ผลรวมคะแนนทุกชุด (เต็ม {course.weeks.length * 10}) · กด “⬇ สมุดคะแนน CSV” เพื่อนำไปลงคะแนน
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
                const passedPeople = inRosterVisible.filter((r) => setPassOf(r.prog, wk.no)).length;
                return (
                  <button key={wk.no} onClick={() => setWeekNo(wk.no)} className={`w-full flex items-center gap-2 text-left rounded-lg px-1 ${weekNo === wk.no ? "bg-[#FFD700]/20" : "hover:bg-gray-50"}`}>
                    <span className="w-20 shrink-0 text-xs font-black text-[#003399]" title={wk.label}>ชุด {wk.no}</span>
                    <span className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden relative">
                      <span className="absolute inset-y-0 left-0 bg-[#003399]/30" style={{ width: `${(seen / n) * 100}%` }} />
                      <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${(known / n) * 100}%` }} />
                    </span>
                    <span className="w-48 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-600">เรียน {pct(seen, n)}% · ผ่าน {passedPeople}/{inRosterVisible.length} คน</span>
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

// 9 พ.ย. (ครูสั่ง):
//   early = ผ่านชุดนี้ก่อนวันเรียนของห้อง (ยังไม่ผ่านการเปิดกล้องในคาบ) → ไม่นับ ⏩ · ต้องทำรอบทบทวนใหม่พร้อมกล้อง
//   grace = สัปดาห์ 1–2 ทำล่วงหน้า → อนุโลมนับผ่าน (11 พ.ย.) · ป้าย "อ"
//   R (เรียนครบ 10 คำ ยังไม่ทำรอบทบทวน) = สีเหลือง ไม่นับผ่าน (กลับมาเป็นแบบเดิมตั้งแต่ 11 พ.ย.)
type SetInfo = { no: number; n: number; seen: number; state: ReturnType<typeof setState>; rec?: VSetPass; early?: VSetPass; grace?: boolean };
function rowMetrics(p: VProgress, words: VWord[], today: string, ctx?: { course: VCourse; room: string | null; unlock: number }) {
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
  const sets: SetInfo[] = Array.from({ length: nWeeks }, (_, i) => {
    const no = i + 1;
    const od = ctx ? openDay(ctx.course.weeks[i]?.start, ctx.room, ctx.course.classDays) : null;
    const unlocked = !!ctx && no <= ctx.unlock;
    let rec = setPassOf(p, no);
    let early: VSetPass | undefined;
    if (rec && !rec.prev && !rec.legacy && doneEarly(rec.day, od, unlocked, no)) {
      early = rec;
      rec = undefined;
    }
    const grace = !!rec && !rec.prev && !rec.legacy && doneGraced(rec.day, od, unlocked, no);
    const state = setState(p, words, no);
    return { no, n: words.filter((w) => w.week === no).length, seen: weekSeen[i], state: rec ? state : early ? "ready" : state, rec, early, grace };
  });
  const done = sets.filter((x) => x.rec);
  for (const x of done) lastAt = Math.max(lastAt, x.rec!.at || 0);
  return {
    sets,
    passed: done.length,
    passedToday: done.filter((x) => x.rec!.day === today).length,
    ready: sets.filter((x) => x.state === "ready" && !x.rec).length,
    score: done.reduce((s, x) => s + x.rec!.score, 0),
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

// ── ช่อง “ตามแผน” (นับเป็นชุด) ──
function planText(plan: number | null, behind: number): string {
  return !plan ? "" : behind === 0 ? "ทัน" : `ขาด ${behind} ชุด`;
}
function PlanCell({ plan, behind }: { plan: number | null; behind: number }) {
  if (!plan) return <span className="text-gray-300">–</span>;
  if (behind === 0) return <span className="text-emerald-600">✓ ทัน</span>;
  return <span className={behind > 1 ? "text-rose-600" : "text-amber-700"}>ขาด {behind} ชุด</span>;
}
// ── ช่องรายชุด ──
function setTip(x: SetInfo): string {
  if (x.rec) {
    const when = new Date(x.rec.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `ชุด ${x.no}:${x.grace ? " (อนุโลม · ทำล่วงหน้าก่อนวันเรียน สัปดาห์ 1–2 นับผ่าน)" : ""} ✓ ผ่านเมื่อ ${when} · คะแนน ${x.rec.score}/10${x.rec.legacy ? " (แอปแบบเดิม คิดจากขั้นที่ 4)" : " (รอบทบทวน ถูกตั้งแต่ครั้งแรก)"}${guardTip(x.rec)}`;
  }
  if (x.early) return `ชุด ${x.no}: ⏩ ทำล่วงหน้า (ผ่านเมื่อ ${x.early.day} ก่อนวันเรียนของห้อง · คะแนน ${x.early.score}/10) — ไม่นับ ต้องทำรอบทบทวนใหม่พร้อมกล้อง`;
  if (x.state === "ready") return `ชุด ${x.no}: เรียนครบ ${x.n} คำแล้ว — ยังไม่ได้ทำรอบทบทวน`;
  return x.seen ? `ชุด ${x.no}: เรียนแล้ว ${x.seen}/${x.n} คำ` : `ชุด ${x.no}: ยังไม่เรียน`;
}
function SetCell({ x }: { x: SetInfo }) {
  if (x.rec) return <span {...(x.grace ? { "data-grace": "1" } : {})} className="inline-flex w-7 h-6 rounded-md bg-emerald-500 text-white font-black items-center justify-center text-[11px]">✓{x.grace && <sup className="text-[8px] ml-px opacity-90">อ</sup>}</span>;
  if (x.early) return <span data-early="1" className="inline-flex w-7 h-6 rounded-md bg-orange-100 text-orange-700 font-black items-center justify-center text-[11px] ring-1 ring-orange-300">⏩</span>;
  if (x.state === "ready") return <span className="inline-flex w-7 h-6 rounded-md bg-[#FFD700] text-[#003399] font-black items-center justify-center text-[11px] ring-2 ring-amber-400">R</span>;
  if (x.seen) return <span className="inline-flex w-7 h-6 rounded-md bg-amber-50 text-amber-700 font-black items-center justify-center text-[11px] tabular-nums">{x.seen}</span>;
  return <span className="inline-flex w-7 h-6 rounded-md bg-gray-50 text-gray-300 items-center justify-center text-xs">·</span>;
}
