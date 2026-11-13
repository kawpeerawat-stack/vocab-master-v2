"use client";
// app/_components/BookletRoom.tsx — 📒 Smart Booklet M.6 (ม.6 เท่านั้น · 13 พ.ย. 2569)
//   8 Part × 25 คำ · ปรนัย 4 ตัวเลือก อังกฤษ→ไทย / ไทย→อังกฤษ · ถูกครบทุกข้อ = ผ่าน ✓ เขียว
//   คำของแต่ละ Part สุ่มตามอีเมล (ไม่เหมือนกันระหว่างคน) · ไม่ใช้กล้อง · ผลเก็บในเครื่องก่อน แล้วส่งขึ้นระบบให้ครูเห็น
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PARTS,
  PART_SIZE,
  buildQuiz,
  gradeQuiz,
  loadLocalBooklet,
  mergeBooklet,
  partLabel,
  partMonthText,
  partUnit,
  passedCount,
  recordAttempt,
  saveLocalBooklet,
  wordOf,
  type BQuestion,
  type BookProg,
  type Graded,
} from "../lib/booklet";
import { readCloudBooklet, writeCloudPart } from "../lib/bookletCloud";
import { isIssue, issueText, serverNow, type SyncState } from "../lib/sync";

type View = { kind: "list" } | { kind: "quiz"; part: number; qs: BQuestion[]; idx: number; picked: (number | null)[]; review: boolean } | { kind: "result"; part: number; qs: BQuestion[]; graded: Graded; review: boolean; firstPass: boolean };

function speak(text: string) {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    /* ไม่เป็นไร */
  }
}

export function BookletRoom({ email, onExit }: { email: string; onExit: () => void }) {
  const [prog, setProg] = useState<BookProg>(() => loadLocalBooklet(email));
  const [view, setView] = useState<View>({ kind: "list" });
  const [sync, setSync] = useState<SyncState>("idle");
  const progRef = useRef(prog);
  useEffect(() => {
    progRef.current = prog;
  }, [prog]);

  const send = useCallback(
    async (part: number, p: BookProg) => {
      const rec = p[String(part)];
      if (!rec) return;
      setSync("saving");
      const r = await writeCloudPart(email, part, rec, () => setSync("slow"));
      setSync(r.ok ? "ok" : r.issue);
    },
    [email]
  );

  // เปิดห้อง: รวมกับผลบนระบบ (ผ่านบนเครื่องไหนก็นับ) · ส่งผลที่ผ่านในเครื่องแต่ระบบยังไม่มี
  useEffect(() => {
    let alive = true;
    readCloudBooklet(email).then((cloud) => {
      if (!alive || !cloud) return;
      const local = progRef.current;
      const merged = mergeBooklet(local, cloud);
      saveLocalBooklet(email, merged);
      setProg(merged);
      for (const k of Object.keys(local)) if (local[k].p && !cloud[k]?.p) void writeCloudPart(email, Number(k), merged[k]);
    });
    return () => {
      alive = false;
    };
  }, [email]);

  function start(part: number) {
    const review = !!prog[String(part)]?.p;
    const qs = buildQuiz(email, part);
    setSync("idle");
    setView({ kind: "quiz", part, qs, idx: 0, picked: Array(qs.length).fill(null), review });
  }

  function finish(v: Extract<View, { kind: "quiz" }>) {
    const graded = gradeQuiz(v.qs, v.picked);
    let firstPass = false;
    if (!v.review) {
      const out = recordAttempt(prog, v.part, graded, serverNow());
      firstPass = out.firstPass;
      if (out.changed) {
        saveLocalBooklet(email, out.prog);
        setProg(out.prog);
        void send(v.part, out.prog);
      }
    }
    setView({ kind: "result", part: v.part, qs: v.qs, graded, review: v.review, firstPass });
  }

  const nPassed = passedCount(prog);

  // ── รายการ Part ──
  if (view.kind === "list") {
    return (
      <div className="animate-fadeIn" data-booklet="list" data-bk-passed-count={nPassed}>
        <button onClick={onExit} className="mb-4 text-sm font-bold text-[#003399] hover:underline">
          ← เมนูหลัก
        </button>
        <div className="text-center mb-5">
          <p className="text-3xl mb-1" aria-hidden="true">
            📒
          </p>
          <h2 className="text-xl font-black text-gray-900">Smart Booklet M.6</h2>
          <p className="text-xs font-bold text-gray-500 mt-1">Gold Experience 6 · Unit 6–9 · 200 คำ แบ่ง {PARTS} Part × {PART_SIZE} คำ</p>
          <p className="mt-2 inline-block text-xs font-black text-[#003399] bg-[#003399]/5 rounded-full px-3 py-1" data-bk-summary>
            ผ่านแล้ว {nPassed} / {PARTS} Part
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs font-bold text-amber-900 leading-relaxed mb-4">
          วิธีทำ: จดความหมายใน Booklet ของตัวเองก่อน แล้วมาทำข้อสอบ Part ละ {PART_SIZE} ข้อ (ปรนัย 4 ตัวเลือก อังกฤษ→ไทย และ ไทย→อังกฤษ) · <b>ต้องถูกครบทุกข้อ</b> จึงผ่านและขึ้น ✓ เขียว · ผิดแล้วทำใหม่ได้ไม่จำกัด (ข้อ/ตัวเลือกสุ่มใหม่) · คำใน Part ของแต่ละคนไม่เหมือนกัน
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: PARTS }, (_, i) => i + 1).map((n) => {
            const r = prog[String(n)];
            const passed = !!r?.p;
            return (
              <button
                key={n}
                type="button"
                onClick={() => start(n)}
                data-bk-part={n}
                data-bk-passed={passed ? "1" : "0"}
                className={`text-left rounded-2xl border-2 p-4 transition-all active:scale-[0.99] ${passed ? "border-emerald-400 bg-emerald-50 hover:border-emerald-500" : "border-[#003399]/15 bg-white hover:border-[#003399]/50"}`}
              >
                <span className="flex items-center gap-3">
                  <span className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-xl font-black ${passed ? "bg-emerald-500 text-white" : "bg-[#003399]/10 text-[#003399]"}`} aria-hidden="true">
                    {passed ? "✓" : n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-black text-gray-900">Part {n}</span>
                    <span className="block text-[11px] font-bold text-gray-500">
                      {partMonthText(n)} · Unit {partUnit(n)} · {PART_SIZE} คำ
                    </span>
                    <span className={`block text-[11px] font-black mt-0.5 ${passed ? "text-emerald-700" : "text-gray-400"}`}>
                      {passed ? "ผ่านแล้ว · ทบทวนซ้ำได้" : r?.a ? `ทำไป ${r.a} รอบ · ดีสุด ${r.b}/${PART_SIZE}` : "ยังไม่ได้ทำ"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[#003399] text-lg" aria-hidden="true">
                    →
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {isIssue(sync) && (
          <p className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 rounded-xl p-3" data-bk-sync={sync}>
            {issueText(sync)}
          </p>
        )}
      </div>
    );
  }

  // ── ทำข้อสอบ ──
  if (view.kind === "quiz") {
    const q = view.qs[view.idx];
    const chosen = view.picked[view.idx];
    const answered = chosen !== null;
    const wrongSoFar = view.picked.reduce<number>((n, p, i) => (p !== null && p !== view.qs[i].no ? n + 1 : n), 0);
    const w = wordOf(q.no);
    const last = view.idx === view.qs.length - 1;
    const pick = (no: number) => {
      if (answered) return;
      const picked = view.picked.slice();
      picked[view.idx] = no;
      setView({ ...view, picked });
    };
    return (
      <div className="animate-fadeIn" data-booklet="quiz" data-bk-q={view.idx + 1} data-bk-dir={q.dir} data-bk-review={view.review ? "1" : "0"}>
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setView({ kind: "list" })} className="text-sm font-bold text-[#003399] hover:underline">
            ← เลือก Part
          </button>
          <span className="text-xs font-black text-gray-500">{partLabel(view.part)}</span>
        </div>
        {view.review && <p className="mb-2 text-[11px] font-black text-emerald-700 bg-emerald-50 rounded-lg px-2 py-1 text-center">โหมดทบทวน — Part นี้ผ่านแล้ว (ไม่บันทึกผล)</p>}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-[#003399] transition-all" style={{ width: `${(view.idx / view.qs.length) * 100}%` }} />
          </div>
          <span className="text-xs font-black text-gray-600 whitespace-nowrap">
            ข้อ {view.idx + 1}/{view.qs.length}
          </span>
          {wrongSoFar > 0 && <span className="text-xs font-black text-rose-600 whitespace-nowrap">ผิด {wrongSoFar}</span>}
        </div>
        <div className="rounded-2xl border-2 border-[#003399]/15 bg-white p-5 text-center mb-4">
          <p className="text-[11px] font-black tracking-wide text-[#003399]/60 mb-2">{q.dir === "en2th" ? "ภาษาอังกฤษ → เลือกความหมายไทย" : "ภาษาไทย → เลือกคำภาษาอังกฤษ"}</p>
          <p className="text-2xl font-black text-gray-900 leading-snug break-words" data-bk-prompt>
            {q.prompt}
          </p>
          <p className="mt-2 flex items-center justify-center gap-2 text-xs font-bold text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-0.5">{q.pos}</span>
            {q.dir === "en2th" && (
              <button type="button" onClick={() => speak(w.en)} className="rounded-full bg-[#003399]/10 text-[#003399] px-2 py-0.5 font-black" aria-label="ฟังเสียง" data-bk-speak>
                🔊
              </button>
            )}
          </p>
        </div>
        <div className="space-y-2.5">
          {q.options.map((o, i) => {
            const isRight = o.no === q.no;
            const isPicked = chosen === o.no;
            const cls = !answered ? "border-gray-200 bg-white hover:border-[#003399]/50" : isRight ? "border-emerald-500 bg-emerald-50" : isPicked ? "border-rose-400 bg-rose-50" : "border-gray-100 bg-white opacity-60";
            return (
              <button key={o.no} type="button" disabled={answered} onClick={() => pick(o.no)} data-bk-opt={i} data-bk-right={isRight ? "1" : "0"} className={`w-full flex items-center gap-3 text-left rounded-xl border-2 px-4 py-3 transition-all ${cls}`}>
                <span className={`shrink-0 w-7 h-7 rounded-full text-xs font-black flex items-center justify-center ${answered && isRight ? "bg-emerald-500 text-white" : answered && isPicked ? "bg-rose-500 text-white" : "bg-gray-100 text-gray-600"}`}>
                  {answered && isRight ? "✓" : answered && isPicked ? "✗" : "ABCD"[i]}
                </span>
                <span className="font-bold text-gray-900 break-words min-w-0">{o.text}</span>
              </button>
            );
          })}
        </div>
        {answered && (
          <div className="mt-4" data-bk-feedback={chosen === q.no ? "right" : "wrong"}>
            <p className={`text-sm font-black ${chosen === q.no ? "text-emerald-700" : "text-rose-600"}`}>
              {chosen === q.no ? "✓ ถูกต้อง" : "✗ ยังไม่ถูก"}
              <span className="block text-xs font-bold text-gray-600 mt-0.5">
                {w.en} = {w.th}
              </span>
            </p>
            <button type="button" data-bk-next onClick={() => (last ? finish(view) : setView({ ...view, idx: view.idx + 1 }))} className="mt-3 w-full py-3 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg">
              {last ? "ดูผล" : "ข้อถัดไป →"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── ผลรอบ ──
  const g = view.graded;
  const nextPart = view.part < PARTS && !prog[String(view.part + 1)]?.p ? view.part + 1 : null;
  return (
    <div className="animate-fadeIn text-center" data-booklet="result" data-bk-result={g.pass ? "pass" : "fail"} data-bk-correct={g.correct}>
      {g.pass ? (
        <>
          <div className="mx-auto w-24 h-24 rounded-full bg-emerald-500 text-white flex items-center justify-center text-6xl font-black shadow-lg mb-3" data-bk-tick>
            ✓
          </div>
          <h2 className="text-xl font-black text-emerald-700">{view.review ? "ทบทวนถูกครบ!" : `ผ่าน Part ${view.part}!`}</h2>
          <p className="text-sm font-bold text-gray-600 mt-1">
            ถูกครบ {g.correct}/{g.total} ข้อ · {partLabel(view.part)}
          </p>
          {!view.review && (
            <p className="mt-2 text-xs font-bold text-gray-500" data-bk-sync={sync}>
              {sync === "ok" ? "✓ ส่งผลขึ้นระบบแล้ว ครูเห็นเครื่องหมายถูกของคุณแล้ว" : isIssue(sync) ? issueText(sync) : sync === "idle" ? "" : issueText(sync)}
            </p>
          )}
          {!view.review && isIssue(sync) && (
            <button type="button" onClick={() => void send(view.part, progRef.current)} className="mt-2 px-4 py-2 rounded-xl border-2 border-[#003399] text-[#003399] text-xs font-black" data-bk-resend>
              ส่งอีกครั้ง
            </button>
          )}
        </>
      ) : (
        <>
          <div className="mx-auto w-24 h-24 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-3xl font-black mb-3">
            {g.correct}/{g.total}
          </div>
          <h2 className="text-xl font-black text-gray-900">ยังไม่ผ่าน — ต้องถูกครบทุกข้อ</h2>
          <p className="text-sm font-bold text-gray-600 mt-1">ผิด {g.wrong.length} ข้อ ทบทวนคำเหล่านี้แล้วทำใหม่ได้เลย (ข้อและตัวเลือกจะสุ่มใหม่)</p>
          <ul className="mt-4 text-left space-y-2" data-bk-wrong-list>
            {g.wrong.map(({ q, picked }) => {
              const w = wordOf(q.no);
              const pw = picked === null ? null : wordOf(picked);
              return (
                <li key={q.no} className="rounded-xl border-2 border-rose-100 bg-rose-50/60 p-3" data-bk-wrong={q.no}>
                  <p className="font-black text-gray-900 break-words">
                    {w.en} <span className="text-xs font-bold text-gray-500">({w.pos})</span> = <span className="text-emerald-700">{w.th}</span>
                  </p>
                  {pw && (
                    <p className="text-xs font-bold text-rose-600 mt-0.5 break-words">
                      คุณเลือก: {q.dir === "en2th" ? pw.th : pw.en}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {isIssue(sync) && (
            <p className="mt-3 text-xs font-bold text-rose-700 bg-rose-50 rounded-xl p-3" data-bk-sync={sync}>
              {issueText(sync)}
            </p>
          )}
        </>
      )}
      <div className="mt-5 space-y-2.5">
        {!g.pass && (
          <button type="button" onClick={() => start(view.part)} data-bk-retry className="w-full py-3 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg">
            ทำใหม่ (สุ่มข้อใหม่)
          </button>
        )}
        {g.pass && nextPart && !view.review && (
          <button type="button" onClick={() => start(nextPart)} data-bk-nextpart className="w-full py-3 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg">
            ทำ Part {nextPart} ต่อ →
          </button>
        )}
        <button type="button" onClick={() => setView({ kind: "list" })} data-bk-back className="w-full py-3 bg-white border-2 border-gray-200 text-gray-700 font-black rounded-2xl">
          กลับไปเลือก Part
        </button>
      </div>
    </div>
  );
}
