"use client";
// app/admin/_parts/AdminTools.tsx
// ─────────────────────────────────────────────────────────────
// เครื่องมือหน้าครูที่ใช้ร่วมกันทั้งแท็บ 📚 และ 🧩
//   • GuardMark / guardTip — ผลระบบกัน AI ของรอบที่เข้าสมุดคะแนน (🚩 = รวม 3 ครั้งขึ้นไป · ↗n = ออกจากหน้า · 📷n = บังใบหน้า · 🚫 = ไม่ใช้กล้อง)
//   • UnlockButton — เปิดบท/ชุดล่วงหน้าให้นักเรียนรายคน (เช่น ลาไปแข่งขันวันที่ห้องเรียน)
//   • LegacyPanel — ข้อมูลแอปเทอม 1 ที่ค้างอยู่ (ทำให้ที่เก็บข้อมูลของนักเรียนเต็ม) → สำรองแล้วล้าง
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { db } from "../../lib/firebase";
import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { GUARD_FLAG_AT, fmtAway } from "../../lib/guard";

// ── ระบบกัน AI + กล้องกันกล้องซ้อน ──
//   gl = ออกจากหน้า/หน้าต่างบัง · gc = มีอะไรบังใบหน้า (กล้อง) · cm = ใช้กล้องหรือไม่ · pm = ผ่านด้วยรอบแบบไหน
export interface GuardInfo {
  gl?: number; ga?: number; gb?: number; gv?: number; gm?: "log" | "enforce";
  cm?: "cam" | "nocam" | "camfail"; gc?: number; gca?: number; gt?: number; pm?: "cam" | "nocam" | "camfail";
}
export const CM_TH: Record<string, string> = { cam: "📷 ใช้กล้อง", nocam: "🚫 ไม่ใช้กล้อง", camfail: "⚠️ เลือกกล้องแต่กล้องใช้ไม่ได้" };
export const guardEvents = (g?: GuardInfo | null) => (g?.gl ?? 0) + (g?.gc ?? 0);
export const isFlagged = (g?: GuardInfo | null) => !!g && guardEvents(g) >= GUARD_FLAG_AT;
export function guardTip(g?: GuardInfo | null): string {
  if (!g || (g.gl === undefined && g.gb === undefined && g.cm === undefined)) return "";
  const parts = [`ออกจากหน้า ${g.gl ?? 0} ครั้ง (รวม ${fmtAway(g.ga)})`];
  if (g.cm) parts.push(CM_TH[g.cm]);
  if (g.cm === "cam") parts.push(`มีอะไรบังใบหน้า ${g.gc ?? 0} ครั้ง${g.gca ? ` (รวม ${fmtAway(g.gca)})` : ""}`);
  if (g.cm && g.cm !== "cam") parts.push(`หมดเวลา ${g.gt ?? 0} ข้อ`);
  if (g.gb) parts.push(`เสียโฟกัสสั้น ๆ ${g.gb} ครั้ง`);
  if (g.gm === "enforce") parts.push(`ถูกข้าม/ไม่นับ ${g.gv ?? 0} ข้อ`);
  else if (g.gm) parts.push("ช่วงทดลอง ไม่หักคะแนน");
  return `\n${isFlagged(g) ? "🚩 " : ""}รอบแรก: ${parts.join(" · ")}${g.pm ? `\nผ่านด้วยรอบ: ${CM_TH[g.pm]}` : ""}`;
}
// สัญลักษณ์มุมซ้ายบนของช่อง: 🚩 = รวม 3 ครั้งขึ้นไป · 📷n = ถูกบังหน้า n ครั้ง · ↗n = ออกจากหน้า n ครั้ง · 🚫 = ไม่ใช้กล้อง
export function GuardMark({ g }: { g?: GuardInfo | null }) {
  if (!g) return null;
  const ev = guardEvents(g);
  if (ev === 0) {
    return g.cm === "nocam" || g.cm === "camfail" ? (
      <span className="absolute -top-1 left-0 text-[8px]" aria-label={CM_TH[g.cm]}>{g.cm === "nocam" ? "🚫" : "⚠️"}</span>
    ) : null;
  }
  if (isFlagged(g)) return <span className="absolute -top-0.5 left-0 text-[10px]" aria-label="ออกจากหน้า/บังหน้าบ่อย">🚩</span>;
  return (g.gc ?? 0) > 0 ? (
    <span className="absolute -top-1 left-0 text-[9px] font-black text-rose-600" aria-label={`บังใบหน้า ${g.gc} ครั้ง`}>📷{g.gc}</span>
  ) : (
    <span className="absolute -top-1 left-0 text-[9px] font-black text-orange-600" aria-label={`ออกจากหน้า ${g.gl} ครั้ง`}>↗{g.gl}</span>
  );
}

// ── เปิดล่วงหน้ารายคน ──
export function UnlockButton({ ids, keyName, current, max, unit }: { ids: string[]; keyName: string; current: number; max: number; unit: string }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current || 1);
  const [state, setState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  if (!ids.length) return null;
  const save = async (n: number) => {
    setState("saving");
    try {
      await Promise.all(ids.map((id) => setDoc(doc(db, "students", id), { unlock: { [keyName]: n } }, { merge: true })));
      setState("ok");
      setOpen(false);
    } catch (e) {
      console.error("unlock failed:", e);
      setState("err");
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] font-bold">
      {current > 0 && !open && <span className="text-violet-700 bg-violet-50 rounded-full px-1.5">🔓 เปิดล่วงหน้าถึง{unit} {current}</span>}
      {!open ? (
        <button type="button" onClick={() => { setVal(current || 1); setOpen(true); setState("idle"); }} className="text-[#003399]/60 hover:text-[#003399] underline" title={`เปิด${unit}ล่วงหน้าให้นักเรียนคนนี้ (เช่น ลาไปแข่งขันวันที่ห้องเรียน)`}>
          {current > 0 ? "แก้" : `🔓 เปิด${unit}ล่วงหน้า`}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 bg-violet-50 rounded-lg px-1.5 py-0.5">
          เปิดถึง{unit}
          <select value={val} onChange={(e) => setVal(Number(e.target.value))} className="border border-violet-200 rounded px-1 bg-white">
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" disabled={state === "saving"} onClick={() => save(val)} className="px-1.5 py-0.5 bg-violet-600 text-white rounded">บันทึก</button>
          {current > 0 && <button type="button" disabled={state === "saving"} onClick={() => save(0)} className="px-1.5 py-0.5 bg-white border border-violet-200 rounded">ยกเลิกที่เปิดไว้</button>}
          <button type="button" onClick={() => setOpen(false)} className="px-1 text-gray-500">✕</button>
        </span>
      )}
      {state === "saving" && <span className="text-gray-500">⏳</span>}
      {state === "ok" && <span className="text-emerald-600">✓ บันทึกแล้ว (นักเรียนเปิดห้องใหม่จึงเห็น)</span>}
      {state === "err" && <span className="text-rose-600">บันทึกไม่สำเร็จ ลองใหม่</span>}
    </span>
  );
}

// ── ข้อมูลแอปเทอม 1 (แอปเดิมก่อน 14–17 ต.ค. 2569) — แอปปัจจุบันไม่ได้ใช้แล้ว ──
export const LEGACY_FIELDS = [
  "srs", "history", "reading", "readingLeaves", "conversation", "masteredPassages", "completedPassages", "weeklyReading",
  "mastered", "learning", "seen", "total", "percent", "answered", "lastDeltaPercent", "lastDeltaAnswered", "lastActiveAt",
  "score", "bestScore", "lastScore", "weeklyXp", "weekId", "streak", "bestStreak", "lastStudyDate", "todayCount", "dailyGoal", "points",
] as const;
type RawDoc = { id: string } & Record<string, unknown>;
export function legacyOf(d: RawDoc): { keys: string[]; words: number } {
  const keys = LEGACY_FIELDS.filter((k) => d[k] !== undefined);
  const srs = d.srs && typeof d.srs === "object" ? Object.keys(d.srs as object).length : 0;
  return { keys, words: srs };
}
// คำในข้อมูลเก่าตั้งแต่เท่านี้ขึ้นไป → เสี่ยงที่เก็บเต็ม (ราว 2,000 คำ = เต็มเพดาน)
export const LEGACY_RISK_WORDS = 1200;

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LegacyPanel({ students }: { students: RawDoc[] }) {
  const list = useMemo(() => students.map((d) => ({ d, ...legacyOf(d) })).filter((x) => x.keys.length > 0), [students]);
  const [open, setOpen] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [prog, setProg] = useState<{ done: number; fail: number; total: number } | null>(null);
  if (!list.length && !prog) return null;
  const risky = list.filter((x) => x.words >= LEGACY_RISK_WORDS).length;
  const words = list.reduce((s, x) => s + x.words, 0);

  const backup = () => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const x of list) {
      const o: Record<string, unknown> = { name: x.d.name, email: x.d.email };
      for (const k of x.keys) o[k] = x.d[k];
      out[x.d.id] = o;
    }
    download(`vocab-term1-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ savedAt: new Date().toISOString(), count: list.length, students: out }), "application/json");
    setBackedUp(true);
  };
  const clean = async () => {
    setConfirm(false);
    const todo = list.slice();
    setProg({ done: 0, fail: 0, total: todo.length });
    let done = 0, fail = 0;
    for (const x of todo) {
      try {
        await updateDoc(doc(db, "students", x.d.id), Object.fromEntries(x.keys.map((k) => [k, deleteField()])));
        done++;
      } catch (e) {
        console.error("clean legacy failed:", x.d.id, e);
        fail++;
      }
      setProg({ done, fail, total: todo.length });
    }
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-amber-200 p-4 mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black text-amber-900">🧹 ข้อมูลแอปเทอม 1 ค้างอยู่ {list.length} บัญชี</span>
        <span className="text-xs font-bold text-amber-800">
          (รวม {words.toLocaleString()} คำ{risky > 0 ? ` · เสี่ยงที่เก็บเต็ม ${risky} บัญชี` : ""})
        </span>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-xs font-bold text-[#003399] underline">{open ? "ซ่อน" : "ดู / ล้างข้อมูล"}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-600 leading-relaxed">
            เป็นข้อมูลของแอปเวอร์ชันเทอม 1 (คลัง 3,467 คำ) ซึ่งแอปปัจจุบันไม่ได้ใช้แล้ว แต่ทำให้ที่เก็บข้อมูลของนักเรียนบางคนเต็ม จนส่งผลไม่ขึ้นระบบ ·
            ล้างแล้ว <b>ผลของภาคเรียนนี้ (📚 · 🧩) ไม่ถูกแตะต้อง</b> · หน้าครูและหน้านักเรียนโหลดเร็วขึ้น
          </p>
          <div className="max-h-40 overflow-auto border border-gray-100 rounded-xl text-xs">
            {list
              .slice()
              .sort((a, b) => b.words - a.words)
              .map((x) => (
                <div key={x.d.id} className="flex gap-2 px-3 py-1 border-b border-gray-50 last:border-0">
                  <span className="flex-1 truncate">{String(x.d.name || x.d.email || x.d.id)}</span>
                  <span className={`tabular-nums font-bold ${x.words >= LEGACY_RISK_WORDS ? "text-rose-600" : "text-gray-500"}`}>{x.words.toLocaleString()} คำ</span>
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" onClick={backup} className="px-3 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl text-sm">① ⬇ ดาวน์โหลดไฟล์สำรอง (.json)</button>
            {!confirm ? (
              <button type="button" disabled={!backedUp || !!prog} onClick={() => setConfirm(true)} className="px-3 py-2 bg-amber-500 text-white font-black rounded-xl text-sm disabled:opacity-40">
                ② ล้างข้อมูลเทอม 1 ออกจากระบบ
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span className="text-rose-700">ยืนยันล้าง {list.length} บัญชี? (ย้อนกลับไม่ได้ ใช้ไฟล์สำรองแทน)</span>
                <button type="button" onClick={clean} className="px-3 py-1.5 bg-rose-600 text-white rounded-lg">ยืนยันล้าง</button>
                <button type="button" onClick={() => setConfirm(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg">ยกเลิก</button>
              </span>
            )}
            {!backedUp && <span className="text-[11px] text-gray-500">ต้องดาวน์โหลดไฟล์สำรองก่อน จึงกดล้างได้</span>}
          </div>
          {prog && (
            <p className={`text-sm font-bold ${prog.fail ? "text-rose-700" : "text-emerald-700"}`}>
              {prog.done + prog.fail < prog.total ? `⏳ กำลังล้าง ${prog.done + prog.fail}/${prog.total}…` : `✓ ล้างแล้ว ${prog.done} บัญชี${prog.fail ? ` · ไม่สำเร็จ ${prog.fail} บัญชี (กดล้างอีกครั้ง)` : ""}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── สุ่มตรวจคาบนี้ (ครูเรียกถามปากเปล่า 3 คำ · คนละไม่ถึง 1 นาที) ──
//   ให้น้ำหนัก: 🚩 +3 · ⚡ ทำเร็วผิดปกติ +2 · ไม่ใช้กล้อง/กล้องใช้ไม่ได้ +1 · คะแนนรอบแรก ≥ 90% +1 · หมดเวลาบ่อย +1 · ที่เหลือสุ่ม (คงที่ทั้งวัน)
export interface SpotCand { key: string; name: string; reasons: string[]; weight: number }
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
export function pickSpot(cands: SpotCand[], seed: string, n = 3): SpotCand[] {
  return cands
    .map((c) => ({ c, r: c.weight + hash(seed + c.key) }))
    .sort((a, b) => b.r - a.r)
    .slice(0, n)
    .map((x) => x.c);
}
export function SpotCheck({ title, picks, total }: { title: string; picks: SpotCand[]; total: number }) {
  if (!picks.length) return null;
  return (
    <div className="bg-white rounded-2xl border-2 border-violet-200 p-4 mb-5" data-spot="1">
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <h2 className="font-black text-violet-900">🎯 สุ่มตรวจคาบนี้</h2>
        <span className="text-xs font-bold text-violet-700">{title} · เลือก {picks.length} จาก {total} คนที่ทำรอบแรกวันนี้ · ถามปากเปล่า 3 คำ</span>
      </div>
      <ol className="space-y-1 text-sm">
        {picks.map((p, i) => (
          <li key={p.key} className="flex flex-wrap gap-x-2">
            <span className="font-black text-violet-900">{i + 1}. {p.name}</span>
            <span className="text-xs font-bold text-gray-500">{p.reasons.length ? p.reasons.join(" · ") : "สุ่ม"}</span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-gray-500 mt-2">รายชื่อคงที่ทั้งวัน (รีเฟรชแล้วไม่เปลี่ยน) · นักเรียนทุกคนมีโอกาสถูกสุ่ม · คนที่มี 🚩 ⚡ หรือไม่ใช้กล้องมีโอกาสมากกว่า</p>
    </div>
  );
}
