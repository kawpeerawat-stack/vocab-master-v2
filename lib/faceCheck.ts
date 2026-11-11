// lib/faceCheck.ts
// ─────────────────────────────────────────────────────────────
// กล้องกันการใช้ AI ระหว่างทำแบบฝึก (ต่อยอดจากหน้าทดลองกล้องของ Vocab Master)
//   1) ใบหน้า: MediaPipe Face Detection (/mediapipe/face_detection) ตรวจ ~10 ภาพ/วินาที
//      ไม่เห็นใบหน้าต่อเนื่อง ≥ FACE_MISS_FRAMES ภาพ และ ≥ FACE_LIMIT_MS → onMiss (ข้ามข้อ)
//      (ต้องพลาดหลายภาพติดกัน → กะพริบตา / ขยับหัวนิดเดียวไม่โดน)
//   2) มือถืออีกเครื่อง: MediaPipe Object Detector (/mediapipe/tasks) หา "cell phone" ในภาพ ~3 ภาพ/วินาที
//      เจอติดกัน ≥ PHONE_HITS ภาพ → onPhone (ข้ามข้อ) — จับได้แม้ถ่ายจอจากด้านข้างโดยไม่บังหน้า
//      โหลดตัวตรวจมือถือไม่ได้ (เครื่องเก่า) → ใช้แค่ตรวจใบหน้าต่อไป
//   - ประมวลผลในเครื่องเท่านั้น · ไม่บันทึก ไม่ส่งภาพ · ไม่ใช้ไมโครโฟน · ปิดกล้องเมื่อเลิกใช้
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";

export const FACE_LIMIT_MS = 800;     // ไม่เห็นใบหน้าเกิน 0.8 วินาที …
export const FACE_MISS_FRAMES = 8;    // … และพลาดติดกันอย่างน้อย 8 ภาพ (ตรวจ ~10 ภาพ/วินาที) → ข้ามข้อ
const FACE_INTERVAL_MS = 100;
export const PHONE_SCORE = 0.5;       // ความมั่นใจขั้นต่ำว่าเป็นมือถือ
export const PHONE_HITS = 2;          // เจอมือถือติดกันกี่ภาพ → ข้ามข้อ (~0.6 วินาที)
const PHONE_INTERVAL_MS = 300;

type FaceDet = {
  setOptions: (o: Record<string, unknown>) => void;
  onResults: (cb: (r: { detections?: unknown[] }) => void) => void;
  initialize?: () => Promise<void>;
  send: (i: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => Promise<void>;
};
type ObjDet = {
  detectForVideo: (v: HTMLVideoElement, ts: number) => { detections: { categories: { categoryName: string; score: number }[] }[] };
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
const BASE = "/mediapipe/face_detection";
const TASKS = "/mediapipe/tasks";

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

export type CamStatus = "off" | "loading" | "ready" | "error" | "denied";
export type PhoneStatus = "off" | "loading" | "ready" | "unavailable";

// กันค้าง: งานที่ใช้เวลานานเกินกำหนด → ถือว่าล้มเหลว (บน iPhone/iPad บางรุ่นอาจค้างเงียบ)
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label}: หมดเวลา ${Math.round(ms / 1000)} วิ`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

// watching = ข้อปัจจุบันยังไม่ตอบ · onMiss = ไม่เห็นใบหน้า · onPhone = เจอมือถือในกล้อง (เรียก 1 ครั้งต่อช่วง)
export function useFaceCheck(watching: boolean, onMiss: () => void, onPhone?: () => void) {
  const [status, setStatus] = useState<CamStatus>("off");
  const [phoneStatus, setPhoneStatus] = useState<PhoneStatus>("off");
  const [face, setFace] = useState(false);
  const [phone, setPhone] = useState(false);       // ตอนนี้เห็นมือถือในกล้องหรือไม่
  const [missMs, setMissMs] = useState(0);
  const [seenFrames, setSeenFrames] = useState(0); // เห็นหน้าต่อเนื่องกี่เฟรม (ใช้ตอนเทียบหน้า)
  const [errorDetail, setErrorDetail] = useState(""); // สาเหตุที่เปิดไม่ได้ (โชว์ให้ครูส่งภาพมาตรวจ)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detRef = useRef<FaceDet | null>(null);
  const objRef = useRef<ObjDet | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastSeen = useRef(0);
  const missFrames = useRef(0);
  const phoneHits = useRef(0);
  const faceRef = useRef(false);
  const firedRef = useRef(false);
  const phoneFiredRef = useRef(false);
  const watchRef = useRef(watching);
  const onResultsRef = useRef<((r: { detections?: unknown[] }) => void) | null>(null);
  const onMissRef = useRef(onMiss);
  const onPhoneRef = useRef(onPhone);
  const aliveRef = useRef(0); // เพิ่มทุกครั้งที่ปิดกล้อง → งานโหลดที่ค้างอยู่รู้ว่าถูกยกเลิก
  useEffect(() => {
    onMissRef.current = onMiss;
    onPhoneRef.current = onPhone;
    // เริ่มข้อใหม่ / ตอบแล้ว → เริ่มนับใหม่
    if (watching !== watchRef.current) {
      lastSeen.current = Date.now(); missFrames.current = 0; firedRef.current = false;
      phoneHits.current = 0; phoneFiredRef.current = false; setMissMs(0);
    }
    watchRef.current = watching;
  });

  const stop = useCallback(() => {
    aliveRef.current++;
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void detRef.current?.close?.();
    detRef.current = null;
    try { objRef.current?.close(); } catch { /* ignore */ }
    objRef.current = null;
    faceRef.current = false; // ไม่ค้างค่า "เห็นหน้า" ข้ามรอบ (รอบที่ 2 ในเซสชันเดียวกันจะได้ขึ้นสถานะถูกต้อง)
    phoneHits.current = 0;
    setStatus("off");
    setPhoneStatus("off");
    setFace(false);
    setPhone(false);
    setSeenFrames(0);
  }, []);
  useEffect(() => stop, [stop]);

  // เรียกใหม่เมื่อเริ่มข้อใหม่ (ให้เวลาเต็มกับข้อนั้น)
  const resetMiss = useCallback(() => {
    lastSeen.current = Date.now(); missFrames.current = 0; firedRef.current = false;
    phoneHits.current = 0; phoneFiredRef.current = false; setMissMs(0);
  }, []);

  // ตัวตรวจมือถือ (โหลดเบื้องหลัง — ไม่ทำให้การเปิดกล้องช้าลง)
  const startPhone = useCallback(async (token: number) => {
    setPhoneStatus("loading");
    try {
      const vision = (await withTimeout(
        import(/* webpackIgnore: true */ `${TASKS}/vision_bundle.mjs`) as Promise<VisionModule>, 20000, "โหลดตัวตรวจมือถือ")) as VisionModule;
      const fs = await withTimeout(vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`), 30000, "โหลด wasm ตัวตรวจมือถือ");
      const det = await withTimeout(vision.ObjectDetector.createFromOptions(fs, {
        baseOptions: { modelAssetPath: `${TASKS}/efficientdet_lite0.tflite`, delegate: "CPU" },
        runningMode: "VIDEO", scoreThreshold: PHONE_SCORE, maxResults: 3, categoryAllowlist: ["cell phone"],
      }), 40000, "เริ่มตัวตรวจมือถือ");
      if (token !== aliveRef.current) { det.close(); return; }
      objRef.current = det;
      setPhoneStatus("ready");
    } catch (e) {
      console.warn("phone detector unavailable", e);
      if (token === aliveRef.current) setPhoneStatus("unavailable");
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (detRef.current) return true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorDetail("เบราว์เซอร์นี้ไม่รองรับกล้อง (ถ้าเปิดจากในแอป LINE / Facebook ให้กด ⋯ แล้วเลือกเปิดด้วย Safari หรือ Chrome)");
      setStatus("error");
      return false;
    }
    const token = aliveRef.current;
    setErrorDetail("");
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error("no video element");
      v.setAttribute("playsinline", "true");
      v.muted = true;
      v.srcObject = stream;
      await v.play();
      // รอให้ภาพจากกล้องมาจริงก่อน (iPhone/iPad บางรุ่นยังไม่มีขนาดภาพทันที)
      if (v.readyState < 2 || !v.videoWidth) {
        await withTimeout(new Promise<void>((res) => { v.onloadeddata = () => res(); }), 8000, "รอภาพจากกล้อง").catch(() => undefined);
      }
    } catch (e) {
      console.error(e);
      setErrorDetail(String((e as Error)?.name || e));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("denied");
      return false;
    }
    void startPhone(token);
    // สร้างตัวตรวจใบหน้า · noSimd = ใช้ไฟล์รุ่นธรรมดา (สำรองเมื่อรุ่น SIMD ใช้กับเครื่องนี้ไม่ได้)
    const create = async (noSimd: boolean): Promise<FaceDet> => {
      const FD = window.FaceDetection;
      if (!FD) throw new Error("FaceDetection missing");
      const det = new FD({ locateFile: (f) => `${BASE}/${noSimd ? f.replace("_simd_wasm_bin", "_wasm_bin") : f}` });
      det.setOptions({ model: "short", minDetectionConfidence: 0.5 });
      return det;
    };
    try {
      // ตรวจว่ามีไฟล์ตัวตรวจใบหน้าบนเว็บจริง (ถ้าไม่ได้อัปโหลดโฟลเดอร์ public/mediapipe จะรู้ทันที)
      const head = await fetch(`${BASE}/face_detection_short_range.tflite`, { method: "HEAD", cache: "no-store" }).catch(() => null);
      if (!head || !head.ok) throw new Error(`ไม่พบไฟล์ตัวตรวจใบหน้าบนเว็บ (${head ? head.status : "network"}) — ต้องอัปโหลดโฟลเดอร์ public/mediapipe`);
      await withTimeout(loadScript(`${BASE}/face_detection.js`), 20000, "โหลด face_detection.js");
      let det = await create(false);
      const handleResults = (r: { detections?: unknown[] }) => {
        const seen = (r.detections?.length ?? 0) > 0;
        const t = Date.now();
        if (seen) { lastSeen.current = t; missFrames.current = 0; } else missFrames.current++;
        if (seen !== faceRef.current) { faceRef.current = seen; setFace(seen); }
        setSeenFrames((n) => (seen ? Math.min(n + 1, 99) : 0));
        const miss = seen ? 0 : t - lastSeen.current;
        setMissMs(miss);
        if (watchRef.current && !firedRef.current && miss >= FACE_LIMIT_MS && missFrames.current >= FACE_MISS_FRAMES) {
          firedRef.current = true;
          onMissRef.current();
        }
        if (seen) firedRef.current = false;
      };
      onResultsRef.current = handleResults;
      det.onResults(handleResults);
      // รอบแรกใช้รุ่น SIMD (เร็วกว่า) · ไม่ได้ → ลองรุ่นธรรมดาอีกครั้ง
      try {
        if (det.initialize) await withTimeout(det.initialize(), 25000, "เริ่มตัวตรวจใบหน้า (SIMD)");
        if (videoRef.current) await withTimeout(det.send({ image: videoRef.current }), 15000, "ทดสอบภาพแรก (SIMD)");
      } catch (e1) {
        console.warn("SIMD failed, retry without SIMD", e1);
        void det.close?.();
        const handler = onResultsRef.current;
        det = await create(true);
        if (handler) det.onResults(handler);
        if (det.initialize) await withTimeout(det.initialize(), 25000, "เริ่มตัวตรวจใบหน้า");
        if (videoRef.current) await withTimeout(det.send({ image: videoRef.current }), 15000, "ทดสอบภาพแรก");
      }
      if (token !== aliveRef.current) { void det.close?.(); return false; }
      detRef.current = det;
      lastSeen.current = Date.now();
      missFrames.current = 0;
      setStatus("ready");
      let busy = false;
      let lastSend = 0;
      let lastObj = 0;
      const tick = () => {
        loopRef.current = requestAnimationFrame(tick);
        const v = videoRef.current;
        const t = Date.now();
        if (!v || v.readyState < 2) return;
        // ตรวจมือถือ (~3 ภาพ/วินาที) — ทำแบบ synchronous สั้น ๆ
        const obj = objRef.current;
        if (obj && t - lastObj >= PHONE_INTERVAL_MS) {
          lastObj = t;
          try {
            const r = obj.detectForVideo(v, performance.now());
            const has = r.detections.some((d) => d.categories.some((c) => c.categoryName === "cell phone" && c.score >= PHONE_SCORE));
            phoneHits.current = has ? phoneHits.current + 1 : 0;
            setPhone(has);
            if (watchRef.current && !phoneFiredRef.current && phoneHits.current >= PHONE_HITS) {
              phoneFiredRef.current = true;
              onPhoneRef.current?.();
            }
            if (!has) phoneFiredRef.current = false;
          } catch { /* ข้ามภาพนี้ */ }
        }
        // ตรวจใบหน้า (~10 ภาพ/วินาที)
        if (busy || t - lastSend < FACE_INTERVAL_MS) return;
        busy = true;
        lastSend = t;
        detRef.current?.send({ image: v }).catch(() => undefined).finally(() => { busy = false; });
      };
      tick();
      return true;
    } catch (e) {
      console.error(e);
      const msg = (e as Error)?.message || String(e);
      stop();
      setErrorDetail(msg);
      setStatus("error");
      return false;
    }
  }, [stop, startPhone]);

  return { status, phoneStatus, face, phone, missMs, seenFrames, errorDetail, videoRef, start, stop, resetMiss };
}
