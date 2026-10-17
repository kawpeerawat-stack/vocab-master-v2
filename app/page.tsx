"use client";
// app/page.tsx
// ─────────────────────────────────────────────────────────────
// หน้าหลักของนักเรียน: เข้าสู่ระบบ (ชื่อ + อีเมล) → เลือกห้อง
//   📚 คำศัพท์แกน 300 คำ (VocabRoom)  — เรียนแบบ 5 ขั้น + ทวนเว้นวัน
//   🧩 ถอดรหัสคำศัพท์ (CourseRoom)     — บทเรียน Prefix • Root • Suffix
// (ระบบคลังคำ 3,000+ คำแบบเดิมถูกนำออกแล้ว — ข้อมูลเก่าใน Firestore ยังเก็บไว้ ไม่ได้ลบ)
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import CourseRoom from "./_components/CourseRoom";
import VocabRoom, { dueCountLocal } from "./_components/VocabRoom";

const SCHOOL_LOGO_URL = "/logo.png";
const SESSION_KEY = "vm_student"; // จำการเข้าสู่ระบบไว้ในแท็บนี้ (กันกดรีเฟรชแล้วต้องกรอกใหม่)

type Section = "HUB" | "VOCAB" | "DECODER";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [section, setSection] = useState<Section>("HUB");
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");

  // กู้การเข้าสู่ระบบเดิมในแท็บนี้ (ทำหลังโหลดหน้า เพื่อให้หน้าแรกตรงกับที่เซิร์ฟเวอร์สร้างไว้)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { name: string; email: string };
        if (s.name && s.email) {
          setStudentName(s.name);
          setEmail(s.email);
          setIsLoggedIn(true);
        }
      }
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ป้าย “ถึงกำหนดทวน” บนปุ่มคำศัพท์ (อ่านจากข้อมูลในเครื่องทุกครั้งที่กลับมาหน้าเมนู)
  const dueCount = isLoggedIn && section === "HUB" && email && typeof window !== "undefined" ? dueCountLocal(email) : 0;

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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    unlockSpeech();
    const n = studentName.trim();
    const m = email.trim().toLowerCase();
    if (!n || !m || !m.includes("@")) return;
    setStudentName(n);
    setEmail(m);
    setIsLoggedIn(true);
    setSection("HUB");
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name: n, email: m }));
    } catch {
      /* ไม่เป็นไร */
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setSection("HUB");
    setStudentName("");
    setEmail("");
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
          <form onSubmit={handleLogin} className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-8">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-32 h-32 mb-4 object-contain" />
              <h2 className="text-sm md:text-base font-bold text-[#003399] uppercase tracking-widest mb-1">Anukoolnaree School</h2>
              <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">Vocabulary Essential</h1>
              <div className="h-1 w-20 bg-[#FFD700] mt-2 rounded-full"></div>
            </div>

            <p className="text-gray-500 mb-8 text-sm md:text-base italic">&quot;Anukoolnaree students, let&apos;s master English for your future.&quot;</p>

            <div className="text-left space-y-5 mb-8">
              <div>
                <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">Full Name & Student ID</label>
                <input
                  type="text"
                  placeholder="Example: Somchai Rakdee No.1 M.6/1"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] focus:ring-2 focus:ring-[#FFD700]/20 bg-gray-50/50 transition-all font-medium"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">Email (Gmail Only)</label>
                <input
                  type="email"
                  placeholder="Example: anukoolnaree.student@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] focus:ring-2 focus:ring-[#FFD700]/20 bg-gray-50/50 transition-all font-medium"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!studentName.trim() || !email.trim() || !email.includes("@")}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 transition-all duration-300 text-xl uppercase tracking-widest"
            >
              Enter Dashboard
            </button>
          </form>
        )}

        {/* ── เมนูหลัก ── */}
        {isLoggedIn && section === "HUB" && (
          <div className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-6">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-20 h-20 mb-3 object-contain" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">Grade 12 Mastery Hub</h1>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">Choose your practice room</p>
              <p className="text-gray-500 text-xs mt-1">เลือกห้องที่อยากฝึกวันนี้ · สวัสดี {studentName.split(" ")[0]}</p>
            </div>

            <div className="space-y-3 text-left mb-6">
              <button
                type="button"
                onClick={() => setSection("VOCAB")}
                className="w-full p-5 bg-[#003399] text-white rounded-2xl shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-4 text-left"
              >
                <span className="text-3xl">📚</span>
                <span className="flex-1">
                  <span className="block font-black text-lg text-[#FFD700]">คำศัพท์แกน 300 คำ</span>
                  <span className="block text-xs text-white/80 font-bold">TGAT · A-Level · เรียนแบบ 5 ขั้น · 10 สัปดาห์</span>
                </span>
                {dueCount > 0 ? (
                  <span className="text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full whitespace-nowrap">ทวน {dueCount} คำ</span>
                ) : (
                  <span className="text-[#FFD700] text-xl">→</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSection("DECODER")}
                className="w-full p-5 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.98] transition-all flex items-center gap-4 text-left"
              >
                <span className="text-3xl">🧩</span>
                <span className="flex-1">
                  <span className="block font-black text-lg text-[#003399]">ถอดรหัสคำศัพท์</span>
                  <span className="block text-xs text-gray-500 font-bold">Root Words Decoder · Prefix • Root • Suffix · 18 บท</span>
                </span>
                <span className="text-[#003399] text-xl">→</span>
              </button>
            </div>

            <button
              onClick={handleLogout}
              className="w-full py-3 bg-white text-gray-400 font-bold rounded-xl hover:text-[#003399] transition-all duration-150 text-sm uppercase"
            >
              🔄 Switch Student Account
            </button>
          </div>
        )}

        {isLoggedIn && section === "VOCAB" && <VocabRoom email={email} name={studentName} onExit={() => setSection("HUB")} />}

        {isLoggedIn && section === "DECODER" && (
          <CourseRoom courseId="decoder" email={email} name={studentName} onExit={() => setSection("HUB")} />
        )}
      </div>
      <p className="mt-8 text-[10px] text-gray-400 font-bold tracking-[0.3em] uppercase">© Anukoolnaree School | Vocabulary Essential M.6</p>
    </div>
  );
}
