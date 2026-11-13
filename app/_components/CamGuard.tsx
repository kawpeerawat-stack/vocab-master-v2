"use client";
// app/_components/CamGuard.tsx
// ─────────────────────────────────────────────────────────────
// กล้องกันการใช้กล้องซ้อน (ถ่ายจอไปถาม AI) — ใช้ในรอบที่เข้าสมุดคะแนน เมื่อนักเรียนยินยอมใช้กล้อง
//   ชั้น 1: หาใบหน้าไม่เจอ (MediaPipe Face Detection · ไฟล์อยู่ในเว็บเรา /mediapipe)
//   ชั้น 2: บริเวณ "จมูกขึ้นไป" (ตา–หน้าผาก) ต่างจากตอนเทียบหน้าก่อนเริ่มมาก
//           → จับกรณีเอียงมือถือบังช่วงตา ทั้งที่กล้องยังเห็นปาก/คาง
//   บังต่อเนื่อง getCoverMs() (ครูปรับที่ /admin) → นับ 1 ครั้ง (onCover) — หน้าทำข้อสอบเป็นคนตัดสินว่าจะข้ามข้อหรือไม่
//   ชั้น 3 (9 พ.ย.): ตรวจหา "มือถือ" ในภาพกล้อง — ตัวตรวจเดียวกับแอป Grammar Master
//           (MediaPipe Object Detector · EfficientDet-Lite0 · ไฟล์อยู่ในเว็บเรา /mediapipe/tasks)
//           ครูเลือก "ทางสายกลาง": เห็นมือถือ PHONE_FRAMES ภาพติดกัน
//             · มือถือใหญ่ (≥ PHONE_MIN_AREA ของภาพ = อยู่ใกล้กล้อง) หรือแตะขอบภาพ (กำลังยกเข้ามาในกรอบ) ทุกขนาด → นับ 1 ครั้ง (onCover kind = "phone")
//             · มือถือเล็กอยู่กลางภาพ (น่าจะเป็นของเพื่อนด้านหลัง) → ไม่ข้ามข้อ บันทึก "📱ไกล" ให้ครูเห็น (onFar)
//           เครื่องช้ามาก / โหลดไม่ได้ → ปิดชั้นนี้ ใช้ชั้น 1–2 ต่อ
//   ประมวลผลในเครื่องเท่านั้น · ไม่เก็บ ไม่ส่งภาพ · ไม่ใช้ไมโครโฟน · ปิดกล้องเมื่อเลิกใช้
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { redeemCode } from "../lib/teacherCode";
import { liftCap, ROUND_CAP } from "../lib/rounds";
import { serverNow, syncClock } from "../lib/sync";
import { getCoverMs, refreshCamSettings } from "../lib/camSettings";
import { describeCamError, shouldRetrySimple } from "../lib/camHelp";
import { CamHelp } from "./CamHelp";

// เวลาบังหน้าต่อเนื่องก่อนนับ 1 ครั้ง = getCoverMs() (ค่าเริ่มต้น 1.5 วินาที · ครูปรับ 1.0–3.0 ได้ที่หน้า /admin → app/lib/camSettings.ts) — กรองการกะพริบตา/ส่ายหน้า/ปรับท่านั่ง (8 พ.ย. ครูปรับ 0.3→0.5 · 12 พ.ย. ปรับเป็น 1.5 วินาที)
export const UPPER_CORR_MIN = 0.3; // ความคล้ายของบริเวณตา–หน้าผากกับภาพอ้างอิง (ตอนเทียบหน้า + ภาพที่ปรับตามท่านั่ง) ต่ำกว่านี้ = มีอะไรบัง
// 12 พ.ย. (ครูแจ้ง: ทักว่าบังหน้าทั้งที่ไม่มีอะไรบัง · ขยับกล้องแล้วทักผิด) — ชั้น 2 ปรับให้ตามท่านั่ง/มุมกล้องได้
export const MOVE_GRACE_MS = 4000;    // ขยับกล้อง/ท่านั่งเปลี่ยนมาก แต่ยังเห็นหน้า → ผ่อนผันไม่เกินนี้ ระหว่างรอให้นิ่งแล้วเทียบหน้าใหม่เอง
const ANCHOR_STEADY_MS = 600;         // ตำแหน่งหน้านิ่งนานเท่านี้ (และ ≥ ANCHOR_FRAMES ภาพ) = เทียบหน้าใหม่
const ANCHOR_FRAMES = 4;
const ADAPT_MIN_CORR = 0.45;          // ภาพยังคล้ายภาพอ้างอิง (แสง/ท่านั่งค่อย ๆ เปลี่ยน) → เก็บเป็นภาพอ้างอิงเพิ่มทุก ADAPT_EVERY_MS
const ADAPT_EVERY_MS = 3000;
const MAX_REFS = 5;                   // ภาพอ้างอิงสูงสุด (ภาพแรกตอนเทียบหน้าคงไว้เสมอ)
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
// เหตุที่ "ไม่ผ่าน": ไม่พบใบหน้า · เห็นหน้าแต่ตา–หน้าผากถูกบัง · กล้อง/ท่านั่งขยับไม่นิ่ง (ผ่อนผันหมดเวลาแล้ว)
export type FaceReason = "noface" | "covered" | "moving" | null;
// คำแนะนำก่อนเริ่ม (แสดงตอนเทียบหน้า): ไม่พบหน้า · มืด · แสงจ้า · ไกล · ใกล้ · ไม่อยู่กลางภาพ · กล้องเอียง
export type CamTip = "noface" | "dark" | "bright" | "far" | "near" | "offcenter" | "tilt";
type Geo = { cx: number; cy: number; size: number; roll: number }; // ตำแหน่ง/ขนาด/การเอียงของใบหน้าในภาพ (สัดส่วนของภาพ · องศา)
type Thumb = Float32Array & { sd?: number; mean?: number };
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

// ภาพย่อบริเวณตา–หน้าผาก แบบปรับค่าเฉลี่ย/ความต่างแสงแล้ว
// 12 พ.ย.: ตัดภาพตาม "ตำแหน่งตาสองข้าง" (หมุนให้แนวตาอยู่ระดับเดียวกัน · ขนาดตามระยะห่างตา) แทนกรอบหน้า
//   → หน้าเอียง/ขยับ/ใกล้-ไกลเล็กน้อย ภาพยังตรงกับที่เทียบไว้ (กรอบหน้าของตัวตรวจสั่นได้ ทำให้ภาพเพี้ยนจนทักผิด)
// คืน null ถ้าหาบริเวณไม่ได้ หรือบริเวณนั้นล้นขอบภาพ · .sd = ความต่างแสงเดิม (พื้นเรียบ เช่น หลังมือถือ = sd ต่ำ) · .mean = ความสว่างเฉลี่ย
function upperThumb(video: HTMLVideoElement, ctx: CanvasRenderingContext2D, d: Det): Thumb | null {
  const lm = d.landmarks;
  if (!lm || lm.length < 2) return null;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  let a = { x: lm[0].x * vw, y: lm[0].y * vh };
  let c = { x: lm[1].x * vw, y: lm[1].y * vh };
  if (c.x < a.x) [a, c] = [c, a];
  const iod = Math.hypot(c.x - a.x, c.y - a.y);
  if (iod < 8) return null;
  const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
  const roll = Math.atan2(c.y - a.y, c.x - a.x);
  const W = 2.6 * iod, UP = 0.95 * iod, DOWN = 0.55 * iod, H = UP + DOWN; // ซ้าย-ขวาข้างละ 1.3 ระยะตา · เหนือแนวตา 0.95 · ลงมาถึงสันจมูก 0.55
  const cs = Math.cos(roll), sn = Math.sin(roll);
  for (const [u, w] of [[-W / 2, -UP], [W / 2, -UP], [-W / 2, DOWN], [W / 2, DOWN]]) {
    const x = mx + u * cs - w * sn, y = my + u * sn + w * cs;
    if (x < -2 || y < -2 || x > vw + 2 || y > vh + 2) return null; // ล้นขอบภาพ → มีแถบดำปนเข้ามา ไม่ใช้เทียบ
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, TW, TH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(TW / W, TH / H);
  ctx.translate(W / 2, UP);
  ctx.rotate(-roll);
  ctx.translate(-mx, -my);
  ctx.drawImage(video, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  return Object.assign(g, { sd: sd0, mean: m });
}
// ตำแหน่ง/ขนาด/การเอียงของใบหน้า
function geoOf(d: Det, vw: number, vh: number): Geo | null {
  const b = d.boundingBox, lm = d.landmarks;
  if (!b) return null;
  let roll = 0;
  if (lm && lm.length >= 2 && vw && vh) {
    let a = lm[0], c = lm[1];
    if (c.x < a.x) [a, c] = [c, a];
    roll = (Math.atan2((c.y - a.y) * vh, (c.x - a.x) * vw) * 180) / Math.PI;
  }
  return { cx: b.xCenter, cy: b.yCenter, size: b.width, roll };
}
// ใบหน้าเปลี่ยนตำแหน่ง/ขนาด/มุมมาก (ขยับกล้อง หรือนั่งเปลี่ยนท่า) เมื่อเทียบกับตอนที่ภาพยังตรงกับภาพอ้างอิง
const geoMoved = (a: Geo, b: Geo) => Math.hypot(a.cx - b.cx, a.cy - b.cy) > 0.07 || b.size / (a.size || 1) > 1.2 || b.size / (a.size || 1) < 0.83 || Math.abs(a.roll - b.roll) > 10;
// นิ่งแล้ว (ใช้ตัดสินว่าขยับกล้องเสร็จแล้ว)
const geoSteady = (a: Geo, b: Geo) => Math.hypot(a.cx - b.cx, a.cy - b.cy) < 0.03 && Math.abs(b.size / (a.size || 1) - 1) < 0.12 && Math.abs(a.roll - b.roll) < 6;
// เฉลี่ยภาพย่อหลายภาพ → ปรับให้ความต่างแสงเป็น 1 (ไม่ให้ค่าเทียบต่ำลงเพราะการเฉลี่ย)
function averageThumbs(xs: Float32Array[]): Float32Array {
  const avg = new Float32Array(xs[0].length);
  for (const x of xs) for (let i = 0; i < avg.length; i++) avg[i] += x[i] / xs.length;
  let v = 0;
  for (let i = 0; i < avg.length; i++) v += avg[i] * avg[i];
  const sd = Math.sqrt(v / avg.length) || 1;
  for (let i = 0; i < avg.length; i++) avg[i] /= sd;
  return avg;
}
const corr = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
};
const bestCorr = (a: Float32Array, refs: Float32Array[]) => refs.reduce((m, r) => Math.max(m, corr(a, r)), -1);

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
  const [faceReason, setFaceReason] = useState<FaceReason>(null); // เหตุที่ไม่ผ่านตอนนี้ (ใช้เลือกข้อความ)
  const [adjusting, setAdjusting] = useState(false); // ขยับกล้อง/ท่านั่งเปลี่ยน แต่ยังเห็นหน้า → กำลังเทียบหน้าใหม่ (ยังไม่นับบัง)
  const [tips, setTips] = useState<CamTip[]>([]); // คำแนะนำก่อนเริ่ม (อัปเดตเฉพาะตอนยังไม่เริ่มทำข้อ)
  const videoRef = useRef<HTMLVideoElement | null>(null); // กล่องภาพที่นักเรียนเห็น (เปลี่ยนตามหน้า)
  // ภาพต้นทางสำหรับตรวจจับ (9 พ.ย.): วิดีโอซ่อนที่อยู่ตลอด (หน้าเลือกห้อง) — เปลี่ยนหน้าแล้วการตรวจไม่สะดุด
  const sourceRef = useRef<HTMLVideoElement | null>(null);
  const vid = () => sourceRef.current ?? videoRef.current;
  const streamRef = useRef<MediaStream | null>(null);
  const detRef = useRef<FaceDet | null>(null);
  const loopRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const baseFlat = useRef(false); // ตอนเทียบหน้าภาพเรียบเกินไป (มืด/แสงจ้า) → ไม่ใช้ชั้นที่ 2
  const calibBuf = useRef<Thumb[]>([]);
  const calibGeo = useRef<Geo[]>([]);
  // ภาพอ้างอิงของตา–หน้าผาก: refs[0] = ตอนเทียบหน้า (หรือเทียบใหม่หลังขยับกล้อง) · ที่เหลือ = ภาพล่าสุดที่ยังคล้ายกัน (ตามแสง/ท่านั่งที่ค่อย ๆ เปลี่ยน)
  const ap = useRef({ refs: [] as Float32Array[], baseSd: 0, good: null as Geo | null, goodSince: 0, lastAdd: 0, mv: null as null | { since: number; anchor: Geo; stableSince: number; buf: Thumb[] } });
  const st = useRef({ armed: false, missStart: 0, fired: false, lastSeen: 0, covers: 0, coverMs: 0, gotResult: false, faceOk: true, phoneHits: 0, phoneMiss: 0, phones: 0, farHits: 0, farMiss: 0, farFired: false, phonesFar: 0, phoneState: "off" as PhoneState });
  const phoneRun = useRef(0); // รอบการทำงานของตัวตรวจมือถือ (เปลี่ยนเลข = หยุดรอบเก่า)
  // หน้าจอเปลี่ยน (กติกา → ทำข้อ) แล้วกล่องวิดีโอถูกสร้างใหม่ → ต่อภาพกล้องเข้าไปใหม่
  const setSource = useCallback((el: HTMLVideoElement | null) => {
    sourceRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.muted = true;
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);
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
    if (sourceRef.current) sourceRef.current.srcObject = null;
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
    const kind: CoverKind | null = phoneNow ? "phone" : faceMiss >= getCoverMs() ? "face" : null;
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
    let reason: FaceReason = d ? null : "noface";
    let adj = false;
    let geo: Geo | null = null;
    let th: Thumb | null = null;
    const v = vid();
    if (d && v) {
      if (!ctxRef.current) {
        const c = document.createElement("canvas");
        c.width = TW;
        c.height = TH;
        ctxRef.current = c.getContext("2d", { willReadFrequently: true });
      }
      geo = geoOf(d, v.videoWidth, v.videoHeight);
      th = ctxRef.current ? upperThumb(v, ctxRef.current, d) : null;
      const A = ap.current;
      if (th && geo) {
        if (A.refs.length === 0) {
          // เทียบหน้า: เก็บค่าเฉลี่ย 6 ภาพแรกที่เห็นใบหน้า (อยู่ในหน่วยความจำเท่านั้น)
          calibBuf.current.push(th);
          calibGeo.current.push(geo);
          if (calibBuf.current.length >= 6) {
            const n = calibGeo.current.length;
            A.refs = [averageThumbs(calibBuf.current)];
            A.baseSd = calibBuf.current.reduce((m, x) => m + (x.sd ?? 0), 0) / calibBuf.current.length;
            A.good = { cx: calibGeo.current.reduce((m, g) => m + g.cx, 0) / n, cy: calibGeo.current.reduce((m, g) => m + g.cy, 0) / n, size: calibGeo.current.reduce((m, g) => m + g.size, 0) / n, roll: calibGeo.current.reduce((m, g) => m + g.roll, 0) / n };
            baseFlat.current = A.baseSd < 4;
            calibBuf.current = [];
            calibGeo.current = [];
            setCalibrated(true);
            setStatus("ready");
          }
        } else if (!baseFlat.current) {
          const c = bestCorr(th, A.refs);
          const flat = (th.sd ?? 99) < Math.max(2, 0.2 * A.baseSd); // พื้นเรียบมากเมื่อเทียบกับตอนเทียบหน้า (เช่น หลังมือถือ / มือ)
          if (!flat && c >= UPPER_CORR_MIN) {
            A.mv = null;
            if (c >= ADAPT_MIN_CORR) {
              A.good = geo;
              if (!A.goodSince) A.goodSince = t;
              if (t - A.goodSince >= ADAPT_EVERY_MS && t - A.lastAdd >= ADAPT_EVERY_MS) {
                A.refs = [A.refs[0], ...[...A.refs.slice(1), th].slice(-(MAX_REFS - 1))];
                A.lastAdd = t;
              }
            } else A.goodSince = 0;
          } else {
            A.goodSince = 0;
            const moved = !flat && !!A.good && geoMoved(A.good, geo);
            if (moved) {
              // ขยับกล้อง/นั่งเปลี่ยนท่า แต่ยังเห็นหน้าชัด → ไม่ใช่การบัง: รอให้นิ่ง แล้วเทียบหน้าใหม่เอง (ผ่อนผันไม่เกิน MOVE_GRACE_MS)
              if (!A.mv) A.mv = { since: t, anchor: geo, stableSince: t, buf: [] };
              const m = A.mv;
              if (t - m.since <= MOVE_GRACE_MS) {
                if (geoSteady(m.anchor, geo)) {
                  m.buf.push(th);
                  if (m.buf.length > 8) m.buf.shift();
                  if (m.buf.length >= ANCHOR_FRAMES && t - m.stableSince >= ANCHOR_STEADY_MS) {
                    A.refs = [averageThumbs(m.buf)];
                    A.baseSd = m.buf.reduce((x, y) => x + (y.sd ?? 0), 0) / m.buf.length;
                    baseFlat.current = A.baseSd < 4;
                    A.good = geo;
                    A.lastAdd = t;
                    A.mv = null;
                  } else adj = true;
                } else {
                  m.anchor = geo;
                  m.stableSince = t;
                  m.buf = [th];
                  adj = true;
                }
              } else {
                ok = false; // ขยับไม่นิ่งเกินเวลาผ่อนผัน
                reason = "moving";
              }
            } else {
              A.mv = null;
              ok = false; // ตา–หน้าผากถูกบัง (ภาพเปลี่ยนไปมากโดยตำแหน่งหน้าไม่ขยับ หรือกลายเป็นพื้นเรียบ เช่น หลังมือถือ)
              reason = "covered";
            }
          }
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
    setFaceReason(ok ? null : reason);
    setAdjusting(adj);
    // คำแนะนำก่อนเริ่มทำข้อ (ระหว่างทำข้อไม่ต้องคำนวณ)
    if (!s.armed) {
      const tp: CamTip[] = [];
      if (!d) tp.push("noface");
      else {
        if (geo) {
          if (geo.size < 0.16) tp.push("far");
          else if (geo.size > 0.55) tp.push("near");
          if (Math.abs(geo.cx - 0.5) > 0.22 || geo.cy < 0.28 || geo.cy > 0.68) tp.push("offcenter");
          if (Math.abs(geo.roll) > 15) tp.push("tilt");
        }
        if (th && th.mean !== undefined) {
          if (th.mean < 55) tp.push("dark");
          else if (th.mean > 215) tp.push("bright");
        }
      }
      setTips((prev) => (prev.join() === tp.join() ? prev : tp));
    }
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
      const v = vid();
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
      if (times.length > 4) times.shift();
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
      // นอกรอบที่เข้าสมุดคะแนน (กล้องเปิดค้างจากหน้าเลือกห้อง) → ตรวจช้าลง ประหยัดแบตเตอรี่/ไม่ให้เครื่องร้อน
      await new Promise((r) => setTimeout(r, s.armed ? PHONE_GAP_MS : 1000));
    }
  }, [judge]);

  // เปิดกล้อง + ตัวตรวจจับ → คืน false ถ้าใช้ไม่ได้ (ไม่อนุญาต / เครื่องไม่รองรับ)
  const start = useCallback(async (): Promise<boolean> => {
    if (streamRef.current && detRef.current) return true;
    void refreshCamSettings(); // อ่านเวลาบังหน้าที่ครูตั้ง (ไม่รอ — ใช้ค่าที่จำไว้ก่อน)
    setStatus("loading");
    setErrorDetail("");
    setCalibrated(false);
    ap.current = { refs: [], baseSd: 0, good: null, goodSince: 0, lastAdd: 0, mv: null };
    baseFlat.current = false;
    calibBuf.current = [];
    calibGeo.current = [];
    setFaceReason(null);
    setAdjusting(false);
    setTips([]);
    st.current = { armed: false, missStart: 0, fired: false, lastSeen: 0, covers: 0, coverMs: 0, gotResult: false, faceOk: true, phoneHits: 0, phoneMiss: PHONE_CLEAR, phones: 0, farHits: 0, farMiss: PHONE_CLEAR, farFired: false, phonesFar: 0, phoneState: "off" };
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorDetail("NoMediaDevices"); // กล่องแก้ปัญหากล้อง (CamHelp) แยกเบราว์เซอร์ในแอป / ไม่ใช่ https / เบราว์เซอร์เก่า
      setStatus("denied");
      return false;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
      } catch (e1) {
        // กล้องเพิ่งถูกใช้แล้วยังไม่คืน / ค่าที่ขอกล้องบางรุ่นไม่รับ → รอสั้น ๆ แล้วลองครั้งเดียวด้วยค่าเรียบง่าย (ไม่ลองซ้ำเมื่อถูกปฏิเสธสิทธิ์ — กันถามนักเรียนซ้ำ)
        if (!shouldRetrySimple(e1)) throw e1;
        await new Promise((r) => setTimeout(r, 700));
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      const v = vid();
      if (!v) throw new Error("no video element");
      // กล่องภาพที่นักเรียนเห็น (ถ้าแยกจากภาพต้นทาง)
      const disp = videoRef.current;
      if (disp && disp !== v) {
        disp.muted = true;
        disp.srcObject = stream;
        void disp.play().catch(() => undefined);
      }
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
      setErrorDetail(describeCamError(e));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("denied");
      return false;
    }
    void startPhone(); // โหลดตัวตรวจมือถือเบื้องหลัง ไปพร้อมกับเทียบหน้า
    // สร้างตัวตรวจใบหน้า · noSimd = ไฟล์รุ่นธรรมดา (สำรองเมื่อรุ่น SIMD ใช้กับเครื่องนี้ไม่ได้ · ยกมาจากแอป Grammar)
    const create = (noSimd: boolean): FaceDet => {
      const det = new window.FaceDetection!({ locateFile: (f) => `${BASE}/${noSimd ? f.replace("_simd_wasm_bin", "_wasm_bin") : f}` });
      det.setOptions({ model: "short", minDetectionConfidence: 0.5 });
      det.onResults(onResults);
      return det;
    };
    try {
      await withTimeout(loadScript(`${BASE}/face_detection.js`), 20000, "โหลดตัวตรวจใบหน้า");
      let det = create(false);
      try {
        if (det.initialize) await withTimeout(det.initialize(), 25000, "เริ่มตัวตรวจใบหน้า (SIMD)");
        const v0 = vid();
        if (v0) await withTimeout(det.send({ image: v0 }), 15000, "ทดสอบภาพแรก (SIMD)");
      } catch (e1) {
        console.warn("SIMD failed, retry without SIMD:", e1);
        void det.close?.().catch(() => undefined);
        det = create(true);
        if (det.initialize) await withTimeout(det.initialize(), 25000, "เริ่มตัวตรวจใบหน้า");
        const v1 = vid();
        if (v1) await withTimeout(det.send({ image: v1 }), 15000, "ทดสอบภาพแรก");
      }
      detRef.current = det;
      setStatus("calib");
      let busy = false, lastSend = 0;
      const tick = () => {
        loopRef.current = requestAnimationFrame(tick);
        const t = now();
        const vv = vid();
        if (busy || t - lastSend < (st.current.armed ? 100 : 400) || !vv || vv.readyState < 2) return; // ~10 ภาพ/วินาที ระหว่างทำข้อ · นอกนั้น ~2.5 ภาพ/วินาที
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
  return { status, visible, missMs, calibrated, faceReason, adjusting, tips, phone, phoneFar, phoneState, errorDetail, setVideo, setSource, start, stop, arm, counts, resetCounts };
}

export type CamGuard = ReturnType<typeof useCameraGuard>;

// ── 9 พ.ย.: กล้องชุดเดียวทั้งแอป — เปิดและเทียบหน้าที่หน้าเลือกห้อง แล้วใช้ต่อทั้ง 2 แถบ (มาตรฐานเดียวกันก่อนทำ) ──
//   หน้าเลือกห้องถือกล้อง · ห้องที่กำลังเปิดลงทะเบียนตัวรับเหตุการณ์ (บังหน้า / มือถือ) · ห้องปิดกล้องเองไม่ได้ (ปิดเมื่อออกจากระบบ)
type CamHandlers = { onCover?: (ms: number, kind: CoverKind) => boolean | void; onFar?: () => void };
// กล้องมีชุดเดียวต่อหน้า → เก็บตัวรับเหตุการณ์ของห้องที่เปิดอยู่ไว้ระดับไฟล์
let roomHandlers: CamHandlers = {};
const bindRoom = (h: CamHandlers) => {
  roomHandlers = h;
  return () => {
    if (roomHandlers === h) roomHandlers = {};
  };
};
export function useSharedCamera() {
  const cam = useCameraGuard(
    (ms, kind) => roomHandlers.onCover?.(ms, kind),
    () => roomHandlers.onFar?.()
  );
  return { cam, bind: bindRoom };
}
export type SharedCam = ReturnType<typeof useSharedCamera> & { fallback: boolean }; // fallback = ครูกรอกรหัสไม่ใช้กล้องแล้ว (เครื่องนี้)
const noop = () => undefined;
export function useRoomCamera(shared: SharedCam | undefined, onCover: (ms: number, kind: CoverKind) => boolean | void, onFar?: () => void): CamGuard {
  const own = useCameraGuard(shared ? undefined : onCover, shared ? undefined : onFar);
  const cb = useRef({ onCover, onFar });
  useEffect(() => {
    cb.current = { onCover, onFar };
  });
  const bind = shared?.bind;
  useEffect(() => {
    if (!bind) return;
    return bind({ onCover: (ms, kind) => cb.current.onCover(ms, kind), onFar: () => cb.current.onFar?.() });
  }, [bind]);
  return shared ? { ...shared.cam, stop: noop } : own;
}

// ภาพต้นทางของกล้อง (ซ่อน · วางไว้ที่หน้าเลือกห้องตลอดเวลาที่เข้าระบบ) — เปลี่ยนหน้า/ห้องแล้วการตรวจไม่สะดุด
export function CamSource({ cam }: { cam: CamGuard }) {
  return <SourceVideo setSource={cam.setSource} />;
}
function SourceVideo({ setSource }: { setSource: (el: HTMLVideoElement | null) => void }) {
  return <video ref={setSource} playsInline muted aria-hidden="true" className="fixed bottom-0 left-0 w-[2px] h-[2px] opacity-[0.01] pointer-events-none" />;
}
// กล่องภาพกล้อง (แสดงให้นักเรียนเห็นตัวเอง) — floating = มุมขวาล่างระหว่างทำข้อ
export function CamBox({ cam, floating }: { cam: CamGuard; floating?: boolean }) {
  return <CamView status={cam.status} visible={cam.visible} missMs={cam.missMs} phone={cam.phone} phoneFar={cam.phoneFar} reason={cam.faceReason} adjusting={cam.adjusting} setVideo={cam.setVideo} floating={floating} />;
}
function CamView({ status, visible, missMs, phone, phoneFar, reason, adjusting, setVideo, floating }: { status: CamStatus; visible: boolean; missMs: number; phone: boolean; phoneFar?: boolean; reason?: FaceReason; adjusting?: boolean; setVideo: (el: HTMLVideoElement | null) => void; floating?: boolean }) {
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
          <span className="text-emerald-700">● เห็นใบหน้า{adjusting ? <span className="text-amber-600" data-cam-adjusting="1"> · กำลังปรับ…</span> : null}{phoneFar ? <span className="text-amber-600"> · 📱ไกล</span> : null}</span>
        ) : reason === "noface" ? (
          <span className="text-rose-600">● ไม่พบใบหน้า {(missMs / 1000).toFixed(1)} วิ</span>
        ) : reason === "moving" ? (
          <span className="text-rose-600">● กล้องขยับ {(missMs / 1000).toFixed(1)} วิ</span>
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

// ── 12 พ.ย.: คำแนะนำก่อนเริ่ม (ตั้งกล้องให้ตรวจแม่น ไม่ทักผิด) + ตรวจตำแหน่ง/แสงสด ๆ ระหว่างเทียบหน้า ──
const TIP_TH: Record<CamTip, string> = {
  noface: "ยังไม่เห็นใบหน้า — ขยับให้หน้าอยู่กลางภาพ แล้วมองตรงที่กล้อง",
  dark: "แสงน้อยไป — หันหน้าเข้าหาแสง หรือเปิดไฟห้อง",
  bright: "แสงจ้า/ย้อนแสง — อย่านั่งหันหลังให้หน้าต่างหรือหลอดไฟ",
  far: "ไกลไป — ขยับเข้าใกล้กล้องอีกนิด",
  near: "ใกล้ไป — ถอยออกจากกล้องเล็กน้อย",
  offcenter: "หน้าไม่อยู่กลางภาพ — ขยับเครื่องหรือตัวให้เห็นหน้าอยู่ตรงกลาง",
  tilt: "ภาพเอียง — ตั้งเครื่องให้ตรง อย่าถือเอียง",
};
function CamCoach({ cam }: { cam: CamGuard }) {
  const live = cam.status === "calib" || cam.status === "ready";
  return (
    <div className="rounded-2xl border-2 border-[#003399]/20 bg-white p-3 space-y-2" data-cam-coach="1">
      {live && (
        <div data-cam-tips={cam.tips.join(",") || "ok"}>
          {cam.tips.length === 0 ? (
            cam.status === "ready" ? (
              <p className="text-xs font-black text-emerald-700">✅ ตำแหน่งและแสงดีแล้ว — พร้อมเริ่ม</p>
            ) : (
              <p className="text-xs font-black text-[#003399]">กำลังเทียบหน้า… นั่งนิ่ง ๆ สักครู่</p>
            )
          ) : (
            <ul className="space-y-0.5">
              {cam.tips.map((t) => (
                <li key={t} className="text-xs font-black text-amber-700" data-cam-tip={t}>⚠️ {TIP_TH[t]}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <details open={!live}>
        <summary className="text-xs font-black text-[#003399] cursor-pointer">📋 ก่อนเริ่ม ตั้งกล้องให้ถูก 5 อย่าง (ระบบจะไม่ทักผิด)</summary>
        <ol className="mt-1.5 space-y-1 text-[11px] font-bold text-gray-600 leading-relaxed list-decimal pl-4">
          <li><b>วางเครื่องให้นิ่ง</b> พิงหนังสือหรือใช้ขาตั้ง อย่าถือ — กล้องขยับระหว่างทำจะทำให้ภาพเปลี่ยน</li>
          <li><b>ให้เห็นหน้าเต็ม</b> ตา–จมูก–ปากชัด อยู่กลางภาพ กล้องระดับสายตา ไม่เอียง</li>
          <li><b>แสงมาจากด้านหน้า</b> เปิดไฟห้อง ไม่นั่งหันหลังให้หน้าต่างหรือหลอดไฟ</li>
          <li><b>ตาและหน้าผากไม่ถูกบัง</b> เก็บผมที่ปรกตา ถอดหมวก/หน้ากาก · แว่นสะท้อนแสงให้เอียงหน้าจอลงเล็กน้อย</li>
          <li><b>เก็บมือถือเครื่องอื่น</b> ให้พ้นภาพกล้อง</li>
        </ol>
        <p className="mt-1.5 text-[11px] font-bold text-[#003399] bg-[#003399]/5 rounded-lg px-2 py-1.5 leading-relaxed">
          ระหว่างทำข้อ ถ้าต้องขยับกล้อง ให้ขยับช้า ๆ ให้หน้ายังอยู่ในภาพ แล้วนิ่งสัก 1–2 วินาที ระบบจะเทียบหน้าใหม่เอง (ไม่นับว่าบัง) · ถ้าหน้าหลุดจากภาพเกิน 1.5 วินาที ข้อนั้นจะถูกข้าม
        </p>
      </details>
    </div>
  );
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
  required = false,
  preApproved = false,
  noCamMode = false,
  room = null,
}: {
  cam: CamGuard;
  room?: string | null; // v8.6: รหัสครูเป็นรหัสของ "ห้อง" (เช่น 6/5) · ไม่รู้ห้อง = ใช้รหัสไม่ได้
  want: boolean;
  setWant: (on: boolean) => void;
  camRule: string;
  noCamRule: string;
  note?: string;
  startLabel: string;
  onStart: (cm: "cam" | "nocam" | "camfail") => void;
  required?: boolean; // 9 พ.ย.: ต้องใช้กล้องทุกคน — ไม่มีตัวเลือก "ไม่ใช้กล้อง" · กล้องใช้ไม่ได้จริงให้ครูกรอกรหัส
  preApproved?: boolean; // ครูกรอกรหัสไม่ใช้กล้องให้แล้วที่หน้าเลือกห้อง
  noCamMode?: boolean; // ห้องเรียนพิเศษ (/extraclass): ไม่ใช้กล้องเลย — เหลือปุ่มเริ่มปุ่มเดียว (จับเวลาเท่าเดิม)
}) {
  const st = cam.status;
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const camView = required || want;
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
  if (noCamMode) {
    return (
      <div className="space-y-3" data-nocam-mode="1">
        <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
          <div className="font-black text-sm text-gray-900">🚫 ห้องเรียนพิเศษ ไม่ใช้กล้อง</div>
          <div className="text-xs font-bold text-gray-600 mt-0.5">จับเวลา {noCamRule} · ทำเองคนเดียว ไม่เปิดแอปหรือเครื่องอื่นช่วย</div>
        </div>
        {note && <p className="text-[11px] font-bold text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{note}</p>}
        <button type="button" onClick={() => onStart("nocam")} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg" data-nocam-start="1">
          {startLabel} →
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {required ? (
        <div className="rounded-2xl border-2 border-[#003399] bg-[#003399]/5 p-3" data-cam-required="1">
          <div className="font-black text-sm text-gray-900">📷 รอบนี้ต้องใช้กล้องทุกคน</div>
          <div className="text-xs font-bold text-[#003399] mt-0.5">{camRule}</div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {card(true, "📷", "ใช้กล้อง", camRule)}
          {card(false, "🚫", "ไม่ใช้กล้อง", noCamRule)}
        </div>
      )}
      {note && <p className="text-[11px] font-bold text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{note}</p>}
      <p className="text-[11px] text-gray-500 leading-relaxed">
        🔒 กล้องใช้ดูว่า “ยังเห็นใบหน้า (จมูกขึ้นไป)” และ “มีมือถือเครื่องอื่นในภาพ” หรือไม่เท่านั้น — ประมวลผลในเครื่องนี้ <b>ไม่บันทึก ไม่ส่งภาพ ไม่ใช้ไมโครโฟน</b> · ครูเห็นแค่จำนวนครั้ง · ปิดกล้องทันทีเมื่อทำจบ
      </p>
      {camView ? (
        <div className="space-y-2">
          {st !== "denied" && st !== "error" && <CamCoach cam={cam} />}
          {st !== "off" && st !== "denied" && st !== "error" && <CamBox cam={cam} />}
          {st !== "ready" && st !== "loading" && st !== "calib" && preApproved && required && (
            <button type="button" onClick={() => onStart("camfail")} className="w-full py-4 bg-gray-700 text-white font-black rounded-2xl shadow-xl text-lg" data-preapproved="1">
              {startLabel} (ครูอนุญาตไม่ใช้กล้องแล้ว · จับเวลา {noCamRule}) →
            </button>
          )}
          {st === "off" && (
            <button type="button" onClick={() => void cam.start()} className={`w-full py-4 font-black rounded-2xl shadow-xl text-lg ${preApproved ? "bg-white border-2 border-[#003399] text-[#003399]" : "bg-[#003399] text-[#FFD700]"}`}>
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
          {(st === "denied" || st === "error") && !preApproved && (
            <div className="space-y-2">
              <CamHelp status={st} detail={cam.errorDetail} />
              <button type="button" onClick={() => void cam.start()} className="w-full py-3 bg-white border-2 border-[#003399] text-[#003399] font-black rounded-2xl">ลองเปิดกล้องอีกครั้ง</button>
              {required ? (
                <div className="rounded-xl border-2 border-gray-200 p-3 space-y-2" data-nocam-code="1">
                  <p className="text-xs font-bold text-gray-700">เครื่องนี้เปิดกล้องไม่ได้จริง? <b>ยกมือเรียกครู</b> — ครูจะมาตรวจเครื่องและบอกรหัสของห้อง (ใช้ได้ภายในคาบ) (ทำแบบจับเวลา {noCamRule} · ครูเห็น 🚫)</p>
                  <div className="flex gap-2">
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, ""));
                        setCodeMsg("");
                      }}
                      placeholder="รหัสครู 6 หลัก"
                      aria-label="รหัสครู"
                      className="flex-1 min-w-0 border-2 border-gray-200 rounded-xl px-3 py-2 font-black tracking-widest text-center"
                    />
                    <button
                      type="button"
                      disabled={codeBusy}
                      onClick={async () => {
                        setCodeBusy(true);
                        await syncClock(); // ใช้เวลาของเซิร์ฟเวอร์ (นาฬิกามือถือผิดก็ไม่เป็นไร)
                        const r = redeemCode("nocam", room, code, serverNow());
                        setCodeBusy(false);
                        if (r.result === "ok") onStart("camfail");
                        else setCodeMsg(r.result === "noroom" ? "ไม่พบห้องของคุณ — ออกจากระบบแล้วกรอกชั้นเรียนใหม่ หรือแจ้งครู" : r.result === "locked" ? `กรอกผิดหลายครั้ง ล็อกไว้ ${Math.ceil((r.lockMs ?? 0) / 60000)} นาที` : `รหัสไม่ถูกต้องหรือหมดอายุ (เหลือ ${r.left ?? 0} ครั้งก่อนล็อก)`);
                      }}
                      className="shrink-0 px-4 py-2 bg-gray-700 text-white font-black rounded-xl disabled:opacity-50"
                    >
                      ยืนยัน
                    </button>
                  </div>
                  {codeMsg && <p className="text-xs font-bold text-rose-600" data-code-msg="1">{codeMsg}</p>}
                </div>
              ) : (
                <button type="button" onClick={() => onStart("camfail")} className="w-full py-3 bg-gray-100 text-gray-700 font-black rounded-2xl">
                  ทำแบบไม่ใช้กล้อง ({noCamRule}) · ครูจะเห็นว่ากล้องใช้ไม่ได้
                </button>
              )}
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

// แถบนับถอยหลัง (จับเวลาต่อข้อ · ทุกคน ตั้งแต่ 9 พ.ย.)
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
  cam.status === "ready" && (!!cam.phone || (!cam.visible && cam.missMs >= getCoverMs()));
const SHIELD_FACE: Record<"noface" | "covered" | "moving", [string, string]> = {
  noface: ["ไม่พบใบหน้าในกล้อง", "ขยับให้เห็นหน้า (ตา–จมูก–ปาก) อยู่กลางภาพ แล้วมองหน้าจอ · ถ้าขยับกล้อง ให้วางให้นิ่ง"],
  covered: ["มีอะไรบังใบหน้า (ตา–หน้าผาก)", "เอามือ/สิ่งของ/ผมที่ปรกตาออก แล้วมองหน้าจอ"],
  moving: ["กล้องขยับอยู่", "วางเครื่องให้นิ่ง ให้เห็นหน้าอยู่กลางภาพ นิ่งสัก 1–2 วินาที ระบบจะเทียบหน้าใหม่เอง"],
};
export function CoverShield({ phone, reason }: { phone?: boolean; reason?: FaceReason }) {
  const [head, hint] = SHIELD_FACE[reason ?? "covered"];
  return (
    <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-6 mb-4 text-center" data-shield={phone ? "phone" : "face"} data-shield-reason={phone ? "phone" : reason ?? "covered"}>
      <div className="text-4xl mb-1">{phone ? "📱" : "📷"}</div>
      <p className="font-black text-rose-800">{phone ? "พบมือถือในกล้อง" : head}</p>
      <p className="text-sm font-bold text-rose-700 mt-1">{phone ? "เก็บมือถือเครื่องอื่นให้พ้นกล้อง" : hint} — โจทย์จะกลับมาเอง</p>
    </div>
  );
}
// ยกเลิกรอบครบกำหนดของวันนี้ → เริ่มรอบเข้าสมุดคะแนนไม่ได้ · ครูปลดล็อกด้วยรหัสห้อง
export function RoundCapPanel({ email, room, onLifted }: { email: string; room: string | null; onLifted: () => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 mb-4 text-left" data-round-cap="1">
      <p className="font-black text-rose-800">⛔ วันนี้ยกเลิกรอบครบ {ROUND_CAP} ครั้งแล้ว</p>
      <p className="text-xs font-bold text-rose-700 mt-1 leading-relaxed">
        (ออกกลางรอบ / รีเฟรชหรือปิดหน้าระหว่างรอบ / แบ่งจอ) จึงเริ่มรอบที่เข้าสมุดคะแนนอีกไม่ได้ในวันนี้ — พรุ่งนี้เริ่มใหม่ได้ · ฝึกเพิ่มและเรียนบทได้ตามปกติ
        <br />
        เหตุผลจำเป็น (เช่น เครื่องดับ เน็ตหลุด) <b>ยกมือเรียกครู</b> — ครูจะมาตรวจเครื่องและบอกรหัสปลดล็อกของห้อง
      </p>
      <div className="flex gap-2 mt-2">
        <input
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ""));
            setMsg("");
          }}
          placeholder="รหัสปลดล็อกจากครู 6 หลัก"
          aria-label="รหัสปลดล็อก"
          className="flex-1 min-w-0 border-2 border-rose-200 bg-white rounded-xl px-3 py-2 font-black tracking-widest text-center"
        />
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await syncClock();
            const r = liftCap(email, room, code);
            setBusy(false);
            if (r.result === "ok") onLifted();
            else setMsg(r.result === "noroom" ? "ไม่พบห้องของคุณ — ออกจากระบบแล้วกรอกชั้นเรียนใหม่ หรือแจ้งครู" : r.result === "locked" ? `กรอกผิดหลายครั้ง ล็อกไว้ ${Math.ceil((r.lockMs ?? 0) / 60000)} นาที` : `รหัสไม่ถูกต้องหรือหมดอายุ (เหลือ ${r.left ?? 0} ครั้งก่อนล็อก)`);
          }}
          className="shrink-0 px-4 py-2 bg-rose-700 text-white font-black rounded-xl disabled:opacity-50"
        >
          ปลดล็อก
        </button>
      </div>
      {msg && <p className="text-xs font-bold text-rose-700 mt-1" data-lift-msg="1">{msg}</p>}
    </div>
  );
}
// หน้าต่างแอปไม่เต็มจอ (แบ่งจอ / หน้าต่างลอย): ซ่อนโจทย์ ให้เวลาขยายคืน ไม่เช่นนั้นหยุดรอบ
export function SplitShield({ leftMs }: { leftMs: number }) {
  const sec = Math.ceil(leftMs / 1000);
  return (
    <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-6 mb-4 text-center" data-shield="split">
      <div className="text-4xl mb-1">📐</div>
      <p className="font-black text-rose-800">หน้าต่างแอปไม่เต็มจอ (แบ่งจอ / หน้าต่างลอย)</p>
      <p className="text-sm font-bold text-rose-700 mt-1">
        ปิดหน้าต่างอื่นแล้วขยายแอปให้เต็มจอ ภายใน <b className="tabular-nums" data-split-left={sec}>{sec}</b> วินาที — ไม่เช่นนั้นรอบนี้จะถูกหยุด (ไม่ได้คะแนน)
      </p>
    </div>
  );
}
// ข้อความแจ้งหลังถูกข้ามเพราะกล้อง
export const camSkipText = (kind: CoverKind, unit = "ข้อ") =>
  kind === "phone" ? `📱 พบมือถือในกล้อง — ${unit}ที่แล้วถูกข้าม (ไม่ได้คะแนน)` : `📷 ไม่เห็นใบหน้า หรือมีอะไรบังใบหน้า (จมูกขึ้นไป) — ${unit}ที่แล้วถูกข้าม (ไม่ได้คะแนน)`;
