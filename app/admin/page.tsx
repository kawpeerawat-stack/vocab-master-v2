"use client";
// app/admin/page.tsx
// ─────────────────────────────────────────────────────────────
// แดชบอร์ดครู
//   📚 คำศัพท์แกน 120 คำ (ค่าเริ่มต้น) — ดู app/admin/_vocab/VocabAdmin.tsx
//   🧩 คอร์สบทเรียน เช่น Root Words Decoder:
//   • ตารางรายคน: นักเรียนแต่ละคนผ่านบทไหนแล้ว (ม.6 ผ่าน = ถูกครบ 15/15 · ม.4 ผ่าน = ถูก 8/10 ขึ้นไป)
//   • มุมมองรายบท: ใครผ่าน / ทำแล้วยังไม่ผ่าน / ยังไม่ทำ + ข้อที่นักเรียนพลาดบ่อย
//   • จับคู่ชื่อที่นักเรียนพิมพ์กับรายชื่อทางการ (data/roster.json) → เรียงตามห้องและเลขที่
//   • สมุดคะแนน: คะแนนรายบท/รายคาบ (ม.4 = คะแนนรอบแรก · ม.6 = คะแนนดีที่สุด) + คะแนนรวม → ส่งออก CSV
//   • เวลาที่ใช้ทำ + ⚡ เมื่อทำเร็วผิดปกติ (เฉลี่ยไม่ถึง 5 วินาที/ข้อ)
//   • ข้อมูลอัปเดตสด (onSnapshot) — นักเรียนส่งผลแล้วหน้าครูเปลี่ยนเองโดยไม่ต้องกดรีเฟรช
//   • ระบบกัน AI (รอบแรก): 🚩 = ออกจากหน้าครบ 3 ครั้ง · ↗n = ออก n ครั้ง · 🔓 เปิดบทล่วงหน้ารายคน
//   • 🧹 ข้อมูลแอปเทอม 1 ที่ค้างอยู่ → สำรองแล้วล้าง (แก้ที่เก็บข้อมูลของนักเรียนเต็ม)
// เพิ่มคอร์สใหม่ในอนาคต: เพิ่มใน app/lib/courseRegistry.ts แล้วหน้านี้จะมีแท็บคอร์สใหม่ให้เอง
// ─────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import {
  COURSE_REGISTRY,
  courseMeta,
  Course,
  CourseProgress,
  LessonProgress,
  loadCourse,
  mergeCourseProgress,
  isFastAttempt,
  applyEarly,
} from "../lib/courses";
import { doneEarly, doneGraced, thaiDayOf } from "../lib/early";
import { openDay } from "../lib/sync";
import { GRADES, ROSTER, extractNo, fmtThaiTime, gradeOf, matchRoster, roomOf, rosterKey, typedMismatch } from "../lib/roster";
import { CORE_NAME, CORE_PLAN, VCourse, VProgress, loadVocab300 } from "../lib/vocab300";
import VocabAdmin from "./_vocab/VocabAdmin";
import { LivePanel, type LiveEntry } from "./_parts/LivePanel";
import type { LiveDoc } from "../lib/live";
import { PurgeEarly } from "./_parts/PurgeEarly";
import { StudentManager } from "./_parts/StudentManager";
import { isConfigId, isExtraId } from "../lib/extra";
import { GuardMark, LegacyPanel, SpotCheck, UnlockButton, WeekTabs, guardEvents, guardTip, isFlagged, pickSpot, type SpotCand } from "./_parts/AdminTools";

// ── สิทธิ์เข้าหน้า /admin (เหมือนเดิม) ──
const ADMIN_EMAIL = "kawpeerawat@gmail.com";
// ตั้งรหัสผ่านจริงผ่าน Vercel → Environment Variables: NEXT_PUBLIC_ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "anukoolnaree2025";
const ADMIN_USING_DEFAULT_PW = !process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

// ── ระดับชั้น: ม.6 และ ม.4 แยกกันคนละมุมมอง ไม่ปนกัน (ห้องที่อ่านไม่ออกนับอยู่ใน ม.6 ตามเดิม) ──
const inGrade = (room: string | null, grade: string) => (room ? gradeOf(room) === grade : grade === "6");
// ── ข้อมูลนักเรียนจาก Firestore (อ่านเฉพาะฟิลด์ที่ใช้) ──
// วันนี้ตามเวลาไทย (เรียกตอนวาดหน้า — ใช้เลือกรายชื่อสุ่มตรวจ)
function thaiToday(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

type StudentDoc = {
  id: string;
  name?: string;
  email?: string;
  courses?: Record<string, CourseProgress>;
  courseActiveAt?: number;
  v300?: VProgress;
  v300At?: number;
  unlock?: Record<string, number>; // ครูเปิดบท/ชุดล่วงหน้า (รายคน)
  live?: LiveDoc; // กำลังทำรอบเข้าสมุดคะแนนอยู่ตอนนี้ (หน้าติดตามสด)
  hidden?: boolean; // ครูซ่อนจากแดชบอร์ด (11 พ.ย.)
} & Record<string, unknown>;

type Row = {
  key: string;
  room: string | null;
  no: number | null;
  name: string;          // ชื่อทางการ (หรือชื่อที่พิมพ์ ถ้าจับคู่ไม่ได้)
  typedNames: string[];  // ชื่อที่นักเรียนพิมพ์ในแอป
  emails: string[];
  ids: string[];         // id เอกสารของนักเรียน (หลายบัญชีได้)
  unlock: number;        // เปิดล่วงหน้าถึงบทที่ … (0 = ไม่ได้เปิด)
  progress: CourseProgress;
  activeAt: number;
  inRoster: boolean;
};

function fmtDate(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ── ฟังข้อมูลนักเรียนแบบสด: Firestore ส่งเอกสารที่เปลี่ยนมาให้เองทุกครั้งที่นักเรียนบันทึก ──
function listenStudents(onData: (list: StudentDoc[]) => void, onError: (e: unknown) => void): () => void {
  return onSnapshot(
    collection(db, "students"),
    (snap) => {
      const data: StudentDoc[] = [];
      snap.forEach((d) => {
        data.push({ id: d.id, ...(d.data() as Record<string, unknown>) } as StudentDoc);
      });
      onData(data);
    },
    onError
  );
}

// เวลาที่ใช้ทำ เช่น 2:05
const fmtDur = (ms?: number) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : "");

type Status = "passed" | "tried" | "none";
// early = ทำล่วงหน้าก่อนวันเรียนของห้อง (ไม่นับ · ⏩ ต้องทำใหม่พร้อมกล้อง) → นับเป็นยังไม่ทำ
const statusOf = (p?: LessonProgress): Status => (p?.passed ? "passed" : p && p.attempts > 0 ? "tried" : "none");
const GraceMark = () => (
  <span data-grace="1" className="absolute -top-0.5 left-0 text-[9px] leading-none font-black text-sky-800 bg-sky-100 rounded px-0.5" aria-label="อนุโลม">อ</span>
);
const EarlyMark = () => <span data-early="1" className="inline-flex w-7 h-7 rounded-lg bg-orange-100 text-orange-700 font-black items-center justify-center text-[11px] ring-1 ring-orange-300">⏩</span>;

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);

  const [area, setArea] = useState<"vocab300" | "course">("vocab300");
  const [v300, setV300] = useState<VCourse | null>(null);
  const [courseId, setCourseId] = useState(COURSE_REGISTRY[0]?.id ?? "decoder");
  const [course, setCourse] = useState<Course | null>(null);
  const [weekSel, setWeekSel] = useState(0); // 0 = ทุกสัปดาห์
  const [allStudents, setAllStudents] = useState<StudentDoc[]>([]); // นักเรียนโรงเรียนทั้งหมด (รวมที่ซ่อน) — ไม่รวมห้องเรียนพิเศษ (ex:) และเอกสารตั้งค่า (cfg:)
  const students = useMemo(() => allStudents.filter((s) => !s.hidden), [allStudents]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [live, setLive] = useState(false);
  const [liveKey, setLiveKey] = useState(0);
  const [error, setError] = useState("");

  const [grade, setGrade] = useState<string>("6");
  const [roomFilter, setRoomFilter] = useState<string>("ALL");
  const [mode, setMode] = useState<"matrix" | "lesson" | "grades">("matrix");
  const [lessonId, setLessonId] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    try {
      if (sessionStorage.getItem("vocab_admin_ok") === "1") setAuthed(true);
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);

  // เนื้อหาคอร์ส (โหลดครั้งเดียวต่อคอร์ส)
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    Promise.all([loadCourse(courseId), loadVocab300()])
      .then(([c, vc]) => {
        if (!alive) return;
        setCourse(c);
        setV300(vc);
        setLessonId((prev) => prev || c.lessons[0]?.id || "");
      })
      .catch((e) => {
        console.error(e);
        if (alive) setError("โหลดเนื้อหาคอร์สไม่สำเร็จ ลองกดเชื่อมต่อใหม่");
      });
    return () => {
      alive = false;
    };
  }, [authed, courseId]);

  // ข้อมูลนักเรียนแบบสด (อัปเดตเองทุกครั้งที่นักเรียนส่งผล)
  useEffect(() => {
    if (!authed) return;
    const stop = listenStudents(
      (data) => {
        setAllStudents(data.filter((s) => !isExtraId(s.id) && !isConfigId(s.id)));
        setLoadedAt(Date.now());
        setLive(true);
        setLoading(false);
        setError("");
      },
      (e) => {
        console.error(e);
        setLive(false);
        setLoading(false);
        setError("เชื่อมต่อข้อมูลสดไม่สำเร็จ — กด “เชื่อมต่อใหม่” อีกครั้ง");
      }
    );
    return () => stop();
  }, [authed, liveKey]);
  const reconnect = useCallback(() => {
    setLoading(true);
    setLive(false);
    setLiveKey((k) => k + 1);
  }, []);

  // ── 🔴 กำลังทำอยู่ตอนนี้ (ตามระดับชั้น/ห้องที่เลือก) ──
  const liveEntries: LiveEntry[] = useMemo(() => {
    const out: LiveEntry[] = [];
    for (const s of students) {
      if (!s.live || typeof s.live.at !== "number") continue;
      const hit = matchRoster(s.name);
      const room = hit?.room ?? s.live.room ?? roomOf(s.name) ?? null;
      if (!inGrade(room, grade)) continue;
      if (roomFilter !== "ALL" && room !== roomFilter) continue;
      out.push({ id: s.id, name: hit?.name ?? s.name ?? s.email ?? s.id, no: hit?.no ?? extractNo(s.name) ?? null, room, live: s.live });
    }
    return out;
  }, [students, grade, roomFilter]);

  // ── รวมข้อมูลเป็นแถวตามรายชื่อทางการ ──
  const rows: Row[] = useMemo(() => {
    const byRoster: Record<string, Row> = {};
    for (const r of ROSTER) {
      byRoster[rosterKey(r)] = {
        key: rosterKey(r), room: r.room, no: r.no, name: r.name,
        typedNames: [], emails: [], ids: [], unlock: 0, progress: {}, activeAt: 0, inRoster: true,
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
        row.ids.push(s.id);
        row.unlock = Math.max(row.unlock, s.unlock?.[courseId] ?? 0);
        if (hasProgress) row.progress = mergeCourseProgress(row.progress, prog!);
        row.activeAt = Math.max(row.activeAt, s.courseActiveAt ?? 0);
      } else if (hasProgress) {
        extra.push({
          key: `x|${s.id}`, room: roomOf(s.name), no: extractNo(s.name), name: s.name || s.email || s.id,
          typedNames: s.name ? [s.name] : [], emails: s.email ? [s.email] : [], ids: [s.id], unlock: s.unlock?.[courseId] ?? 0, progress: prog!,
          activeAt: s.courseActiveAt ?? 0, inRoster: false,
        });
      }
    }
    const rosterRows = Object.values(byRoster).sort((a, b) => (a.room! < b.room! ? -1 : a.room! > b.room! ? 1 : (a.no ?? 0) - (b.no ?? 0)));
    // 9 พ.ย.: บทที่ทำล่วงหน้า (ก่อนวันเรียนของห้อง · ครูไม่ได้เปิดให้) ไม่นับ → ⏩
    const byId = new Map((course?.lessons ?? []).map((l) => [l.id, l] as const));
    return [...rosterRows, ...extra].map((r) =>
      course
        ? {
            ...r,
            progress: applyEarly(r.progress, (id, x) => {
              const l = byId.get(id);
              return !!l && doneEarly(thaiDayOf(x.firstAt ?? x.passedAt ?? x.lastAt ?? 0), openDay(l.start, r.room, course.classDays), l.hour <= r.unlock, l.hour);
            }),
          }
        : r
    );
  }, [students, courseId, course]);

  const gradeInfo = GRADES.find((g) => g.grade === grade) ?? GRADES[0];
  const scopeLabel = roomFilter === "ALL" ? `${gradeInfo.label} ทุกห้อง` : `ม.${roomFilter}`;
  const lessons = course?.lessons ?? [];
  const L = course?.lessonWord ?? "บท"; // ฉบับ ม.4 เรียกว่า "คาบ"
  // สัปดาห์ 1–2 ทำล่วงหน้า → อนุโลมนับผ่าน (ป้าย "อ")
  const gracedCell = (r: { room: string | null; unlock: number }, l: { start?: string; hour: number }, p?: LessonProgress) =>
    !!course && !!p && p.attempts > 0 && doneGraced(thaiDayOf(p.firstAt ?? p.passedAt ?? p.lastAt ?? 0), openDay(l.start, r.room, course.classDays), l.hour <= r.unlock, l.hour);
  const shownLessons = weekSel ? lessons.filter((l) => (l.week ?? l.hour) === weekSel) : lessons;
  const qn = lessons[0]?.questions.length ?? 0;
  const passText = course?.passMin && course.passMin < qn ? `ถูก ${course.passMin}/${qn} ข้อขึ้นไป` : `ตอบถูกครบทุกข้อ (${qn}/${qn})`;
  const inRoom = (r: Row) => (roomFilter === "ALL" ? inGrade(r.room, grade) : r.room === roomFilter);
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
  }, [rows, roomFilter, grade, lessons]);

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
  }, [rows, roomFilter, grade, lessons]);

  // ── CSV (โหมดสมุดคะแนน = คะแนนเป็นตัวเลข · โหมดอื่น = สถานะผ่าน) ──
  // คะแนนที่ลงสมุด: ม.4 (gradeBy = "first") ใช้คะแนนรอบแรก · ม.6 ใช้คะแนนดีที่สุด
  //   * = รอบแรกทำก่อนเริ่มเก็บคะแนนรอบแรก (ใช้คะแนนดีที่สุดแทน) หรือทำแบบเดิม 10 ข้อ (เทียบเป็นคะแนนเต็มปัจจุบัน)
  const byFirst = course?.gradeBy === "first";
  const gradeCell = (p: LessonProgress | undefined, full: number): { score: number; star: boolean; fast: boolean } | null => {
    if (!p) return null;
    let raw = p.best, of = p.total, star = false;
    if (byFirst) {
      if (typeof p.first === "number") { raw = p.first; of = p.firstTotal ?? p.total; }
      else if ((p.attempts ?? 0) > 1) star = true;
    }
    let score = raw;
    if (of && of !== full) { score = Math.round((raw * full) / of); star = true; }
    return { score, star, fast: (p.fast ?? 0) > 0 || isFastAttempt(p.firstMs, p.firstTotal) };
  };
  const scoreOf = (r: Row) => lessons.reduce((s, l) => s + (gradeCell(r.progress[l.id], l.questions.length)?.score ?? 0), 0);
  const fastRows = [...rosterRows, ...extraRows].filter((r) => lessons.some((l) => gradeCell(r.progress[l.id], l.questions.length)?.fast)).length;
  const fullScore = lessons.reduce((s, l) => s + l.questions.length, 0);

  // ── 🎯 สุ่มตรวจคาบนี้: คนที่ทำรอบแรกวันนี้ (ห้องที่เลือก) ──
  const todayTH = thaiToday();
  const dayOf = (t?: number) => (t ? new Date(t + 7 * 3600000).toISOString().slice(0, 10) : "");
  const spot = (() => {
    if (roomFilter === "ALL") return null;
    const cands: SpotCand[] = [];
    for (const r of [...rosterRows, ...extraRows]) {
      const ls = lessons.filter((l) => dayOf(r.progress[l.id]?.firstAt) === todayTH);
      if (!ls.length) continue;
      const reasons: string[] = [];
      let w = 0;
      for (const l of ls) {
        const p = r.progress[l.id]!;
        const tag = `${L}${l.hour}`;
        if (isFlagged(p)) { w += 3; reasons.push(`${tag} 🚩`); }
        if ((p.fast ?? 0) > 0 || isFastAttempt(p.firstMs, p.firstTotal)) { w += 2; reasons.push(`${tag} ⚡ ทำเร็วผิดปกติ`); }
        if (p.cm === "nocam" || p.cm === "camfail") { w += 1; reasons.push(`${tag} ${p.cm === "nocam" ? "🚫 ไม่ใช้กล้อง" : "⚠️ กล้องใช้ไม่ได้"}`); }
        if (typeof p.first === "number" && p.firstTotal && p.first / p.firstTotal >= 0.9) { w += 1; reasons.push(`${tag} คะแนนรอบแรก ${p.first}/${p.firstTotal}`); }
        if ((p.gt ?? 0) >= 3) { w += 1; reasons.push(`${tag} หมดเวลา ${p.gt} ข้อ`); }
      }
      cands.push({ key: r.key, name: `${r.no != null ? `${r.no}. ` : ""}${r.name}`, reasons, weight: w });
    }
    return cands.length ? { picks: pickSpot(cands, `${todayTH}|${roomFilter}|${courseId}`, 3), total: cands.length } : null;
  })();
  const downloadCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const list = [...rosterRows, ...extraRows];
    const grades = mode === "grades";
    const headers = grades
      ? ["ห้อง", "เลขที่", "ชื่อ-สกุล", ...lessons.map((l) => `${L}${l.hour} (เต็ม ${l.questions.length})`), `ผ่าน (${L})`, `คะแนนรวม (เต็ม ${fullScore}) · ${byFirst ? "คะแนนรอบแรก" : "คะแนนดีที่สุด"}`, "หมายเหตุ (* = ใช้คะแนนดีที่สุด/เทียบจากแบบเดิม · ⚡ = ทำเร็วผิดปกติ · ↗ = ออกจากหน้า · 📷 = บังใบหน้า (ครั้ง) · 🚩 = รวม 3 ครั้งขึ้นไป · 🚫 = ไม่ใช้กล้อง)", "ชื่อที่พิมพ์ในแอป", "อีเมล", "ทำล่าสุด"]
      : ["ห้อง", "เลขที่", "ชื่อ-สกุล", "ชื่อที่พิมพ์ในแอป", "อีเมล", ...lessons.map((l) => `${L}${l.hour}`), `ผ่าน (${L})`, "ทำล่าสุด"];
    const lines = list.map((r) =>
      (grades
        ? [
            r.room ?? "", r.no ?? "", r.name,
            ...lessons.map((l) => gradeCell(r.progress[l.id], l.questions.length)?.score ?? ""),
            passedCountOf(r), scoreOf(r),
            [
              ...lessons.filter((l) => gradeCell(r.progress[l.id], l.questions.length)?.star).map((l) => `${L}${l.hour}*`),
              ...lessons.filter((l) => gradeCell(r.progress[l.id], l.questions.length)?.fast).map((l) => `${L}${l.hour}⚡`),
              ...lessons.filter((l) => guardEvents(r.progress[l.id]) > 0).map((l) => `${L}${l.hour}${isFlagged(r.progress[l.id]) ? "🚩" : ""}↗${r.progress[l.id]?.gl ?? 0}📷${r.progress[l.id]?.gc ?? 0}📱${r.progress[l.id]?.gp ?? 0}`),
              ...lessons.filter((l) => r.progress[l.id]?.cm === "nocam" || r.progress[l.id]?.cm === "camfail").map((l) => `${L}${l.hour}${r.progress[l.id]?.cm === "nocam" ? "🚫ไม่ใช้กล้อง" : "⚠️กล้องใช้ไม่ได้"}`),
            ].join(" "),
            r.typedNames.join(" / "), r.emails.join(" / "),
            r.activeAt ? new Date(r.activeAt).toLocaleString("th-TH") : "",
          ]
        : [
            r.room ?? "", r.no ?? "", r.name, r.typedNames.join(" / "), r.emails.join(" / "),
            ...lessons.map((l) => {
              const p = r.progress[l.id];
              return p?.passed ? "ผ่าน" : p ? `${p.best}/${p.total}` : "";
            }),
            `${passedCountOf(r)}/${lessons.length}`,
            r.activeAt ? new Date(r.activeAt).toLocaleString("th-TH") : "",
          ]
      ).map(esc).join(",")
    );
    const csv = "﻿" + [headers.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${courseId}-${grades ? "grades" : "progress"}-${roomFilter === "ALL" ? `m${grade}-all` : roomFilter.replace("/", "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
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
              แดชบอร์ดครู · {area === "vocab300" ? CORE_NAME : "ติดตามบทเรียน"}
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {area === "vocab300" ? "ผ่านชุด = เรียนครบ 10 คำ + รอบทบทวนถูกครบ (ทำจบในคาบ)" : `ผ่าน = ${passText}`}
            </p>
            <p className="text-xs font-bold mt-1" data-live={live ? "1" : "0"}>
              {live ? (
                <span className="text-emerald-700">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle animate-pulse" />
                  อัปเดตสดอัตโนมัติ · ข้อมูลล่าสุด {loadedAt ? new Date(loadedAt).toLocaleTimeString("th-TH") : "–"} น.
                </span>
              ) : (
                <span className="text-gray-400">{loading ? "⏳ กำลังเชื่อมต่อข้อมูลสด..." : "⚪ ยังไม่ได้เชื่อมต่อข้อมูลสด"}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/admin/extraclass" data-extra-link className="px-3 py-2 rounded-xl bg-white border-2 border-[#003399]/15 text-[#003399] font-bold text-sm hover:border-[#003399]/40" title="รหัสเข้าชั้นและความก้าวหน้าของนักเรียนเรียนพิเศษ">🎓 ห้องเรียนพิเศษ</a>
            <a href="/demo/camera" target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-white border-2 border-[#003399]/15 text-[#003399] font-bold text-sm hover:border-[#003399]/40" title="หน้าทดลองสำหรับผู้บริหาร (ยังไม่ใช้กับนักเรียน)">🧪 ทดลองกล้องซ้อน</a>
            <button onClick={reconnect} disabled={loading} className="px-4 py-2 bg-white border-2 border-[#003399]/20 text-[#003399] font-bold rounded-xl disabled:opacity-50">
              {loading ? "⏳ กำลังเชื่อมต่อ..." : "🔄 เชื่อมต่อใหม่"}
            </button>
            {area === "course" && (
              <button onClick={downloadCsv} disabled={!course} className="px-4 py-2 bg-[#003399] text-[#FFD700] font-black rounded-xl disabled:opacity-50">
                {mode === "grades" ? "⬇ สมุดคะแนน CSV" : "⬇ CSV"}
              </button>
            )}
          </div>
        </div>

        {/* ── เลือกคอร์ส (รองรับหลายคอร์สในอนาคต) ── */}
        <div className="flex flex-wrap gap-2 mb-3">
          {grade === "6" && (
          <button
            onClick={() => setArea("vocab300")}
            className={`px-4 py-2 rounded-xl font-black text-sm ${area === "vocab300" ? "bg-[#003399] text-[#FFD700]" : "bg-white text-gray-600 border border-gray-200"}`}
          >
            📚 {CORE_NAME} <span className="font-bold opacity-70">({CORE_PLAN})</span>
          </button>
          )}
          {COURSE_REGISTRY.filter((c) => c.grade === grade).map((c) => (
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
          {GRADES.map((g) => (
            <button
              key={g.grade}
              onClick={() => {
                setGrade(g.grade);
                setRoomFilter("ALL");
                // แต่ละระดับชั้นใช้คอร์สของตัวเอง: ม.6 = ถอดรหัสคำศัพท์ (decoder) · ม.4 = ถอดรหัสคำศัพท์ ม.4 (decoder4)
                const first = COURSE_REGISTRY.find((c) => c.grade === g.grade);
                if (first && courseMeta(courseId)?.grade !== g.grade) { setCourseId(first.id); setLessonId(""); }
                if (g.grade === "4") setArea("course"); // ม.4 ไม่มีห้องคำศัพท์แกน 120 คำ
              }}
              className={`px-4 py-1.5 rounded-xl text-sm font-black ${grade === g.grade ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}
            >
              {g.label}
            </button>
          ))}
          <span className="mx-1 text-gray-300">|</span>
          {["ALL", ...gradeInfo.rooms].map((r) => (
            <button
              key={r}
              onClick={() => setRoomFilter(r)}
              className={`px-3 py-1.5 rounded-full text-sm font-bold ${roomFilter === r ? "bg-[#FFD700] text-[#003399]" : "bg-white text-gray-600 border border-gray-200"}`}
            >
              {r === "ALL" ? `${gradeInfo.label} ทุกห้อง` : `ม.${r}`}
            </button>
          ))}
          {area === "course" && <span className="mx-1 text-gray-300">|</span>}
          {area === "course" && <button onClick={() => setMode("matrix")} className={`px-3 py-1.5 rounded-full text-sm font-bold ${mode === "matrix" ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            ตารางรายคน
          </button>}
          {area === "course" && <button onClick={() => setMode("lesson")} className={`px-3 py-1.5 rounded-full text-sm font-bold ${mode === "lesson" ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            ราย{L}
          </button>}
          {area === "course" && <button onClick={() => setMode("grades")} className={`px-3 py-1.5 rounded-full text-sm font-bold ${mode === "grades" ? "bg-[#003399] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            📒 สมุดคะแนน
          </button>}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ / อีเมล"
            className="ml-auto w-full sm:w-56 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-[#003399]"
          />
        </div>

        {error && <p className="bg-rose-50 text-rose-700 font-bold rounded-xl p-3 mb-4">{error}</p>}
        <LivePanel entries={liveEntries} />
        <StudentManager docs={allStudents} />
        <PurgeEarly docs={allStudents} />
        <LegacyPanel students={students} />
        {(area === "vocab300" ? !v300 : !course) && <p className="text-center text-[#003399] font-bold animate-pulse py-10">กำลังโหลดข้อมูล...</p>}

        {area === "vocab300" && v300 && <VocabAdmin course={v300} students={students} roomFilter={roomFilter} grade={grade} search={search} />}

        {area === "course" && course && (
          <>
            {/* ── การ์ดสรุป ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                [summary.n, `นักเรียนในรายชื่อ ${scopeLabel}`],
                [summary.started, `เริ่มทำแล้ว (อย่างน้อย 1 ${L})`],
                [summary.avg.toFixed(1), `ผ่านเฉลี่ย (${L}/คน จาก ${lessons.length})`],
                [summary.allDone, `ผ่านครบทั้ง ${lessons.length} ${L}`],
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
                <h2 className="font-black text-gray-900">สัดส่วนผู้ผ่านราย{L}</h2>
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
                      <span className="w-12 shrink-0 text-xs font-black text-[#003399]">{L} {l.hour}</span>
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

            {spot && <SpotCheck title={`ม.${roomFilter} · ${course.title ?? ""}`.trim()} picks={spot.picks} total={spot.total} />}

            {/* 9 พ.ย.: แถบแยกรายสัปดาห์ — ดูทีละบท/สัปดาห์ เช็คง่าย */}
            {(mode === "matrix" || mode === "grades") && (
              <WeekTabs
                items={lessons.map((l) => ({ key: l.week ?? l.hour, label: `${L} ${l.hour}`, sub: l.dateLabel ?? "" }))}
                sel={weekSel}
                setSel={setWeekSel}
                summary={
                  weekSel
                    ? (() => {
                        const ls = shownLessons;
                        const rs = [...rosterRows, ...extraRows];
                        const c = { pass: 0, tried: 0, early: 0, none: 0 };
                        for (const r of rs)
                          for (const l of ls) {
                            const p = r.progress[l.id];
                            if (p?.early && !(p.attempts > 0)) c.early++;
                            else if (p?.passed) c.pass++;
                            else if (p && p.attempts > 0) c.tried++;
                            else c.none++;
                          }
                        return `${scopeLabel}: ✓ ผ่าน ${c.pass} · ทำแล้วยังไม่ผ่าน ${c.tried} · ⏩ ทำล่วงหน้า (ต้องทำใหม่) ${c.early} · ยังไม่ทำ ${c.none} (จาก ${rs.length} คน)`;
                      })()
                    : ""
                }
              />
            )}

            {/* ── ตารางรายคน ── */}
            {mode === "matrix" && (
              <div className="bg-white rounded-2xl border border-gray-100 mb-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#003399] text-white">
                        <th className="sticky left-0 z-10 bg-[#003399] text-left px-3 py-2 font-black min-w-[220px]">นักเรียน</th>
                        {shownLessons.map((l) => (
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
                                {r.inRoster && typedMismatch(r.name, r.typedNames).length > 0 && (
                                  <div className="text-[10px] font-bold text-amber-700 truncate max-w-[260px]" title="ชื่อที่นักเรียนกรอกในแอปไม่ตรงกับรายชื่อ — ตรวจว่ากรอกเลขที่/ห้องถูกไหม">
                                    ⚠️ กรอกว่า: {typedMismatch(r.name, r.typedNames).join(" / ")}
                                  </div>
                                )}
                                {!r.inRoster && <div className="text-[10px] text-gray-400 truncate max-w-[260px]">{r.emails.join(" / ")}</div>}
                                <UnlockButton ids={r.ids} keyName={courseId} current={r.unlock} max={lessons.length} unit={L} />
                              </td>
                              {shownLessons.map((l) => {
                                const p = r.progress[l.id];
                                const st = statusOf(p);
                                const fast = !!p && ((p.fast ?? 0) > 0 || isFastAttempt(p.firstMs, p.firstTotal));
                                const tip = p
                                  ? `${L} ${l.hour} ${l.titleEn}\n${typeof p.first === "number" ? `รอบแรก ${p.first}/${p.firstTotal ?? p.total}${p.firstMs ? ` (${fmtDur(p.firstMs)} นาที)` : ""} · ` : ""}ดีที่สุด ${p.best}/${p.total} · ล่าสุด ${p.last}/${p.total}${p.lastMs ? ` (${fmtDur(p.lastMs)} นาที)` : ""} · ทำ ${p.attempts} รอบ${fast ? `\n⚡ ทำเร็วผิดปกติ ${p.fast ?? 1} รอบ (เฉลี่ยไม่ถึง 5 วินาที/ข้อ)` : ""}${guardTip(p)}${p.fqt?.length ? `\nข้อที่ใช้เวลานานสุด ${Math.max(...p.fqt)} วินาที` : ""}${p.passedAt ? `\nผ่านเมื่อ ${new Date(p.passedAt).toLocaleString("th-TH")}` : ""}`
                                  : `${L} ${l.hour} ยังไม่ทำ`;
                                return (
                                  <td key={l.id} className="text-center px-0.5 py-1 relative" title={tip}>
                                    {fast && <span className="absolute -top-0.5 right-0 text-[10px]" aria-label="ทำเร็วผิดปกติ">⚡</span>}
                                    <GuardMark g={p} />
                                    {gracedCell(r, l, p) && <GraceMark />}
                                    {p?.early && !(p.attempts > 0) ? (
                                      <EarlyMark />
                                    ) : st === "passed" ? (
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
                  ✓ = ผ่าน ({passText}) · ตัวเลข = คะแนนดีที่สุดที่ยังไม่ผ่าน · ⚡ = ทำเร็วผิดปกติ (เฉลี่ยไม่ถึง 5 วินาทีต่อข้อ){fastRows > 0 ? ` — ${fastRows} คนในมุมมองนี้` : ""} · ↗n = ออกจากหน้า n ครั้ง · 📷n = มีอะไรบังใบหน้า n ครั้ง · 🚫 = ไม่ใช้กล้อง · 🚩 = รวม 3 ครั้งขึ้นไป (ควรเรียกมาถาม) · 🔓 = เปิด{L}ล่วงหน้าให้รายคน · <b className="text-sky-800">อ</b> = ทำล่วงหน้าแต่ได้รับอนุโลม (สัปดาห์ 1–2 นับผ่าน) · ชี้ที่ช่องเพื่อดูคะแนนรอบแรก เวลาที่ใช้ จำนวนรอบ และวันที่ผ่าน · หัวคอลัมน์ = {L}ที่
                </p>
              </div>
            )}

            {/* ── สมุดคะแนน: คะแนนดีที่สุดราย{L} + คะแนนรวม ── */}
            {mode === "grades" && (
              <div className="bg-white rounded-2xl border border-gray-100 mb-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#003399] text-white">
                        <th className="sticky left-0 z-10 bg-[#003399] text-left px-3 py-2 font-black min-w-[220px]">นักเรียน</th>
                        {shownLessons.map((l) => (
                          <th key={l.id} className="px-1 py-2 font-black text-[11px] min-w-[38px]" title={`${L} ${l.hour} · ${l.titleEn} (เต็ม ${l.questions.length})`}>
                            {l.hour}
                          </th>
                        ))}
                        <th className="px-2 py-2 font-black text-[11px] whitespace-nowrap">ผ่าน</th>
                        <th className="px-3 py-2 font-black text-[11px] whitespace-nowrap">รวม / {fullScore}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rosterRows, ...extraRows].map((r, i, arr) => {
                        const showRoomHeader = roomFilter === "ALL" && r.inRoster && (i === 0 || arr[i - 1].room !== r.room);
                        return (
                          <React.Fragment key={r.key}>
                            {showRoomHeader && (
                              <tr><td colSpan={lessons.length + 3} className="bg-[#FFD700]/30 text-[#003399] font-black px-3 py-1.5 text-xs">ม.{r.room}</td></tr>
                            )}
                            <tr className="border-b border-gray-100 hover:bg-blue-50/40">
                              <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                                <div className="font-bold text-gray-900 truncate max-w-[260px]">
                                  {r.no != null && <span className="text-gray-400 font-black mr-1 tabular-nums">{r.no}.</span>}
                                  {r.name}
                                </div>
                              </td>
                              {shownLessons.map((l) => {
                                const p = r.progress[l.id];
                                const g = gradeCell(p, l.questions.length);
                                return (
                                  <td
                                    key={l.id}
                                    className="text-center px-0.5 py-1 relative"
                                    title={p ? `${typeof p.first === "number" ? `รอบแรก ${p.first}/${p.firstTotal ?? p.total}${p.firstMs ? ` · ${fmtDur(p.firstMs)} นาที` : ""} · ` : ""}ดีที่สุด ${p.best}/${p.total} · ทำ ${p.attempts} รอบ${g?.star ? "\n* ใช้คะแนนดีที่สุด / เทียบจากแบบเดิม 10 ข้อ" : ""}${g?.fast ? "\n⚡ ทำเร็วผิดปกติ" : ""}${guardTip(p)}` : "ยังไม่ทำ"}
                                  >
                                    {g?.fast && <span className="absolute -top-0.5 right-0 text-[10px]" aria-label="ทำเร็วผิดปกติ">⚡</span>}
                                    <GuardMark g={p} />
                                    {gracedCell(r, l, p) && <GraceMark />}
                                    {p?.early && !(p.attempts > 0) ? (
                                      <EarlyMark />
                                    ) : p && g ? (
                                      <span className={`inline-flex min-w-7 h-7 px-0.5 rounded-lg font-black items-center justify-center text-[11px] tabular-nums ${p.passed ? "bg-emerald-500 text-white" : "bg-amber-100 text-amber-800"}`}>{g.score}{g.star ? "*" : ""}</span>
                                    ) : (
                                      <span className="inline-flex w-7 h-7 rounded-lg bg-gray-50 text-gray-300 items-center justify-center text-xs">·</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="text-center px-2 py-1 font-black tabular-nums text-[#003399]">{passedCountOf(r)}</td>
                              <td className="text-center px-3 py-1 font-black tabular-nums">{scoreOf(r)}</td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 px-4 py-3">
                  ตัวเลข = {byFirst ? "คะแนนรอบแรก" : "คะแนนดีที่สุด"}ของ{L}นั้น (เต็ม {qn}) · เขียว = ผ่าน ({passText}) · รวม = ผลรวมทุก{L} (เต็ม {fullScore}) ·
                  {byFirst ? " * = ทำก่อนเริ่มเก็บคะแนนรอบแรก (ใช้คะแนนดีที่สุดแทน) หรือทำแบบเดิม 10 ข้อ (เทียบเป็นคะแนนเต็มปัจจุบัน) ·" : ""} ⚡ = ทำเร็วผิดปกติ · ↗n ออกจากหน้า · 📷n บังใบหน้า · 🚫 ไม่ใช้กล้อง · 🚩 รวม 3 ครั้งขึ้นไป · กด “⬇ สมุดคะแนน CSV” เพื่อนำไปลงคะแนน
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
                passText={passText}
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
  passText,
}: {
  course: Course;
  lessonId: string;
  setLessonId: (id: string) => void;
  rows: Row[];
  roomFilter: string;
  passText: string;
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
  // เวลาที่ใช้ทำรอบล่าสุด + ⚡ ถ้าเร็วผิดปกติ
  const timeNote = (p?: LessonProgress) =>
    !p ? "" : `${p.lastMs ? ` · ⏱ ${fmtDur(p.lastMs)}` : ""}${(p.fast ?? 0) > 0 || isFastAttempt(p.firstMs, p.firstTotal) ? " ⚡" : ""}`;
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
            <option key={l.id} value={l.id}>{course.lessonWord ?? "บท"} {l.hour} · {l.titleEn} — {l.titleTh}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{lesson.questions.length} ข้อ · ผ่าน = {passText}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Col title="✓ ผ่านแล้ว" list={groups.passed} cls="bg-emerald-50 text-emerald-700" render={(r) => `${fmtDate(r.progress[lesson.id]?.passedAt)} · ${r.progress[lesson.id]?.attempts} รอบ${timeNote(r.progress[lesson.id])}`} />
        <Col title="ทำแล้ว ยังไม่ผ่าน" list={groups.tried} cls="bg-amber-50 text-amber-800" render={(r) => `ดีสุด ${r.progress[lesson.id]?.best}/${r.progress[lesson.id]?.total} · ${r.progress[lesson.id]?.attempts} รอบ${timeNote(r.progress[lesson.id])}`} />
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
