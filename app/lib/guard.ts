// app/lib/guard.ts
// ─────────────────────────────────────────────────────────────
// ระบบกันการสลับไปถาม AI ระหว่างทำแบบฝึกที่เข้าสมุดคะแนน (รอบแรก)
//   - ออกจากหน้าแอป (สลับแอป/แท็บ/กลับหน้าโฮม/ล็อกจอ) ระหว่างข้อไหน → ข้อนั้น "ไม่นับคะแนนรอบแรก" (ช่วงหักคะแนน)
//   - หน้าเสียโฟกัสแต่ยังแสดงอยู่ (เช่น วงกลมค้นหา / หน้าต่างลอย) → บันทึกให้ครูเห็นเท่านั้น ไม่หักคะแนน
//   - ออกครบ GUARD_FLAG_AT ครั้ง → หน้าครูขึ้น 🚩 ให้ครูตัดสินเอง
//   - ช่วงทดลอง (ก่อน GUARD_ENFORCE_FROM): บันทึกอย่างเดียว ยังไม่หักคะแนน
//   - v8.5: หน้าต่างแอปไม่เต็มจอ (แบ่งจอ / หน้าต่างลอย บนมือถือ-แท็บเล็ต) → ซ่อนโจทย์ทันที ให้เวลา 10 วินาทีขยายคืน
//           เกินเวลา หรือเกิดครั้งที่ 2 ในรอบเดียว = หยุดรอบ (ยกเลิก ไม่ได้คะแนน · นับในโควตายกเลิกรอบต่อวัน)
//   - v8.5: ตรวจโฟกัสทุกวินาที (document.hasFocus) สะสมเวลาที่หน้าแอปไม่ได้เป็นหน้าที่ใช้งาน → บันทึกให้ครูอย่างเดียว ไม่หักคะแนน
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { serverToday } from "./sync";

export const GUARD_ENFORCE_FROM = "2026-11-16"; // เริ่มหักคะแนน (สัปดาห์ที่ 3 ของภาค) — ก่อนหน้านี้บันทึกอย่างเดียว
export const GUARD_FLAG_AT = 3;                  // ออกจากหน้ากี่ครั้งขึ้น 🚩
export type GuardMode = "log" | "enforce";
export const guardMode = (today: string = serverToday()): GuardMode => (today >= GUARD_ENFORCE_FROM ? "enforce" : "log");
// 9 พ.ย.: ครูให้ "กล้อง (บังหน้า / มือถือ) + จับเวลา (ไม่ใช้กล้อง) + เกณฑ์ 80%" ข้ามข้อตั้งแต่วันนี้ เหมือนแอป Grammar
//   ส่วนการออกจากหน้าแอป / หน้าต่างอื่นบัง ยังบันทึกอย่างเดียวถึง 15 พ.ย. แล้วเริ่มข้ามข้อ 16 พ.ย. (เหมือน Grammar)
export const CAM_ENFORCE_FROM = "2026-11-09";
export const camMode = (today: string = serverToday()): GuardMode => (today >= CAM_ENFORCE_FROM ? "enforce" : "log");

// ผลการเฝ้าดู 1 รอบ (เก็บคู่กับคะแนนรอบแรก)
export interface GuardStats {
  leaves: number;   // ออกจากหน้ากี่ครั้ง
  awayMs: number;   // เวลาที่หายไปรวม (ms)
  blurs: number;    // หน้าเสียโฟกัสแต่ยังแสดงอยู่กี่ครั้ง
  voided: number;   // ข้อที่ไม่นับคะแนน (ช่วงหักคะแนน)
  mode: GuardMode;
  splits?: number;  // v8.5: หน้าต่างไม่เต็มจอกี่ครั้ง
  splitMs?: number; //       รวมกี่ ms
  fm?: number;      //       เวลาที่หน้าแอปไม่ได้เป็นหน้าที่ใช้งาน (สะสม ms · บันทึกอย่างเดียว)
  fe?: number;      //       จำนวนช่วงที่เสียโฟกัส (นับรวมช่วงสั้น ๆ)
}

// ── หน้าต่างไม่เต็มจอ (แบ่งจอ / หน้าต่างลอย) ──
import { SPLIT_RATIO, SPLIT_HOLD_MS, SPLIT_GRACE_MS, SPLIT_STOP_AT, isSplitWindow, type WinMetrics } from "./splitWindow";
export { SPLIT_RATIO, SPLIT_HOLD_MS, SPLIT_GRACE_MS, SPLIT_STOP_AT, isSplitWindow };
export type { WinMetrics };
function readMetrics(): WinMetrics {
  const a = document.activeElement as HTMLElement | null;
  const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  let coarse = false;
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    /* ไม่เป็นไร */
  }
  return { iw: window.innerWidth, ih: window.innerHeight, sw: window.screen?.width ?? 0, sh: window.screen?.height ?? 0, coarse, typing };
}

export const COVER_MS = 3000; // หน้าเสียโฟกัสแต่ยังแสดงอยู่ (หน้าต่าง Gemini / วงกลมค้นหาบัง) นานเกินนี้ = นับเหมือนออกจากหน้า
export type LeaveKind = "leave" | "cover" | "split"; // leave = สลับแอป/แท็บ/หน้าโฮม · cover = มีหน้าต่างอื่นบังนานเกิน 3 วินาที · split = หน้าต่างแอปไม่เต็มจอ
export interface GuardNotice { n: number; key: string; kind: LeaveKind; skipped: boolean }

// ใช้ในหน้าทำข้อสอบ: active = กำลังทำรอบที่เข้าสมุดคะแนน · qKey = ข้อที่กำลังทำอยู่
// onLeft(key) = เรียกเมื่อตรวจพบ (จากเหตุการณ์ ไม่ใช่ระหว่างวาดหน้าจอ) → คืน true ถ้าหน้าจอข้ามข้อนั้นไปแล้ว
export interface GuardOpts {
  onSplit?: (n: number) => void;       // หน้าต่างไม่เต็มจอ ครั้งที่ n (เรียกจากตัวจับเวลา ไม่ใช่ระหว่างวาดหน้าจอ)
  onStop?: (why: "split") => void;     // ระบบสั่งหยุดรอบ (เรียกครั้งเดียวต่อรอบ)
}
export function useLeaveGuard(active: boolean, qKey: string | null, onLeft?: (key: string, kind: LeaveKind) => boolean, opts?: GuardOpts) {
  const [leaves, setLeaves] = useState(0);
  const [notice, setNotice] = useState<GuardNotice | null>(null);
  const [split, setSplit] = useState(false); // ตอนนี้หน้าต่างไม่เต็มจอ (ซ่อนโจทย์)
  const [splitLeft, setSplitLeft] = useState(SPLIT_GRACE_MS);
  const [stop, setStop] = useState<null | "split">(null); // ระบบสั่งหยุดรอบ
  const st = useRef(freshState());
  const leftKeys = useRef<Set<string>>(new Set());
  const keyRef = useRef<string | null>(qKey);
  const onLeftRef = useRef(onLeft);
  const optsRef = useRef(opts);
  useEffect(() => {
    keyRef.current = qKey;
    onLeftRef.current = onLeft;
    optsRef.current = opts;
  });

  const reset = useCallback(() => {
    st.current = freshState();
    leftKeys.current = new Set();
    setLeaves(0);
    setNotice(null);
    setSplit(false);
    setSplitLeft(SPLIT_GRACE_MS);
    setStop(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    let coverT: ReturnType<typeof setTimeout> | undefined;
    const record = (key: string, kind: LeaveKind) => {
      const s = st.current;
      s.leaves++;
      if (key) leftKeys.current.add(key);
      const skipped = key ? !!onLeftRef.current?.(key, kind) : false;
      setLeaves(s.leaves);
      setNotice({ n: s.leaves, key, kind, skipped });
    };
    const onVis = () => {
      const s = st.current;
      if (document.visibilityState === "hidden") {
        if (coverT) clearTimeout(coverT);
        // ถ้ากำลังนับว่า "ถูกบัง" อยู่แล้ว ไม่นับซ้ำ
        if (!s.covered) s.hiddenAt = Date.now();
        s.blurAt = 0;
      } else if (s.hiddenAt) {
        s.awayMs += Date.now() - s.hiddenAt;
        s.hiddenAt = 0;
        record(keyRef.current || "", "leave");
      }
    };
    const onBlur = () => {
      // เสียโฟกัสแต่หน้ายังแสดงอยู่ (ถ้าซ่อนหน้า visibilitychange จะนับแทน)
      setTimeout(() => {
        const s = st.current;
        if (document.visibilityState !== "visible" || document.hasFocus() || s.blurAt) return;
        s.blurAt = Date.now() - 300;
        s.blurKey = keyRef.current || "";
        if (coverT) clearTimeout(coverT);
        coverT = setTimeout(() => {
          if (st.current.blurAt && document.visibilityState === "visible" && !document.hasFocus()) {
            st.current.covered = true;
            record(st.current.blurKey, "cover"); // นานเกิน 3 วินาที → นับเหมือนออกจากหน้า (ข้ามข้อทันที)
          }
        }, COVER_MS - 300);
      }, 300);
    };
    const onFocus = () => {
      const s = st.current;
      if (coverT) clearTimeout(coverT);
      if (s.blurAt) {
        const dur = Date.now() - s.blurAt;
        if (s.covered) s.awayMs += dur;
        else if (dur > 1500) s.blurs++; // สั้น ๆ: บันทึกให้ครูเห็นเท่านั้น
        s.blurAt = 0;
      }
      s.covered = false;
    };
    const fireStop = () => {
      if (st.current.stopped) return;
      st.current.stopped = true;
      setStop("split");
      optsRef.current?.onStop?.("split");
    };
    // v8.5: ตรวจทุก 0.5 วินาที — (1) หน้าต่างไม่เต็มจอ (2) โฟกัสหาย (นับสะสม · บันทึกอย่างเดียว)
    const tick = () => {
      const s = st.current;
      const t = Date.now();
      if (isSplitWindow(readMetrics())) {
        if (!s.smallSince) s.smallSince = t;
        if (!s.splitAt && t - s.smallSince >= SPLIT_HOLD_MS) {
          s.splitAt = t;
          s.splits++;
          record(keyRef.current || "", "split"); // ข้อนี้ไม่นับ (ช่วงหักคะแนน) + นับเป็นการออกจากหน้า 1 ครั้ง
          setSplit(true);
          optsRef.current?.onSplit?.(s.splits);
          if (s.splits >= SPLIT_STOP_AT) fireStop();
        }
        if (s.splitAt) {
          const left = SPLIT_GRACE_MS - (t - s.splitAt);
          setSplitLeft(Math.max(0, left));
          if (left <= 0) fireStop();
        }
      } else {
        s.smallSince = 0;
        if (s.splitAt) {
          s.splitMs += t - s.splitAt;
          s.splitAt = 0;
          setSplit(false);
          setSplitLeft(SPLIT_GRACE_MS);
        }
      }
      if (document.visibilityState === "visible" && !document.hasFocus()) {
        if (!s.fAt) {
          s.fAt = t;
          s.fe++;
        }
      } else if (s.fAt) {
        s.fm += t - s.fAt;
        s.fAt = 0;
      }
    };
    const iv = setInterval(tick, 500);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("resize", tick);
    window.addEventListener("orientationchange", tick);
    return () => {
      if (coverT) clearTimeout(coverT);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("resize", tick);
      window.removeEventListener("orientationchange", tick);
    };
  }, [active]);

  // ข้อนี้เคยออกจากหน้าระหว่างทำหรือไม่
  const wasLeft = useCallback((key: string) => leftKeys.current.has(key), []);
  const stats = useCallback((voided: number, mode: GuardMode): GuardStats => {
    const s = st.current;
    const t = Date.now();
    return {
      leaves: s.leaves,
      awayMs: s.awayMs,
      blurs: s.blurs,
      voided,
      mode,
      splits: s.splits,
      splitMs: Math.round(s.splitMs + (s.splitAt ? t - s.splitAt : 0)),
      fm: Math.round(s.fm + (s.fAt ? t - s.fAt : 0)),
      fe: s.fe,
    };
  }, []);
  return { leaves, notice, clearNotice: () => setNotice(null), wasLeft, stats, reset, split, splitLeft, stop };
}
function freshState() {
  return { leaves: 0, awayMs: 0, blurs: 0, hiddenAt: 0, blurAt: 0, blurKey: "" as string, covered: false, smallSince: 0, splitAt: 0, splits: 0, splitMs: 0, fAt: 0, fm: 0, fe: 0, stopped: false };
}

// ข้อความเตือนเมื่อกลับมา
export function noticeText(nt: GuardNotice, mode: GuardMode, unit = "ข้อ"): string {
  const what = nt.kind === "split" ? "หน้าต่างแอปไม่เต็มจอ (แบ่งจอ / หน้าต่างลอย)" : nt.kind === "cover" ? "มีหน้าต่างอื่นบังหน้าแอปนานเกิน 3 วินาที" : "ออกจากหน้าแอป";
  const tail = mode === "enforce"
    ? (nt.skipped ? ` — ${unit}นี้ถูกข้าม (ไม่ได้คะแนน)` : ` — ${unit}นี้ไม่นับคะแนน`)
    : " — ช่วงทดลอง ระบบบันทึกให้ครูเห็น (ยังไม่หักคะแนน)";
  return `⚠️ ${what} ครั้งที่ ${nt.n}${tail}${nt.n >= GUARD_FLAG_AT ? " · ครูจะเห็น 🚩" : ""}`;
}

// กันคัดลอกข้อความโจทย์ / เมนูกดค้าง (ใส่ใน props ของกล่องโจทย์)
export const noCopyProps = {
  onCopy: (e: { preventDefault: () => void }) => e.preventDefault(),
  onCut: (e: { preventDefault: () => void }) => e.preventDefault(),
  onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  style: { WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" } as CSSProperties,
};

export const fmtAway = (ms?: number) => (!ms ? "0 วิ" : ms < 60000 ? `${Math.round(ms / 1000)} วิ` : `${Math.floor(ms / 60000)} นาที ${Math.round((ms % 60000) / 1000)} วิ`);

// ── เกณฑ์ผ่านตามการยินยอมใช้กล้อง (ช่วงหักคะแนน) ──
//   ใช้กล้อง = ถูก 80% ขึ้นไป · ไม่ใช้กล้อง / กล้องใช้ไม่ได้ = ต้องถูกครบทุกข้อ (ระบบกันสลับหน้าจอยังทำงาน)
//   ช่วงทดลอง (ก่อน GUARD_ENFORCE_FROM) และรอบฝึกหลังผ่านแล้ว = เกณฑ์เดิมของคอร์ส
export type CamMode = "cam" | "nocam" | "camfail";
export const CAM_PASS_RATIO = 0.8;
export function passNeed(total: number, o: { mode: GuardMode; guarded: boolean; cm?: CamMode; passMin?: number }): number {
  // 8 พ.ย.: ครูเลือกให้เกณฑ์เท่ากันทั้งสองแบบ (80%) — ไม่ใช้กล้องพิสูจน์ด้วยการจับเวลาต่อข้อ + ครูดูหน้าติดตามสด (นั่งที่เดิม) + สุ่มตรวจ
  if (o.mode === "enforce" && o.guarded) return Math.ceil(total * CAM_PASS_RATIO - 1e-9);
  return Math.min(total, o.passMin ?? total);
}

// ── จับเวลาต่อข้อ (รอบที่เข้าสมุดคะแนน · ไม่ใช้กล้อง) ──
//   9 พ.ย. (บ่าย): ครูให้ใช้กล้อง 100% และจับเวลาทุกคน ข้อละ 45 วินาที (เดิม: เฉพาะไม่ใช้กล้อง 20 วิ / ข้อยาว 25)
//   หมดเวลา = ข้ามข้อ · ปิดช่อง "อ่านโจทย์ให้ AI ในเครื่องอื่นที่อยู่นอกกล้องฟัง"
export const Q_TIME_MS = 45000;
export const Q_TIME_LONG_EXTRA = 0;
export const Q_LONG_CHARS = 120;
export const qTimeLimit = (text: string) => Q_TIME_MS + (text.replace(/\*\*|<[^>]+>/g, "").length > Q_LONG_CHARS ? Q_TIME_LONG_EXTRA : 0);

// นับถอยหลังของข้อปัจจุบัน · onTimeout เรียกครั้งเดียวต่อข้อ (จากตัวจับเวลา ไม่ใช่ระหว่างวาดหน้าจอ)
export function useQuestionTimer(active: boolean, key: string | null, limitMs: number, onTimeout: (key: string) => void) {
  const [st, setSt] = useState<{ key: string | null; left: number }>({ key: null, left: limitMs });
  const cb = useRef(onTimeout);
  useEffect(() => {
    cb.current = onTimeout;
  });
  useEffect(() => {
    if (!active || !key) return;
    const t0 = Date.now();
    let fired = false;
    const t = setInterval(() => {
      const l = Math.max(0, limitMs - (Date.now() - t0));
      setSt({ key, left: l });
      if (l <= 0 && !fired) {
        fired = true;
        clearInterval(t);
        cb.current(key);
      }
    }, 250);
    return () => clearInterval(t);
  }, [active, key, limitMs]);
  return st.key === key ? st.left : limitMs; // ข้อใหม่ยังไม่ถึงรอบนับแรก = เต็มเวลา
}
