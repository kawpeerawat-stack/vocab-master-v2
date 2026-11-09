"use client";
// app/_components/CamGuard.tsx
// ─────────────────────────────────────────────────────────────
// กล้องกันการใช้กล้องซ้อน (ถ่ายจอไปถาม AI) — ใช้ในรอบที่เข้าสมุดคะแนน เมื่อนักเรียนยินยอมใช้กล้อง
//   ชั้น 1: หาใบหน้าไม่เจอ (MediaPipe Face Detection · ไฟล์อยู่ในเว็บเรา /mediapipe)
//   ชั้น 2: บริเวณ "จมูกขึ้นไป" (ตา–หน้าผาก) ต่างจากตอนเทียบหน้าก่อนเริ่มมาก
//           → จับกรณีเอียงมือถือบังช่วงตา ทั้งที่กล้องยังเห็นปาก/คาง
//   บังต่อเนื่อง COVER_FACE_MS → นับ 1 ครั้ง (onCover) — หน้าทำข้อสอบเป็นคนตัดสินว่าจะข้ามข้อหรือไม่
//   ชั้น 3 (9 พ.ย.): ตรวจหา "มือถือ" ในภาพกล้อง — ตัวตรวจเดียวกับแอป Grammar Master
//           (MediaPipe Object Detector · EfficientDet-Lite0 · ไฟล์อยู่ในเว็บเรา /mediapipe/tasks)
//           ครูเลือก "ทางสายกลาง": เห็นมือถือ PHONE_FRAMES ภาพติดกัน
//             · มือถือใหญ่ (≥ PHONE_MIN_AREA ของภาพ = อยู่ใกล้กล้อง) หรือแตะขอบภาพ (กำลังยกเข้ามาในกรอบ) ทุกขนาด → นับ 1 ครั้ง (onCover kind = "phone")
//             · มือถือเล็กอยู่กลางภาพ (น่าจะเป็นของเพื่อนด้านหลัง) → ไม่ข้ามข้อ บันทึก "📱ไกล" ให้ครูเห็น (onFar)
//           เครื่องช้ามาก / โหลดไม่ได้ → ปิดชั้นนี้ ใช้ชั้น 1–2 ต่อ
//   ประมวลผลในเครื่องเท่านั้น · ไม่เก็บ ไม่ส่งภาพ · ไม่ใช้ไมโครโฟน · ปิดกล้องเมื่อเลิกใช้
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";

export const COVER_FACE_MS = 500; // บังต่อเนื่องนานเท่านี้ (~5 ภาพ) = นับ 1 ครั้ง — กรองการกะพริบตา/ขยับหัว (8 พ.ย. ครูปรับจาก 0.3 เป็น 0.5 วินาที)
export const UPPER_CORR_MIN = 0.3; // ความคล้ายของบริเวณตา–หน้าผากกับตอนเทียบหน้า ต่ำกว่านี้ = มีอะไรบัง
const BASE = "/mediapipe/face_detection";
// ── ชั้น 3: ตรวจหามือถือ ──
export const PHONE_FRAMES = 2;        // เห็นมือถือกี่ภาพติดกันจึงนับ (ครูเลือก 9 พ.ย.)
export const PHONE_SCORE = 0.5;       // ความมั่นใจขั้นต่ำ (เท่าแอป Grammar)
export const PHONE_MIN_AREA = 0.03;   // กรอบมือถือใหญ่อย่างน้อย 3% ของภาพ = อยู่ใกล้กล้อง → นับ
export const PHONE_EDGE = 0.02;       // กรอบมือถือห่างขอบภาพไม่เกิน 2% = แตะขอบ (กำลังยกเข้ามา) → นับทุกขนาด
const PHONE_CLEAR = 2;                // ไม่เห็นมือถือกี่ภาพติดกัน = เก็บแล้ว
const PHONE_GAP_MS = 250;             // ~3–4 ภาพ/วินาที (แอป Grammar 300)
const PHONE_SLOW_MS = 1200;           // เฉลี่ยช้ากว่านี้ต่อภาพ = เครื่องช้าเกินไป → ปิดชั้นนี้
const TASKS = "/mediapipe/tasks";
export type PhoneState = "off" | "loading" | "ready" | "slow" | "error";
export type CoverKind = "face" | "phone";
type PhoneSeen = "near" | "far" | null;
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
// MediaPipe Tasks Vision (เฉพาะส่วนที่ใช้)
type ObjBox = { originX: number; originY: number; width: number; height: number };
type ObjDet = {
  detectForVideo: (v: HTMLVideoElement, ts: number) => { detections: { boundingBox?: ObjBox; categories: { categoryName: string; score: number }[] }[] };
  close: () => void;
};
type VisionModule = {
  FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
  ObjectDetector: { createFromOptions: (fs: unknown, o: Record<string, unknown>) => Promise<ObjDet> };
};
declare global {
  interface Window {
    FaceDetection?: new (o: { locateFile: (f: string) => string }) => FaceDet;
  }
}
function loadScript(src: string, loaded: () => boolean = () => !!window.FaceDetection): Promise<void> {
  return new Promise((res, rej) => {
    if (loaded()) return res();
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

// กันค้าง: งานที่ใช้เวลานานเกินกำหนด → ถือว่าล้มเหลว (iPhone/iPad บางรุ่นค้างเงียบ · ยกมาจากแอป Grammar)
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label}: หมดเวลา ${Math.round(ms / 1000)} วิ`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}
// โหลดไฟล์ .mjs จากเว็บเราโดยไม่ผ่านตัวรวมไฟล์ของ Next
const importUrl = (u: string) => (new Function("u", "return import(u)") as (u: string) => Promise<unknown>)(u);

// ตัวตรวจมือถือ: สร้างครั้งเดียวต่อหน้า ใช้ซ้ำทุกรอบ (ไฟล์ ~17 MB · เบราว์เซอร์จำไว้ใช้ครั้งต่อไป)
let phoneDetP: Promise<ObjDet> | null = null;
function loadPhoneDetector() {
  if (!phoneDetP) {
    phoneDetP = (async () => {
      const vision = (await withTimeout(importUrl(`${TASKS}/vision_bundle.mjs`), 20000, "โหลดตัวตรวจมือถือ")) as VisionModule;
      const fs = await withTimeout(vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`), 30000, "โหลด wasm ตัวตรวจมือถือ");
      return withTimeout(
        vision.ObjectDetector.createFromOptions(fs, {
          baseOptions: { modelAssetPath: `${TASKS}/efficientdet_lite0.tflite`, delegate: "CPU" },
          runningMode: "VIDEO",
          scoreThreshold: PHONE_SCORE,
          maxResults: 5,
          categoryAllowlist: ["cell phone"],
        }),
        40000,
        "เริ่มตัวตรวจมือถือ"
      );
    })();
    phoneDetP.catch(() => {
      phoneDetP = null; // ครั้งหน้าลองใหม่
    });
  }
  return phoneDetP;
}
// มือถือในภาพ: near = ใหญ่หรือแตะขอบ (นับ) · far = เล็กอยู่กลางภาพ (บันทึกให้ครูเห็นเท่านั้น)
function classifyPhone(r: ReturnType<ObjDet["detectForVideo"]>, vw: number, vh: number): PhoneSeen {
  let far = false;
  for (const d of r.detections) {
    if (!d.categories.some((c) => c.categoryName === "cell phone" && c.score >= PHONE_SCORE)) continue;
    const b = d.boundingBox;
    if (!b) return "near";
    const area = (b.width * b.height) / (vw * vh);
    const mx = vw * PHONE_EDGE, my = vh * PHONE_EDGE;
    const edge = b.originX <= mx || b.originY <= my || b.originX + b.width >= vw - mx || b.originY + b.height >= vh - my;
    if (area >= PHONE_MIN_AREA || edge) return "near";
    far = true;
  }
  return far ? "far" : null;
}

export interface CamCounts { covers: number; coverMs: number; phones: number; phonesFar: number; phoneState: PhoneState }

// active = เปิดกล้องอยู่ · armed = กำลังทำข้อ (นับการบัง) · onCover คืน true ถ้าหน้าจอข้ามข้อไปแล้ว
export function useCameraGuard(onCover?: (ms: number, kind: CoverKind) => boolean | void, onFar?: () => void) {
  const [status, setStatus] = useState<CamStatus>("off");
  const [phoneState, setPhoneState] = useState<PhoneState>("off");
  const [phone, setPhone] = useState(false); // เห็นมือถือ (ใกล้/แตะขอบ) ในภาพอยู่ตอนนี้
  const [phoneFar, setPhoneFar] = useState(false); // เห็นมือถือเล็ก ๆ ไกล ๆ อยู่ตอนนี้ (ไม่นับ)
  const [errorDetail, setErrorDetail] = useState(""); // สาเหตุที่เปิดกล้องไม่ได้ (นักเรียนถ่ายรูปส่งครูได้)
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
  const st = useRef({ armed: false, missStart: 0, fired: false, lastSeen: 0, covers: 0, coverMs: 0, gotResult: false, faceOk: true, phoneHits: 0, phoneMiss: 0, phones: 0, farHits: 0, farMiss: 0, farFired: false, phonesFar: 0, phoneState: "off" as PhoneState });
  const phoneRun = useRef(0); // รอบการทำงานของตัวตรวจมือถือ (เปลี่ยนเลข = หยุดรอบเก่า)
  // หน้าจอเปลี่ยน (กติกา → ทำข้อ) แล้วกล่องวิดีโอถูกสร้างใหม่ → ต่อภาพกล้องเข้าไปใหม่
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);
  const onCoverRef = useRef(onCover);
  const onFarRef = useRef(onFar);
  useEffect(() => {
    onCoverRef.current = onCover;
    onFarRef.current = onFar;
  });

  const stop = useCallback(() => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    phoneRun.current++;
    setPhone(false);
    setPhoneFar(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void detRef.current?.close?.().catch(() => undefined);
    detRef.current = null;
    st.current.armed = false;
    setStatus("off");
    setPhoneState("off");
  }, []);

  // ตัดสินรวมทั้งใบหน้าและมือถือ: 1 ช่วงที่บัง/มีมือถือ = นับครั้งเดียว (ข้ามข้อเดียว)
  //   ช่วงจบเมื่อเห็นหน้าอีกครั้ง และไม่เห็นมือถือแล้ว
  const judge = useCallback((t: number) => {
    const s = st.current;
    const phoneNow = s.phoneHits >= PHONE_FRAMES;
    const faceMiss = s.faceOk ? 0 : t - s.missStart;
    if (s.faceOk && s.phoneHits === 0 && s.phoneMiss >= PHONE_CLEAR) {
      s.fired = false;
      return;
    }
    if (!s.armed || s.fired) return;
    const kind: CoverKind | null = phoneNow ? "phone" : faceMiss >= COVER_FACE_MS ? "face" : null;
    if (!kind) return;
    s.fired = true;
    if (kind === "phone") s.phones++;
    else s.covers++;
    onCoverRef.current?.(kind === "face" ? faceMiss : 0, kind);
    // ระหว่างที่ยังบัง/ยังเห็นมือถือ หน้าทำข้อจะซ่อนโจทย์ไว้ (ดู CoverShield) จึงถ่ายโจทย์ข้อถัดไปไม่ได้
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
    } else if (!s.missStart) {
      s.missStart = t;
    }
    s.faceOk = ok;
    setVisible(ok);
    setMissMs(ok ? 0 : t - s.missStart);
    judge(t);
  }, [judge]);

  // ชั้น 3: วนตรวจหามือถือ (~3–4 ภาพ/วินาที · ทีละภาพ)
  const startPhone = useCallback(async () => {
    const run = ++phoneRun.current;
    const s = st.current;
    s.phoneHits = 0;
    s.phoneMiss = PHONE_CLEAR;
    s.farHits = 0;
    s.farMiss = PHONE_CLEAR;
    s.farFired = false;
    const set = (p: PhoneState) => {
      s.phoneState = p;
      setPhoneState(p);
    };
    set("loading");
    let det: ObjDet;
    try {
      det = await loadPhoneDetector();
    } catch (e) {
      console.warn("phone detector unavailable:", e);
      if (run === phoneRun.current) set("error");
      return;
    }
    if (run !== phoneRun.current) return;
    set("ready");
    const times: number[] = [];
    while (run === phoneRun.current) {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const t0 = now();
      let seen: PhoneSeen = null;
      try {
        seen = classifyPhone(det.detectForVideo(v, performance.now()), v.videoWidth, v.videoHeight);
      } catch (e) {
        console.warn("phone frame failed:", e); // ข้ามภาพนี้
      }
      if (run !== phoneRun.current) return;
      times.push(now() - t0);
      if (times.length === 4 && times.reduce((a, b) => a + b, 0) / 4 > PHONE_SLOW_MS) {
        set("slow"); // เครื่องช้าเกินไป → ใช้แค่ชั้น 1–2
        setPhone(false);
        setPhoneFar(false);
        s.phoneHits = 0;
        s.phoneMiss = PHONE_CLEAR;
        judge(now());
        return;
      }
      if (seen === "near") {
        s.phoneHits++;
        s.phoneMiss = 0;
      } else {
        s.phoneMiss++;
        if (s.phoneMiss >= PHONE_CLEAR) s.phoneHits = 0;
      }
      // มือถือไกล ๆ: บันทึกครั้งเดียวต่อช่วง (ไม่ข้ามข้อ)
      if (seen === "far") {
        s.farHits++;
        s.farMiss = 0;
        if (s.armed && !s.farFired && s.farHits >= PHONE_FRAMES) {
          s.farFired = true;
          s.phonesFar++;
          onFarRef.current?.();
        }
      } else {
        s.farMiss++;
        if (s.farMiss >= PHONE_CLEAR) {
          s.farHits = 0;
          s.farFired = false;
        }
      }
      setPhone(s.phoneHits >= PHONE_FRAMES);
      setPhoneFar(s.farHits >= PHONE_FRAMES);
      judge(now());
      await new Promise((r) => setTimeout(r, PHONE_GAP_MS));
    }
  }, [judge]);

  // เปิดกล้อง + ตัวตรวจจับ → คืน false ถ้าใช้ไม่ได้ (ไม่อนุญาต / เครื่องไม่รองรับ)
  const start = useCallback(async (): Promise<boolean> => {
    if (streamRef.current && detRef.current) return true;
    setStatus("loading");
    setErrorDetail("");
    setCalibrated(false);
    baseRef.current = null;
    baseFlat.current = false;
    calibBuf.current = [];
    st.current = { armed: false, missStart: 0, fired: false, lastSeen: 0, covers: 0, coverMs: 0, gotResult: false, faceOk: true, phoneHits: 0, phoneMiss: PHONE_CLEAR, phones: 0, farHits: 0, farMiss: PHONE_CLEAR, farFired: false, phonesFar: 0, phoneState: "off" };
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorDetail("เบราว์เซอร์นี้ไม่รองรับกล้อง — ถ้าเปิดจากในแอป LINE / Facebook ให้กด ⋯ แล้วเลือกเปิดด้วย Safari หรือ Chrome");
      setStatus("error");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error("no video element");
      v.setAttribute("playsinline", "true");
      v.muted = true;
      v.srcObject = stream;
      await v.play();
      // รอภาพจริงจากกล้อง (iPhone/iPad บางรุ่นยังไม่มีขนาดภาพทันที)
      if (v.readyState < 2 || !v.videoWidth) {
        await withTimeout(new Promise<void>((res) => v.addEventListener("loadeddata", () => res(), { once: true })), 8000, "รอภาพจากกล้อง").catch(() => undefined);
      }
    } catch (e) {
      console.error("camera denied:", e);
      setErrorDetail(String((e as Error)?.name || e));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("denied");
      return false;
    }
    void startPhone(); // โหลดตัวตรวจมือถือเบื้องหลัง ไปพร้อมกับเทียบหน้า
    // สร้างตัวตรวจใบหน้า · noSimd = ไฟล์รุ่นธรรมดา (สำรองเมื่อรุ่น SIMD ใช้กับเครื่องนี้ไม่ได้ · ยกมาจากแอป Grammar)
    const create = (noSimd: boolean): FaceDet => {
      const det = new window.FaceDetection!({ locateFile: (f) => `${BASE}/${noSimd ? f.replace("_simd_wasm_bin", "_wasm_bin") : f}` });
      det.setOptions({ model: "short", minDetectionConfidence: 0.6 });
      det.onResults(onResults);
      return det;
    };
    try {
      await withTimeout(loadScript(`${BASE}/face_detection.js`), 20000, "โหลดตัวตรวจใบหน้า");
      let det = create(false);
      try {
        if (det.initialize) await withTimeout(det.initialize(), 25000, "เริ่มตัวตรวจใบหน้า (SIMD)");
        if (videoRef.current) await withTimeout(det.send({ image: videoRef.current }), 15000, "ทดสอบภาพแรก (SIMD)");
      } catch (e1) {
        console.warn("SIMD failed, retry without SIMD:", e1);
        void det.close?.().catch(() => undefined);
        det = create(true);
        if (det.initialize) await withTimeout(det.initialize(), 25000, "เริ่มตัวตรวจใบหน้า");
        if (videoRef.current) await withTimeout(det.send({ image: videoRef.current }), 15000, "ทดสอบภาพแรก");
      }
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
      if (!st.current.gotResult) throw new Error("ตัวตรวจใบหน้าไม่ตอบใน 15 วินาที");
      return true;
    } catch (e) {
      console.error("face detector failed:", e);
      stop();
      setErrorDetail((e as Error)?.message || String(e));
      setStatus("error");
      return false;
    }
  }, [onResults, stop, startPhone]);

  // เริ่ม/หยุดนับการบัง (ระหว่างทำข้อ)
  const arm = useCallback((on: boolean) => {
    st.current.armed = on;
  }, []);
  const counts = useCallback((): CamCounts => ({ covers: st.current.covers, coverMs: st.current.coverMs, phones: st.current.phones, phonesFar: st.current.phonesFar, phoneState: st.current.phoneState }), []);
  const resetCounts = useCallback(() => {
    st.current.covers = 0;
    st.current.coverMs = 0;
    st.current.phones = 0;
    st.current.phonesFar = 0;
  }, []);
  return { status, visible, missMs, calibrated, phone, phoneFar, phoneState, errorDetail, setVideo, start, stop, arm, counts, resetCounts };
}

export type CamGuard = ReturnType<typeof useCameraGuard>;

// กล่องภาพกล้อง (แสดงให้นักเรียนเห็นตัวเอง) — floating = มุมขวาล่างระหว่างทำข้อ
export function CamBox({ cam, floating }: { cam: CamGuard; floating?: boolean }) {
  return <CamView status={cam.status} visible={cam.visible} missMs={cam.missMs} phone={cam.phone} phoneFar={cam.phoneFar} setVideo={cam.setVideo} floating={floating} />;
}
function CamView({ status, visible, missMs, phone, phoneFar, setVideo, floating }: { status: CamStatus; visible: boolean; missMs: number; phone: boolean; phoneFar?: boolean; setVideo: (el: HTMLVideoElement | null) => void; floating?: boolean }) {
  const ready = status === "ready" || status === "calib";
  const color = !ready ? "#9ca3af" : visible && !phone ? "#10b981" : "#f43f5e";
  return (
    <div className={floating ? "fixed bottom-4 right-4 z-30 w-24" : "w-full max-w-[220px] mx-auto"}>
      <div className="relative rounded-2xl overflow-hidden border-4 bg-black" style={{ borderColor: color }}>
        <video ref={setVideo} playsInline muted className="w-full block" style={{ transform: "scaleX(-1)" }} />
      </div>
      <p className="text-[10px] font-bold text-center mt-1 bg-white/90 rounded" data-cam={phone ? "phone" : visible ? "face" : "noface"}>
        {status === "loading" ? (
          <span className="text-gray-500">⏳ กำลังเปิดกล้อง…</span>
        ) : !ready ? null : phone ? (
          <span className="text-rose-600">● พบมือถือในกล้อง</span>
        ) : visible ? (
          <span className="text-emerald-700">● เห็นใบหน้า{phoneFar ? <span className="text-amber-600"> · 📱ไกล</span> : null}</span>
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
        🔒 กล้องใช้ดูว่า “ยังเห็นใบหน้า (จมูกขึ้นไป)” และ “มีมือถือเครื่องอื่นในภาพ” หรือไม่เท่านั้น — ประมวลผลในเครื่องนี้ <b>ไม่บันทึก ไม่ส่งภาพ ไม่ใช้ไมโครโฟน</b> · ครูเห็นแค่จำนวนครั้ง · ปิดกล้องทันทีเมื่อทำจบ
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
          {st === "ready" && cam.phoneState === "loading" && <p className="text-center text-sm font-bold text-[#003399]" data-phone-loading="1">⏳ กำลังโหลดตัวตรวจมือถือ (ครั้งแรกอาจใช้ 10–20 วินาที)…</p>}
          {st === "ready" && cam.phone && <p className="text-center text-sm font-bold text-rose-700 bg-rose-50 rounded-xl p-2" data-phone-block="1">📱 กล้องเห็นมือถืออีกเครื่อง — วางให้พ้นกล้องก่อนเริ่ม</p>}
          {st === "ready" && cam.phoneState === "ready" && !cam.phone && <p className="text-center text-[11px] font-bold text-gray-400">✓ ตัวตรวจมือถือพร้อม</p>}
          {st === "ready" && (cam.phoneState === "error" || cam.phoneState === "slow") && <p className="text-center text-[11px] font-bold text-gray-400">เครื่องนี้ใช้ตัวตรวจมือถือไม่ได้ — ตรวจเฉพาะใบหน้า</p>}
          {st === "ready" && cam.phoneState !== "loading" && !cam.phone && (
            <button type="button" onClick={() => onStart("cam")} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg">
              ✓ เทียบหน้าแล้ว · {startLabel} →
            </button>
          )}
          {(st === "denied" || st === "error") && (
            <div className="space-y-2">
              <p className="bg-rose-50 text-rose-700 font-bold rounded-xl p-3 text-sm">
                {st === "denied" ? "ไม่ได้รับอนุญาตให้ใช้กล้อง (กดอนุญาตกล้องในเบราว์เซอร์แล้วลองใหม่ได้)" : "เปิดตัวตรวจจับใบหน้าไม่ได้ในเครื่องนี้ (ลองเบราว์เซอร์ Chrome / Safari)"}
                {cam.errorDetail && <span className="block text-[11px] font-bold text-rose-500 mt-1" data-cam-error="1">สาเหตุ: {cam.errorDetail}</span>}
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
// และระหว่างที่เห็นมือถือในกล้อง
export const isCovered = (cam: { status: CamStatus; visible: boolean; missMs: number; phone?: boolean }) =>
  cam.status === "ready" && (!!cam.phone || (!cam.visible && cam.missMs >= COVER_FACE_MS));
export function CoverShield({ phone }: { phone?: boolean }) {
  return (
    <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-6 mb-4 text-center" data-shield={phone ? "phone" : "face"}>
      <div className="text-4xl mb-1">{phone ? "📱" : "📷"}</div>
      <p className="font-black text-rose-800">{phone ? "พบมือถือในกล้อง" : "มีอะไรบังใบหน้าอยู่"}</p>
      <p className="text-sm font-bold text-rose-700 mt-1">{phone ? "เก็บมือถือเครื่องอื่นให้พ้นกล้อง" : "เอามือ/สิ่งของออก แล้วมองหน้าจอ"} — โจทย์จะกลับมาเอง</p>
    </div>
  );
}
// ข้อความแจ้งหลังถูกข้ามเพราะกล้อง
export const camSkipText = (kind: CoverKind, unit = "ข้อ") =>
  kind === "phone" ? `📱 พบมือถือในกล้อง — ${unit}ที่แล้วถูกข้าม (ไม่ได้คะแนน)` : `📷 มีอะไรบังใบหน้า (จมูกขึ้นไป) — ${unit}ที่แล้วถูกข้าม (ไม่ได้คะแนน)`;
