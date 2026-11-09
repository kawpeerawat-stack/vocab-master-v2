"use client";
// app/demo/camera/page.tsx
// ─────────────────────────────────────────────────────────────
// หน้าทดลองสำหรับผู้บริหาร/ครู: ระบบเดียวกับที่นักเรียนใช้ในรอบที่เข้าสมุดคะแนน (ใช้ app/_components/CamGuard.tsx ตัวเดียวกัน)
//   - มีอะไรบังใบหน้าตั้งแต่จมูกขึ้นไป (มือถืออีกเครื่อง / สมุด / มือ) นานเกิน 0.5 วินาที → ข้ามข้อนั้นทันที
//   - เห็นมือถือเครื่องอื่นในภาพกล้อง 2 ภาพติดกัน (ใกล้กล้อง หรือแตะขอบภาพ · แม้ไม่บังหน้า) → ข้ามข้อนั้นทันที
//   - ออกจากหน้าแอป / หน้าต่าง Gemini หรือวงกลมค้นหาบังนานเกิน 3 วินาที → ข้ามข้อ
//   - ประมวลผลในเครื่องเท่านั้น · ไม่บันทึก ไม่ส่งภาพ · ไม่ใช้ไมโครโฟน · หน้านี้ไม่บันทึกผลลงระบบ
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { noCopyProps, noticeText, useLeaveGuard } from "../../lib/guard";
import { CamBox, CamChooser, camSkipText, CoverShield, COVER_FACE_MS, isCovered, useCameraGuard } from "../../_components/CamGuard";

type Q = { id: string; q: string; options: string[]; answer: number };
type Phase = "INTRO" | "QUIZ" | "DONE";
type Reason = "face" | "leave" | "cover" | "phone";
type Ev = { t: number; q: number; reason: Reason };

const strip = (s: string) => s.replace(/\*\*/g, "").replace(/<[^>]+>/g, "");
const REASON_TH: Record<Reason, string> = {
  face: "📷 มีอะไรบังใบหน้า (จมูกขึ้นไป)",
  phone: "📱 พบมือถือในกล้อง",
  leave: "↗ ออกจากหน้าแอป",
  cover: "🪟 หน้าต่างอื่นบังหน้าแอป",
};
const nowMs = () => Date.now();
const FALLBACK: Q[] = [
  { id: "d1", q: "The word *decision* is a …", options: ["noun", "verb", "adjective", "adverb"], answer: 0 },
  { id: "d2", q: "Which suffix makes a noun from *improve*?", options: ["-ment", "-ly", "-ous", "-ful"], answer: 0 },
  { id: "d3", q: "*careful* + -ly = ?", options: ["carefully", "carefuly", "carefulness", "careless"], answer: 0 },
  { id: "d4", q: "Choose the adjective: *She is very ___.* (create)", options: ["creative", "creation", "create", "creatively"], answer: 0 },
  { id: "d5", q: "The noun form of *happy* is …", options: ["happiness", "happily", "happier", "unhappy"], answer: 0 },
];

export default function CameraDemo() {
  const [phase, setPhase] = useState<Phase>("INTRO");
  const [want, setWant] = useState(true);
  const [useCam, setUseCam] = useState(false);
  const [qs, setQs] = useState<Q[]>(FALLBACK);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [results, setResults] = useState<{ id: string; ok: boolean; skipped?: Reason }[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [camNotice, setCamNotice] = useState<string | null>(null);
  const startT = useRef(0);
  const phaseRef = useRef<Phase>("INTRO");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // คำถามจริงจากบทที่ 1 (🧩 ม.6)
  useEffect(() => {
    fetch("/api/course?id=decoder")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { lessons?: { questions: Q[] }[] } | null) => {
        const list = c?.lessons?.[0]?.questions?.slice(0, 8);
        if (list && list.length >= 4) setQs(list);
      })
      .catch(() => undefined);
  }, []);

  const cur = qs[idx];
  const skip = (reason: Reason) => {
    if (phaseRef.current !== "QUIZ" || !cur || picked !== null) return false;
    setResults((r) => [...r, { id: cur.id, ok: false, skipped: reason }]);
    setEvents((e) => [...e, { t: nowMs() - startT.current, q: idx + 1, reason }]);
    advance();
    return true;
  };
  const cam = useCameraGuard((_ms, kind) => {
    const ok = skip(kind);
    if (ok) setCamNotice(camSkipText(kind));
    return ok;
  });
  const guard = useLeaveGuard(phase === "QUIZ", phase === "QUIZ" && cur && picked === null ? cur.id : null, (_k, kind) => skip(kind));
  const { arm: camArm, stop: camStop } = cam;
  useEffect(() => {
    camArm(phase === "QUIZ" && useCam && picked === null);
  }, [camArm, phase, useCam, picked, idx]);
  useEffect(() => {
    if (phase === "DONE") camStop();
  }, [camStop, phase]);

  function advance() {
    if (idx + 1 >= qs.length) {
      setPhase("DONE");
      return;
    }
    setIdx((i) => i + 1);
    setPicked(null);
  }
  const begin = (cm: "cam" | "nocam" | "camfail") => {
    setUseCam(cm === "cam");
    if (cm !== "cam") cam.stop();
    cam.resetCounts();
    guard.reset();
    setEvents([]);
    setResults([]);
    setIdx(0);
    setPicked(null);
    setCamNotice(null);
    startT.current = nowMs();
    setPhase("QUIZ");
  };
  const choose = (i: number) => {
    if (picked !== null || !cur) return;
    setPicked(i);
    setResults((r) => [...r, { id: cur.id, ok: i === cur.answer }]);
  };
  const next = () => {
    setCamNotice(null);
    guard.clearNotice();
    advance();
  };
  const score = results.filter((r) => r.ok).length;

  return (
    <div className="min-h-screen bg-[#f3f5fa] text-gray-800 px-4 py-6">
      <div className="max-w-xl mx-auto">
        <p className="text-xs font-black text-[#003399] tracking-widest uppercase">Demo · ผู้บริหาร / ครู</p>
        <h1 className="text-2xl font-black text-gray-900 mb-1">ทดลองระบบกันกล้องซ้อน</h1>
        <p className="text-xs text-gray-500 mb-4">ระบบเดียวกับที่นักเรียนใช้ในรอบที่เข้าสมุดคะแนน · หน้านี้ไม่บันทึกผล · Vocab Master — โรงเรียนอนุกูลนารี</p>

        {phase === "INTRO" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border-2 border-[#003399]/10 p-4 text-sm leading-relaxed">
              <h2 className="font-black text-[#003399] mb-2">ลองทำแบบนี้</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>ยกมือถืออีกเครื่องขึ้นมาในภาพกล้อง (ถือต่ำระดับอก ไม่บังหน้าก็ได้ · แค่โผล่เข้ามาที่ขอบภาพก็นับ) → เห็น 2 ภาพติดกันก็ข้ามข้อ · ตัวตรวจเดียวกับแอป Grammar</li>
                <li>ยกมือถืออีกเครื่อง / สมุด / มือ ขึ้นบังตั้งแต่จมูกขึ้นไป (รวมเอียงมือถือบังแค่ช่วงตา) → นับทันที (~{COVER_FACE_MS / 1000} วินาที) และข้ามข้อ</li>
                <li>สลับไปแอปอื่น หรือเรียก Gemini / วงกลมค้นหานานเกิน 3 วินาที → ข้ามข้อ</li>
                <li>ลองคลุมข้อความโจทย์ → คัดลอกไม่ได้</li>
              </ul>
            </div>
            <div className="bg-amber-50 rounded-2xl border-2 border-amber-200 p-4 text-sm leading-relaxed text-amber-900">
              <h2 className="font-black mb-2">⚠️ ข้อจำกัด</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>ถ่ายจอจากด้านบนหรือด้านข้างโดยไม่บังหน้า → กล้องจับไม่ได้ (ระบบอื่นและครูในห้องช่วยดูแทน)</li>
                <li>ก้มจดสมุด หรือห้องมืด → อาจถูกนับว่ามีอะไรบังหน้า จึงให้นักเรียนจดหลังทำเสร็จ</li>
                <li>ตัวตรวจมือถือต้องโหลดเพิ่ม ~17 MB ครั้งแรก · เครื่องที่ช้ามากจะปิดการตรวจมือถือเอง (ยังจับบังหน้าได้) · มือถือเล็ก ๆ อยู่กลางภาพ (เพื่อนด้านหลัง) ไม่ข้ามข้อ แต่ขึ้น “📱ไกล” ให้ครูเห็นในแผงติดตามสด</li>
              </ul>
            </div>
            <CamChooser
              cam={cam}
              want={want}
              setWant={setWant}
              camRule="นักเรียน: ผ่านเมื่อถูก 80%"
              noCamRule="นักเรียน: ใช้กล้องทุกคน · ถูก 80% · ข้อละ 45 วินาที"
              startLabel={`เริ่มทดลอง ${qs.length} ข้อ`}
              onStart={begin}
            />
          </div>
        )}

        {phase === "QUIZ" && cur && (
          <div className="bg-white rounded-3xl shadow-xl p-5 mb-28">
            {useCam && <CamBox cam={cam} floating />}
            <div className="flex items-center justify-between mb-3 text-sm font-black text-[#003399]">
              <span>ข้อ {idx + 1}/{qs.length}</span>
              <span className="text-emerald-600">✓ {score}</span>
            </div>
            {(camNotice || guard.notice) && (
              <div className="rounded-xl p-3 mb-3 text-sm font-bold bg-orange-100 text-orange-900 border-2 border-orange-300 flex gap-2">
                <span className="flex-1">{camNotice ?? noticeText(guard.notice!, "enforce").replace("ข้อนี้ถูกข้าม", "ข้อที่แล้วถูกข้าม")}</span>
                <button onClick={() => { setCamNotice(null); guard.clearNotice(); }} className="text-xs underline shrink-0">รับทราบ</button>
              </div>
            )}
            {useCam && picked === null && isCovered(cam) && <CoverShield phone={cam.phone} />}
            <div className="bg-gray-50 rounded-2xl p-4 mb-4" hidden={useCam && picked === null && isCovered(cam)} {...noCopyProps}>
              <p className="text-base font-bold text-gray-900">{strip(cur.q)}</p>
            </div>
            <div className="space-y-2 mb-4" hidden={useCam && picked === null && isCovered(cam)} {...noCopyProps}>
              {cur.options.map((o, i) => {
                const show = picked !== null;
                const cls = !show ? "border-gray-200 hover:border-[#003399]" : i === cur.answer ? "border-emerald-400 bg-emerald-50" : i === picked ? "border-rose-400 bg-rose-50" : "border-gray-100 opacity-60";
                return (
                  <button key={i} disabled={show} onClick={() => choose(i)} className={`w-full text-left p-3 rounded-xl border-2 font-bold text-sm ${cls}`}>
                    {strip(o)}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <button onClick={next} className="w-full py-3 bg-[#003399] text-[#FFD700] font-black rounded-xl">
                {idx + 1 >= qs.length ? "ดูผล →" : "ข้อต่อไป →"}
              </button>
            )}
          </div>
        )}

        {phase === "DONE" && (
          <div className="space-y-4">
            <div className="bg-white rounded-3xl shadow-xl p-5 text-center">
              <p className="text-5xl font-black text-[#003399]">{score}/{qs.length}</p>
              <p className="text-sm font-bold text-gray-600 mt-1">ถูกข้าม {results.filter((r) => r.skipped).length} ข้อ · กล้องปิดแล้ว</p>
            </div>
            <div className="bg-white rounded-2xl border-2 border-[#003399]/10 p-4">
              <h2 className="font-black text-[#003399] mb-2 text-sm">สิ่งที่ระบบตรวจพบ (ไม่มีภาพ · ไม่ได้บันทึกที่ไหน)</h2>
              {events.length === 0 ? (
                <p className="text-sm text-gray-500">ไม่พบเหตุการณ์</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {events.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular-nums text-gray-500 w-14">{Math.round(e.t / 1000)} วิ</span>
                      <span className="font-bold">ข้อ {e.q}</span>
                      <span>{REASON_TH[e.reason]} → ข้ามข้อ</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setPhase("INTRO")} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl">🔁 ทดลองอีกครั้ง</button>
          </div>
        )}
      </div>
    </div>
  );
}
