"use client";
// app/_components/CourseRoom.tsx
// ─────────────────────────────────────────────────────────────
// ห้องเรียนแบบ "บทเรียน" (ใช้กับ Root Words Decoder และคอร์สอื่นในอนาคต)
//   LIST   → รายการบท แยกตามหน่วย พร้อมสถานะ ผ่าน / ทำแล้ว / ยังไม่ทำ
//   LESSON → ทบทวนเนื้อหาก่อนทำ (ชิ้นส่วนคำ + ตัวอย่าง + เคล็ดลับ + คำศัพท์ประจำบท 8 คำ แบบกดดูความหมาย)
//   แต่ละบทแสดงสัปดาห์/วันที่ตามแผนการสอน — ทำแบบฝึกหัดในคาบ (10 นาทีแรกของคาบถัดไป) ไม่มีการบ้าน
//   เลขบทและเนื้อหาตรงกับแบบเรียน Root Words Decoder (14 บท)
//   QUIZ   → แบบฝึกหัด 5 ตัวเลือก (ฉบับ ม.6 บทละ 15 ข้อ · ฉบับ ม.4 คาบละ 10 ข้อ) สุ่มลำดับข้อ + สลับตัวเลือกทุกรอบ
//   RESULT → สรุปคะแนน — ฉบับ ม.6 ต้องถูกครบทุกข้อ · ฉบับ ม.4 ถูก 8/10 ขึ้นไป (course.passMin) จึงจะ "ผ่าน"
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Course,
  CourseLesson,
  CourseProgress,
  CourseQuestion,
  loadCourse,
  loadCourseProgress,
  loadLocalCourseProgress,
  hasPendingLessons,
  mergeLesson,
  resendPendingLessons,
  saveLessonAttempt,
  shuffled,
  applyEarly,
  type LessonProgress,
} from "../lib/courses";
import { doneEarly, doneGraced, thaiDayOf } from "../lib/early";
import { hoursNow, useSchoolHours } from "../lib/hours";
import { HoursNote } from "./HoursNote";
import { isIssue, issueText, loadLocalUnlock, openDay, serverToday, syncClock, thaiShort, type SyncState } from "../lib/sync";
import { camMode, GUARD_FLAG_AT, guardMode, noCopyProps, noticeText, passNeed, qTimeLimit, Q_TIME_MS, useLeaveGuard, useQuestionTimer, type CamMode } from "../lib/guard";
import { CamBox, CamChooser, camSkipText, CoverShield, isCovered, loadCamChoice, saveCamChoice, TimerBar, useRoomCamera, type SharedCam } from "./CamGuard";
import { roomOf } from "../lib/names";
import { liveEnd, liveEvent, liveLeaves, liveQuit, liveStart, liveStep } from "../lib/live";

type View = "LIST" | "LESSON" | "GATE" | "QUIZ" | "RESULT";
type QuizItem = { q: CourseQuestion; order: number[] }; // order[i] = index ตัวเลือกเดิมที่แสดงในช่อง i
// chosen = index เดิม (ก่อนสลับ) · voided = ออกจากหน้าระหว่างข้อนี้ในรอบที่เข้าสมุดคะแนน (ช่วงหักคะแนน) → ไม่นับ
type Answer = { qid: string; chosen: number; correct: boolean; voided?: boolean; skipped?: boolean; why?: "leave" | "cover" | "face" | "time" | "phone" }; // skipped = ระบบข้ามข้อนี้ทันทีเพราะออกจากหน้า (chosen = -1)
const nowMs = () => Date.now(); // เวลาปัจจุบัน (เรียกเฉพาะตอนกดปุ่ม ไม่ได้เรียกระหว่างวาดหน้าจอ)
const scoreOf = (all: Answer[]) => all.filter((a) => a.correct && !a.voided).length;

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  prefix: { label: "อุปสรรค", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  root: { label: "รากศัพท์", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  suffix: { label: "ปัจจัย", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  concept: { label: "หลักคิด", cls: "bg-blue-50 text-[#003399] border-blue-200" },
};
const OPTION_LABELS = ["1", "2", "3", "4", "5"];

// แปลง **ตัวหนา** ในข้อความเป็น <strong>
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="text-[#003399] font-black">{p.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  );
}

function mergeProgressMaps(a: CourseProgress, b: CourseProgress): CourseProgress {
  const out: CourseProgress = { ...a };
  for (const [id, v] of Object.entries(b)) out[id] = mergeLesson(out[id], v) ?? v;
  return out;
}

function fmtDate(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const th = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d.getDate()} ${th[d.getMonth()]}`;
}

export default function CourseRoom({
  courseId,
  email,
  name,
  onExit,
  shared,
  extra = false,
}: {
  courseId: string;
  email: string;
  name: string;
  onExit: () => void;
  shared?: SharedCam; // กล้องที่เปิดไว้แล้วที่หน้าเลือกห้อง (9 พ.ย.)
  extra?: boolean; // ห้องเรียนพิเศษ (/extraclass · 11 พ.ย.): ไม่ล็อกตามวันเรียน · ไม่นับล่วงหน้า · ไม่ใช้กล้อง · ไม่ปิดเวลา 16.30
}) {
  const [course, setCourse] = useState<Course | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rawProgress, setProgress] = useState<CourseProgress>({});
  const [view, setView] = useState<View>("LIST");
  const [lesson, setLesson] = useState<CourseLesson | null>(null);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null); // ช่องที่เลือก (หลังสลับ)
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [saveState, setSaveState] = useState<SyncState>("idle");
  const saving = saveState === "saving" || saveState === "slow";
  const [pending, setPending] = useState(() => hasPendingLessons(courseId, email)); // มีผลในเครื่องที่ยังไม่ขึ้นระบบ
  const [today, setToday] = useState(() => serverToday());
  const [unlockN, setUnlockN] = useState(() => loadLocalUnlock(email)[courseId] || 0); // ครูเปิดให้ล่วงหน้าถึงบทที่ … (รายคน)
  const room = extra ? null : roomOf(name);
  // ระบบกัน AI: เฝ้าดูเฉพาะรอบที่เข้าสมุดคะแนน (รอบแรกของบท)
  const [guarded, setGuarded] = useState(false);
  const mode = guardMode(today); // ออกจากหน้าแอป / หน้าต่างบัง
  const cMode = camMode(today); // กล้อง + จับเวลา + เกณฑ์ 80%
  const qStart = useRef(0);
  const qTimes = useRef<number[]>([]);
  // กล้องกันกล้องซ้อน: นักเรียนเลือกเองที่หน้ากติกา (จำไว้ในเครื่อง)
  const [camWant, setCamWant] = useState<boolean>(() => loadCamChoice(email) ?? true);
  const [roundCam, setRoundCam] = useState<CamMode>("nocam");
  const [camNotice, setCamNotice] = useState<string | null>(null);
  const [triedNow, setTriedNow] = useState<Record<string, true>>({}); // บทที่ทำไปแล้วในรอบเปิดห้องนี้ (ก่อนผลบันทึกเสร็จ)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({}); // คำศัพท์ประจำบทที่กดดูความหมายแล้ว
  const startedAt = useRef(0); // เวลาที่เริ่มทำแบบฝึกหัดรอบนี้ (ไว้คิดเวลาที่ใช้ให้ครูดู)

  // 9 พ.ย.: บทที่ "ทำล่วงหน้า" (ก่อนวันเรียนของห้อง · ครูไม่ได้เปิดให้) ไม่นับ → มองเป็นยังไม่ได้ทำ ต้องทำใหม่พร้อมกล้อง
  const progress = useMemo(() => {
    if (!course || extra) return rawProgress;
    const byId = new Map(course.lessons.map((l) => [l.id, l] as const));
    return applyEarly(rawProgress, (id, x) => {
      const l = byId.get(id);
      if (!l) return false;
      return doneEarly(thaiDayOf(x.firstAt ?? x.passedAt ?? x.lastAt ?? 0), openDay(l.start, room, course.classDays), l.hour <= unlockN, l.hour);
    });
  }, [course, rawProgress, room, unlockN, extra]);

  // โหลดเนื้อหา + ความก้าวหน้า
  useEffect(() => {
    let alive = true;
    setProgress(loadLocalCourseProgress(courseId, email));
    loadCourse(courseId)
      .then((c) => alive && setCourse(c))
      .catch(() => alive && setLoadError(true));
    loadCourseProgress(courseId, email, name).then((p) => {
      if (!alive) return;
      setProgress((prev) => mergeProgressMaps(prev, p));
      setUnlockN(loadLocalUnlock(email)[courseId] || 0);
      setPending(hasPendingLessons(courseId, email));
    });
    syncClock().then(() => alive && setToday(serverToday()));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, email]);

  // ส่งผลที่ค้างในเครื่องขึ้นระบบอีกครั้ง (ปุ่ม / อัตโนมัติ)
  const resend = async () => {
    if (saving) return;
    setSaveState("saving");
    const r = await resendPendingLessons(courseId, email, name, () => setSaveState("slow"));
    setSaveState(r.ok ? "ok" : r.issue);
    setPending(hasPendingLessons(courseId, email));
  };
  const resendRef = useRef(resend);
  useEffect(() => {
    resendRef.current = resend;
  });
  // ลองส่งใหม่เองทุก 20 วินาที / เมื่อเน็ตกลับมา / เมื่อกลับเข้าหน้าแอป (ยกเว้นที่เก็บเต็ม — ต้องให้ครูแก้)
  const needRetry = pending && isIssue(saveState) && saveState !== "full";
  useEffect(() => {
    if (!needRetry) return;
    const tick = () => {
      if (document.visibilityState === "visible") void resendRef.current();
    };
    const t = setInterval(tick, 20000);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [needRetry]);

  const lessons = course?.lessons ?? [];
  const L = course?.lessonWord ?? "บท"; // ฉบับ ม.4 เรียกว่า "คาบ"
  // บทเปิดเมื่อถึงวันเรียนของห้องในสัปดาห์นั้น · บทที่ผ่านวันเรียนแล้วเปิดค้างไว้ (ทำย้อนหลังได้) · ครูเปิดล่วงหน้ารายคนได้
  const openOn = (l: CourseLesson) => (extra ? null : openDay(l.start, room, course?.classDays));
  // 11 พ.ย.: บท 1–2 ที่ทำไว้ก่อนวันเรียน → ผ่านแบบอนุโลม (ป้ายบนการ์ด)
  const graceOf = (l: CourseLesson, p?: LessonProgress) =>
    !extra && !!p?.passed && doneGraced(thaiDayOf(p.firstAt ?? p.passedAt ?? p.lastAt ?? 0), openOn(l), l.hour <= unlockN, l.hour);
  const isOpen = (l: CourseLesson) => {
    const d = openOn(l);
    return !d || d <= today || l.hour <= unlockN || (progress[l.id]?.attempts ?? 0) > 0;
  };
  const needOf = (total: number) => Math.min(total, course?.passMin ?? total); // ถูกกี่ข้อจึงผ่าน
  const qn = lessons[0]?.questions.length ?? 0;
  const passedCount = lessons.filter((l) => progress[l.id]?.passed).length;
  const pct = lessons.length ? Math.round((passedCount / lessons.length) * 100) : 0;

  const scrollTop = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* ไม่เป็นไร */
    }
  };

  const openLesson = (l: CourseLesson) => {
    setLesson(l);
    setRevealed({});
    setView("LESSON");
    scrollTop();
  };

  const current = items[idx];
  const answered = selected !== null;
  // ช่วงหักคะแนน: ตรวจพบว่าออกจากหน้า/ถูกบังนานระหว่างข้อไหน → ข้ามข้อนั้นทันที (ไม่ได้คะแนน)
  const finishRef = useRef<(all: Answer[]) => void>(() => undefined);
  const skipCurrent = (key: string, why: "leave" | "cover" | "face" | "time" | "phone" = "leave") => {
    if (!guarded || (why === "leave" || why === "cover" ? mode : cMode) !== "enforce" || !current || current.q.id !== key || selected !== null) return false;
    qTimes.current.push(Math.round((nowMs() - qStart.current) / 1000));
    const all: Answer[] = [...answers, { qid: key, chosen: -1, correct: false, voided: true, skipped: true, why }];
    setAnswers(all);
    liveStep(all.length);
    if (idx + 1 >= items.length) {
      finishRef.current(all);
    } else {
      setIdx((i) => i + 1);
      setSelected(null);
      setShowHint(false);
      qStart.current = nowMs();
    }
    return true;
  };
  const guard = useLeaveGuard(view === "QUIZ" && guarded, view === "QUIZ" && current && !answered ? current.q.id : null, skipCurrent);
  // กล้อง: มีอะไรบังใบหน้า (จมูกขึ้นไป) นานเกิน 0.5 วินาที → ช่วงหักคะแนนข้ามข้อ · ช่วงทดลองเตือน+บันทึก
  //   พบมือถือในกล้อง 2 ภาพติดกัน (9 พ.ย.) → เหมือนกัน
  const cam = useRoomCamera(shared, (_ms, kind) => {
    if (guarded) liveEvent(kind);
    const skipped = current ? skipCurrent(current.q.id, kind) : false;
    const what = kind === "phone" ? "📱 พบมือถือในกล้อง" : "📷 มีอะไรบังใบหน้า (จมูกขึ้นไป)";
    setCamNotice(
      cMode === "enforce"
        ? skipped
          ? camSkipText(kind)
          : what
        : `${what} — ช่วงทดลอง ระบบบันทึกให้ครูเห็น (ยังไม่หักคะแนน)`
    );
    return skipped;
  }, () => {
    if (guarded) liveEvent("far"); // มือถือเล็ก ๆ ไกล ๆ: ไม่ข้ามข้อ แจ้งครูในแผงสด
  });
  // จับเวลาทุกคน ข้อละ 45 วินาที (9 พ.ย.) · หมดเวลา → ข้ามข้อ · ช่วงทดลองเตือน+บันทึก
  const timeoutsRef = useRef(0);
  const timed = view === "QUIZ" && guarded && !!current && !answered;
  const qLimit = current ? qTimeLimit(current.q.q + " " + current.q.options.join(" ")) : Q_TIME_MS;
  const timeLeft = useQuestionTimer(timed, current ? `${idx}:${current.q.id}` : null, qLimit, () => {
    if (!current) return;
    timeoutsRef.current++;
    liveEvent("time");
    const skipped = cMode === "enforce" ? skipCurrent(current.q.id, "time") : false;
    setCamNotice(skipped ? `⏱ หมดเวลา ${Math.round(qLimit / 1000)} วินาที — ข้อที่แล้วถูกข้าม (ไม่ได้คะแนน)` : `⏱ หมดเวลา ${Math.round(qLimit / 1000)} วินาที — ช่วงทดลอง ระบบบันทึกให้ครูเห็น (ยังไม่ข้ามข้อ)`);
  });
  const { arm: camArm, stop: camStop } = cam;
  useEffect(() => {
    camArm(view === "QUIZ" && guarded && roundCam === "cam" && !answered);
  }, [camArm, view, guarded, roundCam, answered, idx]);
  useEffect(() => {
    if (view !== "QUIZ" && view !== "GATE") camStop();
  }, [camStop, view]);
  // หน้าติดตามสดของครู: ออกจากหน้ากี่ครั้ง · ออกจากรอบกลางคัน
  useEffect(() => {
    if (guarded && guard.leaves > 0) liveLeaves(guard.leaves);
  }, [guarded, guard.leaves]);
  useEffect(() => {
    if (view !== "QUIZ" && view !== "RESULT") liveQuit();
  }, [view]);
  // 11 พ.ย.: หลัง 16.30 น. ปิดรอบที่เข้าสมุดคะแนน + กล้อง (PDPA) · รอบที่ทำค้างอยู่ถูกยกเลิก (ไม่บันทึกคะแนน) · ฝึกบทที่ผ่านแล้วยังทำได้
  const hours = useSchoolHours(!extra, () => {
    if (view === "GATE" || (view === "QUIZ" && guarded)) {
      cam.stop();
      setConfirmExit(false);
      setView("LESSON");
    }
  });

  // รอบแรกของบท (เข้าสมุดคะแนน) → หน้ากติกาก่อน
  const beginQuiz = () => {
    if (!lesson) return;
    // บทที่ยังไม่ผ่าน = ทุกรอบผ่านหน้ากติกา (เลือกใช้กล้อง/ไม่ใช้) · ผ่านแล้ว = ฝึกได้อิสระ
    if (!progress[lesson.id]?.passed) {
      if (!extra && !hoursNow().open) return;
      setView("GATE");
      scrollTop();
      return;
    }
    startQuiz(false);
  };
  const startQuiz = (g: boolean, cm: CamMode = "nocam") => {
    if (!lesson) return;
    setGuarded(g);
    setRoundCam(g ? cm : "nocam");
    if (!g || cm !== "cam") cam.stop();
    cam.resetCounts();
    timeoutsRef.current = 0;
    setCamNotice(null);
    guard.reset();
    qTimes.current = [];
    qStart.current = nowMs();
    const qs = shuffled(lesson.questions).map((q) => ({ q, order: shuffled(q.options.map((_, i) => i)) }));
    setItems(qs);
    setIdx(0);
    setSelected(null);
    setAnswers([]);
    setShowHint(false);
    setConfirmExit(false);
    setSaveState("idle");
    setView("QUIZ");
    startedAt.current = nowMs();
    if (g) {
      const n = lessons.findIndex((x) => x.id === lesson.id) + 1;
      liveStart(email, { room, a: "course", c: courseId, l: lesson.id, t: `${L}ที่ ${lesson.hour || n}`, tot: qs.length, cm, pd: cm === "cam" ? cam.phoneState : undefined });
    }
    scrollTop();
  };

  const choose = (slot: number) => {
    if (!current || answered) return;
    const original = current.order[slot];
    const voided = guarded && mode === "enforce" && guard.wasLeft(current.q.id);
    if (guarded) qTimes.current.push(Math.round((nowMs() - qStart.current) / 1000));
    setSelected(slot);
    setAnswers((prev) => [...prev, { qid: current.q.id, chosen: original, correct: original === current.q.answer, ...(voided ? { voided: true } : {}) }]);
    if (guarded) liveStep(answers.length + 1);
  };

  const finish = async (all: Answer[]) => {
    if (!lesson) return;
    setView("RESULT");
    scrollTop();
    cam.stop();
    setTriedNow((t) => ({ ...t, [lesson.id]: true }));
    setSaveState("saving");
    const score = scoreOf(all);
    if (guarded) liveEnd(score);
    const ms = startedAt.current ? nowMs() - startedAt.current : undefined;
    const { lesson: lp, cloudOk, issue } = await saveLessonAttempt({
      courseId,
      lessonId: lesson.id,
      email,
      name,
      score,
      total: lesson.questions.length,
      wrongIds: all.filter((a) => !a.correct).map((a) => a.qid),
      passMin: passNeed(lesson.questions.length, { mode: cMode, guarded, cm: roundCam, passMin: course?.passMin }),
      ms,
      early: !!progress[lesson.id]?.early && !rawProgress[lesson.id]?.early,
      ...(guarded
        ? {
            guard: guard.stats(all.filter((a) => a.voided).length, mode),
            qt: qTimes.current,
            cam: { mode: roundCam, covers: cam.counts().covers, coverMs: cam.counts().coverMs, timeouts: timeoutsRef.current, phones: cam.counts().phones, phonesFar: cam.counts().phonesFar, pd: cam.counts().phoneState },
          }
        : {}),
      onSlow: () => setSaveState("slow"),
    });
    // รวมแบบไม่ถอยหลัง (กันผลรอบก่อนที่บันทึกช้ามาทับผลรอบใหม่)
    setProgress((prev) => ({ ...prev, [lesson.id]: mergeLesson(prev[lesson.id], lp) ?? lp }));
    setSaveState(cloudOk ? "ok" : issue ?? "error");
    setPending(hasPendingLessons(courseId, email));
  };
  useEffect(() => {
    finishRef.current = (all) => void finish(all);
  });

  const next = () => {
    if (!answered) return;
    if (idx + 1 >= items.length) {
      finish(answers);
      return;
    }
    setIdx((i) => i + 1);
    setSelected(null);
    setShowHint(false);
    qStart.current = nowMs();
    guard.clearNotice();
    setCamNotice(null);
  };

  const lessonIndex = lesson ? lessons.findIndex((l) => l.id === lesson.id) : -1;
  const nextLesson = lessonIndex >= 0 ? lessons[lessonIndex + 1] : undefined;

  const unitsWithLessons = useMemo(() => {
    if (!course) return [];
    return course.units
      .map((u) => ({ ...u, lessons: course.lessons.filter((l) => l.unit === u.no) }))
      .filter((u) => u.lessons.length > 0);
  }, [course]);

  // ───────────────── หน้าจอ ─────────────────
  if (loadError) {
    return (
      <div className="animate-fadeIn mt-2 text-center">
        <p className="text-rose-600 font-bold mb-4">โหลดบทเรียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>
        <button onClick={onExit} className="text-sm font-bold text-[#003399] hover:underline">← เมนูหลัก</button>
      </div>
    );
  }
  if (!course) {
    return <div className="mt-6 text-center text-[#003399] font-bold animate-pulse">⏳ กำลังโหลดบทเรียน...</div>;
  }

  // ── LIST: รายการบท ──
  if (view === "LIST") {
    return (
      <div className="animate-fadeIn mt-2">
        <button type="button" onClick={onExit} className="mb-4 text-sm font-bold text-[#003399] hover:underline">
          ← เมนูหลัก
        </button>
        <div className="text-center mb-5">
          <div className="text-4xl mb-1">🧩</div>
          <h1 className="text-2xl font-black text-gray-900">{course.titleTh}</h1>
          <p className="text-[#003399] font-bold text-xs tracking-widest uppercase">{course.title}</p>
          <p className="text-gray-500 text-xs mt-1">{course.subtitle}</p>
        </div>

        <div className="bg-[#003399] rounded-2xl p-4 mb-5 text-white">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-black text-[#FFD700]">ผ่านแล้ว {passedCount}/{lessons.length} {L}</span>
            <span className="text-sm font-bold">{pct}%</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-[#FFD700] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-white/80 mt-2">
            {`แต่ละ${L}มีแบบฝึกหัด ${qn} ข้อ (5 ตัวเลือก) ${needOf(qn) < qn ? `ถูก ${needOf(qn)} ข้อขึ้นไปจึงจะผ่าน` : "ต้องตอบถูกครบทุกข้อจึงจะผ่าน"} · ทำใหม่ได้ไม่จำกัด ข้อและตัวเลือกจะสลับทุกรอบ${course?.gradeBy === "first" ? " · คะแนนรอบแรกเข้าสมุดคะแนนของครู" : ""}`}
          </p>
          {course.classNote && <p className="text-[11px] font-bold text-[#FFD700] mt-1.5">🕙 {course.classNote}</p>}
        </div>

        {pending || saveState === "ok" ? (
          <div className={`rounded-2xl px-4 py-3 mb-4 text-sm font-bold flex items-center gap-2 ${!pending ? "bg-emerald-50 text-emerald-800 border-2 border-emerald-200" : saving ? "bg-blue-50 text-[#003399]" : "bg-amber-50 text-amber-900 border-2 border-amber-300"}`}>
            <span className="flex-1">{!pending ? issueText("ok") + " · ครูเห็นผลแล้ว" : saving ? issueText(saveState) : isIssue(saveState) ? issueText(saveState) : "⚠️ มีผลในเครื่องที่ยังไม่ขึ้นระบบ — กดส่งอีกครั้ง"}</span>
            {pending && !saving && (
              <button onClick={resend} className="shrink-0 px-3 py-1.5 bg-amber-500 text-white rounded-xl font-black text-xs">ส่งอีกครั้ง</button>
            )}
          </div>
        ) : null}

        {!extra && <p className="text-[11px] font-bold text-gray-500 mb-3">🔒 {L}ใหม่เปิดในวันที่ห้อง {room || "ของคุณ"} เรียน{L}นั้น · {L}ที่ผ่านวันเรียนแล้วเปิดไว้ให้ทำย้อนหลังได้เสมอ (เช่น วันที่ลาเรียน)</p>}
        <div className="space-y-5">
          {unitsWithLessons.map((u) => (
            <div key={u.no}>
              <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">
                {u.code ? `ภาค ${u.code}` : `หน่วยที่ ${u.no}`} · {u.title}
              </h2>
              <div className="space-y-2">
                {u.lessons.map((l) => {
                  const p = progress[l.id];
                  const open = isOpen(l);
                  const od = openOn(l);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={!open}
                      onClick={() => open && openLesson(l)}
                      className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${
                        !open
                          ? "bg-gray-50 border-dashed border-gray-200 opacity-70 cursor-not-allowed"
                          : p?.passed
                          ? "bg-emerald-50 border-emerald-200 hover:border-emerald-400 active:scale-[0.99]"
                          : "bg-white border-[#003399]/10 hover:border-[#003399]/40 active:scale-[0.99]"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center font-black leading-none ${
                          p?.passed ? "bg-emerald-500 text-white" : "bg-[#003399] text-[#FFD700]"
                        }`}
                      >
                        <span className="text-[9px] font-bold opacity-80">{L}</span>
                        <span className="text-base">{l.hour}</span>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-black text-gray-900 truncate">{l.titleTh}</span>
                        <span className="block text-xs text-gray-500 truncate">{l.titleEn}</span>
                        {l.week && <span className="block text-[11px] font-bold text-[#003399]/70">สัปดาห์ที่ {l.week}{l.dateLabel ? ` · ${l.dateLabel}` : ""}{l.pairNote ? ` · ${l.pairNote}` : ""}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        {!open ? (
                          <span className="text-[11px] font-black text-gray-500 bg-gray-100 px-2 py-1 rounded-full whitespace-nowrap">🔒 {od ? thaiShort(od) : ""}{p?.early ? " · ทำใหม่" : ""}</span>
                        ) : p?.early && !(p.attempts > 0) ? (
                          <span className="text-[11px] font-black text-orange-700 bg-orange-100 px-2 py-1 rounded-full whitespace-nowrap" title="ทำไว้ก่อนวันเรียน ยังไม่ผ่านการเปิดกล้อง — ต้องทำใหม่">⏩ ทำใหม่พร้อมกล้อง</span>
                        ) : p?.passed ? (
                          <span className="text-[11px] font-black text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full whitespace-nowrap" title={graceOf(l, p) ? "ทำไว้ก่อนวันเรียน — สัปดาห์ที่ 1–2 อนุโลมให้นับผ่าน" : undefined}>✓ ผ่าน{graceOf(l, p) ? " · อนุโลม" : ""}</span>
                        ) : p && p.attempts > 0 ? (
                          <span className="text-[11px] font-black text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                            ดีสุด {p.best}/{p.total}
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-gray-400">ยังไม่ทำ</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!lesson) return null;
  const lp = progress[lesson.id];

  // ── LESSON: ทบทวนก่อนทำ ──
  if (view === "LESSON") {
    return (
      <div className="animate-fadeIn mt-2">
        <button
          type="button"
          onClick={() => { setView("LIST"); scrollTop(); }}
          className="mb-4 text-sm font-bold text-[#003399] hover:underline"
        >
          ← รายการ{L}
        </button>
        <div className="mb-4">
          <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">{L}ที่ {lesson.hour} · ตรงกับแบบเรียน</span>
          {lesson.week && <span className="ml-2 text-[11px] font-bold text-gray-500">แผนเรียน: สัปดาห์ที่ {lesson.week}{lesson.dateLabel ? ` · ${lesson.dateLabel}` : ""}{lesson.pairNote ? ` · ${lesson.pairNote}` : ""}</span>}
          <h1 className="text-2xl font-black text-gray-900 mt-2">{lesson.titleTh}</h1>
          <p className="text-[#003399] font-bold">{lesson.titleEn}</p>
          <p className="text-sm text-gray-600 mt-2"><span className="font-bold">เป้าหมาย:</span> {lesson.goal}</p>
        </div>

        {lp && (
          <div className={`rounded-xl p-3 mb-4 text-sm font-bold ${lp.passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {lp.passed
              ? `✓ ผ่าน${L}นี้แล้ว (${fmtDate(lp.passedAt)}) · ทำไปแล้ว ${lp.attempts} รอบ — ทำซ้ำเพื่อทบทวนได้`
              : `ทำไปแล้ว ${lp.attempts} รอบ · คะแนนดีที่สุด ${lp.best}/${lp.total} — ต้องได้ ${needOf(lp.total)}/${lp.total} ขึ้นไปจึงจะผ่าน`}
          </div>
        )}

        <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">ทบทวนก่อนทำแบบฝึกหัด</h2>
        <div className="space-y-2 mb-4">
          {lesson.recap.parts.map((p, i) => {
            const k = KIND_STYLE[p.kind] ?? KIND_STYLE.concept;
            return (
              <div key={i} className="border-2 border-gray-100 rounded-2xl p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-lg text-gray-900">{p.part}</span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${k.cls}`}>{k.label}</span>
                  <span className="text-sm font-bold text-[#003399]">= {p.meaning}</span>
                </div>
                {p.examples.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.examples.map((e, j) => (
                      <span key={j} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                        <span className="font-bold text-gray-900">{e.word}</span>
                        <span className="text-gray-500"> · {e.th}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {lesson.recap.tips.length > 0 && (
          <div className="bg-amber-50 border-l-4 border-[#FFD700] rounded-xl p-3 mb-5">
            <p className="text-xs font-black text-amber-800 mb-1">💡 เคล็ดลับ / กับดักในห้องสอบ</p>
            <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
              {lesson.recap.tips.map((t, i) => (
                <li key={i}>
                  <Rich text={t} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {lesson.words && lesson.words.length > 0 && (
          <div className="mb-5">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest">คำศัพท์ประจำ{L} ({lesson.words.length} คำ)</h2>
              <button
                type="button"
                onClick={() => {
                  const all = lesson.words!.every((w) => revealed[w.w]);
                  setRevealed(all ? {} : Object.fromEntries(lesson.words!.map((w) => [w.w, true])));
                }}
                className="text-[11px] font-bold text-[#003399] hover:underline shrink-0"
              >
                {lesson.words.every((w) => revealed[w.w]) ? "ซ่อนความหมาย" : "ดูความหมายทั้งหมด"}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mb-2">
              ทดสอบตัวเองก่อน: นึกความหมายในใจ แล้วแตะคำเพื่อดูเฉลย{lesson.words.some((w) => w.core || w.n) ? " · ★ = อยู่ในคำแกน 120 คำ · ตัวเลข = ออกสอบกี่ฉบับ (จาก 18)" : ""}
              {lesson.words.some((w) => w.x) ? " · คำขยาย = ใช้รหัสเดียวกัน ลองถอดเองก่อนเปิด" : ""}
              {lesson.words.some((w) => w.tg || w.al) ? " · 🎯 T = พบในข้อสอบ TGAT/GAT กี่ฉบับ (จาก 7) · A = A-Level/9 วิชาสามัญ กี่ฉบับ (จาก 6)" : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {lesson.words.map((w) => {
                const open = !!revealed[w.w];
                return (
                  <button
                    key={w.w}
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [w.w]: !r[w.w] }))}
                    className={`text-left rounded-xl border-2 px-3 py-2 transition-all ${open ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-100 hover:border-[#003399]/30"}`}
                  >
                    <span className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="font-black text-gray-900">{w.w}</span>
                      {w.core && <span className="text-amber-500 text-xs" title="อยู่ในคำแกน 120 คำ">★</span>}
                      <span className="text-[11px] italic text-gray-400">{w.pos}</span>
                      {w.x && <span className="text-[10px] font-black text-amber-700 bg-amber-50 rounded-full px-1.5">คำขยาย</span>}
                      {typeof w.n === "number" && w.n > 0 && (
                        <span className="ml-auto text-[10px] font-black text-[#003399] bg-[#003399]/5 rounded-full px-1.5">{w.n} ฉบับ</span>
                      )}
                      {(w.tg || w.al) ? (
                        <span className="ml-auto text-[10px] font-black text-[#003399] bg-[#003399]/5 rounded-full px-1.5" title="พบในข้อสอบจริง: T = TGAT/GAT · A = A-Level/9 วิชาสามัญ">
                          🎯{w.tg ? ` T${w.tg}` : ""}{w.al ? ` A${w.al}` : ""}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] text-gray-500">{w.parts}</span>
                    <span className={`block text-sm font-bold ${open ? "text-emerald-800" : "text-gray-300"}`}>{open ? w.th : "แตะเพื่อดูความหมาย"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!progress[lesson.id]?.passed && <HoursNote hours={hours} compact />}
        <button
          type="button"
          onClick={beginQuiz}
          disabled={!hours.open && !progress[lesson.id]?.passed}
          className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] transition-all text-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          เริ่มทำแบบฝึกหัด {lesson.questions.length} ข้อ →
        </button>
        <p className="text-center text-xs text-gray-500 mt-2">
          {cMode === "enforce" && !progress[lesson.id]?.passed
            ? `ถูก ${passNeed(lesson.questions.length, { mode: cMode, guarded: true, cm: "cam" })} ข้อขึ้นไปจึงผ่าน (ผิดได้ 20%) · ใช้กล้องทุกคน · จับเวลาข้อละ ${Q_TIME_MS / 1000} วินาที`
            : needOf(lesson.questions.length) < lesson.questions.length
            ? `ถูก ${needOf(lesson.questions.length)} ข้อขึ้นไปจึงจะผ่าน${L}นี้`
            : `ต้องตอบถูกครบ ${lesson.questions.length} ข้อจึงจะผ่าน${L}นี้`}
        </p>
        {course?.gradeBy === "first" && !(progress[lesson.id]?.attempts > 0) && (
          <p className="text-center text-xs font-bold text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mt-2">⭐ คะแนนรอบแรกจะเข้าสมุดคะแนนของครู — อ่านโจทย์ให้ดี ตั้งใจตั้งแต่รอบแรก</p>
        )}
      </div>
    );
  }

  // ── GATE: กติการอบที่เข้าสมุดคะแนน + เลือกใช้กล้อง ──
  if (view === "GATE") {
    const total = lesson.questions.length;
    const camNeed = passNeed(total, { mode: "enforce", guarded: true, cm: "cam" });
    const first = !(progress[lesson.id]?.attempts > 0) && !triedNow[lesson.id];
    return (
      <div className="animate-fadeIn mt-2">
        <button type="button" onClick={() => { cam.stop(); setView("LESSON"); scrollTop(); }} className="mb-4 text-sm font-bold text-[#003399] hover:underline">← กลับ</button>
        <div className="border-4 border-[#003399] rounded-3xl p-5 mb-4">
          <div className="text-4xl text-center mb-1">📝</div>
          <h1 className="text-xl font-black text-center text-gray-900 mb-1">{first ? "โหมดรอบแรก" : "รอบผ่าน" + L} · {L} {lesson.hour}</h1>
          <p className="text-center text-xs font-bold text-[#003399] mb-4">
            {first ? `คะแนนรอบนี้${course?.gradeBy === "first" ? "เข้าสมุดคะแนนของครู" : "ครูดูประกอบการให้คะแนน"}` : `ยังไม่ผ่าน${L}นี้ — ทุกรอบจนกว่าจะผ่านใช้กติกาเดียวกัน`}
          </p>
          <ol className="text-sm text-gray-800 space-y-2 list-decimal pl-5">
            <li>เปิด <b>โหมดห้ามรบกวน</b> ก่อน (กันแจ้งเตือนเด้งทับ) · ใช้มือถือเครื่องเดียว</li>
            <li><b>อยู่ในหน้านี้ตลอด</b> จนทำครบ {total} ข้อ — ห้ามสลับแอป สลับแท็บ กลับหน้าโฮม หรือเรียก Gemini / วงกลมค้นหา · คลุมหรือคัดลอกโจทย์ไม่ได้</li>
            <li>
              {extra
                ? <>หมดเวลาข้อละ {Q_TIME_MS / 1000} วินาที — ระบบ<b className="text-rose-600">ข้ามข้อนั้นทันที ไม่ได้คะแนน</b>{mode === "enforce" ? <> · ออกจากหน้า หรือหน้าต่างอื่นบังนานเกิน 3 วินาที ก็ข้ามข้อเช่นกัน</> : <> · ออกจากหน้า / หน้าต่างอื่นบัง: ระบบบันทึกให้ครูเห็น</>}</>
                : cMode === "enforce"
                ? <>มีอะไรบังใบหน้าตั้งแต่จมูกขึ้นไป · มีมือถือเครื่องอื่นในภาพ · หรือหมดเวลาข้อละ {Q_TIME_MS / 1000} วินาที — ระหว่างข้อไหน <b className="text-rose-600">ระบบข้ามข้อนั้นทันที ไม่ได้คะแนน</b>{mode === "enforce" ? <> · ออกจากหน้า หรือหน้าต่างอื่นบังนานเกิน 3 วินาที ก็ข้ามข้อเช่นกัน</> : <> · ออกจากหน้า / หน้าต่างอื่นบัง: ถึง 15 พ.ย. บันทึกให้ครูเห็น เริ่มข้ามข้อ 16 พ.ย.</>}</>
                : <>ช่วงทดลอง: ระบบ <b>บันทึก</b> การออกจากหน้า การบังใบหน้า และการหมดเวลาให้ครูเห็น (ยังไม่หักคะแนน)</>}
            </li>
            {extra ? <li><b>ห้องนี้ไม่ใช้กล้อง ไม่เก็บภาพ</b> · ทำเองคนเดียว ไม่ใช้แอปหรือเครื่องอื่นช่วย · จับเวลาข้อละ {Q_TIME_MS / 1000} วินาที</li> : <li><b>ใช้กล้องทุกคน</b> · <b>ห้ามเอามือหรือสิ่งของขึ้นใกล้หน้า</b> (เกาจมูก ขยี้ตา หาว ก็นับ) · <b>เก็บมือถือเครื่องอื่นให้พ้นกล้อง</b> (เห็นแวบเดียวก็นับ) · ตั้งมือถือให้กล้องเห็นหน้า ไม่วางราบ · จับเวลาข้อละ {Q_TIME_MS / 1000} วินาที</li>}
            <li>ออกจากหน้าครบ {GUARD_FLAG_AT} ครั้ง ครูจะเห็นเครื่องหมาย 🚩 และอาจให้ทำต่อหน้าครู</li>
          </ol>
        </div>
        <CamChooser
          cam={cam}
          want={camWant}
          setWant={(on) => {
            setCamWant(on);
            saveCamChoice(email, on);
          }}
          required
          preApproved={!!shared?.fallback}
          noCamMode={extra}
          camRule={`ผ่านเมื่อถูก ${camNeed}/${total} (ผิดได้ 20%) · จับเวลาข้อละ ${Q_TIME_MS / 1000} วินาที`}
          noCamRule={`ข้อละ ${Q_TIME_MS / 1000} วินาที`}
          note={cMode === "enforce" ? undefined : `ช่วงทดลองถึง 15 พ.ย.: ยังใช้เกณฑ์เดิม (${needOf(total) < total ? `ถูก ${needOf(total)}/${total}` : `ถูกครบ ${total}/${total}`}) · เกณฑ์ 80% เริ่ม 16 พ.ย.`}
          startLabel={`เริ่มทำ ${total} ข้อ`}
          onStart={(cm) => startQuiz(true, cm)}
        />
      </div>
    );
  }

  // ── QUIZ ──
  if (view === "QUIZ" && current) {
    const correctSoFar = scoreOf(answers);
    const shield = guarded && roundCam === "cam" && !answered && isCovered(cam);
    const wrongSoFar = answers.length - correctSoFar;
    const lastAnswer = answered ? answers[answers.length - 1] : null;
    return (
      <div className="animate-fadeIn mt-2">
        <div className="flex items-center justify-between mb-3">
          {confirmExit ? (
            <span className="flex items-center gap-2 text-xs font-bold">
              <span className="text-rose-600">ออกแล้วรอบนี้จะไม่ถูกบันทึก</span>
              <button onClick={() => { setView("LESSON"); setConfirmExit(false); }} className="px-2 py-1 bg-rose-600 text-white rounded-lg">ออก</button>
              <button onClick={() => setConfirmExit(false)} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg">ทำต่อ</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmExit(true)} className="text-sm font-bold text-[#003399] hover:underline">
              ← ออก
            </button>
          )}
          <span className="text-xs font-black text-gray-500">{L} {lesson.hour} · {lesson.titleEn}</span>
        </div>
        {guarded && <HoursNote hours={hours} compact />}

        <div className="flex items-center gap-3 mb-1">
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#003399] rounded-full transition-all" style={{ width: `${((idx + (answered ? 1 : 0)) / items.length) * 100}%` }} />
          </div>
          <span className="text-sm font-black text-[#003399] tabular-nums">{idx + 1}/{items.length}</span>
        </div>
        {guarded && guard.notice && (
          <div className={`rounded-xl p-3 mb-3 text-sm font-bold flex items-start gap-2 ${mode === "enforce" ? "bg-orange-100 text-orange-900 border-2 border-orange-300" : "bg-amber-50 text-amber-900 border-2 border-amber-200"}`}>
            <span className="flex-1">{noticeText(guard.notice, mode).replace("ข้อนี้ถูกข้าม", "ข้อที่แล้วถูกข้าม")}</span>
            <button onClick={guard.clearNotice} className="shrink-0 text-xs underline">รับทราบ</button>
          </div>
        )}
        {guarded && camNotice && (
          <div className={`rounded-xl p-3 mb-3 text-sm font-bold flex items-start gap-2 ${cMode === "enforce" ? "bg-orange-100 text-orange-900 border-2 border-orange-300" : "bg-amber-50 text-amber-900 border-2 border-amber-200"}`}>
            <span className="flex-1">{camNotice}</span>
            <button onClick={() => setCamNotice(null)} className="shrink-0 text-xs underline">รับทราบ</button>
          </div>
        )}
        {guarded && (
          <p className="text-[11px] font-bold text-[#003399]/70 mb-2">
            📝 {roundCam === "cam" ? "ใช้กล้อง" : "ไม่ใช้กล้อง"} · ผ่านเมื่อถูก {passNeed(items.length, { mode: cMode, guarded, cm: roundCam, passMin: course?.passMin })}/{items.length} · อยู่ในหน้านี้จนทำครบ
            {guard.leaves > 0 ? ` · ออกจากหน้าแล้ว ${guard.leaves} ครั้ง` : ""}
          </p>
        )}
        {guarded && roundCam === "cam" && <CamBox cam={cam} floating />}
        {timed && <TimerBar left={timeLeft} limit={qLimit} />}
        <div className="flex gap-3 text-xs font-bold mb-4">
          <span className="text-emerald-600">✓ {correctSoFar}</span>
          <span className="text-rose-500">✗ {wrongSoFar}</span>
          {wrongSoFar > 0 && <span className="text-gray-400">รอบนี้ยังไม่ผ่าน แต่ทำให้จบเพื่อดูเฉลยแล้วลองใหม่</span>}
        </div>

        {shield && <CoverShield phone={cam.phone} />}
        <div className="bg-gray-50 rounded-2xl p-4 mb-4" hidden={shield} {...noCopyProps}>
          <p className="text-base md:text-lg font-bold text-gray-900 leading-relaxed">
            <Rich text={current.q.q} />
          </p>
        </div>

        <div className="space-y-2 mb-4" hidden={shield} {...noCopyProps}>
          {current.order.map((orig, slot) => {
            const isCorrect = orig === current.q.answer;
            const isPicked = selected === slot;
            let cls = "bg-white border-gray-200 hover:border-[#003399]/50";
            if (answered && isCorrect) cls = "bg-emerald-50 border-emerald-500 text-emerald-900";
            else if (answered && isPicked) cls = "bg-rose-50 border-rose-500 text-rose-900";
            else if (answered) cls = "bg-white border-gray-100 text-gray-400";
            return (
              <button
                key={slot}
                type="button"
                disabled={answered}
                onClick={() => choose(slot)}
                className={`w-full text-left p-3.5 rounded-xl border-2 font-medium transition-all flex gap-3 items-start ${cls} ${answered ? "cursor-default" : "active:scale-[0.99]"}`}
              >
                <span className={`shrink-0 w-6 h-6 rounded-full text-xs font-black flex items-center justify-center ${answered && isCorrect ? "bg-emerald-500 text-white" : answered && isPicked ? "bg-rose-500 text-white" : "bg-[#003399]/10 text-[#003399]"}`}>
                  {answered && isCorrect ? "✓" : answered && isPicked ? "✗" : OPTION_LABELS[slot]}
                </span>
                <span className="flex-1"><Rich text={current.q.options[orig]} /></span>
              </button>
            );
          })}
        </div>

        {!answered && current.q.hint && (
          <div className="mb-4">
            {showHint ? (
              <p className="text-sm bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900">💡 {current.q.hint}</p>
            ) : (
              <button type="button" onClick={() => setShowHint(true)} className="text-sm font-bold text-amber-700 hover:underline">
                💡 ขอคำใบ้
              </button>
            )}
          </div>
        )}

        {answered && lastAnswer && (
          <div className={`rounded-2xl p-4 mb-4 ${lastAnswer.correct ? "bg-emerald-50" : "bg-rose-50"}`}>
            <p className={`font-black mb-1 ${lastAnswer.correct ? "text-emerald-700" : "text-rose-700"}`}>
              {lastAnswer.correct ? "✓ ถูกต้อง!" : "✗ ยังไม่ถูก"}
              {lastAnswer.voided ? <span className="block text-xs font-bold text-orange-700">ข้อนี้ไม่นับคะแนน เพราะออกจากหน้าระหว่างทำ</span> : null}
            </p>
            {!lastAnswer.correct && (
              <p className="text-sm text-gray-800 mb-1">
                คำตอบที่ถูก: <span className="font-bold"><Rich text={current.q.options[current.q.answer]} /></span>
              </p>
            )}
            {current.q.explain && <p className="text-sm text-gray-700 leading-relaxed"><Rich text={current.q.explain} /></p>}
          </div>
        )}

        {answered && (
          <button
            type="button"
            onClick={next}
            className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] transition-all text-lg"
          >
            {idx + 1 >= items.length ? "ดูผลคะแนน →" : "ข้อต่อไป →"}
          </button>
        )}
      </div>
    );
  }

  // ── RESULT ──
  if (view === "RESULT") {
    const total = items.length;
    const score = scoreOf(answers);
    const nVoid = answers.filter((a) => a.voided).length;
    const need = passNeed(total, { mode: cMode, guarded, cm: roundCam, passMin: course?.passMin });
    const passed = score >= need && total > 0;
    const wrong = answers.filter((a) => !a.correct);
    const qById = Object.fromEntries(lesson.questions.map((q) => [q.id, q]));
    return (
      <div className="animate-fadeIn mt-2">
        <div className={`rounded-3xl p-6 text-center mb-5 ${passed ? "bg-emerald-50" : "bg-amber-50"}`}>
          <div className="text-5xl mb-2">{passed ? "🎉" : "💪"}</div>
          <p className="text-sm font-bold text-gray-500">{L} {lesson.hour} · {lesson.titleEn}</p>
          <p className={`text-5xl font-black my-2 tabular-nums ${passed ? "text-emerald-600" : "text-amber-600"}`}>
            {score}/{total}
          </p>
          <p className={`font-black text-lg ${passed ? "text-emerald-700" : "text-amber-800"}`}>
            {passed ? `ผ่าน${L}นี้แล้ว!` : `อีก ${need - score} ข้อจะผ่าน — ลองใหม่อีกครั้ง`}
          </p>
          {nVoid > 0 && <p className="text-xs font-bold text-orange-700 mt-2">ถูกข้าม/ไม่นับ {nVoid} ข้อ (ออกจากหน้าแอป · มีอะไรบังใบหน้า · หมดเวลา)</p>}
          {guarded && guard.leaves > 0 && mode === "log" && <p className="text-xs font-bold text-amber-700 mt-2">ออกจากหน้า {guard.leaves} ครั้ง (ช่วงทดลอง — บันทึกให้ครูเห็น ยังไม่หักคะแนน)</p>}
          <p className={`text-xs mt-2 ${isIssue(saveState) ? "font-bold text-amber-800" : "text-gray-500"}`}>
            {saveState === "ok" ? "✓ บันทึกผลแล้ว ครูเห็นผลนี้ในระบบ" : issueText(saveState)}
          </p>
          {isIssue(saveState) && pending && (
            <button onClick={resend} className="mt-2 px-4 py-2 bg-amber-500 text-white rounded-xl font-black text-xs">ส่งอีกครั้ง</button>
          )}
        </div>

        {wrong.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">ข้อที่ตอบผิด ({wrong.length} ข้อ) — อ่านเฉลยก่อนลองใหม่</h2>
            <div className="space-y-2">
              {wrong.map((a) => {
                const q = qById[a.qid];
                if (!q) return null;
                return (
                  <div key={a.qid} className="border-2 border-rose-100 rounded-2xl p-3">
                    <p className="text-sm font-bold text-gray-900 mb-1"><Rich text={q.q} /></p>
                    {a.skipped ? (
                      <p className="text-xs text-orange-700 font-bold">⏭ ถูกข้าม เพราะ{a.why === "face" ? "มีอะไรบังใบหน้า (จมูกขึ้นไป)" : a.why === "phone" ? "พบมือถือในกล้อง" : a.why === "cover" ? "มีหน้าต่างอื่นบังหน้าแอป" : a.why === "time" ? "หมดเวลา" : "ออกจากหน้าแอป"}ระหว่างทำ</p>
                    ) : (
                      <p className="text-xs text-rose-600">✗ ตอบ: <Rich text={q.options[a.chosen]} /></p>
                    )}
                    <p className="text-xs text-emerald-700 font-bold">✓ ที่ถูก: <Rich text={q.options[q.answer]} /></p>
                    {q.explain && <p className="text-xs text-gray-600 mt-1"><Rich text={q.explain} /></p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {passed && nextLesson && isOpen(nextLesson) ? (
            <button
              type="button"
              onClick={() => openLesson(nextLesson)}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] transition-all"
            >
              ไป{L}ถัดไป: {L} {nextLesson.hour} {nextLesson.titleEn} →
            </button>
          ) : null}
          {!passed && (
            <button
              type="button"
              onClick={beginQuiz}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] disabled:bg-gray-300 transition-all"
            >
              🔁 ทำใหม่ (สลับข้อและตัวเลือกใหม่)
            </button>
          )}
          <button
            type="button"
            onClick={() => { setView("LESSON"); scrollTop(); }}
            className="w-full py-3 bg-white border-2 border-[#003399]/20 text-[#003399] font-bold rounded-2xl"
          >
            ทบทวนเนื้อหา{L}นี้
          </button>
          <button
            type="button"
            onClick={() => { setView("LIST"); scrollTop(); }}
            className="w-full py-3 text-gray-500 font-bold rounded-2xl hover:text-[#003399]"
          >
            กลับไปรายการ{L}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
