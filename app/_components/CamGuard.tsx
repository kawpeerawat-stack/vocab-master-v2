"use client";
// app/_components/CamGuard.tsx
// ─────────────────────────────────────────────────────────────
// กล้องกันการใช้กล้องซ้อน (ถ่ายจอไปถาม AI) — ใช้ในรอบที่เข้าสมุดคะแนน เมื่อนักเรียนยินยอมใช้กล้อง
//   ชั้น 1: หาใบหน้าไม่เจอ (MediaPipe Face Detection · ไฟล์อยู่ในเว็บเรา /mediapipe)
//   ชั้น 2: บริเวณ "จมูกขึ้นไป" (ตา–หน้าผาก) ต่างจากตอนเทียบหน้าก่อนเริ่มมาก
//           → จับกรณีเอียงมือถือบังช่วงตา ทั้งที่กล้องยังเห็นปาก/คาง
//   บังต่อเนื่อง COVER_FACE_MS → นับ 1 ครั้ง (onCover) — หน้าทำข้อสอบเป็นคนตัดสินว่าจะข้ามข้อหรือไม่
//   ประมวลผลในเครื่องเท่านั้น · ไม่เก็บ ไม่ส่งภาพ · ไม่ใช้ไมโครโฟน · ปิดกล้องเมื่อเลิกใช้
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";

export const COVER_FACE_MS = 500; // บังต่อเนื่องนานเท่านี้ (~5 ภาพ) = นับ 1 ครั้ง — กรองการกะพริบตา/ขยับหัว (8 พ.ย. ครูปรับจาก 0.3 เป็น 0.5 วินาที)
export const UPPER_CORR_MIN = 0.3; // ความคล้ายของบริเวณตา–หน้าผากกับตอนเทียบหน้า ต่ำกว่านี้ = มีอะไรบัง
const BASE = "/mediapipe/face_detection";
const TW = 24, TH = 12; // ขนาดภาพย่อบริเวณตา–หน้าผาก (ใช้เทียบเท่านั้น ไม่เก็บ)

export type CamStatus = "off" | "loading" | "calib" | "ready" | "denied" | "error";
type Rect = { xCenter: number; yCenter: number; width: number; height: number };
type Det = { boundingBox?: Rect; landmarks?: { x: number; y: number }[] };
type FaceDet = {
  setOptions: (o: Record<string, unknown>) => void;
  onResults: (cb: (r: { detections?: Det[] }) => void) => void;
  initialize?: () => Promise<void>;
  send: (i: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => Promise<void>;
};
declare global {
  interface Window {
    FaceDetection?: new (o: { locateFile: (f: string) => string }) => FaceDet;
  }
}
function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    if (window.FaceDetection) return res();
    const old = document.querySelector(`script[src="${src}"]`);
    const s = (old as HTMLScriptElement) || document.createElement("script");
    s.addEventListener("load", () => res());
    s.addEventListener("error", () => rej(new Error("load failed")));
    if (!old) {
      s.src = src;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}
const now = () => Date.now();

// ภาพย่อบริเวณจมูกขึ้นไป (ตา–หน้าผาก) แบบปรับค่าเฉลี่ย/ความต่างแสงแล้ว
// คืน null ถ้าหาบริเวณไม่ได้ · ภาพที่คืนมามี .sd = ความต่างแสงเดิม (ภาพเรียบมาก เช่น หลังมือถือ = sd ต่ำ)
function upperThumb(video: HTMLVideoElement, ctx: CanvasRenderingContext2D, d: Det): (Float32Array & { sd?: number }) | null {
  const b = d.boundingBox, lm = d.landmarks;
  if (!b || !lm || lm.length < 3) return null;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const x0 = Math.max(0, (b.xCenter - b.width / 2) * vw);
  const w = Math.min(vw - x0, b.width * vw);
  const y0 = Math.max(0, (b.yCenter - b.height / 2 - b.height * 0.1) * vh);
  const y1 = Math.min(vh, lm[2].y * vh); // ปลายจมูก
  const h = y1 - y0;
  if (w < 8 || h < 6) return null;
  ctx.drawImage(video, x0, y0, w, h, 0, 0, TW, TH);
  const px = ctx.getImageData(0, 0, TW, TH).data;
  const g = new Float32Array(TW * TH);
  let m = 0;
  for (let i = 0; i < g.length; i++) {
    g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    m += g[i];
  }
  m /= g.length;
  let v = 0;
  for (let i = 0; i < g.length; i++) {
    g[i] -= m;
    v += g[i] * g[i];
  }
  const sd0 = Math.sqrt(v / g.length);
  const sd = sd0 || 1;
  for (let i = 0; i < g.length; i++) g[i] /= sd;
  return Object.assign(g, { sd: sd0 });
}
const corr = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
};

export interface CamCounts { covers: number; coverMs: number }

// active = เปิดกล้องอยู่ · armed = กำลังทำข้อ (นับการบัง) · onCover คืน true ถ้าหน้าจอข้ามข้อไปแล้ว
export function useCameraGuard(onCover?: (ms: number) => boolean | void) {
  const [status, setStatus] = useState<CamStatus>("off");
  const [visible, setVisible] = useState(false);
  const [missMs, setMissMs] = useState(0);
  const [calibrated, setCalibrated] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detRef = useRef<FaceDet | null>(null);
  const loopRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const baseRef = useRef<Float32Array | null>(null);
  const baseFlat = useRef(false); // ตอนเทียบหน้าภาพเรียบเกินไป (มืด/แสงจ้า) → ไม่ใช้ชั้นที่ 2
  const calibBuf = useRef<Float32Array[]>([]);
  const st = useRef({ armed: false, missStart: 0, fired: false, lastSeen: 0, covers: 0, coverMs: 0, gotResult: false });
  // หน้าจอเปลี่ยน (กติกา → ทำข้อ) แล้วกล่องวิดีโอถูกสร้างใหม่ → ต่อภาพกล้องเข้าไปใหม่
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);
  const onCoverRef = useRef(onCover);
  useEffect(() => {
    onCoverRef.current = onCover;
  });

  const stop = useCallback(() => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void detRef.current?.close?.().catch(() => undefined);
    detRef.current = null;
    st.current.armed = false;
    setStatus("off");
  }, []);
  useEffect(() => stop, [stop]);

  const onResults = useCallback((r: { detections?: Det[] }) => {
    const s = st.current;
    s.gotResult = true;
    const t = now();
    const ds = r.detections || [];
    const d = ds.slice().sort((a, b) => (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0) - (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0))[0];
    let ok = !!d;
    const v = videoRef.current;
    if (d && v) {
      if (!ctxRef.current) {
        const c = document.createElement("canvas");
        c.width = TW;
        c.height = TH;
        ctxRef.current = c.getContext("2d", { willReadFrequently: true });
      }
      const th = ctxRef.current ? upperThumb(v, ctxRef.current, d) : null;
      if (th) {
        if (!baseRef.current) {
          // เทียบหน้า: เก็บค่าเฉลี่ย 6 ภาพแรกที่เห็นใบหน้า (อยู่ในหน่วยความจำเท่านั้น)
          calibBuf.current.push(th);
          if (calibBuf.current.length >= 6) {
            const avg = new Float32Array(th.length);
            for (const x of calibBuf.current) for (let i = 0; i < avg.length; i++) avg[i] += x[i] / calibBuf.current.length;
            baseRef.current = avg;
            baseFlat.current = calibBuf.current.reduce((m, x) => m + ((x as { sd?: number }).sd ?? 0), 0) / calibBuf.current.length < 4;
            calibBuf.current = [];
            setCalibrated(true);
            setStatus("ready");
          }
        } else if (!baseFlat.current && ((th.sd ?? 99) < 3 || corr(th, baseRef.current) < UPPER_CORR_MIN)) {
          ok = false; // ตา–หน้าผากถูกบัง (ภาพเปลี่ยนไปมาก หรือกลายเป็นพื้นเรียบ เช่น หลังมือถือ)
        }
      }
    }
    if (ok) {
      if (s.fired && s.missStart) s.coverMs += t - s.missStart; // จบช่วงที่ถูกบัง
      s.lastSeen = t;
      s.missStart = 0;
      s.fired = false;
    } else if (!s.missStart) {
      s.missStart = t;
    }
    setVisible(ok);
    const miss = ok ? 0 : t - s.missStart;
    setMissMs(miss);
    if (s.armed && !ok && !s.fired && miss >= COVER_FACE_MS) {
      s.fired = true;
      s.covers++;
      const skipped = onCoverRef.current?.(miss);
      void skipped;
      // บังต่อเนื่อง = นับครั้งเดียว (ข้ามข้อเดียว) · ต้องเห็นหน้าอีกครั้งจึงนับครั้งใหม่
      // ระหว่างที่ยังบังอยู่ หน้าทำข้อจะซ่อนโจทย์ไว้ (ดู CoverShield) จึงถ่ายโจทย์ข้อถัดไปไม่ได้
    }
  }, []);

  // เปิดกล้อง + ตัวตรวจจับ → คืน false ถ้าใช้ไม่ได้ (ไม่อนุญาต / เครื่องไม่รองรับ)
  const start = useCallback(async (): Promise<boolean> => {
    if (streamRef.current && detRef.current) return true;
    setStatus("loading");
    setCalibrated(false);
    baseRef.current = null;
    baseFlat.current = false;
    calibBuf.current = [];
    st.current = { armed: false, missStart: 0, fired: false, lastSeen: 0, covers: 0, coverMs: 0, gotResult: false };
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error("no video element");
      v.srcObject = stream;
      await v.play();
    } catch (e) {
      console.error("camera denied:", e);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("denied");
      return false;
    }
    try {
      await loadScript(`${BASE}/face_detection.js`);
      const det = new window.FaceDetection!({ locateFile: (f) => `${BASE}/${f}` });
      det.setOptions({ model: "short", minDetectionConfidence: 0.6 });
      det.onResults(onResults);
      if (det.initialize) await det.initialize();
      detRef.current = det;
      setStatus("calib");
      let busy = false, lastSend = 0;
      const tick = () => {
        loopRef.current = requestAnimationFrame(tick);
        const t = now();
        const vv = videoRef.current;
        if (busy || t - lastSend < 100 || !vv || vv.readyState < 2) return; // ~10 ภาพ/วินาที (เครื่องช้าได้น้อยกว่านี้)
        busy = true;
        lastSend = t;
        detRef.current?.send({ image: vv }).catch(() => undefined).finally(() => { busy = false; });
      };
      tick();
      // ไม่มีผลออกมาเลยใน 15 วินาที = เครื่องนี้ใช้ไม่ได้
      await new Promise<void>((res) => {
        const t0 = now();
        const chk = () => (st.current.gotResult || now() - t0 > 15000 ? res() : setTimeout(chk, 200));
        chk();
      });
      if (!st.current.gotResult) throw new Error("no results");
      return true;
    } catch (e) {
      console.error("face detector failed:", e);
      stop();
      setStatus("error");
      return false;
    }
  }, [onResults, stop]);

  // เริ่ม/หยุดนับการบัง (ระหว่างทำข้อ)
  const arm = useCallback((on: boolean) => {
    st.current.armed = on;
  }, []);
  const counts = useCallback((): CamCounts => ({ covers: st.current.covers, coverMs: st.current.coverMs }), []);
  const resetCounts = useCallback(() => {
    st.current.covers = 0;
    st.current.coverMs = 0;
  }, []);
  return { status, visible, missMs, calibrated, setVideo, start, stop, arm, counts, resetCounts };
}

export type CamGuard = ReturnType<typeof useCameraGuard>;

// กล่องภาพกล้อง (แสดงให้นักเรียนเห็นตัวเอง) — floating = มุมขวาล่างระหว่างทำข้อ
export function CamBox({ cam, floating }: { cam: CamGuard; floating?: boolean }) {
  return <CamView status={cam.status} visible={cam.visible} missMs={cam.missMs} setVideo={cam.setVideo} floating={floating} />;
}
function CamView({ status, visible, missMs, setVideo, floating }: { status: CamStatus; visible: boolean; missMs: number; setVideo: (el: HTMLVideoElement | null) => void; floating?: boolean }) {
  const ready = status === "ready" || status === "calib";
  const color = !ready ? "#9ca3af" : visible ? "#10b981" : "#f43f5e";
  return (
    <div className={floating ? "fixed bottom-4 right-4 z-30 w-24" : "w-full max-w-[220px] mx-auto"}>
      <div className="relative rounded-2xl overflow-hidden border-4 bg-black" style={{ borderColor: color }}>
        <video ref={setVideo} playsInline muted className="w-full block" style={{ transform: "scaleX(-1)" }} />
      </div>
      <p className="text-[10px] font-bold text-center mt-1 bg-white/90 rounded" data-cam={visible ? "face" : "noface"}>
        {status === "loading" ? (
          <span className="text-gray-500">⏳ กำลังเปิดกล้อง…</span>
        ) : !ready ? null : visible ? (
          <span className="text-emerald-700">● เห็นใบหน้า</span>
        ) : (
          <span className="text-rose-600">● มีอะไรบังหน้า {(missMs / 1000).toFixed(1)} วิ</span>
        )}
      </p>
    </div>
  );
}

// ── การเลือกใช้กล้อง (จำไว้ในเครื่องนี้ ต่อนักเรียน) ──
const choiceKey = (email: string) => `camChoice:${email.trim().toLowerCase()}`;
export function loadCamChoice(email: string): boolean | null {
  try {
    const v = localStorage.getItem(choiceKey(email));
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}
export function saveCamChoice(email: string, on: boolean) {
  try {
    localStorage.setItem(choiceKey(email), on ? "on" : "off");
  } catch {
    /* ไม่เป็นไร */
  }
}

// ── หน้ากติกา: เลือกใช้กล้อง / ไม่ใช้กล้อง แล้วเริ่ม ──
//   camRule / noCamRule = ข้อความเกณฑ์ของแต่ละแบบ · onStart(cm) เริ่มทำข้อ
export function CamChooser({
  cam,
  want,
  setWant,
  camRule,
  noCamRule,
  note,
  startLabel,
  onStart,
}: {
  cam: CamGuard;
  want: boolean;
  setWant: (on: boolean) => void;
  camRule: string;
  noCamRule: string;
  note?: string;
  startLabel: string;
  onStart: (cm: "cam" | "nocam" | "camfail") => void;
}) {
  const st = cam.status;
  const card = (on: boolean, icon: string, title: string, rule: string) => (
    <button
      type="button"
      onClick={() => {
        setWant(on);
        if (!on) cam.stop();
      }}
      className={`flex-1 min-w-[140px] text-left rounded-2xl border-2 p-3 transition-all ${want === on ? "border-[#003399] bg-[#003399]/5 ring-2 ring-[#003399]/20" : "border-gray-200 bg-white"}`}
      aria-pressed={want === on}
    >
      <div className="text-2xl">{icon}</div>
      <div className="font-black text-sm text-gray-900">{title}</div>
      <div className="text-xs font-bold text-[#003399] mt-0.5">{rule}</div>
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {card(true, "📷", "ใช้กล้อง", camRule)}
        {card(false, "🚫", "ไม่ใช้กล้อง", noCamRule)}
      </div>
      {note && <p className="text-[11px] font-bold text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{note}</p>}
      <p className="text-[11px] text-gray-500 leading-relaxed">
        🔒 กล้องใช้ดูว่า “ยังเห็นใบหน้า (จมูกขึ้นไป)” อยู่หรือไม่เท่านั้น — ประมวลผลในเครื่องนี้ <b>ไม่บันทึก ไม่ส่งภาพ ไม่ใช้ไมโครโฟน</b> · ครูเห็นแค่จำนวนครั้งที่มีอะไรบังหน้า · ปิดกล้องทันทีเมื่อทำจบ
      </p>
      {want ? (
        <div className="space-y-2">
          {st !== "off" && st !== "denied" && st !== "error" && <CamBox cam={cam} />}
          {st === "off" && (
            <button type="button" onClick={() => void cam.start()} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg">
              📷 เปิดกล้องและเทียบหน้า
            </button>
          )}
          {st === "loading" && <p className="text-center text-sm font-bold text-gray-500">⏳ กำลังเปิดกล้อง (ครั้งแรกอาจใช้ 5–15 วินาที)…</p>}
          {st === "calib" && <p className="text-center text-sm font-bold text-[#003399]">มองหน้าจอให้กล้องเห็นใบหน้าชัด ๆ สักครู่… (เทียบหน้า)</p>}
          {st === "ready" && (
            <button type="button" onClick={() => onStart("cam")} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg">
              ✓ เทียบหน้าแล้ว · {startLabel} →
            </button>
          )}
          {(st === "denied" || st === "error") && (
            <div className="space-y-2">
              <p className="bg-rose-50 text-rose-700 font-bold rounded-xl p-3 text-sm">
                {st === "denied" ? "ไม่ได้รับอนุญาตให้ใช้กล้อง (กดอนุญาตกล้องในเบราว์เซอร์แล้วลองใหม่ได้)" : "เปิดตัวตรวจจับใบหน้าไม่ได้ในเครื่องนี้ (ลองเบราว์เซอร์ Chrome / Safari)"}
              </p>
              <button type="button" onClick={() => void cam.start()} className="w-full py-3 bg-white border-2 border-[#003399] text-[#003399] font-black rounded-2xl">ลองเปิดกล้องอีกครั้ง</button>
              <button type="button" onClick={() => onStart("camfail")} className="w-full py-3 bg-gray-100 text-gray-700 font-black rounded-2xl">
                ทำแบบไม่ใช้กล้อง ({noCamRule}) · ครูจะเห็นว่ากล้องใช้ไม่ได้
              </button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => onStart("nocam")} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg">
          {startLabel} (ไม่ใช้กล้อง) →
        </button>
      )}
    </div>
  );
}

// แถบนับถอยหลัง (จับเวลาต่อข้อ · ไม่ใช้กล้อง)
export function TimerBar({ left, limit }: { left: number; limit: number }) {
  const pct = Math.max(0, Math.min(100, (left / limit) * 100));
  const s = Math.ceil(left / 1000);
  const warn = s <= 5;
  return (
    <div className="mb-3" aria-label={`เหลือเวลา ${s} วินาที`}>
      <div className="flex justify-between text-[11px] font-black mb-1">
        <span className="text-gray-500">⏱ จับเวลาข้อนี้ ({Math.round(limit / 1000)} วินาที)</span>
        <span className={`tabular-nums ${warn ? "text-rose-600" : "text-[#003399]"}`} data-timer={s}>{s} วิ</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full transition-[width] duration-200 ${warn ? "bg-rose-500" : "bg-[#003399]"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ระหว่างที่มีอะไรบังใบหน้า (ใช้กล้อง) → ซ่อนโจทย์และตัวเลือก จนกว่าจะเห็นหน้าอีกครั้ง
export const isCovered = (cam: { status: CamStatus; visible: boolean; missMs: number }) => cam.status === "ready" && !cam.visible && cam.missMs >= COVER_FACE_MS;
export function CoverShield() {
  return (
    <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-6 mb-4 text-center" data-shield="1">
      <div className="text-4xl mb-1">📷</div>
      <p className="font-black text-rose-800">มีอะไรบังใบหน้าอยู่</p>
      <p className="text-sm font-bold text-rose-700 mt-1">เอามือ/สิ่งของออก แล้วมองหน้าจอ — โจทย์จะกลับมาเอง</p>
    </div>
  );
}
