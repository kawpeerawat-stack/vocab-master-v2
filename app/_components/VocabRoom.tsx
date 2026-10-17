"use client";
// app/_components/VocabRoom.tsx
// ─────────────────────────────────────────────────────────────
// ห้องคำศัพท์แกน 300 คำ — เรียนแบบ 5 ขั้น
//   ① เดาก่อนรู้ (ผ่าคำ · ชนิดคำ · เดาความหมาย จากประโยคแบบข้อสอบ) — ไม่มีคะแนน
//   ② เจอความหมายแบบเต็ม (เสียง ตระกูลคำ คู่คำ ประโยคที่ 2 กับดัก)
//   ③ ทำให้คิด (ภารกิจสั้น 1 ข้อ ต้องตัดสินใจ)
//   ④ ดึงจากความจำ (หลังเรียนครบชุด · สลับทิศ · บริบทใหม่ · ผิดแล้ววนกลับ)
//   ⑤ ทวนแบบเว้นวัน (ถึงกำหนดต้องทวนก่อนเรียนคำใหม่ · “รู้แล้ว” เมื่อถูกต่างวัน 2 วัน)
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BATCH_SIZE,
  NEW_PER_DAY,
  REVIEW_LIMIT,
  RankEntry,
  VCard,
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
  isKnown,
  loadLocal,
  loadProgress,
  loadRanking,
  loadVocab300,
  mergeProgress,
  saveProgress,
  shuffle,
  statusOf,
  todayStr,
} from "../lib/vocab300";

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
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function dueLabel(due: string, today: string): string {
  const d = dayDiff(today, due);
  if (d <= 0) return "วันนี้";
  if (d === 1) return "พรุ่งนี้";
  const [, m, dd] = due.split("-").map(Number);
  return `อีก ${d} วัน (${dd} ${TH_MONTH[m - 1]})`;
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
function SessionBar({ label, learning, confirmExit, setConfirmExit, onExit }: { label: string; learning: boolean; confirmExit: boolean; setConfirmExit: (v: boolean) => void; onExit: () => void }) {
  return (
  <div className="flex items-center justify-between mb-3 gap-2">
    {confirmExit ? (
      <span className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span className="text-rose-600">{learning ? "ออกตอนนี้ คำชุดนี้จะยังไม่ถูกบันทึก" : "ออกได้ ข้อที่ตอบแล้วบันทึกไว้แล้ว"}</span>
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
    {["เดาก่อน", "เจอเต็ม", "ทำให้คิด", "ดึงความจำ", "ทวนเว้นวัน"].map((l, i) => (
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
type Mode = "HOME" | "WEEK" | "LEARN" | "REVIEW" | "PRACTICE" | "SUMMARY";
type LearnPhase = "predict" | "meet" | "proc" | "retrieve";
interface Summary {
  kind: "learn" | "review" | "practice";
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
  const practiceScore = useRef({ c: 0, t: 0 });
  const sinceSave = useRef(0);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloudState, setCloudState] = useState<"idle" | "ok" | "local">("idle");
  const [showRank, setShowRank] = useState(false);
  const [rank, setRank] = useState<RankEntry[] | null>(null);
  const [showHow, setShowHow] = useState(false);

  // ── โหลด ──
  useEffect(() => {
    let alive = true;
    loadVocab300()
      .then((c) => alive && setCourse(c))
      .catch(() => alive && setLoadError(true));
    loadProgress(email).then((p) => alive && setProg((prev) => mergeProgress(prev, p)));
    return () => {
      alive = false;
    };
  }, [email]);

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
  const newLeftToday = Math.max(0, NEW_PER_DAY - stats.newToday);
  const nextNew = useMemo(() => words.filter((w) => !prog.cards[w.id]), [words, prog]);
  const currentWeek = nextNew[0]?.week ?? 10;

  const doSave = async (p: VProgress) => {
    setSaving(true);
    const ok = await saveProgress(email, name, p);
    setCloudState(ok ? "ok" : "local");
    setSaving(false);
    return ok;
  };

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

  // ── เริ่มทวน ──
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
      if (!ok && it.retry < 2) {
        const pool = words.filter((x) => x.week === w.week);
        setQueue((q) => [...q, makeItem(w, it.kind, pool, it.retry + 1)]);
      }
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
          saveProgress(email, name, p2).then((s) => setCloudState(s ? "ok" : "local"));
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
      setSummary({ kind: "learn", rows, correct, total, cloudOk: null });
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
  const knownPct = total ? Math.round((stats.known / total) * 100) : 0;
  const seenPct = total ? Math.round((stats.seen / total) * 100) : 0;

  // ═════════════ HOME ═════════════
  if (mode === "HOME") {
    const allLearned = nextNew.length === 0;
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
            <span className="font-black text-[#FFD700] text-lg">รู้แล้ว {stats.known}/{total} คำ</span>
            <span className="text-sm font-bold">{knownPct}%</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 bg-white/35 rounded-full" style={{ width: `${seenPct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-[#FFD700] rounded-full transition-all" style={{ width: `${knownPct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div className="bg-white/10 rounded-xl py-2">
              <div className="text-lg font-black">{stats.learning}</div>
              <div className="text-[10px] font-bold text-white/70">กำลังเรียน</div>
            </div>
            <div className="bg-white/10 rounded-xl py-2">
              <div className="text-lg font-black text-[#FFD700]">{stats.due}</div>
              <div className="text-[10px] font-bold text-white/70">ถึงกำหนดทวน</div>
            </div>
            <div className="bg-white/10 rounded-xl py-2">
              <div className="text-lg font-black">🔥 {stats.streak}</div>
              <div className="text-[10px] font-bold text-white/70">วันติดต่อกัน</div>
            </div>
          </div>
          <p className="text-[11px] text-white/75 mt-3 leading-relaxed">
            คำจะนับว่า “รู้แล้ว” เมื่อตอบถูกในวันที่ต่างกันอย่างน้อย 2 วัน · แถบสีขาวจาง = คำที่เรียนแล้ว แถบสีทอง = คำที่รู้แล้ว
          </p>
        </div>

        {/* แผนวันนี้ */}
        <div className="border-2 border-[#003399]/15 rounded-2xl p-4 mb-4">
          <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">วันนี้ทำอะไรดี</p>
          {stats.due > 0 ? (
            <>
              <button onClick={startReview} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] text-lg">
                ทวนคำที่ถึงกำหนด ({Math.min(stats.due, REVIEW_LIMIT)} คำ) →
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">
                {stats.due > REVIEW_LIMIT ? `ค้างทวน ${stats.due} คำ รอบนี้ทำ ${REVIEW_LIMIT} คำก่อน · ` : ""}ทวนให้ครบก่อน จึงจะเปิดคำใหม่ได้
              </p>
            </>
          ) : allLearned ? (
            <p className="text-center font-black text-emerald-700 py-3">🎉 เรียนครบ {total} คำแล้ว — กลับมาทวนตามกำหนดจนรู้แล้วทุกคำ</p>
          ) : newLeftToday > 0 ? (
            <>
              <button onClick={startLearn} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] text-lg">
                เรียนคำใหม่ {Math.min(BATCH_SIZE, newLeftToday, nextNew.length)} คำ →
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">
                วันนี้เรียนคำใหม่แล้ว {stats.newToday}/{NEW_PER_DAY} คำ · ต่อไปคือสัปดาห์ที่ {currentWeek}
              </p>
            </>
          ) : (
            <p className="text-center font-black text-emerald-700 py-3">✓ วันนี้เรียนคำใหม่ครบ {NEW_PER_DAY} คำแล้ว กลับมาพรุ่งนี้นะ</p>
          )}
          {learned.length >= 4 && (
            <button onClick={startPractice} className="w-full mt-3 py-2.5 bg-white border-2 border-[#003399]/15 text-[#003399] font-bold rounded-xl text-sm">
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
            <li><b>ดึงจากความจำ</b> — หลังเรียนครบชุด ตอบโดยไม่มีบัตรคำ ข้อที่ผิดจะวนกลับมา</li>
            <li><b>ทวนเว้นวัน</b> — ระบบนัดทวนวันที่ 3, 7, 14 … ทวนให้ครบก่อนเรียนคำใหม่</li>
          </ol>
        )}

        {/* รายสัปดาห์ */}
        <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2 mt-2">คำศัพท์ 10 สัปดาห์ (สัปดาห์ละ 30 คำ)</h2>
        <div className="space-y-2 mb-5">
          {course.weeks.map((wk) => {
            const ws = words.filter((w) => w.week === wk.no);
            const k = ws.filter((w) => isKnown(prog.cards[w.id])).length;
            const s = ws.filter((w) => prog.cards[w.id]).length;
            const isCur = wk.no === currentWeek && !allLearned;
            return (
              <button
                key={wk.no}
                type="button"
                onClick={() => { setWeekNo(wk.no); setOpenWord(null); setMode("WEEK"); scrollTop(); }}
                className={`w-full text-left p-3 rounded-2xl border-2 flex items-center gap-3 transition-all active:scale-[0.99] ${
                  k === ws.length ? "bg-emerald-50 border-emerald-200" : isCur ? "bg-[#FFD700]/10 border-[#FFD700]" : "bg-white border-[#003399]/10 hover:border-[#003399]/40"
                }`}
              >
                <span className={`shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center font-black leading-none ${k === ws.length ? "bg-emerald-500 text-white" : "bg-[#003399] text-[#FFD700]"}`}>
                  <span className="text-[9px] font-bold opacity-80">สัปดาห์</span>
                  <span className="text-base">{wk.no}</span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-black text-gray-900 truncate">{wk.title}</span>
                  <span className="flex items-center gap-2 mt-1">
                    <span className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden relative">
                      <span className="absolute inset-y-0 left-0 bg-[#003399]/25 rounded-full" style={{ width: `${(s / ws.length) * 100}%` }} />
                      <span className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full" style={{ width: `${(k / ws.length) * 100}%` }} />
                    </span>
                    <span className="text-[11px] font-bold text-gray-500 tabular-nums">รู้แล้ว {k}/{ws.length}</span>
                  </span>
                </span>
                {isCur && <span className="shrink-0 text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">กำลังเรียน</span>}
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
                      <span className="flex-1 truncate">{r.name}</span>
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
        <p className="text-center text-[10px] text-gray-400 mt-3">
          {saving ? "กำลังบันทึก..." : cloudState === "local" ? "⚠️ บันทึกในเครื่องแล้ว จะซิงก์ขึ้นระบบเมื่อเน็ตกลับมา" : cloudState === "ok" ? "✓ บันทึกขึ้นระบบแล้ว" : ""}
        </p>
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
          ← {open ? `สัปดาห์ที่ ${weekNo}` : "หน้าหลักคำศัพท์"}
        </button>
        {open ? (
          <div className="border-2 border-gray-100 rounded-2xl p-4">
            <WordCard w={open} />
            {prog.cards[open.id] && (
              <p className="text-xs font-bold text-gray-500 mt-4">
                สถานะ: {statusOf(prog.cards[open.id]) === "known" ? "รู้แล้ว ✓" : "กำลังเรียน"} · ทวนครั้งต่อไป {dueLabel(prog.cards[open.id].due, today)}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-4">
              <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">สัปดาห์ที่ {wk.no}</span>
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
                      {st === "known" ? "รู้แล้ว" : isDue(c, today) ? "ถึงกำหนดทวน" : "กำลังเรียน"}
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
    const canMore = stats.due === 0 && newLeftToday > 0 && nextNew.length > 0;
    return (
      <div className="animate-fadeIn mt-2">
        <div className="text-center mb-4">
          <div className="text-4xl mb-1">{summary.kind === "practice" ? "🎯" : "✅"}</div>
          <h1 className="text-2xl font-black text-gray-900">
            {summary.kind === "learn" ? "เรียนจบชุดนี้แล้ว" : summary.kind === "review" ? "ทวนเสร็จแล้ว" : "ฝึกเพิ่มเสร็จแล้ว"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {summary.kind === "practice"
              ? `ถูก ${summary.correct}/${summary.total} ข้อ (ไม่นับเป็นความก้าวหน้า)`
              : summary.kind === "learn"
              ? `ขั้นที่ 4 ตอบถูกตั้งแต่ครั้งแรก ${summary.correct}/${summary.total} ข้อ`
              : `ทวนถูก ${summary.correct}/${summary.total} คำ`}
          </p>
        </div>
        {summary.rows.length > 0 && (
          <div className="border-2 border-gray-100 rounded-2xl overflow-hidden mb-4">
            {summary.rows.map((r) => {
              const w = byId[r.wid];
              const c = prog.cards[r.wid];
              const st = statusOf(c);
              const becameKnown = summary.kind === "review" && r.before !== "known" && st === "known";
              return (
                <div key={r.wid} className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-0">
                  <span className={`shrink-0 font-black ${r.ok ? "text-emerald-600" : "text-rose-500"}`}>{r.ok ? "✓" : "✗"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-black font-serif">{w.w}</span> <span className="text-xs text-gray-500">{w.th}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-[10px] font-black px-2 py-0.5 rounded-full ${st === "known" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                      {becameKnown ? "🎉 รู้แล้ว" : st === "known" ? "รู้แล้ว" : "กำลังเรียน"}
                    </span>
                    {c && <span className="block text-[10px] text-gray-400 mt-0.5">ทวน {dueLabel(c.due, today)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {summary.kind === "learn" && (
          <p className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3 mb-4 leading-relaxed">
            คำที่ตอบถูกตั้งแต่ครั้งแรกจะนัดทวนในอีก 2 วัน ส่วนคำที่พลาดจะนัดทวนพรุ่งนี้ · ทุกคำยังเป็น “กำลังเรียน” จนกว่าจะตอบถูกอีกครั้งในวันอื่น
          </p>
        )}
        {summary.cloudOk === false && <p className="text-xs font-bold text-amber-700 bg-amber-50 rounded-xl p-3 mb-3">⚠️ บันทึกในเครื่องแล้ว แต่ยังขึ้นระบบไม่สำเร็จ (จะซิงก์ให้อีกครั้งเมื่อบันทึกครั้งถัดไป)</p>}
        <div className="space-y-2">
          {canMore && summary.kind !== "practice" && (
            <button onClick={startLearn} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
              เรียนต่ออีก {Math.min(BATCH_SIZE, newLeftToday, nextNew.length)} คำ →
            </button>
          )}
          {stats.due > 0 && summary.kind !== "practice" && (
            <button onClick={startReview} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg">
              ทวนต่อ ({Math.min(stats.due, REVIEW_LIMIT)} คำ) →
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
  const quizMode = (mode === "LEARN" && phase === "retrieve") || mode === "REVIEW" || mode === "PRACTICE";
  if (quizMode) {
    const it = queue[qi];
    if (!it) return null;
    const w = byId[it.wid];
    const ok = picked === it.ans;
    const label = mode === "LEARN" ? "ขั้นที่ 4 · ดึงจากความจำ" : mode === "REVIEW" ? "ขั้นที่ 5 · ทวนแบบเว้นวัน" : "ฝึกเพิ่ม (ไม่นับคะแนน)";
    return (
      <div className="animate-fadeIn mt-2">
        <SessionBar label={label} learning={false} confirmExit={confirmExit} setConfirmExit={setConfirmExit} onExit={exitSession} />
        {mode !== "PRACTICE" && <Steps active={mode === "LEARN" ? 4 : 5} />}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#003399] rounded-full transition-all" style={{ width: `${((qi + (picked !== null ? 1 : 0)) / queue.length) * 100}%` }} />
          </div>
          <span className="text-sm font-black text-[#003399] tabular-nums">{qi + 1}/{queue.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">{KIND_LABEL[it.kind]}</span>
          {it.retry > 0 && <span className="text-[11px] font-black bg-rose-100 text-rose-700 px-2 py-1 rounded-full">🔁 วนกลับมาถามอีกครั้ง</span>}
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
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
        <div className="space-y-2 mb-4">
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
                {ok ? "✓ ถูกต้อง" : mode === "LEARN" ? "✗ ยังไม่ถูก — ข้อนี้จะวนกลับมาอีกครั้งท้ายรอบ" : mode === "REVIEW" && it.retry === 0 ? "✗ ยังไม่ถูก — คำนี้กลับไปเป็น “กำลังเรียน” และนัดทวนพรุ่งนี้" : "✗ ยังไม่ถูก"}
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
        <SessionBar label={`คำที่ ${bi + 1}/${batch.length} · สัปดาห์ที่ ${w.week}`} learning confirmExit={confirmExit} setConfirmExit={setConfirmExit} onExit={exitSession} />
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

// สำหรับหน้าอื่นที่อยากรู้ว่ามีคำถึงกำหนดทวนไหม (เช่น ป้ายบนปุ่มเมนูหลัก)
export function dueCountLocal(email: string): number {
  const p = loadLocal(email);
  const t = todayStr();
  return Object.values(p.cards).filter((c: VCard) => c.due <= t).length;
}
