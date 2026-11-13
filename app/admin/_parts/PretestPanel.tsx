"use client";
// app/admin/_parts/PretestPanel.tsx — 📝 Pre-test ม.4: ผลวินิจฉัยรายห้อง (หน้าครู · 13 พ.ย. 2569)
//   คิดคะแนนใหม่จากคำตอบที่เก็บไว้ทุกครั้ง (แก้เฉลยในไฟล์ข้อมูลแล้วผลปรับตามเอง)
//   1) ห้องนี้อ่อนเรื่องไหน — % ถูกรายหัวข้อย่อย เรียงจากอ่อนสุด พร้อมคำแนะนำการสอน
//   2) รายทักษะ 8 แบบตามข้อสอบจริง · รายระดับ A2/B1/ข้อสอบจริง · ระดับคำศัพท์ 4 ชั้น
//   3) วิเคราะห์รายข้อ (% ถูก · อำนาจจำแนก · ตัวลวงที่ถูกเลือกมาก) ไว้ปรับข้อก่อนทำ Post-test
//   4) ตารางรายคน + กลุ่ม (เสริมเข้ม/เสริม/ต่อยอด) · คัดลอกไลน์ · CSV · ปุ่มให้ทำใหม่รายคน
//   v9.5: กลุ่ม/ผลรายหัวข้อคิดจากส่วนที่ 1 (30 ข้อ) อย่างเดียว · ส่วนที่ 2 คำศัพท์ (16 ข้อ) เป็นข้อมูลเสริม ใครยังไม่ทำขึ้น "ยังไม่ได้ทำคำศัพท์"
import React, { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { serverNow } from "../../lib/sync";
import {
  BANK,
  PRE_ITEMS,
  PRE_VOCAB,
  SKILL_ORDER,
  EFFORT_TH,
  TIER_PASS,
  classStats,
  decodePicks,
  effortOf,
  gradeMain,
  gradeVocab,
  parsePreRec,
  preLineText,
  stageOf,
  vocabStats,
  type Effort,
  type MainResult,
  type PreRec,
  type PreStage,
  type VocabResult,
} from "../../lib/pretest";
import { EXCUSED, ROSTER, downloadCsv, gradeOf, matchRoster, rosterKey } from "../../lib/roster";

export interface PreStudent {
  id: string;
  name?: string;
  pretest4?: unknown;
}
interface PRow {
  key: string;
  room: string;
  no: number;
  name: string;
  entered: boolean;
  excused: string | null;
  ids: string[]; // เอกสารที่มีผล Pre-test (ไว้กดให้ทำใหม่)
  rec: PreRec | null;
  stage: PreStage;
  main: MainResult | null;
  voc: VocabResult | null;
  eff: Effort;
}
const RANK: Record<PreStage, number> = { new: 0, main: 1, vocab: 2, done: 3 };
const L = "ABCD";
const fmt = (ms?: number) => (ms ? new Date(ms + 7 * 3600000).toISOString().replace("T", " ").slice(0, 16) : "");
const STAGE_TH: Record<PreStage, string> = { new: "ยังไม่ทำ", main: "ทำส่วนที่ 1 ค้าง", vocab: "ยังไม่ได้ทำคำศัพท์", done: "ทำครบ" };
const BAND_CLS: Record<string, string> = { S: "bg-sky-100 text-sky-800", M: "bg-amber-100 text-amber-800", H: "bg-emerald-100 text-emerald-800" };
const barCls = (p: number) => (p < 40 ? "bg-rose-500" : p < 60 ? "bg-amber-400" : "bg-emerald-500");
const txtCls = (p: number) => (p < 40 ? "text-rose-700" : p < 60 ? "text-amber-700" : "text-emerald-700");
const LV_TH: Record<string, string> = { A2: "A2 พื้นฐาน", B1: "B1 ระดับ ม.4", EX: "ระดับข้อสอบจริง" };

function Bar({ label, p, sub, attr }: { label: React.ReactNode; p: number; sub?: React.ReactNode; attr?: Record<string, string> }) {
  return (
    <div className="flex items-center gap-2 text-xs" {...attr}>
      <div className="w-44 sm:w-60 shrink-0 font-bold text-gray-700 min-w-0">
        {label}
        {sub && <div className="text-[10px] font-bold text-gray-400">{sub}</div>}
      </div>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full ${barCls(p)}`} style={{ width: `${p}%` }} />
      </div>
      <span className={`w-10 text-right font-black tabular-nums ${txtCls(p)}`}>{p}%</span>
    </div>
  );
}

export function PretestPanel({ students, grade, roomFilter }: { students: PreStudent[]; grade: string; roomFilter: string }) {
  const [open, setOpen] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [excl, setExcl] = useState(true); // ไม่นับผลที่ “ตั้งใจต่ำ” ในค่าเฉลี่ยห้อง/การนับกลุ่ม

  const rows: PRow[] = useMemo(() => {
    if (grade !== "4") return [];
    const byKey = new Map<string, PreStudent[]>();
    for (const s of students) {
      const hit = matchRoster(s.name);
      if (!hit) continue;
      const k = rosterKey(hit);
      byKey.set(k, [...(byKey.get(k) ?? []), s]);
    }
    const out: PRow[] = [];
    for (const r of ROSTER) {
      if (roomFilter === "ALL" ? gradeOf(r.room) !== "4" : r.room !== roomFilter) continue;
      const k = rosterKey(r);
      const docs = byKey.get(k) ?? [];
      // หลายบัญชี: ใช้บัญชีที่ทำไปไกลที่สุด (เท่ากัน = ล่าสุด)
      let rec: PreRec | null = null;
      const ids: string[] = [];
      for (const d of docs) {
        const x = parsePreRec(d);
        if (!x) continue;
        ids.push(d.id);
        if (!x.at0) continue;
        if (!rec || RANK[stageOf(x)] > RANK[stageOf(rec)] || (RANK[stageOf(x)] === RANK[stageOf(rec)] && (x.at ?? x.at0) > (rec.at ?? rec.at0))) rec = x;
      }
      const stage = stageOf(rec);
      out.push({
        key: k,
        room: r.room,
        no: r.no,
        name: r.name,
        entered: docs.length > 0,
        excused: EXCUSED[k] ?? null,
        ids,
        rec,
        stage,
        main: rec?.a ? gradeMain(decodePicks(rec.a, PRE_ITEMS.length)) : null,
        voc: rec?.v ? gradeVocab(decodePicks(rec.v, PRE_VOCAB.length)) : null,
        eff: effortOf(rec),
      });
    }
    return out;
  }, [students, grade, roomFilter]);

  const counted = useMemo(() => rows.filter((r) => !r.excused), [rows]);
  const used = useMemo(() => counted.filter((r) => !(excl && r.eff.level === "low")), [counted, excl]);
  const stats = useMemo(() => classStats(used.filter((r) => r.rec?.a).map((r) => decodePicks(r.rec!.a!, PRE_ITEMS.length))), [used]);
  const vstats = useMemo(() => vocabStats(used.filter((r) => r.rec?.v).map((r) => decodePicks(r.rec!.v!, PRE_VOCAB.length))), [used]);

  if (grade !== "4") return null;

  const done = counted.filter((r) => r.stage === "done").length;
  const noVocab = counted.filter((r) => r.stage === "vocab").length; // ส่งส่วนที่ 1 แล้ว แต่ยังไม่ได้ทำคำศัพท์
  const partial = counted.filter((r) => r.stage === "main").length;
  const none = counted.length - done - partial - noVocab;
  const N = PRE_ITEMS.length;
  const bandRange = (k: number) => {
    const lo = BANK.bands[k].min;
    const hi = k + 1 < BANK.bands.length ? BANK.bands[k + 1].min - 1 : N;
    return `${lo}–${hi}`;
  };
  const nLow = counted.filter((r) => r.eff.level === "low").length;
  const nChk = counted.filter((r) => r.eff.level === "check").length;
  const rooms = Array.from(new Set(rows.map((r) => r.room))).sort();
  const scope = roomFilter === "ALL" ? "ม.4 ทุกห้อง" : `ม.${roomFilter}`;
  const exTotal = PRE_ITEMS.filter((i) => i.lv === "EX").length;

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

  async function doReset(r: PRow) {
    if (!db || !r.ids.length) return;
    const fs = db;
    try {
      const t = serverNow();
      await Promise.all(r.ids.map((id) => updateDoc(doc(fs, "students", id), { pretest4: { r: t } })));
      setResetMsg(`✓ ${r.name} ทำ Pre-test ใหม่ได้แล้ว (ให้นักเรียนเปิดห้อง Pre-test อีกครั้ง)`);
    } catch (e) {
      setResetMsg(`ทำไม่สำเร็จ: ${String((e as Error)?.message || e)}`);
    }
    setResetKey(null);
  }

  function csv() {
    const subKeys = Object.keys(BANK.subs);
    const head = [
      "ห้อง", "เลขที่", "ชื่อ", "สถานะ", `คะแนน/${N}`, "กลุ่ม", `ระดับข้อสอบจริง/${exTotal}`, "คำศัพท์ในบริบท (ถูก/ข้อ)",
      ...Object.values(BANK.areas).map((a) => `${a} %`),
      ...SKILL_ORDER.map((s) => `${BANK.skills[s]} (ถูก/ข้อ)`),
      ...subKeys.map((k) => BANK.subs[k].th),
      `คำศัพท์/${PRE_VOCAB.length}`, "ระดับ1/4", "ระดับ2/4", "ระดับ3/4", "ระดับ4/4", "เริ่มคำศัพท์ระดับ",
      "ความตั้งใจ", "เหตุผล", "ตอบเร็ว %", "เวลารวม(วินาที)", "ออกจากหน้า", "บังหน้า", "มือถือ", "เตือนตอบเร็ว", "หมดเวลา", "กล้อง", "เริ่ม", "ส่ง", "นาที",
      ...PRE_ITEMS.map((i) => `ข้อ${i.n}`),
    ];
    const data = counted.map((r) => {
      const m = r.main;
      const g = r.rec?.g;
      const a = r.rec?.a ? decodePicks(r.rec.a, PRE_ITEMS.length) : [];
      return [
        r.room, r.no, r.name, r.excused ? "ลา/ขาด" : STAGE_TH[r.stage], m ? m.score : "", m ? m.band.th : "", m ? m.ex : "", m ? `${m.vc.c}/${m.vc.t}` : "",
        ...(["conv", "gram", "read"] as const).map((k) => (m ? Math.round((m.byArea[k].c / m.byArea[k].t) * 100) : "")),
        ...SKILL_ORDER.map((s) => (m ? `${m.bySk[s].c}/${m.bySk[s].t}` : "")),
        ...subKeys.map((k) => (m ? `${m.bySub[k].c}/${m.bySub[k].t}` : "")),
        r.voc ? r.voc.score : "", ...[0, 1, 2, 3].map((k) => (r.voc ? r.voc.tiers[k] : "")), r.voc ? (r.voc.start >= 5 ? "ผ่านครบ" : r.voc.start) : "",
        r.eff.level === "na" ? "" : EFFORT_TH[r.eff.level], r.eff.reasons.join(" / "), r.eff.level === "na" ? "" : r.eff.rapidPct, r.eff.totalSec || "",
        g?.lv ?? "", g?.cv ?? "", g?.ph ?? "", g?.nd ?? "", r.rec?.to ? "ส่วน1" : "", g?.cm ?? "", fmt(r.rec?.at0), fmt(r.rec?.at), r.rec?.ms ? Math.round(r.rec.ms / 60000) : "",
        ...PRE_ITEMS.map((it, i) => (r.rec?.a ? (a[i] === null ? "-" : `${L[a[i]!]}${a[i] === it.a ? "✓" : ""}`) : "")),
      ];
    });
    downloadCsv(`Pretest_M4_${scope.replace(/[ .]/g, "")}.csv`, head, data);
  }

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-pre-panel>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className="font-black text-gray-800">📝 Pre-test ม.4</span>
        <span className="text-xs font-bold text-gray-500" data-pre-head>
          {scope}: ทำครบ {done} · ยังไม่ได้ทำคำศัพท์ {noVocab} · ทำค้าง {partial} · ยังไม่ทำ {none} จาก {counted.length} คน
          {stats.n > 0 ? ` · เฉลี่ย ${stats.avg}/${N}` : ""}
          {nLow + nChk > 0 ? ` · ผลน่าสงสัย ${nLow + nChk} คน` : ""}
        </span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-5">
          <p className="text-[11px] font-bold text-gray-500">
            ไม่นับคะแนนเก็บ · ผลรายทักษะ/หัวข้อใช้ดู “ทั้งห้อง” (หัวข้อละ 1–3 ข้อ ยังไม่ควรตัดสินรายคน) · คะแนนคิดใหม่จากคำตอบทุกครั้ง แก้เฉลยแล้วผลปรับเอง · กลุ่มคิดจากส่วนที่ 1 อย่างเดียว: เสริมเข้ม &lt;30% ({bandRange(0)}) · เสริม 30–50% ({bandRange(1)}) · ต่อยอด &gt;50% ({bandRange(2)}) · ลำดับข้อสลับรายคน · ส่วนที่ 2 คำศัพท์เป็นข้อมูลเสริม
          </p>
          <div className="rounded-xl border-2 border-sky-100 bg-sky-50/60 p-3 text-xs font-bold text-sky-900" data-pre-effort-box>
            <p>
              🎯 ความตั้งใจในการทำ: ตั้งใจต่ำ <b data-pre-nlow>{nLow}</b> คน · ควรตรวจ <b data-pre-nchk>{nChk}</b> คน (จากเวลาต่อข้อ รูปแบบช่องที่เลือก และข้อที่ไม่ตอบ — คิดใหม่จากข้อมูลทุกครั้ง)
            </p>
            <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={excl} onChange={(e) => setExcl(e.target.checked)} data-pre-excl />
              ไม่นับผล “ตั้งใจต่ำ” ในค่าเฉลี่ยห้อง/การนับกลุ่ม/ระดับคำศัพท์ (ยังเห็นในตารางรายคน)
            </label>
          </div>
          {stats.n === 0 ? (
            <p className="text-sm font-bold text-gray-500" data-pre-empty>
              ยังไม่มีใครส่งส่วนที่ 1 ใน{scope}
            </p>
          ) : (
            <>
              {/* สรุป */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2" data-pre-summary>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[10px] font-black text-gray-500">คะแนนเฉลี่ย ({stats.n} คน)</p>
                  <p className="text-xl font-black text-gray-900 tabular-nums">{stats.avg}<span className="text-xs text-gray-400">/{N}</span></p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[10px] font-black text-gray-500">ระดับข้อสอบจริง (เฉลี่ย)</p>
                  <p className="text-xl font-black text-gray-900 tabular-nums">{stats.exAvg}<span className="text-xs text-gray-400">/{exTotal}</span></p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3" data-pre-vc>
                  <p className="text-[10px] font-black text-gray-500">คำศัพท์ในบริบท</p>
                  <p className={`text-xl font-black tabular-nums ${txtCls(stats.vc)}`}>{stats.vc}<span className="text-xs text-gray-400">%</span></p>
                </div>
                {[...BANK.bands].reverse().map((b) => (
                  <div key={b.id} className={`rounded-xl p-3 ${BAND_CLS[b.id]}`} data-pre-bandcount={b.id}>
                    <p className="text-[10px] font-black">{b.th} ({b.rule})</p>
                    <p className="text-xl font-black tabular-nums">{stats.bands[b.id]} <span className="text-xs">คน</span></p>
                  </div>
                ))}
              </div>

              {/* อ่อนเรื่องไหน */}
              <div>
                <p className="font-black text-[#003399] mb-1">🔎 {scope} อ่อนเรื่องไหน (เรียงจากอ่อนสุด)</p>
                <p className="text-[11px] font-bold text-gray-500 mb-2">แดง &lt;40% = ควรสอนก่อน · เหลือง 40–59% = เสริม · เขียว ≥60% = พอใช้ · คำแนะนำแสดงเฉพาะหัวข้อที่ต่ำกว่า 60%</p>
                <div className="space-y-2" data-pre-subs>
                  {stats.bySub.map((s) => {
                    const sub = BANK.subs[s.sub];
                    const nums = PRE_ITEMS.filter((i) => i.sub === s.sub).map((i) => i.n);
                    return (
                      <div key={s.sub} data-pre-sub={s.sub} data-pct={s.pct}>
                        <Bar label={sub.th} sub={`${BANK.areas[sub.area]} · ข้อ ${nums.join(", ")}`} p={s.pct} />
                        {s.pct < 60 && <p className="ml-0 sm:ml-[15.5rem] mt-0.5 text-[11px] font-bold text-gray-600">💡 {sub.tip}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ทักษะ / ระดับ */}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <p className="font-black text-[#003399] mb-2">ราย 8 ทักษะตามข้อสอบจริง</p>
                  <div className="space-y-1.5" data-pre-skills>
                    {(["conv", "gram", "read"] as const).map((a) => (
                      <Bar key={a} label={<b className="text-gray-900">{BANK.areas[a]}</b>} p={stats.byArea[a] ?? 0} attr={{ "data-pre-area": a }} />
                    ))}
                    <div className="border-t border-gray-100 my-1" />
                    {SKILL_ORDER.map((s) => (
                      <Bar key={s} label={BANK.skills[s]} sub={`${PRE_ITEMS.filter((i) => i.sk === s).length} ข้อ`} p={stats.bySk[s] ?? 0} attr={{ "data-pre-skill": s }} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-black text-[#003399] mb-2">ตามระดับความยาก</p>
                  <div className="space-y-1.5">
                    {(["A2", "B1", "EX"] as const).map((lv) => (
                      <Bar key={lv} label={LV_TH[lv]} sub={`${PRE_ITEMS.filter((i) => i.lv === lv).length} ข้อ`} p={stats.byLv[lv] ?? 0} attr={{ "data-pre-lv": lv }} />
                    ))}
                  </div>
                  <p className="font-black text-[#003399] mt-4 mb-2">ระดับคำศัพท์ (ส่วนที่ 2 · ทำแล้ว {vstats.n} จาก {stats.n} คน · ผ่าน = ถูก {TIER_PASS}/4 ขึ้นไป)</p>
                  <div className="space-y-1.5" data-pre-tiers>
                    {[0, 1, 2, 3].map((k) => (
                      <Bar key={k} label={`ระดับ ${k + 1} · ${BANK.tiers[String(k + 1)].th}`} p={vstats.tierPass[k]} attr={{ "data-pre-tier": String(k + 1) }} />
                    ))}
                  </div>
                  <p className="text-[11px] font-bold text-gray-600 mt-2">
                    ควรเริ่มชุดคำศัพท์จาก: {[1, 2, 3, 4].map((t) => `ระดับ ${t} = ${vstats.start[t]} คน`).join(" · ")} · ผ่านครบ = {vstats.start[5]} คน
                  </p>
                </div>
              </div>

              {/* วิเคราะห์รายข้อ */}
              <div>
                <button type="button" onClick={() => setShowItems((s) => !s)} className="font-black text-[#003399] text-sm underline" data-pre-itemsbtn>
                  {showItems ? "▲ ซ่อนวิเคราะห์รายข้อ" : "▼ วิเคราะห์รายข้อ (ใช้ปรับข้อสอบก่อนทำ Post-test)"}
                </button>
                {showItems && (
                  <div className="overflow-x-auto mt-2">
                    <p className="text-[11px] font-bold text-gray-500 mb-1">
                      % ถูก: &gt;90 ง่ายไป · &lt;20 ยากไป/เฉลยอาจผิด · D = อำนาจจำแนก (กลุ่มสูง 27% − กลุ่มต่ำ 27%, ต้องมี 10 คนขึ้นไป) ต่ำกว่า 0.20 ควรปรับ · ช่องเขียว = เฉลย · ตัวหนาแดง = ตัวลวงที่ถูกเลือกมากสุด
                    </p>
                    <table className="w-full text-[11px] border-collapse min-w-[640px]" data-pre-items>
                      <thead>
                        <tr className="text-[10px] text-gray-500">
                          <th className="text-right pr-2">ข้อ</th>
                          <th className="text-left">ทักษะ / หัวข้อ</th>
                          <th>ระดับ</th>
                          <th>% ถูก</th>
                          <th>D</th>
                          {[0, 1, 2, 3].map((k) => (
                            <th key={k}>{L[k]}</th>
                          ))}
                          <th>ว่าง</th>
                          <th className="text-left">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.items.map((s, i) => {
                          const it = PRE_ITEMS[i];
                          const note = s.p > 90 ? "ง่ายไป" : s.p < 20 ? "ยากไป/ตรวจเฉลย" : s.d !== null && s.d < 0.2 ? "จำแนกต่ำ" : "";
                          return (
                            <tr key={s.id} className="border-t border-gray-100" data-pre-item={s.n} data-p={s.p}>
                              <td className="text-right pr-2 font-black">{s.n}</td>
                              <td className="py-1">
                                <span className="font-bold text-gray-700">{BANK.skills[it.sk]}</span>
                                <span className="text-gray-400"> · {BANK.subs[it.sub].th}</span>
                              </td>
                              <td className="text-center">{it.lv === "EX" ? "จริง" : it.lv}</td>
                              <td className={`text-center font-black tabular-nums ${txtCls(s.p)}`}>{s.p}</td>
                              <td className="text-center tabular-nums">{s.d === null ? "–" : s.d.toFixed(2)}</td>
                              {s.dist.map((p, k) => (
                                <td key={k} className={`text-center tabular-nums ${k === it.a ? "bg-emerald-50 text-emerald-800 font-black" : k === s.top && p > 0 ? "text-rose-700 font-black" : "text-gray-500"}`} title={it.o[k]}>
                                  {p}
                                </td>
                              ))}
                              <td className="text-center text-gray-400 tabular-nums">{s.blank}</td>
                              <td className="text-rose-700 font-bold">{note}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={csv} data-pre-csv className="px-3 py-1.5 rounded-xl border-2 border-gray-200 text-xs font-black text-gray-700 hover:border-[#003399]/50">
              ⬇️ ดาวน์โหลด CSV ({scope} · รายคน รายหัวข้อ รายข้อ)
            </button>
          </div>
          {resetMsg && (
            <p className="text-xs font-bold text-[#003399]" data-pre-resetmsg>
              {resetMsg}
            </p>
          )}

          {/* รายห้อง */}
          {rooms.map((room) => {
            const rr = rows.filter((r) => r.room === room);
            const cnt = rr.filter((r) => !r.excused);
            const lineRows = cnt.map((r) => ({ no: r.no, name: r.name, band: r.main?.band.id ?? null, stage: r.stage, eff: r.eff.level }));
            return (
              <div key={room} className="rounded-xl border-2 border-gray-100 p-3" data-pre-room={room}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-black text-[#003399]">ม.{room}</span>
                  <span className="text-xs font-bold text-gray-500">
                    ทำครบ {cnt.filter((r) => r.stage === "done").length} จาก {cnt.length} คน
                    {cnt.some((r) => r.stage === "vocab") ? ` · ยังไม่ได้ทำคำศัพท์ ${cnt.filter((r) => r.stage === "vocab").length}` : ""}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => copy(`${room}:g`, preLineText(room, lineRows, "groups", true))} data-pre-copy="groups" className="px-2.5 py-1 rounded-lg bg-[#003399] text-white text-[11px] font-black">
                      {copied === `${room}:g` ? "คัดลอกแล้ว ✓" : "📋 ไลน์: รายชื่อตามกลุ่ม"}
                    </button>
                    <button type="button" onClick={() => copy(`${room}:r`, preLineText(room, lineRows, "recheck", true))} data-pre-copy="recheck" className="px-2.5 py-1 rounded-lg border-2 border-sky-200 text-sky-800 text-[11px] font-black">
                      {copied === `${room}:r` ? "คัดลอกแล้ว ✓" : "📋 ไลน์: ควรทำซ้ำ/คุยด้วย"}
                    </button>
                    <button type="button" onClick={() => copy(`${room}:m`, preLineText(room, lineRows, "missing", false))} data-pre-copy="missing" className="px-2.5 py-1 rounded-lg border-2 border-gray-200 text-gray-700 text-[11px] font-black">
                      {copied === `${room}:m` ? "คัดลอกแล้ว ✓" : "📋 ไลน์: ยังไม่ทำ"}
                    </button>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse min-w-[820px]">
                    <thead>
                      <tr className="text-[10px] text-gray-500">
                        <th className="text-right w-8 pr-2 font-black">ที่</th>
                        <th className="text-left font-black">ชื่อ</th>
                        <th className="font-black">คะแนน</th>
                        <th className="font-black">กลุ่ม</th>
                        <th className="font-black" title="ถูกกี่ข้อในระดับข้อสอบจริง">จริง</th>
                        <th className="font-black">สนทนา</th>
                        <th className="font-black">ไวยากรณ์</th>
                        <th className="font-black">อ่าน</th>
                        <th className="font-black" title="ควรเริ่มคำศัพท์ระดับ">คำศัพท์</th>
                        <th className="font-black" title="ความตั้งใจ (เวลาต่อข้อ/รูปแบบคำตอบ/ข้อที่ไม่ตอบ)">ตั้งใจ</th>
                        <th className="font-black text-left">ระบบเฝ้าดู</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cnt.map((r) => {
                        const m = r.main;
                        const ap = (k: "conv" | "gram" | "read") => (m ? Math.round((m.byArea[k].c / m.byArea[k].t) * 100) : null);
                        const g = r.rec?.g;
                        const flags = [g?.lv ? `↗${g.lv}` : "", g?.cv ? `📷${g.cv}` : "", g?.ph ? `📱${g.ph}` : "", g?.cm && g.cm !== "cam" ? "🚫กล้อง" : "", r.rec?.to ? "⏱หมดเวลา" : ""].filter(Boolean).join(" ");
                        const flagged = (g?.lv ?? 0) + (g?.cv ?? 0) + (g?.ph ?? 0) >= 3;
                        return (
                          <tr key={r.key} className="border-t border-gray-100" data-pre-row={r.key} data-stage={r.stage} data-score={m?.score ?? ""}>
                            <td className="text-right pr-2 font-black text-gray-500">{r.no}</td>
                            <td className="py-1 font-black text-gray-800">
                              {r.name}
                              {!r.entered && <span className="ml-1.5 text-[10px] font-black text-rose-600 bg-rose-50 rounded px-1">ยังไม่เคยเข้าระบบ</span>}
                              {r.entered && r.stage !== "done" && <span className="ml-1.5 text-[10px] font-black text-gray-500 bg-gray-100 rounded px-1">{STAGE_TH[r.stage]}</span>}
                            </td>
                            <td className="text-center font-black tabular-nums">{m ? `${m.score}/${N}` : "–"}</td>
                            <td className="text-center">{m ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${BAND_CLS[m.band.id]}`}>{m.band.th}</span> : "–"}</td>
                            <td className="text-center tabular-nums">{m ? `${m.ex}/${exTotal}` : "–"}</td>
                            {(["conv", "gram", "read"] as const).map((k) => {
                              const p = ap(k);
                              return (
                                <td key={k} className={`text-center font-black tabular-nums ${p === null ? "text-gray-300" : txtCls(p)}`}>
                                  {p === null ? "–" : `${p}%`}
                                </td>
                              );
                            })}
                            <td className="text-center tabular-nums" title={r.voc ? `ระดับ 1–4: ${r.voc.tiers.join("/")} (จาก 4)` : r.stage === "vocab" ? "ส่งส่วนที่ 1 แล้ว แต่ยังไม่ได้ทำคำศัพท์" : ""}>
                              {r.voc ? (r.voc.start >= 5 ? "ครบ" : `เริ่ม ${r.voc.start}`) : r.stage === "vocab" ? <span className="text-[10px] font-black text-amber-700" data-pre-novocab>ยังไม่ได้ทำ</span> : "–"}
                            </td>
                            <td className="text-center" data-pre-eff={r.eff.level} title={r.eff.reasons.join(" · ")}>
                              {r.eff.level === "na" ? <span className="text-gray-300">–</span> : <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${r.eff.level === "low" ? "bg-rose-100 text-rose-700" : r.eff.level === "check" ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{r.eff.level === "ok" ? "✓" : EFFORT_TH[r.eff.level]}</span>}
                              {r.eff.level === "low" || r.eff.level === "check" ? <div className="text-[9px] font-bold text-gray-500 max-w-[150px] mx-auto leading-tight">{r.eff.reasons.join(" · ")}</div> : null}
                            </td>
                            <td className={`text-[11px] ${flagged ? "text-rose-700 font-black" : "text-gray-500"}`}>
                              {flagged ? "🚩 " : ""}
                              {flags}
                            </td>
                            <td className="text-right whitespace-nowrap">
                              {r.ids.length > 0 &&
                                (resetKey === r.key ? (
                                  <span className="inline-flex gap-1">
                                    <button type="button" onClick={() => doReset(r)} data-pre-reset-yes className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">
                                      ล้างผล ให้ทำใหม่
                                    </button>
                                    <button type="button" onClick={() => setResetKey(null)} className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-black">
                                      ยกเลิก
                                    </button>
                                  </span>
                                ) : (
                                  <button type="button" onClick={() => setResetKey(r.key)} data-pre-reset className="text-[10px] font-bold text-gray-400 underline">
                                    ให้ทำใหม่
                                  </button>
                                ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rr.some((r) => r.excused) && <p className="mt-2 text-[10px] font-bold text-gray-400">ไม่นับ (ลา/ขาด): {rr.filter((r) => r.excused).map((r) => `${r.no} ${r.name}`).join(" · ")}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
