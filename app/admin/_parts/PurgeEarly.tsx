"use client";
// app/admin/_parts/PurgeEarly.tsx — 🧹 ล้างผลที่ทำล่วงหน้า (สัปดาห์ 3 ขึ้นไป) · 11 พ.ย. 2569 (ครูสั่ง · ผลยังไม่ผ่านการตรวจ)
//   ตรวจหา → ดูรายชื่อ → ดาวน์โหลดไฟล์สำรอง → พิมพ์ "ลบ" ยืนยัน → ลบ
//   ลบเฉพาะ 📚 ชุด/การ์ดคำ และ 🧩 บท ตั้งแต่สัปดาห์ 3 ที่ทำก่อนวันเรียนของห้อง (ครูไม่ได้เปิดล่วงหน้าให้) · สัปดาห์ 1–2 (อนุโลม) ไม่แตะ
import React, { useState } from "react";
import { COURSE_REGISTRY, loadCourse, type Course } from "../../lib/courses";
import { GRACE_UNTIL } from "../../lib/early";
import { loadVocab300 } from "../../lib/vocab300";
import { makeBackup, runPurge, scanEarly, type PurgeItem, type PurgeRunResult, type ScanDoc } from "./purgeScan";

type Phase = "idle" | "scanning" | "preview" | "running" | "done";

export function PurgeEarly({ docs }: { docs: ScanDoc[] }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<PurgeItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [snapshot, setSnapshot] = useState<ScanDoc[]>([]);
  const [backedUp, setBackedUp] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<PurgeRunResult | null>(null);
  const [err, setErr] = useState("");

  const scan = async () => {
    setPhase("scanning");
    setErr("");
    setBackedUp(false);
    setConfirm("");
    setResult(null);
    try {
      const vocab = await loadVocab300();
      const ids = Array.from(new Set(docs.flatMap((d) => Object.keys(d.courses || {})))).filter((id) => COURSE_REGISTRY.some((c) => c.id === id));
      const courses: Record<string, Course> = {};
      await Promise.all(ids.map(async (id) => { courses[id] = await loadCourse(id); }));
      const snap = docs.slice();
      const r = scanEarly(snap, vocab, courses);
      setSnapshot(snap);
      setItems(r.items);
      setSkipped(r.skipped);
      setPhase("preview");
    } catch (e) {
      console.error(e);
      setErr("ตรวจหาไม่สำเร็จ — รีเฟรชหน้าแล้วลองใหม่");
      setPhase("idle");
    }
  };

  const download = () => {
    const blob = new Blob([makeBackup(items, snapshot)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const t = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
    a.href = url;
    a.download = `purge-backup-${t}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setBackedUp(true);
  };

  const run = async () => {
    setPhase("running");
    setProg({ done: 0, total: items.length });
    const r = await runPurge(items, snapshot, (done, total) => setProg({ done, total }));
    setResult(r);
    setPhase("done");
  };

  const sumSets = items.reduce((n, i) => n + i.sets.length, 0);
  const sumLessons = items.reduce((n, i) => n + i.lessons.length, 0);
  const sumCards = items.reduce((n, i) => n + i.cards, 0);
  const rooms = Array.from(new Set(items.map((i) => i.room)));

  return (
    <section data-purge className="bg-white rounded-2xl border-2 border-rose-200 mb-5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="font-black text-gray-900">
          🧹 ล้างผลที่ทำล่วงหน้า <span className="text-xs font-bold text-gray-500">สัปดาห์ {GRACE_UNTIL + 1} ขึ้นไป · ยังไม่ผ่านการตรวจ</span>
        </span>
        <span className="text-xs font-bold text-gray-500">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm">
          <p className="text-xs text-gray-600 leading-relaxed mb-3">
            ลบผล 📚 ชุด/คำศัพท์ และ 🧩 บท ที่นักเรียนทำ <b>ก่อนวันเรียนของห้อง</b> ตั้งแต่สัปดาห์ {GRACE_UNTIL + 1} ขึ้นไป (ที่ครูไม่ได้กดเปิดล่วงหน้าให้) ทุกห้อง ม.6 และ ม.4 ·
            สัปดาห์ 1–{GRACE_UNTIL} ที่อนุโลมไว้ไม่ถูกแตะ · ระบบลบเฉพาะข้อมูลผลการเรียน ไม่ลบรายชื่อ · เครื่องนักเรียนจะล้างให้เองเมื่อเปิดแอปครั้งถัดไป ·
            <b> ลบแล้วกู้คืนไม่ได้ — ต้องดาวน์โหลดไฟล์สำรองก่อนทุกครั้ง</b>
          </p>

          {(phase === "idle" || phase === "scanning") && (
            <button data-purge-scan onClick={scan} disabled={phase === "scanning"} className="px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl disabled:opacity-60">
              {phase === "scanning" ? "⏳ กำลังตรวจหา..." : "🔍 ตรวจหาผลที่ทำล่วงหน้า"}
            </button>
          )}
          {err && <p className="text-rose-600 text-xs font-bold mt-2">{err}</p>}

          {phase === "preview" && (
            <div>
              {items.length === 0 ? (
                <p data-purge-summary className="text-emerald-700 font-bold">✅ ไม่พบผลที่ทำล่วงหน้า (สัปดาห์ {GRACE_UNTIL + 1} ขึ้นไป) ที่ต้องลบ{skipped ? ` · ข้าม ${skipped} บัญชีที่ไม่รู้ห้อง` : ""}</p>
              ) : (
                <>
                  <p data-purge-summary className="font-bold text-gray-800 mb-2">
                    พบ {items.length} คน · 📚 {sumSets} ชุด ({sumCards} คำ) · 🧩 {sumLessons} บท · ห้อง {rooms.join(", ")}
                    {skipped ? <span className="text-gray-500 font-normal"> · ข้าม {skipped} บัญชีที่ไม่รู้ห้อง (ตัดสินวันเรียนไม่ได้)</span> : null}
                  </p>
                  <div className="max-h-64 overflow-auto border border-gray-200 rounded-xl mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 sticky top-0">
                        <tr><th className="text-left px-2 py-1.5">ห้อง</th><th className="text-left px-2 py-1.5">นักเรียน</th><th className="text-left px-2 py-1.5">จะลบ</th></tr>
                      </thead>
                      <tbody>
                        {items.map((i) => (
                          <tr key={i.id} data-purge-row={i.id} className="border-t border-gray-100">
                            <td className="px-2 py-1.5 whitespace-nowrap">{i.room}</td>
                            <td className="px-2 py-1.5">{i.name}</td>
                            <td className="px-2 py-1.5 text-gray-700">
                              {i.sets.length > 0 && <span className="mr-2">📚 ชุด {i.sets.join(", ")}</span>}
                              {i.cards > 0 && i.sets.length === 0 && <span className="mr-2">📚 เรียนล่วงหน้า {i.cards} คำ</span>}
                              {i.lessons.length > 0 && <span className="mr-2">🧩 {i.lessons.map((l) => `${l.course === "decoder4" ? "ม.4 " : ""}บท ${l.hour}`).join(", ")}</span>}
                              {i.prevOnly > 0 && <span className="text-gray-400">+ ผลเก่าที่ทำใหม่แล้ว {i.prevOnly}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ol className="flex flex-col gap-3">
                    <li className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-gray-700">① สำรองข้อมูล</span>
                      <button data-purge-backup onClick={download} className="px-3 py-1.5 border-2 border-[#003399]/30 text-[#003399] font-bold rounded-lg text-xs">⬇️ ดาวน์โหลดไฟล์สำรอง (.json)</button>
                      {backedUp && <span className="text-emerald-700 text-xs font-bold">✓ ดาวน์โหลดแล้ว — เก็บไฟล์ไว้ให้ดี</span>}
                    </li>
                    <li className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-gray-700">② พิมพ์คำว่า “ลบ” เพื่อยืนยัน</span>
                      <input data-purge-confirm value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={!backedUp} placeholder="ลบ" className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-rose-400 disabled:bg-gray-100" />
                      <button data-purge-run onClick={run} disabled={!backedUp || confirm.trim() !== "ลบ"} className="px-4 py-1.5 bg-rose-600 text-white font-black rounded-lg text-xs disabled:opacity-40">
                        🗑 ลบผลที่ทำล่วงหน้า {items.length} คน
                      </button>
                    </li>
                  </ol>
                </>
              )}
              <button onClick={() => setPhase("idle")} className="mt-3 text-xs font-bold text-gray-500 underline">ยกเลิก / ตรวจใหม่</button>
            </div>
          )}

          {phase === "running" && (
            <p data-purge-progress className="font-bold text-gray-700">⏳ กำลังลบ {prog.done}/{prog.total} คน — อย่าปิดหน้านี้</p>
          )}

          {phase === "done" && result && (
            <div data-purge-result>
              <p className={`font-black ${result.failed.length ? "text-amber-700" : "text-emerald-700"}`}>
                ลบสำเร็จ {result.ok.length} คน{result.failed.length ? ` · ไม่สำเร็จ ${result.failed.length} คน` : ""}
              </p>
              {result.failed.length > 0 && (
                <ul className="text-xs text-rose-600 mt-1 list-disc pl-5">
                  {result.failed.map((f) => <li key={f.id}>{f.name} — {f.error}</li>)}
                </ul>
              )}
              <p className="text-xs text-gray-500 mt-2">ตารางจะอัปเดตเอง · กด “ตรวจใหม่” เพื่อตรวจซ้ำ (ที่ลบไม่สำเร็จจะกลับมาในรายการ)</p>
              <button onClick={() => setPhase("idle")} className="mt-2 px-3 py-1.5 border-2 border-gray-200 font-bold rounded-lg text-xs">ตรวจใหม่</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
