"use client";
// app/admin/extraclass/page.tsx
// ─────────────────────────────────────────────────────────────
// 🎓 หน้าครู · ห้องเรียนพิเศษ (/admin/extraclass) — 11 พ.ย. 2569
//   - ตั้ง/เปลี่ยน "รหัสเข้าชั้น" ของ /extraclass (เก็บแฮชใน Firestore · อ่านรหัสย้อนกลับไม่ได้)
//   - ดูความก้าวหน้านักเรียนเรียนพิเศษ (เอกสาร ex:…) แบบสด แยกจากนักเรียนโรงเรียนโดยสิ้นเชิง
//   - ซ่อน/กู้คืนรายชื่อที่ไม่เกี่ยวข้อง (StudentManager) · ไม่มีรายชื่อทางการ ไม่มีการจับคู่ห้อง/เลขที่
//   - ใช้ผ่านด่านรหัสผ่านเดียวกับ /admin (sessionStorage vocab_admin_ok) และ Basic Auth ของ proxy.ts
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { Course, CourseProgress, loadCourse } from "../../lib/courses";
import { VProgress } from "../../lib/vocab300";
import { fmtThaiTime } from "../../lib/roster";
import { extraCourseOf, isExtraId, realEmail, saveExtraCode, type ExtraLevel } from "../../lib/extra";
import { StudentManager, type ManagedDoc } from "../_parts/StudentManager";

type ExDoc = ManagedDoc & {
  profile?: { first?: string; last?: string; level?: string };
  courses?: Record<string, CourseProgress>;
  v300?: VProgress;
  live?: { at?: number };
};

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "anukoolnaree2025";
const CODE_HINT_KEY = "vm_extra_code_hint";

const levelOf = (d: ExDoc): ExtraLevel => (d.profile?.level === "4" ? "4" : "6");
const lastActive = (d: ExDoc) => Math.max(Number(d.courseActiveAt) || 0, Number(d.v300At) || 0, Number(d.updatedAt) || 0);

export default function ExtraAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [docs, setDocs] = useState<ExDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [courses, setCourses] = useState<Record<string, Course>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [q, setQ] = useState("");
  const [now, setNow] = useState(0); // เวลาปัจจุบัน (อัปเดตทุก 20 วินาที ใช้ตัดสินว่า "กำลังทำ")

  // รหัสเข้าชั้น
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingCode, setSavingCode] = useState(false);
  const [hint, setHint] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      if (sessionStorage.getItem("vocab_admin_ok") === "1") setAuthed(true);
      setHint(localStorage.getItem(CODE_HINT_KEY) || "");
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    Promise.all([loadCourse("decoder"), loadCourse("decoder4")])
      .then(([a, b]) => alive && setCourses({ decoder: a, decoder4: b }))
      .catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, [authed]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!authed || !db) return;
    const stop = onSnapshot(
      collection(db, "students"),
      (snap) => {
        const out: ExDoc[] = [];
        snap.forEach((d) => {
          if (isExtraId(d.id)) out.push({ id: d.id, ...(d.data() as Record<string, unknown>) } as ExDoc);
        });
        setDocs(out);
        setLoading(false);
        setError("");
      },
      (e) => {
        console.error(e);
        setLoading(false);
        setError("เชื่อมต่อข้อมูลสดไม่สำเร็จ — ลองรีเฟรชหน้า");
      }
    );
    return () => stop();
  }, [authed]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs
      .filter((d) => (showHidden ? true : !d.hidden))
      .filter((d) => !needle || `${d.name || ""} ${realEmail(d.id)}`.toLowerCase().includes(needle))
      .sort((a, b) => lastActive(b) - lastActive(a));
  }, [docs, showHidden, q]);

  const submitPw = () => {
    if (pw === ADMIN_PASSWORD) {
      setAuthed(true);
      setPwError(false);
      try { sessionStorage.setItem("vocab_admin_ok", "1"); } catch { /* ไม่เป็นไร */ }
    } else setPwError(true);
  };

  const submitCode = async () => {
    const c = code.trim();
    if (c.replace(/\s+/g, "").length < 4) {
      setCodeMsg({ ok: false, text: "รหัสสั้นเกินไป — ใช้อย่างน้อย 4 ตัวอักษร" });
      return;
    }
    setSavingCode(true);
    setCodeMsg(null);
    const ok = await saveExtraCode(c);
    setSavingCode(false);
    if (ok) {
      try { localStorage.setItem(CODE_HINT_KEY, c); } catch { /* ไม่เป็นไร */ }
      setHint(c);
      setCode("");
      setCodeMsg({ ok: true, text: "บันทึกรหัสใหม่แล้ว — นักเรียนที่เข้าอยู่แล้วไม่ถูกเตะออก ใช้รหัสใหม่เฉพาะตอนเข้าระบบครั้งถัดไป" });
    } else {
      setCodeMsg({ ok: false, text: "บันทึกไม่สำเร็จ — ตรวจอินเทอร์เน็ต หรือ Firebase Rules อาจไม่อนุญาตเขียนเอกสารนี้" });
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#f3f5fa] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border-t-8 border-[#003399] rounded-3xl p-8 shadow-xl">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔒</div>
            <h1 className="text-xl font-black text-[#003399]">ห้องเรียนพิเศษ · สำหรับครู</h1>
          </div>
          <label className="block text-xs font-bold text-gray-500 mb-1">รหัสผ่านครู</label>
          <input
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setPwError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") submitPw(); }}
            autoFocus
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003399]"
            placeholder="กรอกรหัสผ่าน"
          />
          {pwError && <p className="text-rose-600 text-xs mt-2 font-bold">รหัสผ่านไม่ถูกต้อง</p>}
          <button onClick={submitPw} className="w-full mt-4 bg-[#003399] text-[#FFD700] font-black rounded-xl py-3">เข้าสู่ระบบ</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f5fa] text-gray-800 p-4 md:p-8" data-extra-admin>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-xs font-black text-[#003399] tracking-widest uppercase">Extra Class</p>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">🎓 ห้องเรียนพิเศษ</h1>
            <p className="text-xs text-gray-500 mt-1">
              นักเรียนเข้าที่ <span className="font-mono font-bold">/extraclass</span> · แยกจากนักเรียนโรงเรียนทั้งหมด · ไม่ใช้กล้อง · ไม่ปิดเวลา 16.30 น.
            </p>
          </div>
          <a href="/admin" className="px-4 py-2 bg-white border-2 border-[#003399]/20 text-[#003399] font-bold rounded-xl text-sm">← แดชบอร์ดโรงเรียน</a>
        </div>

        {/* ── รหัสเข้าชั้น ── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 mb-5" data-code-panel>
          <h2 className="font-black text-gray-900 mb-1">🔑 รหัสเข้าชั้น</h2>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            นักเรียนต้องกรอกรหัสนี้ตอนเข้า /extraclass ครั้งแรก (ระบบเก็บเฉพาะค่าแฮช อ่านรหัสย้อนกลับไม่ได้ ถ้าลืมให้ตั้งใหม่ได้เลย)
            {hint ? <> · รหัสที่ตั้งจากเครื่องนี้ล่าสุด: <span className="font-mono font-black text-[#003399]" data-code-hint>{hint}</span></> : <> · ยังไม่ได้ตั้งรหัสจากเครื่องนี้</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeMsg(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitCode(); }}
              placeholder="ตั้งรหัสใหม่ เช่น kru-kaw-2569"
              data-code-input
              className="flex-1 min-w-[12rem] border-2 border-gray-200 rounded-xl px-3 py-2 font-mono outline-none focus:border-[#003399]"
            />
            <button onClick={submitCode} disabled={savingCode || !code.trim()} data-code-save className="px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl disabled:opacity-50">
              {savingCode ? "⏳ กำลังบันทึก..." : "บันทึกรหัส"}
            </button>
          </div>
          {codeMsg && (
            <p data-code-msg={codeMsg.ok ? "ok" : "err"} className={`text-xs font-bold mt-2 ${codeMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>{codeMsg.text}</p>
          )}
        </section>

        <StudentManager docs={docs} roster={false} label="ห้องเรียนพิเศษ" />

        {/* ── ตารางนักเรียน ── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 mt-5" data-extra-table>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-black text-gray-900">
              นักเรียนเรียนพิเศษ <span className="text-gray-400 font-bold text-sm">({shown.length} คน)</span>
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 font-bold text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> แสดงที่ซ่อนไว้
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาชื่อ/อีเมล"
                className="border-2 border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-[#003399]"
              />
            </div>
          </div>

          {loading && <p className="text-sm text-gray-400">⏳ กำลังเชื่อมต่อข้อมูลสด...</p>}
          {error && <p className="text-sm text-rose-600 font-bold">{error}</p>}
          {!loading && !error && shown.length === 0 && (
            <p className="text-sm text-gray-400" data-extra-empty>ยังไม่มีนักเรียนเข้าระบบ — แจกลิงก์ /extraclass และรหัสเข้าชั้นให้นักเรียนได้เลย</p>
          )}

          <ul className="flex flex-col gap-3">
            {shown.map((d) => {
              const lv = levelOf(d);
              const cid = extraCourseOf(lv);
              const course = courses[cid];
              const prog = d.courses?.[cid] ?? {};
              const sets = d.v300?.sets ?? {};
              const live = typeof d.live?.at === "number" && now - d.live.at < 3 * 60000;
              const passedLessons = course ? course.lessons.filter((l) => prog[l.id]?.passed).length : 0;
              const passedSets = Object.keys(sets).length;
              return (
                <li key={d.id} data-extra-row={d.id} className={`border rounded-xl p-3 ${d.hidden ? "bg-gray-50 border-gray-200 opacity-70" : "border-gray-200"}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-black text-gray-900">{d.name || realEmail(d.id)}</span>
                      {live && <span className="ml-2 text-[11px] font-black text-rose-600">🔴 กำลังทำ</span>}
                      {d.hidden && <span className="ml-2 text-[11px] font-black text-gray-500">ซ่อนไว้</span>}
                      <div className="text-[11px] text-gray-500 break-all">{realEmail(d.id)}</div>
                    </div>
                    <div className="text-[11px] text-gray-500 text-right">
                      ใช้งานล่าสุด {fmtThaiTime(lastActive(d))}
                      <div className="font-bold text-gray-700">🧩 {passedLessons}/{course?.lessons.length ?? "–"} บท{lv === "6" ? ` · 📚 ${passedSets}/12 ชุด` : ""}</div>
                    </div>
                  </div>
                  {course && (
                    <div className="flex flex-wrap gap-1 mt-2" aria-label="บทเรียน">
                      {course.lessons.map((l) => {
                        const p = prog[l.id];
                        const cls = p?.passed ? "bg-emerald-500 text-white" : p && p.attempts > 0 ? "bg-amber-200 text-amber-900" : "bg-gray-100 text-gray-400";
                        return (
                          <span key={l.id} title={`บทที่ ${l.hour} · ${l.titleEn}${p ? ` · ดีที่สุด ${p.best}/${p.total} · ทำ ${p.attempts} รอบ` : ""}`} className={`w-6 h-6 rounded-md text-[10px] font-black flex items-center justify-center ${cls}`}>
                            {l.hour}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {lv === "6" && (
                    <div className="flex flex-wrap gap-1 mt-1.5" aria-label="ชุดคำศัพท์">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((k) => (
                        <span key={k} className={`w-6 h-6 rounded-md text-[10px] font-black flex items-center justify-center ${sets[String(k)] ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-400"}`} title={`ชุดที่ ${k}${sets[String(k)] ? ` · ${sets[String(k)].score}/10` : ""}`}>
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400 mt-3">🟩 ผ่านแล้ว · 🟨 ทำแล้วยังไม่ผ่าน · ⬜ ยังไม่ทำ · 🟦 ชุดคำศัพท์ที่ผ่าน (ม.6)</p>
        </section>
      </div>
    </div>
  );
}
