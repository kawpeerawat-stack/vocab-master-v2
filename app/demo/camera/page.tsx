"use client";
// app/demo/camera/page.tsx
// ─────────────────────────────────────────────────────────────
// หน้าทดลองสำหรับผู้บริหาร: ตรวจจับ "กล้องซ้อน" เบื้องต้น (ยังไม่ใช้กับนักเรียน)
//   - ขออนุญาตใช้กล้องหน้า → ตรวจว่า "ยังเห็นใบหน้า" อยู่หรือไม่ (MediaPipe Face Detection · ไฟล์อยู่ในเว็บเรา /mediapipe)
//   - มีวัตถุ (เช่น มือถืออีกเครื่อง) ยกขึ้นมาบังใบหน้า / ไม่เห็นใบหน้านานเกินที่ตั้งไว้ → ข้ามข้อนั้นทันที
//   - รวมกติกาเดียวกับห้องเรียนจริง: ออกจากหน้าแอป / หน้าต่าง Gemini หรือวงกลมค้นหาบังนานเกิน 3 วินาที → ข้ามข้อ
//   - ประมวลผลในเครื่องนี้เท่านั้น · ไม่บันทึก ไม่ส่งภาพ · ไม่ใช้ไมโครโฟน · ปิดกล้องเมื่อจบ/ออกจากหน้า
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { noCopyProps, noticeText, useLeaveGuard } from "../../lib/guard";

type Q = { id: string; q: string; options: string[]; answer: number };
type Phase = "INTRO" | "CALIB" | "QUIZ" | "DONE";
type Reason = "face" | "leave" | "cover";
type Ev = { t: number; q: number; reason: Reason; ms?: number };
type FaceDet = {
  setOptions: (o: Record<string, unknown>) => void;
  onResults: (cb: (r: { detections?: unknown[] }) => void) => void;
  initialize?: () => Promise<void>;
  send: (i: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => Promise<void>;
};
declare global {
  interface Window {
    FaceDetection?: new (o: { locateFile: (f: string) => string }) => FaceDet;
  }
}

const BASE = "/mediapipe/face_detection";
const strip = (s: string) => s.replace(/\*\*/g, "").replace(/<[^>]+>/g, "");
const REASON_TH: Record<Reason, string> = {
  face: "📷 ไม่เห็นใบหน้า / มีวัตถุบังใบหน้า",
  leave: "↗ ออกจากหน้าแอป",
  cover: "🪟 หน้าต่างอื่นบังหน้าแอป",
};
const nowMs = () => Date.now();

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    if (window.FaceDetection) return res();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("load failed"));
    document.head.appendChild(s);
  });
}

// คำถามตัวอย่าง (ใช้เมื่อโหลดบทเรียนไม่ได้)
const FALLBACK: Q[] = [
  { id: "d1", q: "The word *decision* is a …", options: ["noun", "verb", "adjective", "adverb"], answer: 0 },
  { id: "d2", q: "Which suffix makes a noun from *improve*?", options: ["-ment", "-ly", "-ous", "-ful"], answer: 0 },
  { id: "d3", q: "*careful* + -ly = ?", options: ["carefully", "carefuly", "carefulness", "careless"], answer: 0 },
  { id: "d4", q: "Choose the adjective: *She is very ___.* (create)", options: ["creative", "creation", "create", "creatively"], answer: 0 },
  { id: "d5", q: "The noun form of *happy* is …", options: ["happiness", "happily", "happier", "unhappy"], answer: 0 },
  { id: "d6", q: "The word *dangerous* means …", options: ["อันตราย", "ปลอดภัย", "อันตรายน้อย", "ความอันตราย"], answer: 0 },
];

export default function CameraDemo() {
  const [phase, setPhase] = useState<Phase>("INTRO");
  const [useCam, setUseCam] = useState(true);
  const [limitS, setLimitS] = useState(1.5); // ไม่เห็นใบหน้านานเกินกี่วินาที → ข้ามข้อ
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "error" | "denied">("off");
  const [face, setFace] = useState(false);
  const [missMs, setMissMs] = useState(0);
  const [qs, setQs] = useState<Q[]>(FALLBACK);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [results, setResults] = useState<{ id: string; ok: boolean; skipped?: Reason }[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [camNotice, setCamNotice] = useState<string | null>(null);
  const [calibOk, setCalibOk] = useState(0); // เห็นใบหน้าต่อเนื่องกี่เฟรม (ช่วงเทียบหน้า)

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detRef = useRef<FaceDet | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastSeen = useRef(0);
  const faceRef = useRef(false);
  const phaseRef = useRef<Phase>("INTRO");
  const startT = useRef(0);
  const skipRef = useRef<(r: Reason, ms?: number) => boolean>(() => false);

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

  const stopCamera = useCallback(() => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void detRef.current?.close?.();
    detRef.current = null;
    setStatus("off");
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
    } catch (e) {
      console.error(e);
      setStatus("denied");
      return false;
    }
    try {
      await loadScript(`${BASE}/face_detection.js`);
      const FD = window.FaceDetection!;
      const det = new FD({ locateFile: (f) => `${BASE}/${f}` });
      det.setOptions({ model: "short", minDetectionConfidence: 0.6 });
      det.onResults((r) => {
        const seen = (r.detections?.length ?? 0) > 0;
        const t = nowMs();
        if (seen) lastSeen.current = t;
        if (seen !== faceRef.current) {
          faceRef.current = seen;
          setFace(seen);
        }
        setMissMs(seen ? 0 : t - lastSeen.current);
        if (phaseRef.current === "CALIB") setCalibOk((n) => (seen ? n + 1 : 0));
      });
      if (det.initialize) await det.initialize();
      detRef.current = det;
      lastSeen.current = nowMs();
      setStatus("ready");
      let busy = false;
      let lastSend = 0;
      const tick = () => {
        loopRef.current = requestAnimationFrame(tick);
        const t = nowMs();
        if (busy || t - lastSend < 120 || !videoRef.current || videoRef.current.readyState < 2) return; // ~8 ภาพ/วินาที
        busy = true;
        lastSend = t;
        detRef.current
          ?.send({ image: videoRef.current })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      };
      tick();
      return true;
    } catch (e) {
      console.error(e);
      setStatus("error");
      return false;
    }
  };

  // ไม่เห็นใบหน้านานเกินที่ตั้งไว้ระหว่างทำข้อ → ข้ามข้อ
  useEffect(() => {
    if (phase !== "QUIZ" || !useCam || status !== "ready" || picked !== null) return;
    if (missMs >= limitS * 1000) {
      const ok = skipRef.current("face", missMs);
      if (ok) {
        lastSeen.current = nowMs(); // เริ่มนับใหม่สำหรับข้อถัดไป
        setCamNotice(`📷 ไม่เห็นใบหน้า / มีวัตถุบังใบหน้านานเกิน ${limitS} วินาที — ข้อที่แล้วถูกข้าม (ไม่ได้คะแนน)`);
      }
    }
  }, [missMs, phase, useCam, status, picked, limitS]);

  const cur = qs[idx];
  const advance = () => {
    if (idx + 1 >= qs.length) {
      setPhase("DONE");
      stopCamera();
      return;
    }
    setIdx((i) => i + 1);
    setPicked(null);
  };
  const skip = (reason: Reason, ms?: number) => {
    if (phaseRef.current !== "QUIZ" || !cur || picked !== null) return false;
    const res = [...results, { id: cur.id, ok: false, skipped: reason }];
    setResults(res);
    setEvents((e) => [...e, { t: nowMs() - startT.current, q: idx + 1, reason, ms }]);
    advance();
    return true;
  };
  useEffect(() => {
    skipRef.current = skip;
  });
  const guard = useLeaveGuard(phase === "QUIZ", phase === "QUIZ" && cur && picked === null ? cur.id : null, (_k, kind) => skipRef.current(kind));

  const begin = async () => {
    setEvents([]);
    setResults([]);
    setIdx(0);
    setPicked(null);
    setCamNotice(null);
    guard.reset();
    if (useCam) {
      setPhase("CALIB");
      setCalibOk(0);
      if (status !== "ready") await startCamera();
    } else {
      startT.current = nowMs();
      setPhase("QUIZ");
    }
  };
  const startQuiz = () => {
    startT.current = nowMs();
    lastSeen.current = nowMs();
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
  const camBadge =
    status === "ready" ? (
      face ? (
        <span className="text-emerald-700">● เห็นใบหน้า</span>
      ) : (
        <span className="text-rose-600">● ไม่เห็นใบหน้า {(missMs / 1000).toFixed(1)} วิ</span>
      )
    ) : status === "loading" ? (
      <span className="text-gray-500">⏳ กำลังเปิดตัวตรวจจับ…</span>
    ) : null;

  return (
    <div className="min-h-screen bg-[#f3f5fa] text-gray-800 px-4 py-6">
      <div className="max-w-xl mx-auto">
        <p className="text-xs font-black text-[#003399] tracking-widest uppercase">Demo · สำหรับผู้บริหาร</p>
        <h1 className="text-2xl font-black text-gray-900 mb-1">ทดลองตรวจจับการใช้กล้องซ้อน</h1>
        <p className="text-xs text-gray-500 mb-4">ต้นแบบเบื้องต้น · ยังไม่ได้เปิดใช้กับนักเรียน · Vocab Master — โรงเรียนอนุกูลนารี</p>

        {/* กล้อง (แสดงตั้งแต่ช่วงเทียบหน้า) */}
        <div className={`${phase === "CALIB" || phase === "QUIZ" ? "" : "hidden"} ${phase === "QUIZ" ? "fixed bottom-4 right-4 z-20 w-28" : "w-full max-w-xs mx-auto mb-4"}`}>
          <div className="relative rounded-2xl overflow-hidden border-4 bg-black" style={{ borderColor: status === "ready" ? (face ? "#10b981" : "#f43f5e") : "#9ca3af" }}>
            <video ref={videoRef} playsInline muted className="w-full block" style={{ transform: "scaleX(-1)" }} />
          </div>
          {phase === "QUIZ" && <p className="text-[10px] font-bold text-center mt-1 bg-white/90 rounded">{camBadge}</p>}
        </div>

        {phase === "INTRO" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border-2 border-[#003399]/10 p-4 text-sm leading-relaxed">
              <h2 className="font-black text-[#003399] mb-2">ระบบนี้ทำอะไร</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>ใช้กล้องหน้าดูว่า <b>ยังเห็นใบหน้าของผู้ทำ</b> อยู่หรือไม่ ระหว่างทำแบบฝึกหัด</li>
                <li>ถ้ามีวัตถุ (เช่น มือถืออีกเครื่อง) ยกขึ้นมาบังใบหน้า หรือไม่เห็นใบหน้านานเกินที่ตั้งไว้ → <b>ข้ามข้อนั้นทันที ไม่ได้คะแนน</b></li>
                <li>รวมกติกาเดียวกับห้องเรียนจริง: ออกจากหน้าแอป หรือมีหน้าต่าง Gemini / วงกลมค้นหาบังนานเกิน 3 วินาที → ข้ามข้อ · คลุม/คัดลอกโจทย์ไม่ได้</li>
              </ul>
            </div>
            <div className="bg-emerald-50 rounded-2xl border-2 border-emerald-200 p-4 text-sm leading-relaxed">
              <h2 className="font-black text-emerald-800 mb-2">🔒 ความเป็นส่วนตัว</h2>
              <ul className="list-disc pl-5 space-y-1 text-emerald-900">
                <li>ประมวลผลภาพ <b>ในเครื่องนี้เท่านั้น</b> — ไม่บันทึกภาพ ไม่ส่งภาพหรือวิดีโอออกไปที่ใด</li>
                <li><b>ไม่ใช้ไมโครโฟน</b> · ปิดกล้องทันทีเมื่อทำจบหรือออกจากหน้านี้</li>
                <li>หน้านี้ไม่บันทึกผลลงระบบ — รีเฟรชแล้วผลหายทั้งหมด</li>
              </ul>
            </div>
            <div className="bg-amber-50 rounded-2xl border-2 border-amber-200 p-4 text-sm leading-relaxed">
              <h2 className="font-black text-amber-900 mb-2">⚠️ ข้อจำกัดที่ควรลองดูด้วยตัวเอง</h2>
              <ul className="list-disc pl-5 space-y-1 text-amber-900">
                <li>ถ่ายจอจาก <b>ด้านบนหรือด้านข้าง</b> โดยไม่บังหน้า → ระบบจับไม่ได้</li>
                <li><b>ก้มจดสมุด</b> เอามือเท้าคาง หรือห้องมืด → อาจถูกนับว่าไม่เห็นใบหน้า (เตือนผิดคน)</li>
                <li>มือถือรุ่นประหยัดอาจช้า/ร้อน · ถ้าใช้กับนักเรียนจริงต้องขอความยินยอมจากผู้ปกครองและโรงเรียนก่อน</li>
              </ul>
            </div>
            <div className="bg-white rounded-2xl border-2 border-[#003399]/10 p-4 space-y-3 text-sm">
              <label className="flex items-center gap-2 font-bold">
                <input type="checkbox" checked={useCam} onChange={(e) => setUseCam(e.target.checked)} /> ใช้กล้องตรวจจับใบหน้า
              </label>
              <label className="flex flex-wrap items-center gap-2 font-bold">
                ข้ามข้อเมื่อไม่เห็นใบหน้านานเกิน
                <select value={limitS} onChange={(e) => setLimitS(Number(e.target.value))} className="border rounded px-2 py-1 bg-white" disabled={!useCam}>
                  {[1, 1.5, 2, 3].map((s) => <option key={s} value={s}>{s} วินาที</option>)}
                </select>
              </label>
            </div>
            <button onClick={begin} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg">
              {useCam ? "อนุญาตกล้อง แล้วเริ่มทดลอง →" : "เริ่มทดลอง (ไม่ใช้กล้อง) →"}
            </button>
          </div>
        )}

        {phase === "CALIB" && (
          <div className="text-center space-y-3">
            {status === "denied" && <p className="bg-rose-50 text-rose-700 font-bold rounded-xl p-3 text-sm">ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตกล้องในเบราว์เซอร์ แล้วลองใหม่ หรือกลับไปเลือก “ไม่ใช้กล้อง”</p>}
            {status === "error" && <p className="bg-rose-50 text-rose-700 font-bold rounded-xl p-3 text-sm">เปิดตัวตรวจจับใบหน้าไม่ได้ในเครื่องนี้ — ลองเบราว์เซอร์ Chrome หรือเลือก “ไม่ใช้กล้อง”</p>}
            {status === "loading" && <p className="text-sm font-bold text-gray-500">⏳ กำลังเปิดกล้องและตัวตรวจจับ (ครั้งแรกอาจใช้ 5–10 วินาที)…</p>}
            {status === "ready" && (
              <>
                <p className="text-lg font-black">{face ? "✓ เห็นใบหน้าแล้ว" : "มองหน้าจอให้กล้องเห็นใบหน้า"}</p>
                <p className="text-xs text-gray-500">ลองยกมือถือ/สมุดขึ้นบังหน้า — กรอบจะเปลี่ยนเป็นสีแดง</p>
                <button disabled={calibOk < 4} onClick={startQuiz} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg disabled:opacity-40">
                  เริ่มทำแบบฝึกหัด {qs.length} ข้อ →
                </button>
              </>
            )}
            <button onClick={() => { stopCamera(); setPhase("INTRO"); }} className="text-sm font-bold text-[#003399] underline">← กลับ</button>
          </div>
        )}

        {phase === "QUIZ" && cur && (
          <div className="bg-white rounded-3xl shadow-xl p-5 mb-24">
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
            <div className="bg-gray-50 rounded-2xl p-4 mb-4" {...noCopyProps}>
              <p className="text-base font-bold text-gray-900">{strip(cur.q)}</p>
            </div>
            <div className="space-y-2 mb-4" {...noCopyProps}>
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
