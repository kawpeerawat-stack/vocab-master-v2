"use client";
// app/page.tsx
// ─────────────────────────────────────────────────────────────
// หน้าหลักของนักเรียน: เข้าสู่ระบบ (ชื่อ · นามสกุล · เลขที่ · ชั้นเรียน · อีเมล — กรอกครบทุกช่องจึงเข้าได้) → เลือกห้อง
//   ตรวจกับรายชื่อของครูที่เซิร์ฟเวอร์ (/api/roster) ถ้าไม่ตรงจะให้ตรวจอีกครั้งก่อนยืนยัน
//   เมนู ม.6 เรียงตามคาบคู่ 90 นาที (อ33102): ① 🧩 → พัก 5 นาที → ② 📚 · เมนู ม.4 มีแถบ 🧩 แถบเดียว
//   🧩 ถอดรหัสคำศัพท์ (CourseRoom)     — ม.6: 14 บท บทละ 15 ข้อ (decoder) · ม.4: 14 คาบ คาบละ 10 ข้อ ผ่าน 8 (decoder4)
//   📚 คำศัพท์แกน 120 คำ (VocabRoom)  — เรียนแบบ 5 ขั้น + ทวนตามคาบ
// (ระบบคลังคำ 3,000+ คำแบบเดิมถูกนำออกแล้ว — ข้อมูลเก่าใน Firestore ยังเก็บไว้ ไม่ได้ลบ)
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import CourseRoom from "./_components/CourseRoom";
import VocabRoom, { passedSetsLocal } from "./_components/VocabRoom";
import { CamBox, CamChooser, CamSource, useSharedCamera } from "./_components/CamGuard";
import { HoursNote } from "./_components/HoursNote";
import { useSchoolHours } from "./lib/hours";
import { Q_TIME_MS } from "./lib/guard";
import { CORE_NAME } from "./lib/vocab300";
import {
  GRADES,
  MAX_NO,
  gradeOf,
  RosterCheck,
  StudentProfile,
  checkRoster,
  cleanNamePart,
  composeName,
  profileFromLegacyName,
  saveProfile,
  validateProfile,
  type ProfileField,
} from "./lib/student";

const SCHOOL_LOGO_URL = "/logo.png";
const SESSION_KEY = "vm_student"; // จำการเข้าสู่ระบบไว้ในแท็บนี้ (กันกดรีเฟรชแล้วต้องกรอกใหม่)
const LAST_KEY = "vm_last_profile"; // เติมช่องให้ครั้งหน้าบนเครื่องเดิม (ไม่เข้าระบบให้อัตโนมัติ)

type Form = { first: string; last: string; no: string; room: string; email: string };
const EMPTY_FORM: Form = { first: "", last: "", no: "", room: "", email: "" };
const FIELD_ORDER: ProfileField[] = ["first", "last", "room", "no", "email"];
const CHECK_MSG: Record<Exclude<RosterCheck, "ok" | "unknown">, (f: Form) => string> = {
  partial: (f) => `ชื่อหรือนามสกุลสะกดไม่ตรงกับรายชื่อของครู (ม.${f.room} เลขที่ ${f.no}) — ตรวจการสะกดอีกครั้ง`,
  elsewhere: () => "ชื่อ-นามสกุลนี้อยู่ในรายชื่อของครู แต่ชั้นเรียนหรือเลขที่ไม่ตรง — ตรวจชั้นเรียนและเลขที่อีกครั้ง",
  mismatch: (f) => `ม.${f.room} เลขที่ ${f.no} ในรายชื่อของครูเป็นคนละชื่อกัน — ตรวจเลขที่และชั้นเรียนอีกครั้ง`,
  notfound: (f) => `ไม่พบเลขที่ ${f.no} ในรายชื่อ ม.${f.room} — ตรวจเลขที่อีกครั้ง`,
};

type Section = "HUB" | "VOCAB" | "DECODER";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [section, setSection] = useState<Section>("HUB");
  const [studentName, setStudentName] = useState(""); // ชื่อรวมที่บันทึกขึ้นระบบ: "ชื่อ นามสกุล No.5 M.6/1"
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [check, setCheck] = useState<{ result: RosterCheck; key: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");

  // กู้การเข้าสู่ระบบเดิมในแท็บนี้ (ทำหลังโหลดหน้า เพื่อให้หน้าแรกตรงกับที่เซิร์ฟเวอร์สร้างไว้)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const s = raw ? (JSON.parse(raw) as { name?: string; email?: string; profile?: StudentProfile }) : null;
      if (s?.profile && s.email && s.name) {
        setStudentName(s.name);
        setEmail(s.email);
        setProfile(s.profile);
        setIsLoggedIn(true);
        return;
      }
      if (s?.name && s.email) {
        // เข้าระบบแบบเดิม (พิมพ์ชื่อช่องเดียว) → เติมช่องให้ แล้วให้ตรวจและกดเข้าใหม่
        const p = profileFromLegacyName(s.name);
        setForm({ first: p.first || "", last: p.last || "", no: p.no ? String(p.no) : "", room: p.room || "", email: s.email });
        setNotice("ระบบเปลี่ยนเป็นกรอกข้อมูลแยกช่อง — ตรวจชื่อ นามสกุล ชั้นเรียน และเลขที่ แล้วกดเข้าสู่ระบบอีกครั้ง");
        return;
      }
      const last = localStorage.getItem(LAST_KEY);
      if (last) {
        const p = JSON.parse(last) as StudentProfile;
        setForm({ first: p.first || "", last: p.last || "", no: p.no ? String(p.no) : "", room: p.room || "", email: p.email || "" });
      }
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isM4 = gradeOf(profile?.room) === "4";
  // 9 พ.ย.: เปิดกล้องและเทียบหน้าที่หน้าเลือกห้องก่อน จึงเข้าได้ทั้ง 2 แถบ (มาตรฐานเดียวกันก่อนทำ) · กล้องเปิดค้างจนออกจากระบบ
  const { cam, bind } = useSharedCamera();
  const [hubCam, setHubCam] = useState<null | "cam" | "camfail">(null);
  const shared = { cam, bind, fallback: hubCam === "camfail" };
  // 11 พ.ย.: นอกเวลา 06.00–16.30 น. ไม่เปิดกล้อง (PDPA) · เข้าห้องเพื่อฝึกอิสระที่ไม่ใช้กล้องได้ · รอบที่เข้าสมุดคะแนนทำไม่ได้
  const hours = useSchoolHours(isLoggedIn);
  const camOk = !hours.open || hubCam === "camfail" || (hubCam === "cam" && cam.status !== "off");
  const camStopHub = cam.stop;
  useEffect(() => {
    if (!hours.open) camStopHub(); // 16.30 น. → กล้องดับทันที (สถานะกล้องเป็น off จึงต้องเทียบหน้าใหม่ตอน 06.00 น.)
  }, [hours.open, camStopHub]);

  // ป้าย “ถึงกำหนดทวน” บนปุ่มคำศัพท์ (อ่านจากข้อมูลในเครื่องทุกครั้งที่กลับมาหน้าเมนู)
  const setsPassed = isLoggedIn && section === "HUB" && email && typeof window !== "undefined" ? passedSetsLocal(email) : 0;

  const unlockSpeech = () => {
    // เบราว์เซอร์มือถือจะเล่นเสียงได้ก็ต่อเมื่อผู้ใช้กดปุ่มจริงก่อน 1 ครั้ง
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* ไม่เป็นไร */
    }
  };

  const setField = (k: ProfileField, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const formKey = (f: Form) => [cleanNamePart(f.first), cleanNamePart(f.last), f.room, String(Number(f.no))].join("|");
  const focusField = (k: ProfileField) => {
    if (typeof document !== "undefined") document.getElementById(`f-${k}`)?.focus();
  };

  const enter = (p: StudentProfile) => {
    const n = composeName(p);
    setProfile(p);
    setStudentName(n);
    setEmail(p.email);
    setIsLoggedIn(true);
    setSection("HUB");
    setCheck(null);
    setNotice("");
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name: n, email: p.email, profile: p }));
      localStorage.setItem(LAST_KEY, JSON.stringify(p));
    } catch {
      /* ไม่เป็นไร */
    }
    saveProfile(p); // ส่งข้อมูลแยกช่องขึ้นระบบ (ไม่ต้องรอ)
  };

  const handleLogin = async (e: React.FormEvent, confirmed = false) => {
    e.preventDefault();
    unlockSpeech();
    const errs = validateProfile(form);
    setErrors(errs);
    const firstBad = FIELD_ORDER.find((k) => errs[k]);
    if (firstBad) {
      focusField(firstBad);
      return;
    }
    const p: StudentProfile = {
      first: cleanNamePart(form.first),
      last: cleanNamePart(form.last),
      no: Number(form.no),
      room: form.room,
      email: form.email.trim().toLowerCase(),
    };
    const key = formKey(form);
    if (confirmed && check?.key === key) return enter(p);
    setChecking(true);
    const result = await checkRoster(p);
    setChecking(false);
    if (result === "ok" || result === "unknown") return enter(p);
    setCheck({ result, key });
  };

  const handleLogout = () => {
    cam.stop();
    setHubCam(null);
    setIsLoggedIn(false);
    setSection("HUB");
    setStudentName("");
    setEmail("");
    setProfile(null);
    setErrors({});
    setCheck(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ไม่เป็นไร */
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-start sm:justify-center p-3 sm:p-4 font-sans text-gray-800">
      <div className="w-full max-w-2xl bg-white shadow-2xl rounded-3xl p-5 md:p-10 border-t-[12px] border-[#003399] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-[#FFD700]"></div>

        {/* ── เข้าสู่ระบบ ── */}
        {!isLoggedIn && (
          <form onSubmit={(e) => handleLogin(e)} noValidate className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-8">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-32 h-32 mb-4 object-contain" />
              <h2 className="text-sm md:text-base font-bold text-[#003399] uppercase tracking-widest mb-1">Anukoolnaree School</h2>
              <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">Vocabulary Essential</h1>
              <div className="h-1 w-20 bg-[#FFD700] mt-2 rounded-full"></div>
            </div>

            <p className="text-gray-500 mb-6 text-sm md:text-base italic">&quot;Anukoolnaree students, let&apos;s master English for your future.&quot;</p>

            {notice && <p className="text-left text-sm font-bold bg-amber-50 text-amber-900 border-2 border-amber-200 rounded-2xl px-4 py-3 mb-5">{notice}</p>}

            <div className="text-left space-y-4 mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field id="first" label="ชื่อ" en="First name" error={errors.first}>
                  <input id="f-first" type="text" autoComplete="given-name" placeholder="เช่น สมชาย" value={form.first}
                    onChange={(e) => setField("first", e.target.value)} className={inputCls(!!errors.first)} />
                </Field>
                <Field id="last" label="นามสกุล" en="Last name" error={errors.last}>
                  <input id="f-last" type="text" autoComplete="family-name" placeholder="เช่น รักดี" value={form.last}
                    onChange={(e) => setField("last", e.target.value)} className={inputCls(!!errors.last)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field id="room" label="ชั้นเรียน" en="Class" error={errors.room}>
                  <div className="relative">
                    <select id="f-room" value={form.room} onChange={(e) => setField("room", e.target.value)} className={inputCls(!!errors.room) + " appearance-none pr-10"}>
                      <option value="">เลือกห้อง</option>
                      {GRADES.map((g) => (
                        <optgroup key={g.grade} label={g.label}>
                          {g.rooms.map((r) => (
                            <option key={r} value={r}>ม.{r}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#003399] text-sm">▼</span>
                  </div>
                </Field>
                <Field id="no" label="เลขที่" en="No." error={errors.no}>
                  <input id="f-no" type="text" inputMode="numeric" pattern="[0-9]*" placeholder={`1–${MAX_NO}`} value={form.no}
                    onChange={(e) => setField("no", e.target.value.replace(/\D/g, "").slice(0, 2))} className={inputCls(!!errors.no) + " tabular-nums"} />
                </Field>
              </div>
              <Field id="email" label="อีเมล" en="Gmail" error={errors.email}>
                <input id="f-email" type="email" autoComplete="email" placeholder="เช่น somchai.r@gmail.com" value={form.email}
                  onChange={(e) => setField("email", e.target.value)} className={inputCls(!!errors.email)} />
              </Field>
              <p className="text-xs text-gray-500 leading-relaxed">
                พิมพ์ชื่อ-นามสกุล<b>ภาษาไทยตามทะเบียนนักเรียน</b> ไม่ต้องใส่ นาย/นางสาว · ใช้อีเมลเดิมทุกครั้ง ผลการเรียนจะผูกกับอีเมลนี้
              </p>
            </div>

            {check && check.key === formKey(form) && check.result !== "ok" && check.result !== "unknown" && (
              <div className="text-left bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-5">
                <p className="text-sm font-bold text-amber-900">⚠️ {CHECK_MSG[check.result](form)}</p>
                <p className="text-xs text-amber-800 mt-1">ถ้าไม่แน่ใจเลขที่ ให้ถามครูก่อน เพื่อให้ครูเห็นคะแนนของคุณในรายชื่อที่ถูกต้อง</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" onClick={() => { setCheck(null); focusField(check.result === "notfound" || check.result === "mismatch" ? "no" : "first"); }}
                    className="px-4 py-2 rounded-xl bg-white border-2 border-amber-300 text-amber-900 font-bold text-sm">
                    แก้ไขข้อมูล
                  </button>
                  <button type="button" onClick={(e) => handleLogin(e, true)}
                    className="px-4 py-2 rounded-xl bg-amber-500 text-white font-bold text-sm">
                    ข้อมูลถูกต้อง เข้าสู่ระบบ
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={checking}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 transition-all duration-300 text-xl uppercase tracking-widest"
            >
              {checking ? "กำลังตรวจรายชื่อ..." : "Enter Dashboard"}
            </button>
          </form>
        )}

        {/* ภาพต้นทางของกล้อง (ซ่อน · อยู่ตลอดตอนเข้าระบบ) — เปลี่ยนหน้า/ห้องแล้วการตรวจไม่สะดุด */}
        {isLoggedIn && <CamSource cam={cam} />}

        {/* ── เมนูหลัก ── */}
        {isLoggedIn && section === "HUB" && (
          <div className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-6">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-20 h-20 mb-3 object-contain" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{(GRADES.find((g) => g.grade === gradeOf(profile?.room)) ?? GRADES[0]).hub}</h1>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">Choose your practice room</p>
              <p className="text-gray-500 text-xs mt-1">เลือกห้องที่อยากฝึกวันนี้ · สวัสดี {profile?.first ?? studentName.split(" ")[0]}</p>
              {profile && (
                <p className="mt-2 text-xs font-bold text-[#003399] bg-[#003399]/5 rounded-full px-3 py-1">
                  {profile.first} {profile.last} · ม.{profile.room} เลขที่ {profile.no}
                </p>
              )}
            </div>

            {/* กล้องก่อนเข้าห้อง */}
            <HoursNote hours={hours} />
            {!hours.open ? null : !camOk ? (
              <div className="text-left mb-5 rounded-2xl border-2 border-[#003399]/15 p-4 bg-[#003399]/[0.02]" data-hub-cam="gate">
                <p className="font-black text-[#003399] mb-1">📷 ขั้นแรก: เปิดกล้องก่อนเข้าห้องเรียน</p>
                <p className="text-xs font-bold text-gray-600 mb-3">ทำครั้งเดียวที่หน้านี้ แล้วเข้าได้ทั้ง 2 แถบ · กล้องเปิดค้างระหว่างเรียน (นับเฉพาะตอนทำแบบฝึกที่เข้าสมุดคะแนน) · ตั้งมือถือให้เห็นหน้า เก็บมือถือเครื่องอื่นให้พ้นกล้อง</p>
                <CamChooser
                  cam={cam}
                  want
                  setWant={() => undefined}
                  required
                  camRule="ใช้กล้องทุกคน · ประมวลผลในเครื่อง ไม่บันทึกภาพ"
                  noCamRule={`ข้อละ ${Q_TIME_MS / 1000} วินาที`}
                  startLabel="เข้าห้องเรียน"
                  onStart={(cm) => setHubCam(cm === "cam" ? "cam" : "camfail")}
                />
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-2 text-left" data-hub-cam="ok">
                {hubCam === "cam" && <div className="w-20 shrink-0"><CamBox cam={cam} /></div>}
                <p className="text-xs font-bold text-emerald-800">
                  {hubCam === "cam" ? "✓ กล้องพร้อม — เลือกห้องได้เลย (กล้องเปิดค้างจนกดออกจากระบบ)" : "✓ ครูอนุญาตไม่ใช้กล้องแล้ว (เครื่องนี้) — ทำแบบจับเวลา"}
                </p>
              </div>
            )}

            {!camOk ? null : isM4 ? (
              /* ม.4 (อ31206) คาบเดี่ยว 45 นาที เรียนเฉพาะห้องถอดรหัสคำศัพท์ · ห้องคำศัพท์แกน 120 คำเป็นของ ม.6 (อ33102) */
              <div className="text-left mb-6">
                <RoomCard
                  top="คาบละ"
                  big="45"
                  bottom="นาที"
                  icon="🧩"
                  title="ถอดรหัสคำศัพท์ ม.4"
                  sub="Root Words Decoder · ปูพื้นฐาน · 14 คาบ ตรงกับแบบเรียน ม.4"
                  hint="เรียนตามแบบเรียน → ตั๋วออกคาบละ 10 ข้อ ถูก 8 ข้อขึ้นไปผ่าน"
                  onClick={() => setSection("DECODER")}
                />
              </div>
            ) : (
              /* ม.6 คาบคู่ อ33102: เรียงตามลำดับที่เรียนจริง → คาบที่ 1 🧩 · พัก 5 นาที · คาบที่ 2 📚 */
              <div className="text-left mb-6">
                <p className="text-center text-[11px] font-black text-[#003399]/60 tracking-wide mb-2">
                  เรียงตามลำดับในคาบคู่ 90 นาที · เริ่มจากคาบที่ 1
                </p>
                <RoomCard
                  top="คาบที่"
                  big="1"
                  bottom="45 นาที"
                  icon="🧩"
                  title="ถอดรหัสคำศัพท์"
                  sub="Root Words Decoder · ปัจจัย • อุปสรรค • รากศัพท์ · 14 บท"
                  hint="เรียนบทในแบบเรียน → แบบฝึกหัด 15 ข้อ ต้องถูกครบ"
                  onClick={() => setSection("DECODER")}
                />
                <div className="flex items-center gap-3 py-2.5" aria-hidden="true">
                  <span className="flex-1 border-t-2 border-dashed border-[#003399]/15" />
                  <span className="text-[11px] font-bold text-gray-400 whitespace-nowrap">☕ พัก 5 นาที แล้วต่อคาบที่ 2</span>
                  <span className="flex-1 border-t-2 border-dashed border-[#003399]/15" />
                </div>
                <RoomCard
                  top="คาบที่"
                  big="2"
                  bottom="45 นาที"
                  icon="📚"
                  title={CORE_NAME}
                  sub="TGAT · A-Level · 12 ชุด ชุดละ 10 คำ · เรียนแบบ 5 ขั้น"
                  hint="เรียนชุดของสัปดาห์ 10 คำ → รอบทบทวนถูกครบ = ผ่าน ✓"
                  badge={setsPassed > 0 ? `ผ่าน ${setsPassed} ชุด` : undefined}
                  onClick={() => setSection("VOCAB")}
                />
              </div>
            )}

            <button
              onClick={handleLogout}
              className="w-full py-3 bg-white text-gray-400 font-bold rounded-xl hover:text-[#003399] transition-all duration-150 text-sm uppercase"
            >
              🔄 Switch Student Account
            </button>
          </div>
        )}

        {isLoggedIn && section === "VOCAB" && <VocabRoom email={email} name={studentName} onExit={() => setSection("HUB")} shared={shared} />}

        {isLoggedIn && section === "DECODER" && (
          <CourseRoom key={isM4 ? "decoder4" : "decoder"} courseId={isM4 ? "decoder4" : "decoder"} email={email} name={studentName} onExit={() => setSection("HUB")} shared={shared} />
        )}
      </div>
      <p className="mt-8 text-[10px] text-gray-400 font-bold tracking-[0.3em] uppercase">© Anukoolnaree School | Vocabulary Essential M.6</p>
    </div>
  );
}

// ── ช่องกรอกข้อมูล ──
function inputCls(bad: boolean): string {
  return `w-full p-4 border-2 rounded-2xl focus:outline-none focus:ring-2 bg-gray-50/50 transition-all font-medium ${
    bad ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-gray-100 focus:border-[#FFD700] focus:ring-[#FFD700]/20"
  }`;
}
function Field({ id, label, en, error, children }: { id: string; label: string; en: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={`f-${id}`} className="block text-sm font-bold text-[#003399] mb-1.5">
        {label} <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">{en}</span> <span className="text-rose-500">*</span>
      </label>
      {children}
      {error && <p className="text-xs font-bold text-rose-600 mt-1">{error}</p>}
    </div>
  );
}

// ── แถบห้องในเมนูหลัก: ช่องซ้ายบอกลำดับคาบ (สีกรม-ทองของโรงเรียน) · ทุกแถบหน้าตาเดียวกัน ──
function RoomCard({ top, big, bottom, icon, title, sub, hint, badge, onClick }: {
  top: string; big: string; bottom: string; icon: string; title: string; sub: string; hint: string; badge?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-stretch bg-white border-2 border-[#003399]/15 rounded-2xl overflow-hidden shadow-sm hover:border-[#003399]/50 hover:shadow-md active:scale-[0.99] transition-all text-left"
    >
      <span className="w-16 sm:w-[4.5rem] shrink-0 flex flex-col items-center justify-center gap-1 bg-[#003399] py-4 border-r-4 border-[#FFD700]">
        <span className="text-[10px] font-bold text-white/75 leading-none">{top}</span>
        <span className="text-3xl font-black text-[#FFD700] leading-none">{big}</span>
        <span className="text-[10px] font-bold text-white/75 leading-none whitespace-nowrap">{bottom}</span>
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-3 px-3 sm:px-4 py-4">
        <span className="hidden sm:block text-3xl shrink-0" aria-hidden="true">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-black text-lg text-[#003399] leading-tight">
            <span className="sm:hidden" aria-hidden="true">{icon} </span>
            {title}
          </span>
          <span className="block text-xs text-gray-500 font-bold mt-1">{sub}</span>
          <span className="block text-[11px] text-[#003399]/70 font-bold mt-1">{hint}</span>
        </span>
        {badge ? (
          <span className="shrink-0 text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full whitespace-nowrap">{badge}</span>
        ) : (
          <span className="shrink-0 text-[#003399] text-xl transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
        )}
      </span>
    </button>
  );
}
