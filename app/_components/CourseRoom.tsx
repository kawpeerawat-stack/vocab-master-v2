"use client";
// app/_components/CourseRoom.tsx
// ─────────────────────────────────────────────────────────────
// ห้องเรียนแบบ "บทเรียน" (ใช้กับ Root Words Decoder และคอร์สอื่นในอนาคต)
//   LIST   → รายการบท แยกตามหน่วย พร้อมสถานะ ผ่าน / ทำแล้ว / ยังไม่ทำ
//   LESSON → ทบทวนเนื้อหาก่อนทำ (ชิ้นส่วนคำ + ตัวอย่าง + เคล็ดลับ)
//   QUIZ   → แบบฝึกหัด 20 ข้อ 5 ตัวเลือก (สุ่มลำดับข้อ + สลับตัวเลือกทุกรอบ)
//   RESULT → สรุปคะแนน — ต้องถูกครบทุกข้อจึงจะ "ผ่าน"
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from "react";
import {
  Course,
  CourseLesson,
  CourseProgress,
  CourseQuestion,
  loadCourse,
  loadCourseProgress,
  loadLocalCourseProgress,
  mergeLesson,
  saveLessonAttempt,
  shuffled,
} from "../lib/courses";

type View = "LIST" | "LESSON" | "QUIZ" | "RESULT";
type QuizItem = { q: CourseQuestion; order: number[] }; // order[i] = index ตัวเลือกเดิมที่แสดงในช่อง i
type Answer = { qid: string; chosen: number; correct: boolean }; // chosen = index เดิม (ก่อนสลับ)

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  prefix: { label: "prefix", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  root: { label: "root", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  suffix: { label: "suffix", cls: "bg-rose-50 text-rose-700 border-rose-200" },
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
}: {
  courseId: string;
  email: string;
  name: string;
  onExit: () => void;
}) {
  const [course, setCourse] = useState<Course | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState<CourseProgress>({});
  const [view, setView] = useState<View>("LIST");
  const [lesson, setLesson] = useState<CourseLesson | null>(null);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null); // ช่องที่เลือก (หลังสลับ)
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "ok" | "local">("idle");

  // โหลดเนื้อหา + ความก้าวหน้า
  useEffect(() => {
    let alive = true;
    setProgress(loadLocalCourseProgress(courseId, email));
    loadCourse(courseId)
      .then((c) => alive && setCourse(c))
      .catch(() => alive && setLoadError(true));
    loadCourseProgress(courseId, email, name).then((p) => alive && setProgress((prev) => mergeProgressMaps(prev, p)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, email]);

  const lessons = course?.lessons ?? [];
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
    setView("LESSON");
    scrollTop();
  };

  const startQuiz = () => {
    if (!lesson) return;
    const qs = shuffled(lesson.questions).map((q) => ({ q, order: shuffled(q.options.map((_, i) => i)) }));
    setItems(qs);
    setIdx(0);
    setSelected(null);
    setAnswers([]);
    setShowHint(false);
    setConfirmExit(false);
    setSaveState("idle");
    setView("QUIZ");
    scrollTop();
  };

  const current = items[idx];
  const answered = selected !== null;

  const choose = (slot: number) => {
    if (!current || answered) return;
    const original = current.order[slot];
    setSelected(slot);
    setAnswers((prev) => [...prev, { qid: current.q.id, chosen: original, correct: original === current.q.answer }]);
  };

  const finish = async (all: Answer[]) => {
    if (!lesson) return;
    setView("RESULT");
    scrollTop();
    setSaving(true);
    const score = all.filter((a) => a.correct).length;
    const { lesson: lp, cloudOk } = await saveLessonAttempt({
      courseId,
      lessonId: lesson.id,
      email,
      name,
      score,
      total: lesson.questions.length,
      wrongIds: all.filter((a) => !a.correct).map((a) => a.qid),
    });
    // รวมแบบไม่ถอยหลัง (กันผลรอบก่อนที่บันทึกช้ามาทับผลรอบใหม่)
    setProgress((prev) => ({ ...prev, [lesson.id]: mergeLesson(prev[lesson.id], lp) ?? lp }));
    setSaveState(cloudOk ? "ok" : "local");
    setSaving(false);
  };

  const next = () => {
    if (!answered) return;
    if (idx + 1 >= items.length) {
      finish(answers);
      return;
    }
    setIdx((i) => i + 1);
    setSelected(null);
    setShowHint(false);
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
            <span className="font-black text-[#FFD700]">ผ่านแล้ว {passedCount}/{lessons.length} บท</span>
            <span className="text-sm font-bold">{pct}%</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-[#FFD700] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-white/80 mt-2">
            แต่ละบทมีแบบฝึกหัด 20 ข้อ (5 ตัวเลือก) ต้องตอบถูกครบ 20 ข้อจึงจะผ่าน · ทำใหม่ได้ไม่จำกัด ข้อและตัวเลือกจะสลับทุกรอบ
          </p>
        </div>

        <div className="space-y-5">
          {unitsWithLessons.map((u) => (
            <div key={u.no}>
              <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">
                หน่วยที่ {u.no} · {u.title}
              </h2>
              <div className="space-y-2">
                {u.lessons.map((l) => {
                  const p = progress[l.id];
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => openLesson(l)}
                      className={`w-full text-left p-4 rounded-2xl border-2 transition-all active:scale-[0.99] flex items-center gap-3 ${
                        p?.passed
                          ? "bg-emerald-50 border-emerald-200 hover:border-emerald-400"
                          : "bg-white border-[#003399]/10 hover:border-[#003399]/40"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center font-black leading-none ${
                          p?.passed ? "bg-emerald-500 text-white" : "bg-[#003399] text-[#FFD700]"
                        }`}
                      >
                        <span className="text-[9px] font-bold opacity-80">ชม.</span>
                        <span className="text-base">{l.hour}</span>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-black text-gray-900 truncate">{l.titleEn}</span>
                        <span className="block text-xs text-gray-500 truncate">{l.titleTh}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        {p?.passed ? (
                          <span className="text-[11px] font-black text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">✓ ผ่าน</span>
                        ) : p ? (
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
          ← รายการบท
        </button>
        <div className="mb-4">
          <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">ชั่วโมงที่ {lesson.hour}</span>
          <h1 className="text-2xl font-black text-gray-900 mt-2">{lesson.titleEn}</h1>
          <p className="text-[#003399] font-bold">{lesson.titleTh}</p>
          <p className="text-sm text-gray-600 mt-2"><span className="font-bold">เป้าหมาย:</span> {lesson.goal}</p>
        </div>

        {lp && (
          <div className={`rounded-xl p-3 mb-4 text-sm font-bold ${lp.passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {lp.passed
              ? `✓ ผ่านบทนี้แล้ว (${fmtDate(lp.passedAt)}) · ทำไปแล้ว ${lp.attempts} รอบ — ทำซ้ำเพื่อทบทวนได้`
              : `ทำไปแล้ว ${lp.attempts} รอบ · คะแนนดีที่สุด ${lp.best}/${lp.total} — ต้องได้ ${lp.total}/${lp.total} จึงจะผ่าน`}
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
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={startQuiz}
          className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] transition-all text-lg"
        >
          เริ่มทำแบบฝึกหัด {lesson.questions.length} ข้อ →
        </button>
        <p className="text-center text-xs text-gray-500 mt-2">ต้องตอบถูกครบ {lesson.questions.length} ข้อจึงจะผ่านบทนี้</p>
      </div>
    );
  }

  // ── QUIZ ──
  if (view === "QUIZ" && current) {
    const correctSoFar = answers.filter((a) => a.correct).length;
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
          <span className="text-xs font-black text-gray-500">ชม. {lesson.hour} · {lesson.titleEn}</span>
        </div>

        <div className="flex items-center gap-3 mb-1">
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#003399] rounded-full transition-all" style={{ width: `${((idx + (answered ? 1 : 0)) / items.length) * 100}%` }} />
          </div>
          <span className="text-sm font-black text-[#003399] tabular-nums">{idx + 1}/{items.length}</span>
        </div>
        <div className="flex gap-3 text-xs font-bold mb-4">
          <span className="text-emerald-600">✓ {correctSoFar}</span>
          <span className="text-rose-500">✗ {wrongSoFar}</span>
          {wrongSoFar > 0 && <span className="text-gray-400">รอบนี้ยังไม่ผ่าน แต่ทำให้จบเพื่อดูเฉลยแล้วลองใหม่</span>}
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="text-base md:text-lg font-bold text-gray-900 leading-relaxed">
            <Rich text={current.q.q} />
          </p>
        </div>

        <div className="space-y-2 mb-4">
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
    const score = answers.filter((a) => a.correct).length;
    const passed = score >= total && total > 0;
    const wrong = answers.filter((a) => !a.correct);
    const qById = Object.fromEntries(lesson.questions.map((q) => [q.id, q]));
    return (
      <div className="animate-fadeIn mt-2">
        <div className={`rounded-3xl p-6 text-center mb-5 ${passed ? "bg-emerald-50" : "bg-amber-50"}`}>
          <div className="text-5xl mb-2">{passed ? "🎉" : "💪"}</div>
          <p className="text-sm font-bold text-gray-500">ชม. {lesson.hour} · {lesson.titleEn}</p>
          <p className={`text-5xl font-black my-2 tabular-nums ${passed ? "text-emerald-600" : "text-amber-600"}`}>
            {score}/{total}
          </p>
          <p className={`font-black text-lg ${passed ? "text-emerald-700" : "text-amber-800"}`}>
            {passed ? "ผ่านบทนี้แล้ว!" : `อีก ${total - score} ข้อจะผ่าน — ลองใหม่อีกครั้ง`}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            {saving
              ? "⏳ กำลังบันทึกผล..."
              : saveState === "ok"
              ? "✓ บันทึกผลแล้ว ครูเห็นผลนี้ในระบบ"
              : saveState === "local"
              ? "⚠️ บันทึกไว้ในเครื่องแล้ว แต่ส่งขึ้นระบบยังไม่สำเร็จ — ระบบจะส่งให้อัตโนมัติเมื่อเปิดห้องนี้อีกครั้งตอนมีอินเทอร์เน็ต (ใช้อีเมลเดิม)"
              : ""}
          </p>
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
                    <p className="text-xs text-rose-600">✗ ตอบ: <Rich text={q.options[a.chosen]} /></p>
                    <p className="text-xs text-emerald-700 font-bold">✓ ที่ถูก: <Rich text={q.options[q.answer]} /></p>
                    {q.explain && <p className="text-xs text-gray-600 mt-1"><Rich text={q.explain} /></p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {passed && nextLesson ? (
            <button
              type="button"
              onClick={() => openLesson(nextLesson)}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] transition-all"
            >
              ไปบทถัดไป: ชม. {nextLesson.hour} {nextLesson.titleEn} →
            </button>
          ) : null}
          {!passed && (
            <button
              type="button"
              onClick={startQuiz}
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
            ทบทวนเนื้อหาบทนี้
          </button>
          <button
            type="button"
            onClick={() => { setView("LIST"); scrollTop(); }}
            className="w-full py-3 text-gray-500 font-bold rounded-2xl hover:text-[#003399]"
          >
            กลับไปรายการบท
          </button>
        </div>
      </div>
    );
  }

  return null;
}
