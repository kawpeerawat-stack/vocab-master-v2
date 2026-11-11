"use client";
// app/extraclass/page.tsx
// ─────────────────────────────────────────────────────────────
// ห้องเรียนพิเศษ — แยกจากนักเรียนโรงเรียน (ดู app/lib/extra.ts)
//   เข้าด้วย ชื่อ · นามสกุล · ระดับ (ม.4/ม.6) · อีเมล · รหัสเข้าชั้น (ครูตั้ง)
//   ม.6: 🧩 ถอดรหัสคำศัพท์ + 📚 คำศัพท์แกน 120 คำ · ม.4: 🧩 ถอดรหัสคำศัพท์ ม.4
//   ไม่ใช้กล้อง · ไม่ปิดเวลา 16.30 น. · ไม่ล็อกตามวันเรียน (เรียนได้ทุกบทตามลำดับ) · จับเวลาข้อละ 45 วินาที และผ่าน 80% เหมือนรอบที่เข้าสมุดคะแนน
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import CourseRoom from "../_components/CourseRoom";
import VocabRoom, { passedSetsLocal } from "../_components/VocabRoom";
import { Q_TIME_MS } from "../lib/guard";
import { CORE_NAME } from "../lib/vocab300";
import {
  EXTRA_LEVELS,
  checkExtraCode,
  cleanPart,
  extraCourseOf,
  extraIdentity,
  extraName,
  saveExtraProfile,
  validateExtra,
  type ExtraLevel,
  type ExtraProfile,
} from "../lib/extra";

const SESSION_KEY = "vm_extra";
const LAST_KEY = "vm_extra_last";
type Section = "HUB" | "VOCAB" | "DECODER";
type Form = { first: string; last: string; level: string; email: string; code: string };
const EMPTY: Form = { first: "", last: "", level: "", email: "", code: "" };
const FIELD_ORDER = ["first", "last", "level", "email", "code"] as const;

export default function ExtraClassPage() {
  const [me, setMe] = useState<ExtraProfile | null>(null);
  const [section, setSection] = useState<Section>("HUB");
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<(typeof FIELD_ORDER)[number], string>>>({});
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const p = JSON.parse(raw) as ExtraProfile;
        if (p?.email && p.first && (p.level === "4" || p.level === "6")) {
          setMe(p);
          return;
        }
      }
      const last = localStorage.getItem(LAST_KEY);
      if (last) {
        const p = JSON.parse(last) as Partial<ExtraProfile>;
        setForm((f) => ({ ...f, first: p.first || "", last: p.last || "", level: p.level || "", email: p.email || "" }));
      }
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setField = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as keyof typeof errors]) setErrors((e) => ({ ...e, [k]: undefined }));
    setMsg("");
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateExtra(form);
    setErrors(errs);
    const bad = FIELD_ORDER.find((k) => errs[k]);
    if (bad) {
      document.getElementById(`x-${bad}`)?.focus();
      return;
    }
    setChecking(true);
    const r = await checkExtraCode(form.code);
    setChecking(false);
    if (r === "wrong") return setErrors({ code: "รหัสเข้าชั้นไม่ถูกต้อง — ถามครูอีกครั้ง" });
    if (r === "unset") return setMsg("ห้องเรียนพิเศษยังไม่เปิดรับ — ให้ครูตั้งรหัสเข้าชั้นก่อน");
    if (r === "error") return setMsg("ตรวจรหัสไม่สำเร็จ (อินเทอร์เน็ตหรือระบบขัดข้อง) — ลองใหม่อีกครั้ง");
    const p: ExtraProfile = { first: cleanPart(form.first), last: cleanPart(form.last), level: form.level as ExtraLevel, email: form.email.trim().toLowerCase() };
    setMe(p);
    setSection("HUB");
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(p));
      localStorage.setItem(LAST_KEY, JSON.stringify(p));
    } catch {
      /* ไม่เป็นไร */
    }
    void saveExtraProfile(p);
  };

  const logout = () => {
    setMe(null);
    setSection("HUB");
    setForm((f) => ({ ...f, code: "" }));
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ไม่เป็นไร */
    }
  };

  const id = me ? extraIdentity(me.email) : "";
  const nm = me ? extraName(me) : "";
  const setsPassed = me && section === "HUB" && typeof window !== "undefined" ? passedSetsLocal(id) : 0;

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-start sm:justify-center p-3 sm:p-4 font-sans text-gray-800">
      <div className="w-full max-w-2xl bg-white shadow-2xl rounded-3xl p-5 md:p-10 border-t-[12px] border-[#003399] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-[#FFD700]" />

        {!me && (
          <form onSubmit={login} noValidate className="text-center animate-fadeIn mt-2" data-extra="login">
            <div className="flex flex-col items-center justify-center mb-6">
              <div className="text-6xl mb-3" aria-hidden="true">🎓</div>
              <h2 className="text-sm md:text-base font-bold text-[#003399] uppercase tracking-widest mb-1">Extra Class</h2>
              <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">Vocabulary Essential</h1>
              <div className="h-1 w-20 bg-[#FFD700] mt-2 rounded-full" />
              <p className="text-sm font-bold text-gray-500 mt-3">ห้องเรียนพิเศษ · สำหรับนักเรียนที่ครูให้รหัสเข้าชั้นเท่านั้น</p>
            </div>

            {msg && <p className="text-left text-sm font-bold bg-amber-50 text-amber-900 border-2 border-amber-200 rounded-2xl px-4 py-3 mb-5">{msg}</p>}

            <div className="text-left space-y-4 mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field id="first" label="ชื่อ" error={errors.first}>
                  <input id="x-first" type="text" autoComplete="given-name" placeholder="เช่น สมชาย" value={form.first} onChange={(e) => setField("first", e.target.value)} className={inputCls(!!errors.first)} />
                </Field>
                <Field id="last" label="นามสกุล" error={errors.last}>
                  <input id="x-last" type="text" autoComplete="family-name" placeholder="เช่น รักดี" value={form.last} onChange={(e) => setField("last", e.target.value)} className={inputCls(!!errors.last)} />
                </Field>
              </div>
              <Field id="level" label="ระดับชั้น" error={errors.level}>
                <div className="flex gap-2" id="x-level" tabIndex={-1}>
                  {EXTRA_LEVELS.map((l) => (
                    <button key={l.level} type="button" onClick={() => setField("level", l.level)} aria-pressed={form.level === l.level}
                      className={`flex-1 py-3 rounded-2xl border-2 font-black text-lg ${form.level === l.level ? "border-[#003399] bg-[#003399] text-[#FFD700]" : "border-gray-200 bg-gray-50/50 text-gray-600"}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field id="email" label="อีเมล" error={errors.email}>
                <input id="x-email" type="email" autoComplete="email" placeholder="เช่น somchai.r@gmail.com" value={form.email} onChange={(e) => setField("email", e.target.value)} className={inputCls(!!errors.email)} />
              </Field>
              <Field id="code" label="รหัสเข้าชั้น" error={errors.code}>
                <input id="x-code" type="password" autoComplete="off" placeholder="รหัสที่ครูให้" value={form.code} onChange={(e) => setField("code", e.target.value)} className={inputCls(!!errors.code)} />
              </Field>
              <p className="text-xs text-gray-500 leading-relaxed">ใช้อีเมลเดิมทุกครั้ง ผลการเรียนจะผูกกับอีเมลนี้ · ห้องนี้<b>ไม่ใช้กล้อง ไม่เก็บภาพ</b> · จับเวลาข้อละ {Q_TIME_MS / 1000} วินาทีในแบบทดสอบ</p>
            </div>

            <button type="submit" disabled={checking} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 transition-all duration-300 text-xl uppercase tracking-widest">
              {checking ? "กำลังตรวจรหัส..." : "Enter Class"}
            </button>
          </form>
        )}

        {me && section === "HUB" && (
          <div className="text-center animate-fadeIn mt-2" data-extra="hub">
            <div className="mb-6">
              <div className="text-5xl mb-2" aria-hidden="true">🎓</div>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">Extra Class · ม.{me.level}</p>
              <p className="text-gray-500 text-xs mt-1">สวัสดี {me.first} · เลือกห้องที่อยากฝึก</p>
              <p className="mt-2 text-xs font-bold text-[#003399] bg-[#003399]/5 rounded-full px-3 py-1 inline-block">
                {me.first} {me.last} · ห้องเรียนพิเศษ ม.{me.level}
              </p>
            </div>
            <div className="text-left mb-6 space-y-3">
              <RoomCard icon="🧩" title={me.level === "4" ? "ถอดรหัสคำศัพท์ ม.4" : "ถอดรหัสคำศัพท์"} sub={me.level === "4" ? "Root Words Decoder · ปูพื้นฐาน · 14 คาบ" : "Root Words Decoder · ปัจจัย • อุปสรรค • รากศัพท์ · 14 บท"} hint="เรียนบทในแบบเรียน → แบบฝึกหัด ทำได้ทุกบทตามที่ครูนัด" onClick={() => setSection("DECODER")} />
              {me.level === "6" && (
                <RoomCard icon="📚" title={CORE_NAME} sub="TGAT · A-Level · 12 ชุด ชุดละ 10 คำ · เรียนแบบ 5 ขั้น" hint="เรียน 10 คำ → รอบทบทวนถูกครบ = ผ่าน ✓" badge={setsPassed > 0 ? `ผ่าน ${setsPassed} ชุด` : undefined} onClick={() => setSection("VOCAB")} />
              )}
            </div>
            <button onClick={logout} className="w-full py-3 bg-white text-gray-400 font-bold rounded-xl hover:text-[#003399] transition-all duration-150 text-sm uppercase">
              🔄 Switch Student Account
            </button>
          </div>
        )}

        {me && section === "VOCAB" && <VocabRoom email={id} name={nm} onExit={() => setSection("HUB")} extra />}
        {me && section === "DECODER" && <CourseRoom key={extraCourseOf(me.level)} courseId={extraCourseOf(me.level)} email={id} name={nm} onExit={() => setSection("HUB")} extra />}
      </div>
      <p className="mt-8 text-[10px] text-gray-400 font-bold tracking-[0.3em] uppercase">Vocabulary Essential · Extra Class</p>
    </div>
  );
}

function inputCls(bad: boolean): string {
  return `w-full p-4 border-2 rounded-2xl focus:outline-none focus:ring-2 bg-gray-50/50 transition-all font-medium ${
    bad ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-gray-100 focus:border-[#FFD700] focus:ring-[#FFD700]/20"
  }`;
}
function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={`x-${id}`} className="block text-sm font-bold text-[#003399] mb-1.5">
        {label} <span className="text-rose-500">*</span>
      </label>
      {children}
      {error && <p className="text-xs font-bold text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
function RoomCard({ icon, title, sub, hint, badge, onClick }: { icon: string; title: string; sub: string; hint: string; badge?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group w-full flex items-stretch bg-white border-2 border-[#003399]/15 rounded-2xl overflow-hidden shadow-sm hover:border-[#003399]/50 hover:shadow-md active:scale-[0.99] transition-all text-left">
      <span className="w-16 shrink-0 flex items-center justify-center bg-[#003399] border-r-4 border-[#FFD700] text-3xl" aria-hidden="true">{icon}</span>
      <span className="flex-1 min-w-0 flex items-center gap-3 px-3 sm:px-4 py-4">
        <span className="flex-1 min-w-0">
          <span className="block font-black text-lg text-[#003399] leading-tight">{title}</span>
          <span className="block text-xs text-gray-500 font-bold mt-1">{sub}</span>
          <span className="block text-[11px] text-[#003399]/70 font-bold mt-1">{hint}</span>
        </span>
        {badge ? <span className="shrink-0 text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full whitespace-nowrap">{badge}</span> : <span className="shrink-0 text-[#003399] text-xl transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>}
      </span>
    </button>
  );
}
