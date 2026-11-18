"use client";
// app/_components/ReadingQuiz.tsx
// v9.9 · แบบฝึก Reading สั้น (6–8 ประโยค) — ใช้ทั้งห้องคำศัพท์แกน (📰 พรีวิว) และห้องถอดรหัส ม.6 (🔎 ถอดรหัส)
//   ฝึก ไม่นับคะแนน ไม่ใช้กล้อง ทำซ้ำได้ · เก็บคะแนนดีที่สุดในเครื่อง
import React, { useState } from "react";
import { saveReadingBest, shuffleQ, loadReadingBest, type CoverResult, type RDecodeWord, type RQuestion } from "../lib/reading";

function Hl({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="text-[#003399] font-black bg-[#FFD700]/40 px-0.5 rounded">{p.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  );
}

export function Passage({ title, sents }: { title: string; sents: string[] }) {
  return (
    <div className="bg-[#003399]/5 border-l-4 border-[#003399] rounded-r-2xl p-4" data-rq-passage="1">
      <p className="font-black text-gray-900 font-serif text-lg mb-2">{title}</p>
      <ol className="space-y-1">
        {sents.map((s, i) => (
          <li key={i} className="flex gap-2 font-serif text-[15px] leading-relaxed text-gray-800">
            <span className="shrink-0 w-5 text-right text-xs text-gray-400 pt-1 tabular-nums">{i + 1}</span>
            <span><Hl text={s} /></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CoverBar({ c }: { c: CoverResult }) {
  return (
    <div className="border-2 border-emerald-100 rounded-2xl p-3" data-rq-cover={`${c.known}/${c.total}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-black text-gray-800">คุณรู้แล้ว <b className="text-emerald-700">{c.known}</b> จาก {c.total} คำในบทนี้</span>
        <span className="text-2xl font-black text-emerald-600 tabular-nums">{c.pct}%</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden my-2">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1">
        {c.rows.map((r) => (
          <span key={r.w} className={`text-[11px] rounded-full px-2 py-0.5 border ${r.known ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            <b className="font-serif">{r.w}</b> {r.known ? "✓" : `· ${r.where}`}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-gray-500 mt-2">นับเฉพาะคำที่อยู่ในบทเรียนของแอป · คำที่ยังไม่ได้เรียน ใช้บริบทช่วยเดาได้</p>
    </div>
  );
}

export default function ReadingQuiz({
  id,
  email,
  label,
  title,
  topic,
  sents,
  questions,
  cover,
  words,
  onExit,
  exitLabel,
}: {
  id: string; // เช่น p3 (พรีวิวชุด 3) · d-b03 (ถอดรหัสบท 3)
  email: string;
  label: string;
  title: string;
  topic: string;
  sents: string[];
  questions: RQuestion[];
  cover?: CoverResult | null;
  words?: RDecodeWord[];
  onExit: () => void;
  exitLabel: string;
}) {
  const [stage, setStage] = useState<"INTRO" | "Q" | "DONE">("INTRO");
  const [qs, setQs] = useState<RQuestion[]>(questions); // สลับตัวเลือกใหม่ทุกครั้งที่กดเริ่ม (ใน event ไม่ใช่ตอนวาดหน้าจอ)
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [got, setGot] = useState<boolean[]>([]);
  const [best, setBest] = useState(() => (typeof window !== "undefined" ? loadReadingBest(email)[id] : undefined));
  const q = qs[qi];
  const score = got.filter(Boolean).length;

  const start = () => {
    setQs(questions.map(shuffleQ));
    setQi(0);
    setPicked(null);
    setGot([]);
    setStage("Q");
  };
  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    setGot((g) => [...g, i === q.a]);
  };
  const next = () => {
    if (qi + 1 < qs.length) {
      setQi(qi + 1);
      setPicked(null);
      return;
    }
    const all = saveReadingBest(email, id, got.filter(Boolean).length, qs.length);
    setBest(all[id]);
    setStage("DONE");
  };

  const head = (
    <div className="mb-3">
      <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">{label}</span>
      <span className="ml-2 text-[11px] font-bold text-gray-500">ฝึก ไม่นับคะแนน · {qs.length} ข้อ · ทำซ้ำได้</span>
    </div>
  );

  if (stage === "INTRO") {
    return (
      <div className="animate-fadeIn mt-2" data-reading={id}>
        <button type="button" onClick={onExit} className="mb-4 text-sm font-bold text-[#003399] hover:underline">← {exitLabel}</button>
        {head}
        <h1 className="text-2xl font-black text-gray-900 font-serif">{title}</h1>
        <p className="text-sm text-gray-500 mb-4">เรื่อง: {topic}</p>
        {cover && <div className="mb-4"><CoverBar c={cover} /></div>}
        {words && words.length > 0 && (
          <div className="border-2 border-gray-100 rounded-2xl p-3 mb-4" data-rq-words={words.length}>
            <p className="text-sm font-black text-gray-800 mb-1">🔎 คำที่ต้องถอดในบทนี้ ({words.filter((w) => w.kind !== "trap").length} คำ{words.some((w) => w.kind === "trap") ? ` + กับดัก ${words.filter((w) => w.kind === "trap").length} คำ` : ""})</p>
            <p className="text-xs text-gray-500 mb-2">ยังไม่ต้องรู้ความหมาย — ใช้รหัสที่เพิ่งเรียนถอดเอง แล้วใช้บริบทยืนยัน (เฉลยการถอดอยู่หน้าสรุป)</p>
            <div className="flex flex-wrap gap-1.5">
              {words.map((w) => (
                <span key={w.w} className={`text-sm font-serif font-black rounded-lg px-2 py-0.5 border ${w.kind === "trap" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-gray-50 border-gray-200 text-gray-800"}`}>{w.w}</span>
              ))}
            </div>
          </div>
        )}
        {best && <p className="text-xs font-bold text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2 mb-3" data-rq-best={`${best.b}/${best.t}`}>เคยทำแล้ว {best.n} รอบ · ดีที่สุด {best.b}/{best.t} ข้อ</p>}
        <button type="button" onClick={start} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg text-lg" data-rq-start="1">
          เริ่มอ่าน ({qs.length} ข้อ) →
        </button>
      </div>
    );
  }

  if (stage === "DONE") {
    const full = score === qs.length;
    return (
      <div className="animate-fadeIn mt-2" data-reading={id}>
        {head}
        <div className={`rounded-3xl p-5 text-center mb-4 ${full ? "bg-emerald-50" : "bg-amber-50"}`} data-rq-score={`${score}/${qs.length}`}>
          <div className="text-4xl mb-1">{full ? "🎉" : "📖"}</div>
          <p className={`text-4xl font-black tabular-nums ${full ? "text-emerald-600" : "text-amber-600"}`}>{score}/{qs.length}</p>
          <p className="text-sm font-bold text-gray-600 mt-1">{full ? "อ่านเข้าใจครบทุกข้อ" : "อ่านคำอธิบายด้านล่าง แล้วลองใหม่ได้"} · ไม่นับคะแนน</p>
        </div>
        {words && words.length > 0 && (
          <div className="border-2 border-gray-100 rounded-2xl overflow-hidden mb-4">
            <p className="text-xs font-black text-gray-500 uppercase tracking-widest px-3 pt-3 pb-1">เฉลยการถอดรหัส</p>
            {words.map((w) => (
              <div key={w.w} className="flex items-start gap-2 px-3 py-2 border-t border-gray-100 text-sm">
                <span className="w-28 shrink-0 font-black font-serif text-gray-900">{w.w}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-bold text-[#003399]">{w.code}</span>
                  <span className="block text-gray-700">{w.th}</span>
                </span>
                {w.kind === "trap" && <span className="shrink-0 text-[10px] font-black bg-rose-100 text-rose-700 rounded-full px-2 py-0.5">กับดัก</span>}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 mb-4">
          {qs.map((x, i) => (
            <div key={i} className={`border-2 rounded-2xl p-3 ${got[i] ? "border-emerald-100" : "border-rose-100"}`}>
              <p className="text-sm font-bold text-gray-900">{got[i] ? "✓" : "✗"} {i + 1}. {x.q}</p>
              <p className="text-xs text-emerald-700 font-bold mt-1">คำตอบ: {x.o[x.a]}</p>
              <p className="text-xs text-gray-600 mt-1">{x.why}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <button type="button" onClick={start} className="w-full py-3 bg-[#003399] text-[#FFD700] font-black rounded-2xl" data-rq-retry="1">🔁 ทำใหม่ (สลับตัวเลือก)</button>
          <button type="button" onClick={onExit} className="w-full py-3 bg-white border-2 border-[#003399]/20 text-[#003399] font-black rounded-2xl" data-rq-back="1">{exitLabel}</button>
        </div>
      </div>
    );
  }

  // ── Q ──
  return (
    <div className="animate-fadeIn mt-2" data-reading={id}>
      <button type="button" onClick={onExit} className="mb-3 text-sm font-bold text-[#003399] hover:underline">← ออก (ไม่นับคะแนน)</button>
      {head}
      <Passage title={title} sents={sents} />
      <div className="mt-4 border-2 border-gray-100 rounded-2xl p-4" data-rq-q={qi + 1}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-black text-gray-500">ข้อ {qi + 1}/{qs.length}</span>
          <span className="text-xs font-bold text-gray-400">ถูก {score} ข้อ</span>
        </div>
        <p className="font-bold text-gray-900 mb-3">{q.q}</p>
        <div className="space-y-2">
          {q.o.map((o, i) => {
            const st = picked === null ? "" : i === q.a ? "ok" : i === picked ? "bad" : "dim";
            return (
              <button
                key={i}
                type="button"
                onClick={() => pick(i)}
                disabled={picked !== null}
                data-rq-opt={i}
                data-rq-correct={i === q.a ? "1" : undefined}
                className={`w-full text-left px-4 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                  st === "ok" ? "bg-emerald-50 border-emerald-400 text-emerald-800" : st === "bad" ? "bg-rose-50 border-rose-400 text-rose-700" : st === "dim" ? "border-gray-100 text-gray-400" : "border-gray-200 hover:border-[#003399]/40 text-gray-800"
                }`}
              >
                <span className="font-black mr-2">{"ABCD"[i]}</span>
                {o}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <div className={`mt-3 rounded-xl p-3 text-sm ${picked === q.a ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`} data-rq-feedback={picked === q.a ? "ok" : "bad"}>
            <b>{picked === q.a ? "✓ ถูกต้อง" : `✗ คำตอบคือ ${"ABCD"[q.a]}`}</b> · {q.why}
          </div>
        )}
        {picked !== null && (
          <button type="button" onClick={next} className="mt-3 w-full py-3 bg-[#003399] text-[#FFD700] font-black rounded-2xl" data-rq-next="1">
            {qi + 1 < qs.length ? "ข้อถัดไป →" : "ดูผล →"}
          </button>
        )}
      </div>
    </div>
  );
}
