"use client";
// app/admin/page.tsx
// ─────────────────────────────────────────────────────────────
// แดชบอร์ดครู
//   📚 คำศัพท์แกน 300 คำ (ค่าเริ่มต้น) — ดู app/admin/_vocab/VocabAdmin.tsx
//   🧩 คอร์สบทเรียน เช่น Root Words Decoder:
//   • ตารางรายคน: นักเรียนแต่ละคนผ่านบทไหนแล้ว (ผ่าน = ตอบถูกครบ 20/20)
//   • มุมมองรายบท: ใครผ่าน / ทำแล้วยังไม่ผ่าน / ยังไม่ทำ + ข้อที่นักเรียนพลาดบ่อย
//   • จับคู่ชื่อที่นักเรียนพิมพ์กับรายชื่อทางการ (data/roster.json) → เรียงตามห้องและเลขที่
//   • ส่งออก CSV
// เพิ่มคอร์สใหม่ในอนาคต: เพิ่มใน app/lib/courseRegistry.ts แล้วหน้านี้จะมีแท็บคอร์สใหม่ให้เอง
// ─────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import {
  COURSE_REGISTRY,
  Course,
  CourseProgress,
  LessonProgress,
  loadCourse,
  mergeCourseProgress,
} from "../lib/courses";
import { ROSTER, ROOMS, extractNo, fmtThaiTime, matchRoster, roomOf, rosterKey } from "../lib/roster";
import { VCourse, VProgress, loadVocab300 } from "../lib/vocab300";
import VocabAdmin from "./_vocab/VocabAdmin";

// ── สิทธิ์เข้าหน้า /admin (เหมือนเดิม) ──
const ADMIN_EMAIL = "kawpeerawat@gmail.com";
// ตั้งรหัสผ่านจริงผ่าน Vercel → Environment Variables: NEXT_PUBLIC_ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "anukoolnaree2025";
const ADMIN_USING_DEFAULT_PW = !process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

// ── รายชื่อทางการ + จับคู่ชื่อ (ใช้ร่วมกับหน้าคำศัพท์ 300) ──
const ROSTER_ROOMS = ROOMS;
// ── ข้อมูลนักเรียนจาก Firestore (อ่านเฉพาะฟิลด์ที่ใช้) ──
type StudentDoc = {
  id: string;
  name?: string;
  email?: string;
  courses?: Record<string, CourseProgress>;
  courseActiveAt?: number;
  v300?: VProgress;
  v300At?: number;
};

type Row = {
  key: string;
  room: string | null;
  no: number | null;
  name: string;          // ชื่อทางการ (หรือชื่อที่พิมพ์ ถ้าจับคู่ไม่ได้)
  typedNames: string[];  // ชื่อที่นักเรียนพิมพ์ในแอป
  emails: string[];
  progress: CourseProgress;
  activeAt: number;
  inRoster: boolean;
};

function fmtDate(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

type Status = "passed" | "tried" | "none";
const statusOf = (p?: LessonProgress): Status => (p?.passed ? "passed" : p ? "tried" : "none");

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);

  const [area, setArea] = useState<"vocab300" | "course">("vocab300");
  const [v300, setV300] = useState<VCourse | null>(null);
  const [courseId, setCourseId] = useState(COURSE_REGISTRY[0]?.id ?? "decoder");
  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [error, setError] = useState("");

  const [roomFilter, setRoomFilter] = useState<string>("ALL");
  const [mode, setMode] = useState<"matrix" | "lesson">("matrix");
  const [lessonId, setLessonId] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    try {
      if (sessionStorage.getItem("vocab_admin_ok") === "1") setAuthed(true);
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, vc, snap] = await Promise.all([loadCourse(courseId), loadVocab300(), getDocs(collection(db, "students"))]);
      setCourse(c);
      setV300(vc);
      const data: StudentDoc[] = [];
      snap.forEach((d) => {
        const v = d.data() as Record<string, unknown>;
        data.push({
          id: d.id,
          name: v.name as string | undefined,
          email: v.email as string | undefined,
          courses: v.courses as Record<string, CourseProgress> | undefined,
          courseActiveAt: v.courseActiveAt as number | undefined,
          v300: v.v300 as VProgress | undefined,
          v300At: v.v300At as number | undefined,
        });
      });
      setStudents(data);
      setLoadedAt(Date.now());
      setLessonId((prev) => prev || c.lessons[0]?.id || "");
    } catch (e) {
      console.error(e);
      setError("โหลดข้อมูลไม่สำเร็จ ลองกดรีเฟรชอีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (authed) loadAll();
  }, [authed, loadAll]);

  // ── รวมข้อมูลเป็นแถวตามรายชื่อทางการ ──
  const rows: Row[] = useMemo(() => {
    const byRoster: Record<string, Row> = {};
    for (const r of ROSTER) {
      byRoster[rosterKey(r)] = {
        key: rosterKey(r), room: r.room, no: r.no, name: r.name,
        typedNames: [], emails: [], progress: {}, activeAt: 0, inRoster: true,
      };
    }
    const extra: Row[] = [];
    for (const s of students) {
      const prog = s.courses?.[courseId];
      const hasProgress = !!prog && Object.keys(prog).length > 0;
      const hit = matchRoster(s.name);
      if (hit) {
        const row = byRoster[rosterKey(hit)];
        if (s.name && !row.typedNames.includes(s.name)) row.typedNames.push(s.name);
        if (s.email) row.emails.push(s.email);
        if (hasProgress) row.progress = mergeCourseProgress(row.progress, prog!);
        row.activeAt = Math.max(row.activeAt, s.courseActiveAt ?? 0);
      } else if (hasProgress) {
        extra.push({
          key: `x|${s.id}`, room: roomOf(s.name), no: extractNo(s.name), name: s.name || s.email || s.id,
          typedNames: s.name ? [s.name] : [], emails: s.email ? [s.email] : [], progress: prog!,
          activeAt: s.courseActiveAt ?? 0, inRoster: false,
        });
      }
    }
    const rosterRows = Object.values(byRoster).sort((a, b) => (a.room! < b.room! ? -1 : a.room! > b.room! ? 1 : (a.no ?? 0) - (b.no ?? 0)));
    return [...rosterRows, ...extra];
  }, [students, courseId]);

  const lessons = course?.lessons ?? [];
  const inRoom = (r: Row) => roomFilter === "ALL" || r.room === roomFilter;
  const q = search.trim().toLowerCase();
  const matchSearch = (r: Row) =>
    !q || r.name.toLowerCase().includes(q) || r.typedNames.some((t) => t.toLowerCase().includes(q)) || r.emails.some((e) => e.includes(q));
  const rosterRows = rows.filter((r) => r.inRoster && inRoom(r) && matchSearch(r));
  const extraRows = rows.filter((r) => !r.inRoster && inRoom(r) && matchSearch(r));
  const passedCountOf = (r: Row) => lessons.filter((l) => r.progress[l.id]?.passed).length;

  // ── สรุปภาพรวมของห้องที่เลือก ──
  const summary = useMemo(() => {
    const list = rows.filter((r) => r.inRoster && inRoom(r));
    const started = list.filter((r) => Object.keys(r.progress).length > 0).length;
    const allDone = lessons.length ? list.filter((r) => lessons.every((l) => r.progress[l.id]?.passed)).length : 0;
    const totalPassed = list.reduce((s, r) => s + lessons.filter((l) => r.progress[l.id]?.passed).length, 0);
    return { n: list.length, started, allDone, avg: list.length ? totalPassed / list.length : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, roomFilter, lessons]);

  const lessonStats = useMemo(() => {
    const list = rows.filter((r) => r.inRoster && inRoom(r));
    return lessons.map((l) => {
      let passed = 0, tried = 0;
      for (const r of list) {
        const st = statusOf(r.progress[l.id]);
        if (st === "passed") passed++;
        else if (st === "tried") tried++;
      }
      return { id: l.id, passed, tried, none: list.length - passed - tried, n: list.length };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, roomFilter, lessons]);

  // ── CSV ──
  const downloadCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["ห้อง", "เลขที่", "ชื่อ-สกุล", "ชื่อที่พิมพ์ในแอป", "อีเมล", ...lessons.map((l) => `ชม.${l.hour}`), "ผ่าน (บท)", "ทำล่าสุด"];
    const list = [...rosterRows, ...extraRows];
    const lines = list.map((r) =>
      [
        r.room ?? "", r.no ?? "", r.name, r.typedNames.join(" / "), r.emails.join(" / "),
        ...lessons.map((l) => {
          const p = r.progress[l.id];
          return p?.passed ? "ผ่าน" : p ? `${p.best}/${p.total}` : "";
        }),
        `${passedCountOf(r)}/${lessons.length}`,
        r.activeAt ? new Date(r.activeAt).toLocaleString("th-TH") : "",
      ].map(esc).join(",")
    );
    const csv = "﻿" + [headers.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${courseId}-progress-${roomFilter === "ALL" ? "all" : roomFilter.replace("/", "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const submitPw = () => {
    if (pw === ADMIN_PASSWORD) {
      setAuthed(true);
      setPwError(false);
      try { sessionStorage.setItem("vocab_admin_ok", "1"); } catch { /* ไม่เป็นไร */ }
    } else {
      setPwError(true);
    }
  };

  // ───────────────── หน้าเข้าสู่ระบบ ─────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#f3f5fa] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border-t-8 border-[#003399] rounded-3xl p-8 shadow-xl">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔒</div>
            <h1 className="text-xl font-black text-[#003399]">แดชบอร์ดครู</h1>
            <p className="text-xs text-gray-500 mt-1">สำหรับ {ADMIN_EMAIL} เท่านั้น</p>
          </div>
          <label className="block text-xs font-bold text-gray-500 mb-1">รหัสผ่าน</label>
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
          <button onClick={submitPw} className="w-full mt-4 bg-[#003399] hover:bg-[#002266] text-[#FFD700] font-black rounded-xl py-3">
            เข้าสู่ระบบ
          </button>
          {ADMIN_USING_DEFAULT_PW && (
            <p className="text-amber-700 text-[10px] mt-4 leading-relaxed">
              ⚠️ กำลังใช้รหัสผ่านเริ่มต้น — แนะนำให้ตั้ง <span className="font-mono">NEXT_PUBLIC_ADMIN_PASSWORD</span> ใน Vercel แล้ว Redeploy
            </p>
          )}
        </div>
      </div>
    );
  }

  const lessonSel = lessons.find((l) => l.id === lessonId) ?? lessons[0];

  return (
    <div className="min-h-screen bg-[#f3f5fa] text-gray-800 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* ── หัวเรื่อง ── */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-xs font-black text-[#003399] tracking-widest uppercase">Teacher Dashboard</p>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">
              แดชบอร์ดครู · {area === "vocab300" ? "คำศัพท์แกน 300 คำ" : "ติดตามบทเรียน"}
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {area === "vocab300" ? "รู้แล้ว = ตอบถูกในวันที่ต่างกันอย่างน้อย 2 วัน" : "ผ่าน = ตอบถูกครบทุกข้อในบท (20/20)"} · อัปเดตล่าสุด {loadedAt ? fmtThaiTime(loadedAt) : "–"}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadAll} disabled={loading} className="px-4 py-2 bg-white border-2 border-[#003399]/20 text-[#003399] font-bold rounded-xl disabled:opacity-50">
              {loading ? "⏳ กำลังโหลด..." : "🔄 รีเฟรช"}
            </button>
            {area === "course" && (
              <button onClick={downloadCsv} disabled={!course} className="px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl disabled:opacity-50">
                ⬇ CSV
              </button>
            )}
          </div>
        </div>

        {/* ── เลือกคอร์ส (รองรับหลายคอร์สในอนาคต) ── */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => setArea("vocab300")}
            className={`px-4 py-2 rounded-xl font-black text-sm ${area === "vocab300" ? "bg-[#003399] text-[#FFD700]" : "bg-white text-gray-600 border border-gray-200"}`}
          >
            📚 คำศัพท์แกน 300 คำ <span className="font-bold opacity-70">(Core 300)</span>
          </button>
          {COURSE_REGISTRY.map((c) => (
            <button
              key={c.id}
              onClick={() => { setArea("course"); setCourseId(c.id); setLessonId(""); }}
              className={`px-4 py-2 rounded-xl font-black text-sm ${area === "course" && courseId === c.id ? "bg-[#003399] text-[#FFD700]" : "bg-white text-gray-600 border border-gray-200"}`}
            >
              {c.icon} {c.titleTh} <span className="font-bold opacity-70">({c.title})</span>
            </button>
          ))}
        </div>

        {/* ── ห้อง + โหมด + ค้นหา ── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {["ALL", ...ROSTER_ROOMS].map((r) => (
            <button
              key={r}
              onClick={() => setRoomFilter(r)}
              className={`px-3 py-1.5 rounded-full text-sm font-bold ${roomFilter === r ? "bg-[#FFD700] text-[#003399]" : "bg-white text-gray-600 border border-gray-200"}`}
            >
              {r === "ALL" ? "ทุกห้อง" : `ม.${r}`}
            </button>
          ))}
          {area === "course" && <span className="mx-1 text-gray-300">|</span>}
          {area === "course" && <button onClick={() => setMode("matrix")} className={`px-3 py-1.5 rounded-full text-sm font-bold ${mode === "matrix" ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            ตารางรายคน
          </button>}
          {area === "course" && <button onClick={() => setMode("lesson")} className={`px-3 py-1.5 rounded-full text-sm font-bold ${mode === "lesson" ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            รายบท
          </button>}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ / อีเมล"
            className="ml-auto w-full sm:w-56 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-[#003399]"
          />
        </div>

        {error && <p className="bg-rose-50 text-rose-700 font-bold rounded-xl p-3 mb-4">{error}</p>}
        {(area === "vocab300" ? !v300 : !course) && loading && <p className="text-center text-[#003399] font-bold animate-pulse py-10">กำลังโหลดข้อมูล...</p>}

        {area === "vocab300" && v300 && <VocabAdmin course={v300} students={students} roomFilter={roomFilter} search={search} />}

        {area === "course" && course && (
          <>
            {/* ── การ์ดสรุป ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                [summary.n, `นักเรียนในรายชื่อ${roomFilter === "ALL" ? "" : ` ม.${roomFilter}`}`],
                [summary.started, "เริ่มทำแล้ว (อย่างน้อย 1 บท)"],
                [summary.avg.toFixed(1), `ผ่านเฉลี่ย (บท/คน จาก ${lessons.length})`],
                [summary.allDone, `ผ่านครบทั้ง ${lessons.length} บท`],
              ].map(([v, label], i) => (
                <div key={i} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <div className="text-3xl font-black text-[#003399] tabular-nums">{v}</div>
                  <div className="text-xs text-gray-500 font-bold">{label}</div>
                </div>
              ))}
            </div>

            {/* ── แถบสถิติรายบท ── */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="font-black text-gray-900">สัดส่วนผู้ผ่านรายบท</h2>
                <div className="flex gap-3 text-[11px] font-bold text-gray-500">
                  <span><span className="inline-block w-3 h-3 rounded bg-emerald-500 align-middle mr-1" />ผ่าน</span>
                  <span><span className="inline-block w-3 h-3 rounded bg-amber-400 align-middle mr-1" />ทำแล้วยังไม่ผ่าน</span>
                  <span><span className="inline-block w-3 h-3 rounded bg-gray-200 align-middle mr-1" />ยังไม่ทำ</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {lessons.map((l, i) => {
                  const st = lessonStats[i];
                  const w = (x: number) => (st && st.n ? (x / st.n) * 100 : 0);
                  return (
                    <button
                      key={l.id}
                      onClick={() => { setLessonId(l.id); setMode("lesson"); }}
                      className="flex items-center gap-2 text-left hover:bg-gray-50 rounded-lg px-1"
                      title={`${l.titleEn} — ${l.titleTh}`}
                    >
                      <span className="w-12 shrink-0 text-xs font-black text-[#003399]">ชม.{l.hour}</span>
                      <span className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden flex">
                        <span className="bg-emerald-500 h-full" style={{ width: `${w(st?.passed ?? 0)}%` }} />
                        <span className="bg-amber-400 h-full" style={{ width: `${w(st?.tried ?? 0)}%` }} />
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs font-bold tabular-nums text-gray-600">
                        {st?.passed ?? 0}/{st?.n ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── ตารางรายคน ── */}
            {mode === "matrix" && (
              <div className="bg-white rounded-2xl border border-gray-100 mb-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#003399] text-white">
                        <th className="sticky left-0 z-10 bg-[#003399] text-left px-3 py-2 font-black min-w-[220px]">นักเรียน</th>
                        {lessons.map((l) => (
                          <th key={l.id} className="px-1 py-2 font-black text-[11px] min-w-[38px]" title={`${l.titleEn} — ${l.titleTh}`}>
                            {l.hour}
                          </th>
                        ))}
                        <th className="px-3 py-2 font-black text-[11px] whitespace-nowrap">ผ่าน</th>
                        <th className="px-3 py-2 font-black text-[11px] whitespace-nowrap text-left">ทำล่าสุด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rosterRows, ...extraRows].map((r, i, arr) => {
                        const showRoomHeader = roomFilter === "ALL" && r.inRoster && (i === 0 || arr[i - 1].room !== r.room);
                        const firstExtra = !r.inRoster && (i === 0 || arr[i - 1].inRoster);
                        const pc = passedCountOf(r);
                        return (
                          <React.Fragment key={r.key}>
                            {showRoomHeader && (
                              <tr><td colSpan={lessons.length + 3} className="bg-[#FFD700]/30 text-[#003399] font-black px-3 py-1.5 text-xs">ม.{r.room}</td></tr>
                            )}
                            {firstExtra && (
                              <tr><td colSpan={lessons.length + 3} className="bg-rose-50 text-rose-700 font-black px-3 py-1.5 text-xs">บัญชีที่จับคู่รายชื่อไม่ได้ (พิมพ์ชื่อไม่ตรงรายชื่อทางการ) — ตรวจสอบชื่อที่พิมพ์</td></tr>
                            )}
                            <tr className="border-b border-gray-100 hover:bg-blue-50/40">
                              <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                                <div className="font-bold text-gray-900 truncate max-w-[260px]">
                                  {r.no != null && <span className="text-gray-400 font-black mr-1 tabular-nums">{r.no}.</span>}
                                  {r.name}
                                </div>
                                {r.typedNames.length > 0 && r.inRoster && (
                                  <div className="text-[10px] text-gray-400 truncate max-w-[260px]">พิมพ์ว่า: {r.typedNames.join(" / ")}</div>
                                )}
                                {!r.inRoster && <div className="text-[10px] text-gray-400 truncate max-w-[260px]">{r.emails.join(" / ")}</div>}
                              </td>
                              {lessons.map((l) => {
                                const p = r.progress[l.id];
                                const st = statusOf(p);
                                const tip = p
                                  ? `ชม.${l.hour} ${l.titleEn}\nดีที่สุด ${p.best}/${p.total} · ล่าสุด ${p.last}/${p.total} · ทำ ${p.attempts} รอบ${p.passedAt ? `\nผ่านเมื่อ ${new Date(p.passedAt).toLocaleString("th-TH")}` : ""}`
                                  : `ชม.${l.hour} ยังไม่ทำ`;
                                return (
                                  <td key={l.id} className="text-center px-0.5 py-1" title={tip}>
                                    {st === "passed" ? (
                                      <span className="inline-flex w-7 h-7 rounded-lg bg-emerald-500 text-white font-black items-center justify-center text-xs">✓</span>
                                    ) : st === "tried" ? (
                                      <span className="inline-flex w-7 h-7 rounded-lg bg-amber-100 text-amber-800 font-black items-center justify-center text-[11px] tabular-nums">{p!.best}</span>
                                    ) : (
                                      <span className="inline-flex w-7 h-7 rounded-lg bg-gray-50 text-gray-300 items-center justify-center text-xs">·</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="text-center px-3 py-1 font-black tabular-nums whitespace-nowrap">
                                <span className={pc === lessons.length && lessons.length > 0 ? "text-emerald-600" : pc > 0 ? "text-[#003399]" : "text-gray-300"}>
                                  {pc}/{lessons.length}
                                </span>
                              </td>
                              <td className="px-3 py-1 text-xs text-gray-500 whitespace-nowrap">{r.activeAt ? fmtThaiTime(r.activeAt) : "–"}</td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 px-4 py-3">
                  ✓ = ผ่าน (20/20) · ตัวเลข = คะแนนดีที่สุดที่ยังไม่ผ่าน · ชี้ที่ช่องเพื่อดูจำนวนรอบและวันที่ผ่าน · หัวคอลัมน์ = ชั่วโมงที่
                </p>
              </div>
            )}

            {/* ── มุมมองรายบท ── */}
            {mode === "lesson" && lessonSel && (
              <LessonPanel
                course={course}
                lessonId={lessonSel.id}
                setLessonId={setLessonId}
                rows={[...rosterRows, ...extraRows]}
                roomFilter={roomFilter}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── รายละเอียดรายบท: ใครผ่าน / ยังไม่ผ่าน / ยังไม่ทำ + ข้อที่พลาดบ่อย ──
function LessonPanel({
  course,
  lessonId,
  setLessonId,
  rows,
  roomFilter,
}: {
  course: Course;
  lessonId: string;
  setLessonId: (id: string) => void;
  rows: Row[];
  roomFilter: string;
}) {
  const lesson = course.lessons.find((l) => l.id === lessonId)!;
  const groups: Record<Status, Row[]> = { passed: [], tried: [], none: [] };
  for (const r of rows) {
    const st = statusOf(r.progress[lesson.id]);
    if (!r.inRoster && st === "none") continue;
    groups[st].push(r);
  }
  // ข้อที่พลาดบ่อย (รวมทุกคนในมุมมองนี้)
  const missedAgg: Record<string, { times: number; people: number }> = {};
  for (const r of rows) {
    const m = r.progress[lesson.id]?.missed;
    if (!m) continue;
    for (const [qid, n] of Object.entries(m)) {
      (missedAgg[qid] ||= { times: 0, people: 0 }).times += n;
      missedAgg[qid].people += 1;
    }
  }
  const qById = Object.fromEntries(lesson.questions.map((q) => [q.id, q]));
  const topMissed = Object.entries(missedAgg)
    .filter(([id]) => qById[id])
    .sort((a, b) => b[1].people - a[1].people || b[1].times - a[1].times)
    .slice(0, 8);

  const label = (r: Row) => `${roomFilter === "ALL" && r.room ? `ม.${r.room} ` : ""}${r.no != null ? `${r.no}. ` : ""}${r.name}`;
  const strip = (t: string) => t.replace(/\*\*/g, "");

  const Col = ({ title, list, cls, render }: { title: string; list: Row[]; cls: string; render: (r: Row) => React.ReactNode }) => (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className={`px-4 py-2 font-black text-sm ${cls}`}>{title} · {list.length} คน</div>
      <ul className="max-h-[420px] overflow-y-auto divide-y divide-gray-50">
        {list.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">—</li>}
        {list.map((r) => (
          <li key={r.key} className="px-4 py-1.5 text-sm flex justify-between gap-2">
            <span className="truncate">{label(r)}</span>
            <span className="shrink-0 text-xs text-gray-500 tabular-nums">{render(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={lesson.id}
          onChange={(e) => setLessonId(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 font-bold text-sm bg-white outline-none focus:border-[#003399]"
        >
          {course.lessons.map((l) => (
            <option key={l.id} value={l.id}>ชม.{l.hour} · {l.titleEn} — {l.titleTh}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{lesson.questions.length} ข้อ · ผ่านเมื่อถูกครบทุกข้อ</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Col title="✓ ผ่านแล้ว" list={groups.passed} cls="bg-emerald-50 text-emerald-700" render={(r) => `${fmtDate(r.progress[lesson.id]?.passedAt)} · ${r.progress[lesson.id]?.attempts} รอบ`} />
        <Col title="ทำแล้ว ยังไม่ผ่าน" list={groups.tried} cls="bg-amber-50 text-amber-800" render={(r) => `ดีสุด ${r.progress[lesson.id]?.best}/${r.progress[lesson.id]?.total} · ${r.progress[lesson.id]?.attempts} รอบ`} />
        <Col title="ยังไม่ได้ทำ" list={groups.none} cls="bg-gray-100 text-gray-600" render={() => ""} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="font-black text-gray-900 mb-2">ข้อที่นักเรียนพลาดบ่อยในบทนี้</h3>
        {topMissed.length === 0 ? (
          <p className="text-xs text-gray-400">ยังไม่มีข้อมูล</p>
        ) : (
          <ol className="space-y-2">
            {topMissed.map(([qid, v]) => {
              const qq = qById[qid];
              return (
                <li key={qid} className="text-sm border-b border-gray-50 pb-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-gray-900">{strip(qq.q)}</span>
                    <span className="shrink-0 text-xs font-black text-rose-600">{v.people} คน · {v.times} ครั้ง</span>
                  </div>
                  <div className="text-xs text-emerald-700">เฉลย: {strip(qq.options[qq.answer])}</div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
