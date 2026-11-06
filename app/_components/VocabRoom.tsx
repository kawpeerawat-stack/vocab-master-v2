"use client";
// app/_components/VocabRoom.tsx
// ─────────────────────────────────────────────────────────────
// ห้องคำศัพท์แกน 120 คำ — เรียนแบบ 5 ขั้น จบในคาบ (ชุดละ 10 คำ = 5 คำ × 2 รอบ)
//   ① เดาก่อนรู้ (ผ่าคำ · ชนิดคำ · เดาความหมาย จากประโยคแบบข้อสอบ) — ไม่มีคะแนน
//   ② เจอความหมายแบบเต็ม (เสียง ตระกูลคำ คู่คำ ประโยคที่ 2 กับดัก)
//   ③ ทำให้คิด (ภารกิจสั้น 1 ข้อ ต้องตัดสินใจ)
//   ④ ดึงจากความจำ (หลังเรียนครบ 5 คำ · สลับทิศ · บริบทใหม่ · ผิดแล้ววนกลับจนถูกครบ)
//   ⑤ รอบทบทวนชุด (ครบ 10 คำแล้วทำอีก 1 รอบ · ผิดข้อไหนวนเฉพาะข้อนั้นจนถูกครบ) → ผ่านชุด ✓ ส่งขึ้นระบบทันที
//   ทวนคำของชุดก่อน ๆ ตามนัด = ไม่บังคับ (ไม่มีผลกับการผ่านชุด)
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BATCH_SIZE,
  REVIEW_LIMIT,
  RankEntry,
  VCourse,
  VProgress,
  VWord,
  addDay,
  cardAfterLearning,
  cardAfterReview,
  computeStats,
  dayDiff,
  emptyProgress,
  isDue,
  isReviewWeek,
  loadLocal,
  loadProgress,
  loadRanking,
  loadVocab300,
  mergeProgress,
  newCapToday,
  normalizeProgress,
  passSet,
  passedCount,
  plannedWeekNo,
  saveProgress,
  setPassOf,
  setState,
  setWords,
  shuffle,
  statusOf,
  todayStr,
} from "../lib/vocab300";
import { displayName, roomOf } from "../lib/names";
import { isIssue, issueText, loadLocalUnlock, openDay, serverToday, syncClock, thaiDate, type SyncState } from "../lib/sync";
import { GUARD_FLAG_AT, guardMode, noCopyProps, useLeaveGuard } from "../lib/guard";

// ───────── ตัวช่วยแสดงผล ─────────
function Rich({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className={`text-[#003399] font-black bg-[#FFD700]/30 px-1 rounded ${className}`}>{p.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  );
}
function Blank({ text }: { text: string }) {
  const [a, b] = text.split("___");
  return (
    <>
      {a}
      <span className="inline-block min-w-[4.5rem] border-b-2 border-[#003399] text-center text-[#003399] font-black">?</span>
      {b}
    </>
  );
}
// เวลาที่ส่งผลขึ้นระบบสำเร็จ (เรียกเฉพาะตอนบันทึก ไม่ได้เรียกระหว่างวาดหน้าจอ)
const stampNow = () => Date.now();
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function dueLabel(due: string, today: string): string {
  const d = dayDiff(today, due);
  if (d <= 0) return "วันนี้";
  if (d <= 7) return "คาบหน้า";
  const [, m, dd] = due.split("-").map(Number);
  return `อีก ${Math.round(d / 7)} สัปดาห์ (${dd} ${TH_MONTH[m - 1]})`;
}
function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith("en"));
    if (v) u.voice = v;
    synth.speak(u);
  } catch {
    /* เบราว์เซอร์ไม่รองรับเสียง */
  }
}
const scrollTop = () => {
  try {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    /* ไม่เป็นไร */
  }
};
const PART_STYLE: Record<string, string> = {
  p: "bg-emerald-50 text-emerald-700 border-emerald-200",
  r: "bg-amber-50 text-amber-700 border-amber-200",
  s: "bg-rose-50 text-rose-700 border-rose-200",
  b: "bg-gray-50 text-gray-600 border-gray-200",
};
const POS_TH: Record<string, string> = { n: "คำนาม", v: "กริยา", adj: "คุณศัพท์", adv: "กริยาวิเศษณ์", prep: "คำบุพบท", conj: "คำเชื่อม" };

// ── บัตรคำ (ใช้ทั้งขั้นที่ 2 และตอนเปิดดูย้อนหลัง) ──
function WordCard({ w, guessed }: { w: VWord; guessed?: { text: string; ok: boolean } }) {
  return (
  <div className="space-y-3">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-3xl font-black text-[#003399] font-serif">{w.w}</span>
      <span className="text-sm text-gray-500 font-bold">{w.pos} · {w.pron}</span>
      <button type="button" onClick={() => speak(w.w)} className="text-xs font-black text-[#003399] border border-[#003399]/20 rounded-full px-3 py-1">🔊 ฟัง</button>
    </div>
    {w.parts.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        {w.parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-gray-400 font-bold">+</span>}
            <span className={`border rounded-lg px-2 py-1 text-center leading-tight ${PART_STYLE[p[1]]}`}>
              <span className="block font-black font-serif">{p[0]}</span>
              <span className="block text-[11px]">{p[2] || "ส่วนท้าย"}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
    )}
    <div className="flex flex-wrap gap-1.5">
      <span className="text-[11px] font-black bg-[#003399]/10 text-[#003399] px-2 py-1 rounded-full">📝 ออกสอบจริง {w.papers} ฉบับ</span>
      <span className="text-[11px] font-black bg-gray-100 text-gray-600 px-2 py-1 rounded-full">ระดับ {w.level}</span>
    </div>
    {guessed && (
      <div className={`rounded-xl p-3 text-sm font-bold ${guessed.ok ? "bg-emerald-50 text-emerald-800" : "bg-gray-50 text-gray-700"}`}>
        คุณเดาว่า “{guessed.text}” {guessed.ok ? "✓ ตรงเลย" : "— ความหมายจริงอยู่ด้านล่าง"}
      </div>
    )}
    <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-sm">
      <span className="text-gray-500 font-bold">ความหมาย</span>
      <span className="font-black text-base text-gray-900">{w.th}</span>
      <span className="text-gray-500 font-bold">English</span>
      <span className="font-serif text-gray-700">{w.def}</span>
      <span className="text-gray-500 font-bold">ตระกูลคำ</span>
      <span className="flex flex-wrap gap-1">
        {w.fam.map((f, i) => (
          <span key={i} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5">
            <b className="font-serif">{f[0]}</b> <span className="text-gray-400">{f[1]}</span> {f[2]}
          </span>
        ))}
      </span>
      <span className="text-gray-500 font-bold">คู่คำ</span>
      <span className="flex flex-wrap gap-1">
        {w.col.map((c, i) => (
          <span key={i} className="text-xs font-serif bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5">{c}</span>
        ))}
      </span>
      <span className="text-gray-500 font-bold">ตัวอย่าง</span>
      <span className="font-serif text-gray-800 space-y-1">
        <span className="block"><Rich text={w.sent} /></span>
        <span className="block"><Rich text={w.ex2} /></span>
      </span>
    </div>
    {w.trap && (
      <div className="bg-amber-50 border-l-4 border-[#FFD700] rounded-xl p-3 text-sm text-gray-800">
        ⚠️ <b>กับดัก:</b> {w.trap}
      </div>
    )}
  </div>
);
}

// ── แถบหัวระหว่างเรียน ──
function SessionBar({ label, warn, confirmExit, setConfirmExit, onExit }: { label: string; warn: string; confirmExit: boolean; setConfirmExit: (v: boolean) => void; onExit: () => void }) {
  return (
  <div className="flex items-center justify-between mb-3 gap-2">
    {confirmExit ? (
      <span className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span className="text-rose-600">{warn}</span>
        <button onClick={onExit} className="px-2 py-1 bg-rose-600 text-white rounded-lg">ออก</button>
        <button onClick={() => setConfirmExit(false)} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg">ทำต่อ</button>
      </span>
    ) : (
      <button type="button" onClick={() => setConfirmExit(true)} className="text-sm font-bold text-[#003399] hover:underline">← ออก</button>
    )}
    <span className="text-xs font-black text-gray-500 text-right">{label}</span>
  </div>
);
}

function Steps({ active }: { active: number }) {
  return (
  <div className="grid grid-cols-5 gap-1 mb-3">
    {["เดาก่อน", "เจอเต็ม", "ทำให้คิด", "ดึงความจำ", "รอบทบทวน"].map((l, i) => (
      <div key={l} className={`text-[10px] font-bold text-center ${i + 1 === active ? "text-[#003399]" : i + 1 < active ? "text-emerald-600" : "text-gray-400"}`}>
        <div className={`h-1.5 rounded-full mb-1 ${i + 1 === active ? "bg-[#003399]" : i + 1 < active ? "bg-emerald-500" : "bg-gray-200"}`} />
        {l}
      </div>
    ))}
  </div>
);
}

function Opt({ i, label, state, onClick, en }: { i: number; label: string; state: "" | "ok" | "bad" | "dim"; onClick: () => void; en?: boolean }) {
  return (
  <button
    type="button"
    onClick={onClick}
    disabled={state !== ""}
    className={`w-full text-left px-4 py-3 rounded-xl border-2 flex items-start gap-3 transition-all ${
      state === "ok" ? "border-emerald-500 bg-emerald-50" : state === "bad" ? "border-rose-400 bg-rose-50" : state === "dim" ? "border-gray-100 opacity-50" : "border-gray-200 hover:border-[#003399] active:scale-[0.99]"
    }`}
  >
    <span className="shrink-0 w-6 h-6 rounded-full bg-[#003399]/10 text-[#003399] text-xs font-black flex items-center justify-center">{i + 1}</span>
    <span className={`flex-1 ${en ? "font-serif text-base" : ""}`}>{label}</span>
  </button>
);
}

// ───────── ข้อคำถามขั้นที่ 4–5 ─────────
type Kind = "en2th" | "th2en" | "ctx" | "form";
const KIND_LABEL: Record<Kind, string> = { en2th: "อังกฤษ → ไทย", th2en: "ไทย → อังกฤษ", ctx: "ใช้ในบริบทใหม่", form: "รูปคำ / การใช้" };
interface QItem {
  key: string;
  wid: string;
  kind: Kind;
  options: string[];
  ans: number;
  en: boolean;      // ตัวเลือกเป็นภาษาอังกฤษ
  why: string;
  retry: number;    // 0 = ครั้งแรก, >0 = วนกลับมาถามซ้ำ
}
function pickOthers(w: VWord, pool: VWord[], n: number, field: "th" | "w"): string[] {
  const seen = new Set([w[field]]);
  const same = shuffle(pool.filter((x) => x.id !== w.id && x.pk === w.pk));
  const rest = shuffle(pool.filter((x) => x.id !== w.id && x.pk !== w.pk));
  const out: string[] = [];
  for (const x of [...same, ...rest]) {
    if (seen.has(x[field])) continue;
    seen.add(x[field]);
    out.push(x[field]);
    if (out.length === n) break;
  }
  return out;
}
let itemSeq = 0;
function makeItem(w: VWord, kind: Kind, pool: VWord[], retry = 0): QItem {
  itemSeq++;
  if (kind === "form" && !w.form) kind = "en2th";
  if (kind === "en2th" || kind === "th2en") {
    const field = kind === "en2th" ? "th" : "w";
    const opts = shuffle([w[field], ...pickOthers(w, pool, 3, field)]);
    return { key: `${w.id}-${itemSeq}`, wid: w.id, kind, options: opts, ans: opts.indexOf(w[field]), en: kind === "th2en", why: `${w.w} (${w.pos}) = ${w.th}`, retry };
  }
  if (kind === "ctx") {
    const opts = shuffle([w.w, ...w.cx]);
    return { key: `${w.id}-${itemSeq}`, wid: w.id, kind, options: opts, ans: opts.indexOf(w.w), en: true, why: `ประโยคนี้ต้องการ “${w.w}” = ${w.th}`, retry };
  }
  const f = w.form!;
  const order = shuffle(f.o.map((_, i) => i));
  return { key: `${w.id}-${itemSeq}`, wid: w.id, kind: "form", options: order.map((i) => f.o[i]), ans: order.indexOf(f.a), en: true, why: f.why, retry };
}
function noAdjacent(items: QItem[]): QItem[] {
  let best = shuffle(items);
  for (let t = 0; t < 30; t++) {
    if (best.every((x, i) => i === 0 || x.wid !== best[i - 1].wid)) return best;
    best = shuffle(items);
  }
  return best;
}

// ───────── สถานะการเรียน 1 ชุด ─────────
interface WordRun { g: number; p: number; pc: number; firstTry: boolean; asked: number; wrong: number }
type Mode = "HOME" | "WEEK" | "LEARN" | "CHECK" | "REVIEW" | "PRACTICE" | "SUMMARY";
type LearnPhase = "predict" | "meet" | "proc" | "retrieve";
interface Summary {
  kind: "learn" | "check" | "review" | "practice";
  set?: number;
  rows: { wid: string; ok: boolean; before?: string; after?: string; due?: string }[];
  correct: number;
  total: number;
  cloudOk: boolean | null;
}

export default function VocabRoom({ email, name, onExit }: { email: string; name: string; onExit: () => void }) {
  const [course, setCourse] = useState<VCourse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [prog, setProg] = useState<VProgress>(() => (typeof window !== "undefined" ? loadLocal(email) : emptyProgress()));
  const progRef = useRef<VProgress>(prog);
  useEffect(() => {
    progRef.current = prog;
  }, [prog]);
  const [mode, setMode] = useState<Mode>("HOME");
  const [weekNo, setWeekNo] = useState(1);
  const [openWord, setOpenWord] = useState<string | null>(null);
  const [today, setToday] = useState(todayStr());

  // ชุดเรียน
  const [batch, setBatch] = useState<VWord[]>([]);
  const [bi, setBi] = useState(0);
  const [phase, setPhase] = useState<LearnPhase>("predict");
  const [mini, setMini] = useState<{ part?: number; pos?: string; guess?: number; proc?: number }>({});
  const [ord, setOrd] = useState<{ part: number[]; guess: number[]; proc: number[] }>({ part: [0, 1, 2], guess: [0, 1, 2], proc: [0, 1, 2] });
  const runs = useRef<Record<string, WordRun>>({});

  // คิวคำถาม (ขั้นที่ 4 / ทวน / ฝึกเพิ่ม)
  const [queue, setQueue] = useState<QItem[]>([]);
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const reviewDone = useRef<Record<string, { ok: boolean; before: string }>>({});
  const checkFirst = useRef<Record<string, boolean>>({}); // รอบทบทวน: คำไหนตอบถูกตั้งแต่ครั้งแรก
  const [checkSetNo, setCheckSetNo] = useState(0);
  const practiceScore = useRef({ c: 0, t: 0 });
  const sinceSave = useRef(0);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [cloudState, setCloudState] = useState<SyncState>("idle");
  const saving = cloudState === "saving" || cloudState === "slow";
  const [sToday, setSToday] = useState(() => serverToday()); // วันที่ตามเซิร์ฟเวอร์ (ใช้ล็อกชุดตามวันเรียน)
  const [unlockN, setUnlockN] = useState(() => loadLocalUnlock(email).v300 || 0); // ครูเปิดให้ล่วงหน้าถึงชุดที่ … (รายคน)
  const [checkGate, setCheckGate] = useState(false); // หน้ากติกาก่อนรอบทบทวน (รอบที่เข้าสมุดคะแนน)
  const [savedAt, setSavedAt] = useState(0);
  const [showRank, setShowRank] = useState(false);
  const [rank, setRank] = useState<RankEntry[] | null>(null);
  const [showHow, setShowHow] = useState(false);

  // ── โหลด ──
  useEffect(() => {
    let alive = true;
    const coursePromise = loadVocab300();
    coursePromise
      .then((c) => {
        if (!alive) return;
        setCourse(c);
        // ชุดที่เรียนครบด้วยแอปแบบเดิม → นับผ่านทันทีจากข้อมูลในเครื่อง (ไม่ต้องรอระบบ)
        setProg((cur) => normalizeProgress(cur, c.words));
      })
      .catch(() => alive && setLoadError(true));
    syncClock().then(() => alive && setSToday(serverToday()));
    Promise.all([coursePromise.catch(() => null), loadProgress(email)]).then(([c, { p, needSync }]) => {
      if (!alive) return;
      setUnlockN(loadLocalUnlock(email).v300 || 0);
      const raw = mergeProgress(progRef.current, p);
      const merged = c ? normalizeProgress(raw, c.words) : raw;
      setProg(merged);
      // คาบก่อนเน็ตหลุด / มีชุดที่ผ่านแต่ยังไม่ขึ้นระบบ (เช่น ชุดแบบเดิม) → ส่งเฉพาะส่วนที่ยังไม่ขึ้นระบบให้ทันที
      if (needSync || merged !== raw) {
        setCloudState("saving");
        saveProgress(email, name, merged, () => alive && setCloudState("slow")).then((r) => {
          if (!alive) return;
          setCloudState(r.ok ? "ok" : r.issue);
          if (r.ok) setSavedAt(Date.now());
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [email, name]);

  // วันเปลี่ยน (เปิดค้างข้ามเที่ยงคืน)
  useEffect(() => {
    const t = setInterval(() => setToday(todayStr()), 60000);
    return () => clearInterval(t);
  }, []);

  const words = useMemo(() => course?.words ?? [], [course]);
  const byId = useMemo(() => Object.fromEntries(words.map((w) => [w.id, w])), [words]);
  const stats = useMemo(() => computeStats(prog, today), [prog, today]);
  const dueWords = useMemo(
    () =>
      words
        .filter((w) => isDue(prog.cards[w.id], today))
        .sort((a, b) => (prog.cards[a.id].due < prog.cards[b.id].due ? -1 : prog.cards[a.id].due > prog.cards[b.id].due ? 1 : prog.cards[a.id].at - prog.cards[b.id].at)),
    [words, prog, today]
  );
  const myRoom = roomOf(name);
  const newCap = useMemo(() => newCapToday(course, prog, today, myRoom), [course, prog, today, myRoom]);
  const newLeftToday = Math.max(0, newCap - stats.newToday);
  const planNo = plannedWeekNo(course, today, myRoom);
  const planWk = planNo ? course?.weeks[planNo - 1] : undefined;
  // สัปดาห์ทวน = สัปดาห์ในแผนที่ไม่มีชุดใหม่ (สัปดาห์ที่ 6 และ 14 ของภาค) — ใช้ทวนคำค้างและตามชุดที่ขาด
  const reviewWeek = isReviewWeek(course, today, myRoom);
  const activeDays = Object.values(prog.days).filter((d) => d.n + d.r > 0).length;
  // ชุดที่กำลังเรียน = ชุดแรกที่ยังไม่ผ่าน (ต้องผ่านชุดนี้ก่อนจึงเปิดชุดถัดไป)
  const nSets = course?.weeks.length ?? 0;
  const passedN = passedCount(prog);
  let curSet = 0;
  for (let k = 1; k <= nSets; k++) if (!setPassOf(prog, k)) { curSet = k; break; }
  const curWords = curSet ? setWords(words, curSet) : [];
  const nextNew = curWords.filter((w) => !prog.cards[w.id]);
  const curReady = curSet > 0 && curWords.length > 0 && nextNew.length === 0; // เรียนครบ 10 คำแล้ว รอรอบทบทวน
  const behindSets = planNo ? Array.from({ length: planNo }, (_, i) => i + 1).filter((k) => !setPassOf(prog, k)).length : 0;

  const doSave = async (p: VProgress) => {
    setCloudState("saving");
    const r = await saveProgress(email, name, p, () => setCloudState("slow"));
    setCloudState(r.ok ? "ok" : r.issue);
    if (r.ok) setSavedAt(stampNow());
    return r.ok;
  };
  // ลองส่งใหม่เองทุก 20 วินาที / เมื่อเน็ตกลับมา / เมื่อกลับเข้าหน้าแอป (ยกเว้นที่เก็บเต็ม — ต้องให้ครูแก้)
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  });
  const needRetry = isIssue(cloudState) && cloudState !== "full";
  useEffect(() => {
    if (!needRetry) return;
    const tick = () => {
      if (document.visibilityState === "visible") void doSaveRef.current(progRef.current);
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

  // ── ล็อกชุดตามวันเรียนของห้อง (เวลาเซิร์ฟเวอร์) · ชุดที่ถึงวันเรียนแล้วเปิดค้างไว้ · ครูเปิดล่วงหน้ารายคนได้ ──
  const openPlan = plannedWeekNo(course, sToday, myRoom);
  const openUpTo = openPlan === null ? Infinity : Math.max(openPlan, unlockN);
  const curLocked = curSet > 0 && curSet > openUpTo && !curReady;
  const curOpenDay = curLocked ? openDay(course?.weeks[curSet - 1]?.start, myRoom, course?.classDays) : null;

  // ── ระบบกัน AI ในรอบทบทวน (รอบที่เข้าสมุดคะแนน) ──
  const gMode = guardMode(sToday);
  const curItem = queue[qi];
  const guard = useLeaveGuard(mode === "CHECK" && !checkGate, mode === "CHECK" && !checkGate && curItem && picked === null && curItem.retry === 0 ? curItem.wid : null);
  const voidedRef = useRef(0);

  // ── เริ่มชุดเรียนใหม่ ──
  const startWord = (i: number) => {
    setBi(i);
    setPhase("predict");
    setMini({});
    setOrd({ part: shuffle([0, 1, 2]), guess: shuffle([0, 1, 2]), proc: shuffle([0, 1, 2]) });
  };
  const startLearn = () => {
    const n = Math.min(BATCH_SIZE, newLeftToday, nextNew.length);
    if (n <= 0) return;
    const b = nextNew.slice(0, n);
    runs.current = Object.fromEntries(b.map((w) => [w.id, { g: 0, p: w.pq ? 0 : -1, pc: 0, firstTry: true, asked: 0, wrong: 0 }]));
    setBatch(b);
    startWord(0);
    setConfirmExit(false);
    setMode("LEARN");
    scrollTop();
  };
  const startRetrieve = () => {
    const pool = words.filter((w) => w.week === batch[0].week || batch.some((b) => b.id === w.id));
    const items: QItem[] = [];
    batch.forEach((w, i) => {
      items.push(makeItem(w, i % 2 ? "th2en" : "en2th", pool));
      items.push(makeItem(w, "ctx", pool));
    });
    setQueue(noAdjacent(items));
    setQi(0);
    setPicked(null);
    setPhase("retrieve");
    scrollTop();
  };

  // ── รอบทบทวนชุด: ครบ 10 คำแล้วทำอีก 1 รอบ (คำละ 1 ข้อ) · ผิดข้อไหนวนเฉพาะข้อนั้นจนถูกครบ → ผ่านชุด ──
  const startCheck = () => {
    if (!curReady) return;
    const kinds: Kind[] = ["ctx", "th2en", "form", "en2th"];
    checkFirst.current = {};
    voidedRef.current = 0;
    guard.reset();
    setCheckGate(true);
    setCheckSetNo(curSet);
    setQueue(shuffle(curWords).map((w, i) => makeItem(w, kinds[i % kinds.length], curWords)));
    setQi(0);
    setPicked(null);
    setConfirmExit(false);
    setMode("CHECK");
    scrollTop();
  };

  // ── ทวนคำของชุดก่อน ๆ ตามนัด (ไม่บังคับ) ──
  const startReview = () => {
    const list = dueWords.slice(0, REVIEW_LIMIT);
    if (!list.length) return;
    reviewDone.current = {};
    const items = list.map((w) => {
      const c = prog.cards[w.id];
      const kinds: Kind[] = ["th2en", "ctx", w.form ? "form" : "en2th", "en2th"];
      return makeItem(w, kinds[c.n % 4], words.filter((x) => x.week === w.week));
    });
    setQueue(noAdjacent(items));
    setQi(0);
    setPicked(null);
    sinceSave.current = 0;
    setConfirmExit(false);
    setMode("REVIEW");
    scrollTop();
  };

  // ── ฝึกเพิ่ม (ไม่นับคะแนน) ──
  const learned = words.filter((w) => prog.cards[w.id]);
  const startPractice = () => {
    const pick = shuffle(learned).slice(0, 10);
    if (!pick.length) return;
    practiceScore.current = { c: 0, t: 0 };
    const kinds: Kind[] = ["en2th", "th2en", "ctx", "form"];
    setQueue(noAdjacent(pick.map((w) => makeItem(w, kinds[Math.floor(Math.random() * 4)], learned))));
    setQi(0);
    setPicked(null);
    setConfirmExit(false);
    setMode("PRACTICE");
    scrollTop();
  };

  // ── ตอบข้อคำถาม ──
  const answer = (slot: number) => {
    if (picked !== null) return;
    setPicked(slot);
    const it = queue[qi];
    const ok = slot === it.ans;
    const w = byId[it.wid];
    if (mode === "LEARN") {
      const r = runs.current[it.wid];
      if (it.retry === 0) {
        r.asked++;
        if (!ok) { r.firstTry = false; r.wrong++; }
      }
      // ผิด → วนกลับมาท้ายรอบจนกว่าจะถูก
      if (!ok) {
        const pool = words.filter((x) => x.week === w.week);
        setQueue((q) => [...q, makeItem(w, it.kind, pool, it.retry + 1)]);
      }
    } else if (mode === "CHECK") {
      if (it.retry === 0) {
        // ช่วงหักคะแนน: ออกจากหน้าระหว่างข้อนี้ → ไม่นับว่าถูกตั้งแต่ครั้งแรก (ยังต้องตอบให้ถูกเพื่อผ่านชุดตามเดิม)
        const left = gMode === "enforce" && guard.wasLeft(it.wid);
        if (left && ok) voidedRef.current++;
        checkFirst.current[it.wid] = ok && !left;
      }
      if (!ok) setQueue((q) => [...q, makeItem(w, it.kind, words.filter((x) => x.week === w.week), it.retry + 1)]);
    } else if (mode === "REVIEW") {
      if (it.retry === 0 && !reviewDone.current[it.wid]) {
        const before = statusOf(prog.cards[it.wid]);
        reviewDone.current[it.wid] = { ok, before };
        const next = cardAfterReview(prog.cards[it.wid], today, ok);
        const p2 = addDay({ ...prog, cards: { ...prog.cards, [it.wid]: next } }, today, { r: 1, c: ok ? 1 : 0, x: ok ? 0 : 1 });
        setProg(p2);
        sinceSave.current++;
        if (sinceSave.current >= 5) {
          sinceSave.current = 0;
          saveProgress(email, name, p2).then((r) => setCloudState(r.ok ? "ok" : r.issue));
        }
        if (!ok) setQueue((q) => [...q, makeItem(w, "en2th", words.filter((x) => x.week === w.week), 1)]);
      }
    } else if (mode === "PRACTICE") {
      if (it.retry === 0) {
        practiceScore.current.t++;
        if (ok) practiceScore.current.c++;
      }
    }
  };

  const nextQuestion = async () => {
    guard.clearNotice();
    if (qi + 1 < queue.length) {
      setQi(qi + 1);
      setPicked(null);
      return;
    }
    // จบคิว
    if (mode === "LEARN") {
      let p = progRef.current;
      const rows: Summary["rows"] = [];
      let correct = 0, total = 0;
      for (const w of batch) {
        const r = runs.current[w.id];
        const c = cardAfterLearning(p.cards[w.id], today, { firstTry: r.firstTry, asked: r.asked, wrong: r.wrong, g: r.g, p: r.p, pc: r.pc });
        p = { ...p, cards: { ...p.cards, [w.id]: c } };
        rows.push({ wid: w.id, ok: r.firstTry, due: c.due });
        correct += r.asked - r.wrong;
        total += r.asked;
      }
      p = addDay(p, today, { n: batch.length, c: correct, x: total - correct });
      setProg(p);
      setSummary({ kind: "learn", rows, correct, total, cloudOk: null, set: batch[0]?.week });
      setMode("SUMMARY");
      scrollTop();
      const ok = await doSave(p);
      setSummary((s) => (s ? { ...s, cloudOk: ok } : s));
    } else if (mode === "CHECK") {
      // ถูกครบทุกคำแล้ว → ผ่านชุด · ส่งขึ้นระบบทันที (หน้าครูขึ้น ✓ สีเขียว)
      const k = checkSetNo;
      const first = checkFirst.current;
      const score = Object.values(first).filter(Boolean).length;
      let p = passSet(progRef.current, words, k, today, { score });
      // แนบผลการเฝ้าดู (ออกจากหน้า / เวลาที่หายไป) ไว้กับชุดที่ผ่าน ให้ครูเห็น
      const g = guard.stats(voidedRef.current, gMode);
      p = { ...p, sets: { ...p.sets, [String(k)]: { ...p.sets![String(k)], gl: g.leaves, ga: g.awayMs, gb: g.blurs, gv: g.voided, gm: g.mode } } };
      p = addDay(p, today, { c: score, x: Object.keys(first).length - score });
      setProg(p);
      const rows = setWords(words, k).map((w) => ({ wid: w.id, ok: !!first[w.id] }));
      setSummary({ kind: "check", set: k, rows, correct: score, total: rows.length, cloudOk: null });
      setMode("SUMMARY");
      scrollTop();
      const ok = await doSave(p);
      setSummary((s) => (s ? { ...s, cloudOk: ok } : s));
    } else if (mode === "REVIEW") {
      const p = progRef.current;
      const rows = Object.entries(reviewDone.current).map(([wid, v]) => ({ wid, ok: v.ok, before: v.before, after: statusOf(p.cards[wid]), due: p.cards[wid]?.due }));
      const correct = rows.filter((r) => r.ok).length;
      setSummary({ kind: "review", rows, correct, total: rows.length, cloudOk: null });
      setMode("SUMMARY");
      scrollTop();
      const ok = await doSave(p);
      setSummary((s) => (s ? { ...s, cloudOk: ok } : s));
    } else {
      setSummary({ kind: "practice", rows: [], correct: practiceScore.current.c, total: practiceScore.current.t, cloudOk: null });
      setMode("SUMMARY");
      scrollTop();
    }
  };

  const exitSession = async () => {
    setConfirmExit(false);
    if (mode === "REVIEW") await doSave(progRef.current);
    setMode("HOME");
    scrollTop();
  };

  const toggleRank = async () => {
    const nx = !showRank;
    setShowRank(nx);
    if (nx && rank === null) {
      // บันทึกของตัวเองก่อน เพื่อให้อันดับเป็นข้อมูลล่าสุด
      await saveProgress(email, name, progRef.current);
      setRank(await loadRanking());
    }
  };

  // ───────────────────────── RENDER ─────────────────────────
  if (loadError) {
    return (
      <div className="text-center py-10">
        <p className="text-rose-600 font-bold mb-4">โหลดคำศัพท์ไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>
        <button onClick={onExit} className="px-4 py-2 bg-[#003399] text-white rounded-xl font-bold">← เมนูหลัก</button>
      </div>
    );
  }
  if (!course) {
    return <p className="text-center text-[#003399] font-bold animate-pulse py-16">กำลังโหลดคำศัพท์...</p>;
  }

  const total = words.length;

  // ═════════════ HOME ═════════════
  if (mode === "HOME") {
    const allPassed = nSets > 0 && curSet === 0;
    const curLearned = curWords.length - nextNew.length;
    const curWk = curSet ? course.weeks[curSet - 1] : undefined;
    const stepOf = (n: number) => (allPassed ? 3 : curReady ? 2 : n > 0 ? 1 : 0);
    const step = stepOf(curLearned);
    return (
      <div className="animate-fadeIn mt-2">
        <button type="button" onClick={onExit} className="mb-4 text-sm font-bold text-[#003399] hover:underline">← เมนูหลัก</button>
        <div className="text-center mb-5">
          <div className="text-4xl mb-1">📚</div>
          <h1 className="text-2xl font-black text-gray-900">{course.titleTh}</h1>
          <p className="text-[#003399] font-bold text-xs tracking-widest uppercase">Core Vocabulary · TGAT & A-Level</p>
          <p className="text-gray-500 text-xs mt-1">{course.subtitle}</p>
        </div>

        {/* ความก้าวหน้า */}
        <div className="bg-[#003399] rounded-2xl p-4 mb-4 text-white">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-black text-[#FFD700] text-lg">ผ่านแล้ว {passedN}/{nSets} ชุด</span>
            <span className="text-sm font-bold">รู้แล้ว {stats.known}/{total} คำ</span>
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${nSets || 1}, minmax(0, 1fr))` }}>
            {course.weeks.map((wk) => {
              const st = setState(prog, words, wk.no);
              return (
                <span
                  key={wk.no}
                  title={`ชุด ${wk.no}`}
                  className={`h-3 rounded-full ${st === "passed" ? "bg-[#FFD700]" : st === "ready" ? "bg-white/60" : st === "part" ? "bg-white/30" : "bg-white/15"}`}
                />
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div className="bg-white/10 rounded-xl py-2">
              <div className="text-lg font-black">{stats.learning}</div>
              <div className="text-[10px] font-bold text-white/70">กำลังเรียน</div>
            </div>
            <div className="bg-white/10 rounded-xl py-2">
              <div className="text-lg font-black text-[#FFD700]">{stats.due}</div>
              <div className="text-[10px] font-bold text-white/70">ทวนได้ (ไม่บังคับ)</div>
            </div>
            <div className="bg-white/10 rounded-xl py-2">
              <div className="text-lg font-black">📅 {activeDays}</div>
              <div className="text-[10px] font-bold text-white/70">ครั้งที่เข้าเรียน</div>
            </div>
          </div>
          <p className="text-[11px] text-white/75 mt-3 leading-relaxed">
            ผ่านชุด = เรียนครบ 10 คำ + รอบทบทวนถูกครบทุกคำ (ทำจบในคาบ) · แถบสีทอง = ชุดที่ผ่านแล้ว · คำในชุดที่ผ่านแล้วนับว่า “รู้แล้ว”
          </p>
        </div>

        {/* สถานะส่งผลขึ้นระบบ — ครูตรวจก่อนหมดคาบ */}
        {(saving || cloudState !== "idle") && (
          <div
            className={`rounded-2xl px-4 py-3 mb-4 text-sm font-bold flex items-center gap-2 ${
              saving ? "bg-blue-50 text-[#003399]" : cloudState === "ok" ? "bg-emerald-50 text-emerald-800 border-2 border-emerald-200" : "bg-amber-50 text-amber-900 border-2 border-amber-300"
            }`}
          >
            <span className="flex-1">
              {cloudState === "ok"
                ? `✓ ส่งผลขึ้นระบบแล้ว ${savedAt ? new Date(savedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) + " น." : ""} · ครูเห็นผลแล้ว`
                : issueText(cloudState)}
            </span>
            {isIssue(cloudState) && (
              <button onClick={() => doSave(prog)} className="shrink-0 px-3 py-1.5 bg-amber-500 text-white rounded-xl font-black text-xs">
                ส่งอีกครั้ง
              </button>
            )}
          </div>
        )}

        {/* คาบนี้ทำอะไร */}
        <div className="border-2 border-[#003399]/15 rounded-2xl p-4 mb-4">
          <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">คาบนี้ทำอะไร</p>
          {planNo !== null && planNo > 0 && (
            <p className={`text-xs font-bold rounded-xl px-3 py-2 mb-3 ${behindSets > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
              {reviewWeek ? `ตามแผนของครู: สัปดาห์นี้เป็นสัปดาห์ทวน ไม่มีชุดใหม่ (เรียนถึงชุดที่ ${planNo}) · ` : `ตามแผนของครู: สัปดาห์นี้เรียนชุดที่ ${planNo}${planWk?.label ? ` (${planWk.label})` : ""} · `}
              {behindSets > 0 ? `ยังไม่ผ่าน ${behindSets} ชุด — คาบนี้เรียนคำใหม่ได้ถึง ${newCap} คำ` : "✓ ผ่านตามแผนแล้ว"}
            </p>
          )}

          {allPassed ? (
            <p className="text-center font-black text-emerald-700 py-3">🎉 ผ่านครบทั้ง {nSets} ชุดแล้ว ({total} คำ) — ใช้ “ฝึกเพิ่ม” และ “ทวน” เตรียมสอบได้เลย</p>
          ) : (
            <>
              {/* ชุดที่กำลังเรียน: 3 ขั้นสู่การผ่าน */}
              <div className="rounded-xl bg-gray-50 p-3 mb-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-black text-gray-900">ชุดที่ {curSet}{curWk?.label ? <span className="font-bold text-gray-500 text-xs"> · {curWk.label}</span> : null}</span>
                  <span className="text-[11px] font-black text-[#003399] tabular-nums">เรียนแล้ว {curLearned}/{curWords.length} คำ</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-black text-center">
                  {["① เรียน 10 คำ", "② รอบทบทวน", "③ ผ่าน ✓"].map((l, i) => (
                    <span key={l} className={`rounded-lg py-1.5 ${i < step ? "bg-emerald-500 text-white" : i === step ? "bg-[#FFD700] text-[#003399]" : "bg-white text-gray-400 border border-gray-200"}`}>{l}</span>
                  ))}
                </div>
              </div>
              {curReady ? (
                <>
                  <button onClick={startCheck} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] text-lg">
                    รอบทบทวนชุดที่ {curSet} ({curWords.length} ข้อ) →
                  </button>
                  <p className="text-xs text-gray-500 mt-2 text-center">ทำอีก 1 รอบทั้ง {curWords.length} คำ · ข้อที่ผิดจะวนกลับมาจนถูกครบ · ครบแล้วผ่านชุดทันที</p>
                </>
              ) : curLocked ? (
                <div className="text-center rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 py-3 px-3">
                  <p className="font-black text-gray-700">🔒 ชุดที่ {curSet} เปิด{curOpenDay ? thaiDate(curOpenDay) : "ในคาบถัดไป"}</p>
                  <p className="text-xs text-gray-500 mt-1">ชุดใหม่เปิดในวันที่ห้อง {myRoom || "ของคุณ"} เรียน · ชุดที่ถึงวันเรียนแล้วเปิดไว้ให้ทำย้อนหลังได้เสมอ</p>
                </div>
              ) : newLeftToday > 0 ? (
                <>
                  <button onClick={startLearn} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] text-lg">
                    เรียนคำใหม่ชุดที่ {curSet} ({Math.min(BATCH_SIZE, newLeftToday, nextNew.length)} คำ) →
                  </button>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    เรียนทีละ {BATCH_SIZE} คำ · ข้อที่ผิดวนกลับมาจนถูกครบ · เรียนครบ {curWords.length} คำแล้วทำรอบทบทวนเพื่อผ่านชุด
                  </p>
                </>
              ) : (
                <p className="text-center font-black text-emerald-700 py-3">
                  {reviewWeek && newCap === 0 ? "✓ สัปดาห์ทวน ไม่มีชุดใหม่ · ใช้ “ทวน” และ “ฝึกเพิ่ม” ทบทวนคำที่เรียนแล้ว" : `✓ คาบนี้เรียนคำใหม่ครบ ${newCap} คำแล้ว · ชุดถัดไปเรียนคาบหน้า`}
                </p>
              )}
            </>
          )}

          {/* ทวนคำชุดก่อน ๆ — ไม่บังคับ ไม่มีผลกับการผ่านชุด */}
          {stats.due > 0 && (
            <button onClick={startReview} className="w-full mt-3 py-2.5 bg-white border-2 border-[#003399]/30 text-[#003399] font-black rounded-xl text-sm">
              🔁 ทวนคำชุดก่อน ๆ ({Math.min(stats.due, REVIEW_LIMIT)} คำ · ไม่บังคับ ช่วยให้จำได้ถึงวันสอบ)
            </button>
          )}
          {learned.length >= 4 && (
            <button onClick={startPractice} className="w-full mt-2 py-2.5 bg-white border-2 border-[#003399]/15 text-[#003399] font-bold rounded-xl text-sm">
              🎯 ฝึกเพิ่ม 10 ข้อ (ไม่นับคะแนน)
            </button>
          )}
        </div>

        {/* วิธีเรียน */}
        <button onClick={() => setShowHow(!showHow)} className="w-full text-left text-sm font-black text-[#003399] mb-2">
          {showHow ? "▲" : "▼"} เรียนแบบ 5 ขั้น ทำอย่างไร
        </button>
        {showHow && (
          <ol className="text-sm text-gray-700 bg-gray-50 rounded-2xl p-4 mb-4 space-y-1.5 list-decimal pl-8">
            <li><b>เดาก่อนรู้</b> — อ่านประโยคแบบข้อสอบ ผ่าคำ บอกชนิดคำ แล้วเดาความหมาย (ไม่มีคะแนน เดาผิดได้)</li>
            <li><b>เจอความหมายแบบเต็ม</b> — ฟังเสียง ดูตระกูลคำ คู่คำ ตัวอย่างที่ 2 และกับดัก</li>
            <li><b>ทำให้คิด</b> — ตอบภารกิจสั้น 1 ข้อที่ต้องตัดสินใจ</li>
            <li><b>ดึงจากความจำ</b> — หลังเรียนครบ 5 คำ ตอบโดยไม่มีบัตรคำ ข้อที่ผิดจะวนกลับมาจนถูกครบ</li>
            <li><b>รอบทบทวนชุด</b> — เรียนครบ 10 คำแล้วทำอีก 1 รอบ ผิดข้อไหนวนเฉพาะข้อนั้นจนถูกครบ → <b>ผ่านชุด ✓</b> (ครูเห็นสีเขียวทันที · จบในคาบ ไม่ต้องรอวันอื่น)</li>
          </ol>
        )}

        {/* รายชุด */}
        <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2 mt-2">คำศัพท์ {course.weeks.length} ชุด (ชุดละ {course.weeks[0]?.count ?? 10} คำ · เรียนในคาบตามวันที่ของครู)</h2>
        <div className="space-y-2 mb-5">
          {course.weeks.map((wk) => {
            const ws = words.filter((w) => w.week === wk.no);
            const s = ws.filter((w) => prog.cards[w.id]).length;
            const rec = setPassOf(prog, wk.no);
            const st = setState(prog, words, wk.no);
            const isCur = wk.no === curSet;
            return (
              <button
                key={wk.no}
                type="button"
                onClick={() => { setWeekNo(wk.no); setOpenWord(null); setMode("WEEK"); scrollTop(); }}
                className={`w-full text-left p-3 rounded-2xl border-2 flex items-center gap-3 transition-all active:scale-[0.99] ${
                  rec ? "bg-emerald-50 border-emerald-200" : isCur ? "bg-[#FFD700]/10 border-[#FFD700]" : "bg-white border-[#003399]/10 hover:border-[#003399]/40"
                }`}
              >
                <span className={`shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center font-black leading-none ${rec ? "bg-emerald-500 text-white" : "bg-[#003399] text-[#FFD700]"}`}>
                  <span className="text-[9px] font-bold opacity-80">ชุด</span>
                  <span className="text-base">{wk.no}</span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-black text-gray-900 truncate">{wk.title}</span>
                  {wk.label && <span className="block text-[11px] font-bold text-gray-500">แผนเรียน: {wk.label}</span>}
                  <span className="flex items-center gap-2 mt-1">
                    <span className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden relative">
                      <span className={`absolute inset-y-0 left-0 rounded-full ${rec ? "bg-emerald-500" : "bg-[#003399]/30"}`} style={{ width: `${(s / ws.length) * 100}%` }} />
                    </span>
                    <span className="text-[11px] font-bold text-gray-500 tabular-nums">
                      {rec ? `ผ่าน · คะแนน ${rec.score}/10` : `เรียนแล้ว ${s}/${ws.length}`}
                    </span>
                  </span>
                </span>
                {rec ? (
                  <span className="shrink-0 text-[10px] font-black bg-emerald-500 text-white px-2 py-1 rounded-full">✓ ผ่าน</span>
                ) : st === "ready" ? (
                  <span className="shrink-0 text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">รอรอบทบทวน</span>
                ) : isCur ? (
                  <span className="shrink-0 text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">กำลังเรียน</span>
                ) : wk.no === planNo && !reviewWeek ? (
                  <span className="shrink-0 text-[10px] font-black bg-[#003399]/10 text-[#003399] px-2 py-1 rounded-full">ชุดสัปดาห์นี้</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* อันดับ */}
        <button onClick={toggleRank} className="w-full py-3 rounded-2xl border-2 border-[#003399]/15 bg-white text-[#003399] font-black mb-2">
          🏆 อันดับคำที่รู้แล้ว {showRank ? "▲" : "▼"}
        </button>
        {showRank && (
          <div className="border-2 border-gray-100 rounded-2xl p-3 mb-4">
            {rank === null ? (
              <p className="text-center text-sm text-gray-500 animate-pulse py-3">กำลังโหลด...</p>
            ) : rank.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-3">ยังไม่มีข้อมูล</p>
            ) : (
              <>
                <ol className="space-y-1">
                  {rank.slice(0, 10).map((r, i) => (
                    <li key={r.email} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${r.email === email.trim().toLowerCase() ? "bg-[#FFD700]/30 font-black" : ""}`}>
                      <span className="w-6 text-center font-black text-[#003399]">{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
                      <span className="flex-1 truncate">{displayName(r.name)}</span>
                      <span className="font-black tabular-nums">{r.known}</span>
                    </li>
                  ))}
                </ol>
                {(() => {
                  const me = rank.findIndex((r) => r.email === email.trim().toLowerCase());
                  return me >= 10 ? <p className="text-center text-xs font-bold text-gray-500 mt-2">อันดับของคุณ: {me + 1} จาก {rank.length} คน · รู้แล้ว {rank[me].known} คำ</p> : null;
                })()}
              </>
            )}
          </div>
        )}

      </div>
    );
  }

  // ═════════════ WEEK ═════════════
  if (mode === "WEEK") {
    const wk = course.weeks.find((x) => x.no === weekNo)!;
    const ws = words.filter((w) => w.week === weekNo);
    const open = openWord ? byId[openWord] : null;
    return (
      <div className="animate-fadeIn mt-2">
        <button type="button" onClick={() => { if (open) setOpenWord(null); else setMode("HOME"); scrollTop(); }} className="mb-4 text-sm font-bold text-[#003399] hover:underline">
          ← {open ? `ชุดที่ ${weekNo}` : "หน้าหลักคำศัพท์"}
        </button>
        {open ? (
          <div className="border-2 border-gray-100 rounded-2xl p-4">
            <WordCard w={open} />
            {prog.cards[open.id] && (
              <p className="text-xs font-bold text-gray-500 mt-4">
                สถานะ: {statusOf(prog.cards[open.id]) === "known" ? "รู้แล้ว ✓ (ชุดนี้ผ่านแล้ว)" : "กำลังเรียน (ยังไม่ผ่านชุด)"} · ทวนครั้งต่อไป (ไม่บังคับ) {dueLabel(prog.cards[open.id].due, today)}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-4">
              <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">ชุดที่ {wk.no}</span>
              {wk.label && <span className="ml-2 text-[11px] font-bold text-gray-500">แผนเรียน: {wk.label}</span>}
              <h1 className="text-xl font-black text-gray-900 mt-2">{wk.title}</h1>
              <p className="text-xs text-gray-500 mt-1">คำที่ยังไม่เรียนจะซ่อนไว้ก่อน เพื่อให้ได้ “เดาก่อนรู้” ตอนเรียนจริง</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ws.map((w) => {
                const c = prog.cards[w.id];
                const st = statusOf(c);
                return c ? (
                  <button key={w.id} onClick={() => { setOpenWord(w.id); scrollTop(); }} className="text-left p-3 rounded-xl border-2 border-gray-100 hover:border-[#003399]/40 flex items-center gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block font-black font-serif text-gray-900">{w.w} <span className="text-xs font-sans text-gray-400">{w.pos}</span></span>
                      <span className="block text-xs text-gray-600 truncate">{w.th}</span>
                    </span>
                    <span className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-full ${st === "known" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                      {st === "known" ? "รู้แล้ว" : "กำลังเรียน"}
                    </span>
                  </button>
                ) : (
                  <div key={w.id} className="p-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 text-sm font-bold flex items-center gap-2">
                    <span>🔒</span> <span>ยังไม่เรียน</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ═════════════ SUMMARY ═════════════
  if (mode === "SUMMARY" && summary) {
    const canLearn = !curReady && !curLocked && curSet > 0 && newLeftToday > 0 && nextNew.length > 0;
    const isCheck = summary.kind === "check";
    return (
      <div className="animate-fadeIn mt-2">
        {isCheck ? (
          <div className="text-center mb-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5">
            <div className="text-5xl mb-1">🎉</div>
            <h1 className="text-2xl font-black text-emerald-700">ผ่านชุดที่ {summary.set} แล้ว ✓</h1>
            <p className="text-sm font-bold text-emerald-800 mt-1">
              คะแนนรอบทบทวน {summary.correct}/{summary.total} (ตอบถูกตั้งแต่ครั้งแรก) · ทั้ง {summary.total} คำนับว่า “รู้แล้ว”
            </p>
          </div>
        ) : (
          <div className="text-center mb-4">
            <div className="text-4xl mb-1">{summary.kind === "practice" ? "🎯" : "✅"}</div>
            <h1 className="text-2xl font-black text-gray-900">
              {summary.kind === "learn" ? `เรียนครบ ${summary.rows.length} คำแล้ว` : summary.kind === "review" ? "ทวนเสร็จแล้ว" : "ฝึกเพิ่มเสร็จแล้ว"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {summary.kind === "practice"
                ? `ถูก ${summary.correct}/${summary.total} ข้อ (ไม่นับเป็นความก้าวหน้า)`
                : summary.kind === "learn"
                ? `ขั้นที่ 4 ตอบถูกตั้งแต่ครั้งแรก ${summary.correct}/${summary.total} ข้อ · ข้อที่ผิดทำซ้ำจนถูกครบแล้ว`
                : `ทวนถูก ${summary.correct}/${summary.total} คำ`}
            </p>
          </div>
        )}
        {summary.rows.length > 0 && (
          <div className="border-2 border-gray-100 rounded-2xl overflow-hidden mb-4">
            {summary.rows.map((r) => {
              const w = byId[r.wid];
              const c = prog.cards[r.wid];
              const st = statusOf(c);
              return (
                <div key={r.wid} className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-0">
                  <span className={`shrink-0 font-black ${r.ok ? "text-emerald-600" : "text-rose-500"}`}>{r.ok ? "✓" : "✗"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-black font-serif">{w.w}</span> <span className="text-xs text-gray-500">{w.th}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-[10px] font-black px-2 py-0.5 rounded-full ${st === "known" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                      {st === "known" ? "รู้แล้ว" : "กำลังเรียน"}
                    </span>
                    {!r.ok && summary.kind !== "review" && <span className="block text-[10px] text-gray-400 mt-0.5">ถูกในรอบซ้ำ</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {summary.kind === "learn" && (
          <p className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3 mb-4 leading-relaxed">
            {curReady
              ? `เรียนครบ ${curWords.length} คำของชุดที่ ${curSet} แล้ว · ต่อด้วย “รอบทบทวน” อีก 1 รอบ ถูกครบทุกคำ = ผ่านชุด ✓`
              : `ชุดนี้ยังเรียนไม่ครบ ${curWords.length} คำ · เรียนต่อให้ครบ แล้วทำรอบทบทวนเพื่อผ่านชุด`}
          </p>
        )}
        {summary.cloudOk === true && isCheck && <p className="text-xs font-bold text-emerald-800 bg-emerald-50 rounded-xl p-3 mb-3">✓ ส่งผลขึ้นระบบแล้ว · หน้าครูขึ้นสีเขียวที่ชุดที่ {summary.set}</p>}
        {summary.cloudOk === null && saving && <p className="text-xs font-bold text-[#003399] bg-blue-50 rounded-xl p-3 mb-3">{issueText(cloudState)}</p>}
        {summary.cloudOk === false && <p className="text-xs font-bold text-amber-700 bg-amber-50 rounded-xl p-3 mb-3">{issueText(cloudState)}</p>}
        {isCheck && summary.set && (() => {
          const rec = setPassOf(prog, summary.set);
          if (!rec?.gl) return null;
          return (
            <p className="text-xs font-bold text-orange-800 bg-orange-50 rounded-xl p-3 mb-3">
              ออกจากหน้าระหว่างรอบทบทวน {rec.gl} ครั้ง
              {rec.gm === "enforce" ? (rec.gv ? ` · ไม่นับคะแนน ${rec.gv} คำ` : "") : " (ช่วงทดลอง — บันทึกให้ครูเห็น ยังไม่หักคะแนน)"}
              {rec.gl >= GUARD_FLAG_AT ? " · ครูจะเห็น 🚩" : ""}
            </p>
          );
        })()}
        <div className="space-y-2">
          {summary.kind !== "practice" && curReady && (
            <button onClick={startCheck} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
              รอบทบทวนชุดที่ {curSet} ({curWords.length} ข้อ) →
            </button>
          )}
          {summary.kind !== "practice" && canLearn && (
            <button onClick={startLearn} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
              {isCheck ? `เรียนชุดที่ ${curSet} ต่อ (${Math.min(BATCH_SIZE, newLeftToday, nextNew.length)} คำ) →` : `เรียนต่ออีก ${Math.min(BATCH_SIZE, newLeftToday, nextNew.length)} คำ →`}
            </button>
          )}
          {stats.due > 0 && summary.kind !== "practice" && !curReady && (
            <button onClick={startReview} className="w-full py-3 bg-white border-2 border-[#003399]/30 text-[#003399] font-black rounded-2xl">
              🔁 ทวนคำชุดก่อน ๆ ({Math.min(stats.due, REVIEW_LIMIT)} คำ · ไม่บังคับ)
            </button>
          )}
          <button onClick={() => { setMode("HOME"); scrollTop(); }} className="w-full py-3 bg-white border-2 border-[#003399]/15 text-[#003399] font-black rounded-2xl">
            กลับหน้าหลักคำศัพท์
          </button>
        </div>
      </div>
    );
  }

  // ═════════════ ขั้นที่ 4 / ทวน / ฝึกเพิ่ม (คำถาม) ═════════════
  const quizMode = (mode === "LEARN" && phase === "retrieve") || mode === "CHECK" || mode === "REVIEW" || mode === "PRACTICE";
  if (mode === "CHECK" && checkGate) {
    return (
      <div className="animate-fadeIn mt-2">
        <button type="button" onClick={() => { setCheckGate(false); setMode("HOME"); scrollTop(); }} className="mb-4 text-sm font-bold text-[#003399] hover:underline">← กลับ</button>
        <Steps active={5} />
        <div className="border-4 border-[#003399] rounded-3xl p-5 mb-4">
          <div className="text-4xl text-center mb-1">📝</div>
          <h1 className="text-xl font-black text-center text-gray-900 mb-1">รอบทบทวนชุดที่ {checkSetNo}</h1>
          <p className="text-center text-xs font-bold text-[#003399] mb-4">คะแนนชุด (เต็ม 10) = คำที่ตอบถูกตั้งแต่ครั้งแรกในรอบนี้ · เข้าสมุดคะแนนของครู</p>
          <ol className="text-sm text-gray-800 space-y-2 list-decimal pl-5">
            <li>เปิด <b>โหมดห้ามรบกวน</b> ก่อน (กันแจ้งเตือนเด้งทับ)</li>
            <li><b>อยู่ในหน้านี้ตลอด</b> จนผ่านชุด — ห้ามสลับแอป สลับแท็บ หรือกลับหน้าโฮม</li>
            <li>
              {gMode === "enforce"
                ? <>ออกจากหน้าระหว่างคำไหน <b className="text-rose-600">คำนั้นไม่นับคะแนน</b> (ยังต้องตอบให้ถูกเพื่อผ่านชุดตามเดิม)</>
                : <>ช่วงทดลอง: ระบบ <b>บันทึก</b> การออกจากหน้าให้ครูเห็น (ยังไม่หักคะแนน)</>}
            </li>
            <li>ออกจากหน้าครบ {GUARD_FLAG_AT} ครั้ง ครูจะเห็นเครื่องหมาย 🚩</li>
          </ol>
        </div>
        <button onClick={() => { guard.reset(); setCheckGate(false); scrollTop(); }} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
          เข้าใจแล้ว เริ่มรอบทบทวน →
        </button>
      </div>
    );
  }

  if (quizMode) {
    const it = queue[qi];
    if (!it) return null;
    const w = byId[it.wid];
    const ok = picked === it.ans;
    const label =
      mode === "LEARN" ? "ขั้นที่ 4 · ดึงจากความจำ" : mode === "CHECK" ? `ขั้นที่ 5 · รอบทบทวนชุดที่ ${checkSetNo}` : mode === "REVIEW" ? "ทวนคำชุดก่อน ๆ (ไม่บังคับ)" : "ฝึกเพิ่ม (ไม่นับคะแนน)";
    const warn =
      mode === "LEARN" ? "ออกตอนนี้ คำ 5 คำนี้จะยังไม่ถูกบันทึก" : mode === "CHECK" ? "ออกตอนนี้ รอบทบทวนต้องเริ่มใหม่ (ชุดยังไม่ผ่าน)" : "ออกได้ ข้อที่ตอบแล้วบันทึกไว้แล้ว";
    const left = mode === "LEARN" || mode === "CHECK" ? queue.length - qi - (picked !== null ? 1 : 0) : 0;
    return (
      <div className="animate-fadeIn mt-2">
        <SessionBar label={label} warn={warn} confirmExit={confirmExit} setConfirmExit={setConfirmExit} onExit={exitSession} />
        {(mode === "LEARN" || mode === "CHECK") && <Steps active={mode === "LEARN" ? 4 : 5} />}
        {mode === "CHECK" && guard.notice && (
          <div className={`rounded-xl p-3 mb-3 text-sm font-bold flex items-start gap-2 ${gMode === "enforce" ? "bg-orange-100 text-orange-900 border-2 border-orange-300" : "bg-amber-50 text-amber-900 border-2 border-amber-200"}`}>
            <span className="flex-1">
              ⚠️ ออกจากหน้าครั้งที่ {guard.notice.n}
              {gMode === "enforce" ? " — คำนี้ไม่นับคะแนนรอบทบทวน" : " — ช่วงทดลอง ระบบบันทึกให้ครูเห็น (ยังไม่หักคะแนน)"}
              {guard.notice.n >= GUARD_FLAG_AT ? " · ครูจะเห็น 🚩" : ""}
            </span>
            <button onClick={guard.clearNotice} className="shrink-0 text-xs underline">รับทราบ</button>
          </div>
        )}
        {mode === "CHECK" && qi === 0 && picked === null && (
          <p className="text-xs font-bold text-[#003399] bg-[#FFD700]/20 rounded-xl px-3 py-2 mb-3">
            รอบทบทวนชุดที่ {checkSetNo}: คำละ 1 ข้อ · ข้อที่ผิดจะวนกลับมาจนถูกครบ · ครบแล้วผ่านชุดทันที ✓
          </p>
        )}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#003399] rounded-full transition-all" style={{ width: `${((qi + (picked !== null ? 1 : 0)) / queue.length) * 100}%` }} />
          </div>
          <span className="text-sm font-black text-[#003399] tabular-nums whitespace-nowrap">{mode === "LEARN" || mode === "CHECK" ? `เหลือ ${left} ข้อ` : `${qi + 1}/${queue.length}`}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">{KIND_LABEL[it.kind]}</span>
          {it.retry > 0 && <span className="text-[11px] font-black bg-rose-100 text-rose-700 px-2 py-1 rounded-full">🔁 วนกลับมาถามอีกครั้ง</span>}
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 mb-4" {...(mode === "CHECK" ? noCopyProps : {})}>
          {it.kind === "en2th" && (
            <p className="text-center">
              <span className="text-3xl font-black font-serif text-[#003399]">{w.w}</span> <span className="text-gray-400 font-bold">{w.pos}</span>
              <span className="block text-sm font-bold text-gray-600 mt-2">แปลว่าอะไร?</span>
            </p>
          )}
          {it.kind === "th2en" && (
            <p className="text-center">
              <span className="text-xl font-black text-gray-900">{w.th}</span>
              <span className="block text-sm font-bold text-gray-600 mt-2">ตรงกับคำใด?</span>
            </p>
          )}
          {it.kind === "ctx" && (
            <>
              <p className="font-serif text-lg leading-relaxed text-gray-900"><Blank text={w.ctx} /></p>
              <p className="text-sm font-bold text-gray-600 mt-2">เลือกคำที่เหมาะกับประโยคนี้</p>
            </>
          )}
          {it.kind === "form" && w.form && (
            <>
              <p className="font-serif text-lg leading-relaxed text-gray-900"><Blank text={w.form.s} /></p>
              <p className="text-sm font-bold text-gray-600 mt-2">เลือกรูปคำที่ถูกต้อง</p>
            </>
          )}
        </div>
        <div className="space-y-2 mb-4" {...(mode === "CHECK" ? noCopyProps : {})}>
          {it.options.map((o, i) => (
            <Opt
              key={i}
              i={i}
              label={o}
              en={it.en}
              onClick={() => answer(i)}
              state={picked === null ? "" : i === it.ans ? "ok" : i === picked ? "bad" : "dim"}
            />
          ))}
        </div>
        {picked !== null && (
          <>
            <div className={`rounded-xl p-3 mb-3 text-sm ${ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
              <p className="font-black mb-1">
                {ok
                  ? "✓ ถูกต้อง"
                  : mode === "LEARN" || mode === "CHECK"
                  ? "✗ ยังไม่ถูก — คำนี้จะวนกลับมาท้ายรอบจนกว่าจะถูก"
                  : mode === "REVIEW" && it.retry === 0
                  ? "✗ ยังไม่ถูก — คำนี้จะขึ้นให้ทวนอีกครั้งครั้งหน้า (ชุดที่ผ่านแล้วยังผ่านอยู่)"
                  : "✗ ยังไม่ถูก"}
              </p>
              <p>{it.why}</p>
              {!ok && (
                <p className="mt-2 text-gray-700">
                  <button type="button" onClick={() => speak(w.w)} className="font-black text-[#003399] mr-1">🔊</button>
                  <b className="font-serif">{w.w}</b> {w.pos} = {w.th} · <span className="font-serif"><Rich text={w.ex2} /></span>
                </p>
              )}
            </div>
            <button onClick={nextQuestion} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
              {qi + 1 < queue.length ? "ข้อต่อไป →" : "ดูสรุป →"}
            </button>
          </>
        )}
      </div>
    );
  }

  // ═════════════ ขั้นที่ 1–3 (ทีละคำ) ═════════════
  if (mode === "LEARN") {
    const w = batch[bi];
    if (!w) return null;
    const r = runs.current[w.id];
    const header = (
      <>
        <SessionBar label={`คำที่ ${bi + 1}/${batch.length} · ชุดที่ ${w.week}`} warn="ออกตอนนี้ คำ 5 คำนี้จะยังไม่ถูกบันทึก" confirmExit={confirmExit} setConfirmExit={setConfirmExit} onExit={exitSession} />
        <Steps active={phase === "predict" ? 1 : phase === "meet" ? 2 : 3} />
      </>
    );

    if (phase === "predict") {
      const posOpts: string[] = ["n", "v", "adj", "adv"];
      if (!posOpts.includes(w.pk)) posOpts[3] = w.pk;
      const hasPart = !!w.pq;
      const stepPos = !hasPart || mini.part !== undefined;
      const stepGuess = stepPos && mini.pos !== undefined;
      const stateOf = (chosen: number | string | undefined, val: number | string, ans: number | string): "" | "ok" | "bad" | "dim" =>
        chosen === undefined ? "" : val === ans ? "ok" : val === chosen ? "bad" : "dim";
      let n = 0;
      return (
        <div className="animate-fadeIn mt-2">
          {header}
          <span className="text-[11px] font-black bg-gray-100 text-[#003399] px-2 py-1 rounded-full">ขั้นที่ 1 · เดาก่อนรู้ · ไม่มีคะแนน</span>
          <p className="text-xs text-gray-500 mt-2 mb-2">อ่านประโยค แล้วลองถอดรหัสคำตัวหนาโดยยังไม่ดูความหมาย</p>
          <div className="bg-gray-50 rounded-2xl p-4 mb-4 font-serif text-lg leading-relaxed text-gray-900"><Rich text={w.sent} /></div>

          {hasPart && (
            <div className="mb-4">
              <p className="font-black text-gray-900 mb-2"><span className="inline-flex w-6 h-6 rounded-full bg-[#003399] text-white text-xs items-center justify-center mr-2">{++n}</span>ชิ้นส่วน <span className="font-serif text-[#003399]">{w.pq!.part}</span> ในคำนี้น่าจะหมายถึง…</p>
              <div className="space-y-2">
                {ord.part.map((oi, i) => (
                  <Opt key={oi} i={i} label={w.pq!.o[oi]} state={stateOf(mini.part, oi, 0)} onClick={() => { r.p = oi === 0 ? 1 : 0; setMini({ ...mini, part: oi }); }} />
                ))}
              </div>
              {mini.part !== undefined && w.parts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {w.parts.map((p, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-gray-400 font-bold">+</span>}
                      <span className={`border rounded-lg px-2 py-1 text-center leading-tight ${PART_STYLE[p[1]]}`}>
                        <span className="block font-black font-serif">{p[0]}</span>
                        <span className="block text-[11px]">{p[2] || "ส่วนท้าย"}</span>
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          {stepPos && (
            <div className="mb-4">
              <p className="font-black text-gray-900 mb-2"><span className="inline-flex w-6 h-6 rounded-full bg-[#003399] text-white text-xs items-center justify-center mr-2">{++n}</span>ดูตำแหน่งในประโยค คำนี้เป็นคำชนิดใด</p>
              <div className="grid grid-cols-2 gap-2">
                {posOpts.map((pk) => (
                  <button
                    key={pk}
                    type="button"
                    disabled={mini.pos !== undefined}
                    onClick={() => setMini({ ...mini, pos: pk })}
                    className={`py-3 rounded-xl border-2 font-black ${
                      mini.pos === undefined ? "border-gray-200 hover:border-[#003399]" : pk === w.pk ? "border-emerald-500 bg-emerald-50" : pk === mini.pos ? "border-rose-400 bg-rose-50" : "border-gray-100 opacity-50"
                    }`}
                  >
                    {POS_TH[pk]}
                  </button>
                ))}
              </div>
              {mini.pos !== undefined && <p className="text-sm bg-gray-50 rounded-xl p-3 mt-2">🔎 {w.clue}</p>}
            </div>
          )}

          {stepGuess && (
            <div className="mb-4">
              <p className="font-black text-gray-900 mb-2"><span className="inline-flex w-6 h-6 rounded-full bg-[#003399] text-white text-xs items-center justify-center mr-2">{++n}</span>คำนี้น่าจะแปลว่า…</p>
              <div className="space-y-2">
                {ord.guess.map((oi, i) => (
                  <Opt key={oi} i={i} label={w.guess[oi]} state={stateOf(mini.guess, oi, 0)} onClick={() => { r.g = oi === 0 ? 1 : 0; setMini({ ...mini, guess: oi }); }} />
                ))}
              </div>
              {mini.guess !== undefined && (
                <>
                  <p className={`text-sm rounded-xl p-3 mt-3 ${mini.guess === 0 ? "bg-emerald-50 text-emerald-800" : "bg-gray-50 text-gray-700"}`}>
                    {mini.guess === 0 ? "👍 เดาได้ใกล้เคียง" : "🙂 ยังไม่ตรง ไม่เป็นไร"} — การเดาก่อนช่วยให้จำความหมายจริงได้ดีขึ้น
                  </p>
                  <button onClick={() => { setPhase("meet"); scrollTop(); }} className="w-full mt-3 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
                    ดูความหมายเต็ม →
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      );
    }

    if (phase === "meet") {
      return (
        <div className="animate-fadeIn mt-2">
          {header}
          <span className="text-[11px] font-black bg-gray-100 text-[#003399] px-2 py-1 rounded-full">ขั้นที่ 2 · เจอความหมายแบบเต็ม</span>
          <div className="border-2 border-gray-100 rounded-2xl p-4 mt-3 mb-4">
            <WordCard w={w} guessed={mini.guess !== undefined ? { text: w.guess[mini.guess], ok: mini.guess === 0 } : undefined} />
          </div>
          <button onClick={() => { setPhase("proc"); scrollTop(); }} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
            ไปขั้นทำให้คิด →
          </button>
        </div>
      );
    }

    // phase === "proc"
    const last = bi + 1 >= batch.length;
    return (
      <div className="animate-fadeIn mt-2">
        {header}
        <span className="text-[11px] font-black bg-gray-100 text-[#003399] px-2 py-1 rounded-full">ขั้นที่ 3 · ทำให้คิด · ไม่มีคะแนน</span>
        <p className="font-black text-gray-900 mt-3 mb-3">
          <span className="font-serif text-[#003399]">{w.w}</span> — {w.proc.q}
        </p>
        <div className="space-y-2 mb-4">
          {ord.proc.map((oi, i) => (
            <Opt
              key={oi}
              i={i}
              label={w.proc.o[oi]}
              en={/^[A-Za-z“"]/.test(w.proc.o[oi])}
              state={mini.proc === undefined ? "" : oi === 0 ? "ok" : oi === mini.proc ? "bad" : "dim"}
              onClick={() => { r.pc = oi === 0 ? 1 : 0; setMini({ ...mini, proc: oi }); }}
            />
          ))}
        </div>
        {mini.proc !== undefined && (
          <>
            <div className={`rounded-xl p-3 mb-3 text-sm ${mini.proc === 0 ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
              <b>{mini.proc === 0 ? "✓ ใช่เลย" : "✗ ยังไม่ใช่"}</b> — {w.proc.why}
            </div>
            <button
              onClick={() => { if (last) startRetrieve(); else { startWord(bi + 1); scrollTop(); } }}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg"
            >
              {last ? `เรียนครบ ${batch.length} คำแล้ว · ไปขั้นดึงจากความจำ →` : `คำถัดไป (${bi + 2}/${batch.length}) →`}
            </button>
          </>
        )}
      </div>
    );
  }

  return null;
}

// ป้ายบนปุ่มเมนูหลัก: ผ่านแล้วกี่ชุด (อ่านจากเครื่อง)
export function passedSetsLocal(email: string): number {
  return Object.keys(loadLocal(email).sets || {}).length;
}
