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

// ใช้ในหน้าทำข้อสอบ: active = กำลังทำรอบที่เข้าสมุดคะแนน · qKey = ข้อที่กำลังทำอยู่
export function useLeaveGuard(active: boolean, qKey: string | null) {
  const [leaves, setLeaves] = useState(0);
  const [notice, setNotice] = useState<{ n: number; key: string } | null>(null);
  const st = useRef({ leaves: 0, awayMs: 0, blurs: 0, hiddenAt: 0, blurAt: 0 });
  const leftKeys = useRef<Set<string>>(new Set());
  const keyRef = useRef<string | null>(qKey);
  useEffect(() => {
    keyRef.current = qKey;
  }, [qKey]);

  const reset = useCallback(() => {
    st.current = { leaves: 0, awayMs: 0, blurs: 0, hiddenAt: 0, blurAt: 0 };
    leftKeys.current = new Set();
    setLeaves(0);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onVis = () => {
      const s = st.current;
      if (document.visibilityState === "hidden") {
        s.hiddenAt = Date.now();
      } else if (s.hiddenAt) {
        s.awayMs += Date.now() - s.hiddenAt;
        s.hiddenAt = 0;
        s.leaves++;
        if (keyRef.current) leftKeys.current.add(keyRef.current);
        setLeaves(s.leaves);
        setNotice({ n: s.leaves, key: keyRef.current || "" });
      }
    };
    const onBlur = () => {
      // เสียโฟกัสแต่หน้ายังแสดงอยู่ (ถ้าซ่อนหน้า visibilitychange จะนับแทน)
      setTimeout(() => {
        if (document.visibilityState === "visible" && !document.hasFocus()) st.current.blurAt = Date.now();
      }, 300);
    };
    const onFocus = () => {
      const s = st.current;
      if (s.blurAt) {
        if (Date.now() - s.blurAt > 1500) s.blurs++;
        s.blurAt = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
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

// กันคัดลอกข้อความโจทย์ / เมนูกดค้าง (ใส่ใน props ของกล่องโจทย์)
export const noCopyProps = {
  onCopy: (e: { preventDefault: () => void }) => e.preventDefault(),
  onCut: (e: { preventDefault: () => void }) => e.preventDefault(),
  onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  style: { WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" } as CSSProperties,
};

export const fmtAway = (ms?: number) => (!ms ? "0 วิ" : ms < 60000 ? `${Math.round(ms / 1000)} วิ` : `${Math.floor(ms / 60000)} นาที ${Math.round((ms % 60000) / 1000)} วิ`);
