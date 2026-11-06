// app/lib/guard.ts
// ─────────────────────────────────────────────────────────────
// ระบบกันการสลับไปถาม AI ระหว่างทำแบบฝึกที่เข้าสมุดคะแนน (รอบแรก)
//   - ออกจากหน้าแอป (สลับแอป/แท็บ/กลับหน้าโฮม/ล็อกจอ) ระหว่างข้อไหน → ข้อนั้น "ไม่นับคะแนนรอบแรก" (ช่วงหักคะแนน)
//   - หน้าเสียโฟกัสแต่ยังแสดงอยู่ (เช่น วงกลมค้นหา / หน้าต่างลอย) → บันทึกให้ครูเห็นเท่านั้น ไม่หักคะแนน
//   - ออกครบ GUARD_FLAG_AT ครั้ง → หน้าครูขึ้น 🚩 ให้ครูตัดสินเอง
//   - ช่วงทดลอง (ก่อน GUARD_ENFORCE_FROM): บันทึกอย่างเดียว ยังไม่หักคะแนน
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { serverToday } from "./sync";

export const GUARD_ENFORCE_FROM = "2026-11-16"; // เริ่มหักคะแนน (สัปดาห์ที่ 3 ของภาค) — ก่อนหน้านี้บันทึกอย่างเดียว
export const GUARD_FLAG_AT = 3;                  // ออกจากหน้ากี่ครั้งขึ้น 🚩
export type GuardMode = "log" | "enforce";
export const guardMode = (today: string = serverToday()): GuardMode => (today >= GUARD_ENFORCE_FROM ? "enforce" : "log");

// ผลการเฝ้าดู 1 รอบ (เก็บคู่กับคะแนนรอบแรก)
export interface GuardStats {
  leaves: number;   // ออกจากหน้ากี่ครั้ง
  awayMs: number;   // เวลาที่หายไปรวม (ms)
  blurs: number;    // หน้าเสียโฟกัสแต่ยังแสดงอยู่กี่ครั้ง
  voided: number;   // ข้อที่ไม่นับคะแนน (ช่วงหักคะแนน)
  mode: GuardMode;
}

export const COVER_MS = 3000; // หน้าเสียโฟกัสแต่ยังแสดงอยู่ (หน้าต่าง Gemini / วงกลมค้นหาบัง) นานเกินนี้ = นับเหมือนออกจากหน้า
export type LeaveKind = "leave" | "cover"; // leave = สลับแอป/แท็บ/หน้าโฮม · cover = มีหน้าต่างอื่นบังนานเกิน 3 วินาที
export interface GuardNotice { n: number; key: string; kind: LeaveKind; skipped: boolean }

// ใช้ในหน้าทำข้อสอบ: active = กำลังทำรอบที่เข้าสมุดคะแนน · qKey = ข้อที่กำลังทำอยู่
// onLeft(key) = เรียกเมื่อตรวจพบ (จากเหตุการณ์ ไม่ใช่ระหว่างวาดหน้าจอ) → คืน true ถ้าหน้าจอข้ามข้อนั้นไปแล้ว
export function useLeaveGuard(active: boolean, qKey: string | null, onLeft?: (key: string, kind: LeaveKind) => boolean) {
  const [leaves, setLeaves] = useState(0);
  const [notice, setNotice] = useState<GuardNotice | null>(null);
  const st = useRef({ leaves: 0, awayMs: 0, blurs: 0, hiddenAt: 0, blurAt: 0, blurKey: "" as string, covered: false });
  const leftKeys = useRef<Set<string>>(new Set());
  const keyRef = useRef<string | null>(qKey);
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    keyRef.current = qKey;
    onLeftRef.current = onLeft;
  });

  const reset = useCallback(() => {
    st.current = { leaves: 0, awayMs: 0, blurs: 0, hiddenAt: 0, blurAt: 0, blurKey: "", covered: false };
    leftKeys.current = new Set();
    setLeaves(0);
    setNotice(null);
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
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      if (coverT) clearTimeout(coverT);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [active]);

  // ข้อนี้เคยออกจากหน้าระหว่างทำหรือไม่
  const wasLeft = useCallback((key: string) => leftKeys.current.has(key), []);
  const stats = useCallback((voided: number, mode: GuardMode): GuardStats => {
    const s = st.current;
    return { leaves: s.leaves, awayMs: s.awayMs, blurs: s.blurs, voided, mode };
  }, []);
  return { leaves, notice, clearNotice: () => setNotice(null), wasLeft, stats, reset };
}

// ข้อความเตือนเมื่อกลับมา
export function noticeText(nt: GuardNotice, mode: GuardMode, unit = "ข้อ"): string {
  const what = nt.kind === "cover" ? "มีหน้าต่างอื่นบังหน้าแอปนานเกิน 3 วินาที" : "ออกจากหน้าแอป";
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
