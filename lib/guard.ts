// lib/guard.ts
// ─────────────────────────────────────────────────────────────
// ระบบกันการใช้ AI ระหว่างทำแบบฝึก (ยกมาจาก Vocab Master ให้กติกาเหมือนกันทั้ง 2 แอป)
//   - ออกจากหน้าแอป (สลับแอป/แท็บ/กลับหน้าโฮม/ล็อกจอ) ระหว่างข้อที่ยังไม่ตอบ → ข้อนั้นไม่ได้คะแนน
//   - หน้าต่างอื่นบังหน้าแอปนานเกิน 3 วินาที (เช่น Gemini / วงกลมค้นหา) → นับเหมือนออกจากหน้า
//   - เสียโฟกัสสั้น ๆ → บันทึกให้ครูเห็นเท่านั้น ไม่หักคะแนน
//   - ออกครบ GUARD_FLAG_AT ครั้งในรอบเดียว → หน้าครูขึ้น 🚩
//   - ช่วงทดลอง (ก่อน GUARD_ENFORCE_FROM): บันทึกอย่างเดียว ยังไม่หักคะแนน
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

export const GUARD_ENFORCE_FROM = "2026-11-16"; // วันเริ่มหักคะแนน (ตรงกับ Vocab Master)
export const GUARD_FLAG_AT = 3;                  // ออก/บัง/ไม่เห็นหน้า กี่ครั้งต่อรอบ → 🚩
export type GuardMode = "log" | "enforce";

// วันที่ตามเวลาประเทศไทย (YYYY-MM-DD)
export const thaiToday = (): string =>
  new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export const guardMode = (today: string = thaiToday()): GuardMode => (today >= GUARD_ENFORCE_FROM ? "enforce" : "log");

// ผลการเฝ้าดู 1 รอบ (เก็บคู่กับคะแนน)
export interface GuardStats {
  gl: number;   // ออกจากหน้า / หน้าต่างบัง กี่ครั้ง
  ga: number;   // เวลาที่หายไปรวม (ms)
  gb: number;   // เสียโฟกัสสั้น ๆ กี่ครั้ง (ไม่หักคะแนน)
  gf: number;   // กล้องไม่เห็นใบหน้า / มีวัตถุบังหน้า เกิน 0.8 วิ กี่ครั้ง (ข้ามข้อ ได้ 0)
  gp?: number;  // กล้องเห็นมือถืออีกเครื่อง กี่ครั้ง (ข้ามข้อ ได้ 0)
  gw?: number;  // ไม่เห็นใบหน้า 2–5 วิ กี่ครั้ง (บันทึกให้ครูเห็นอย่างเดียว)
  gv: number;   // ข้อที่ไม่ได้คะแนนเพราะเหตุข้างบน (ช่วงหักคะแนน)
  cam: boolean; // เปิดกล้องตรวจใบหน้าระหว่างรอบนี้หรือไม่
  gm: GuardMode;
}

export const COVER_MS = 3000;
export type LeaveKind = "leave" | "cover" | "face" | "phone";
export interface GuardNotice { n: number; kind: LeaveKind; penalized: boolean }

// active = กำลังทำแบบฝึก · watching = ข้อปัจจุบันยังไม่ตอบ (ออกตอนดูเฉลยไม่นับ)
// onLeft(kind) = เรียกเมื่อตรวจพบ → คืน true ถ้าข้อนั้นถูกตัดคะแนน
export function useLeaveGuard(active: boolean, watching: boolean, onLeft?: (kind: LeaveKind) => boolean) {
  const [notice, setNotice] = useState<GuardNotice | null>(null);
  const st = useRef({ gl: 0, ga: 0, gb: 0, gf: 0, gp: 0, gw: 0, hiddenAt: 0, blurAt: 0, blurWatching: false, covered: false });
  const watchRef = useRef(watching);
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    watchRef.current = watching;
    onLeftRef.current = onLeft;
  });

  const reset = useCallback(() => {
    st.current = { gl: 0, ga: 0, gb: 0, gf: 0, gp: 0, gw: 0, hiddenAt: 0, blurAt: 0, blurWatching: false, covered: false };
    setNotice(null);
  }, []);

  // บันทึกเหตุการณ์ 1 ครั้ง (ใช้กับกล้องด้วย)
  const record = useCallback((kind: LeaveKind, wasWatching: boolean) => {
    const s = st.current;
    if (kind === "face") s.gf++; else if (kind === "phone") s.gp++; else s.gl++;
    const penalized = wasWatching ? !!onLeftRef.current?.(kind) : false;
    setNotice({ n: s.gl + s.gf + s.gp, kind, penalized });
  }, []);

  // ไม่เห็นใบหน้าช่วงสั้น (2–5 วิ) → นับไว้ให้ครูเห็นเท่านั้น ไม่ขึ้นคำเตือน ไม่ตัดข้อ
  const recordGlance = useCallback(() => { st.current.gw++; }, []);

  useEffect(() => {
    if (!active) return;
    let coverT: ReturnType<typeof setTimeout> | undefined;
    let hiddenWatching = false;
    const onVis = () => {
      const s = st.current;
      if (document.visibilityState === "hidden") {
        if (coverT) clearTimeout(coverT);
        if (!s.covered) { s.hiddenAt = Date.now(); hiddenWatching = watchRef.current; }
        s.blurAt = 0;
      } else if (s.hiddenAt) {
        s.ga += Date.now() - s.hiddenAt;
        s.hiddenAt = 0;
        record("leave", hiddenWatching);
      }
    };
    const onBlur = () => {
      setTimeout(() => {
        const s = st.current;
        if (document.visibilityState !== "visible" || document.hasFocus() || s.blurAt) return;
        s.blurAt = Date.now() - 300;
        s.blurWatching = watchRef.current;
        if (coverT) clearTimeout(coverT);
        coverT = setTimeout(() => {
          if (st.current.blurAt && document.visibilityState === "visible" && !document.hasFocus()) {
            st.current.covered = true;
            record("cover", st.current.blurWatching);
          }
        }, COVER_MS - 300);
      }, 300);
    };
    const onFocus = () => {
      const s = st.current;
      if (coverT) clearTimeout(coverT);
      if (s.blurAt) {
        const dur = Date.now() - s.blurAt;
        if (s.covered) s.ga += dur;
        else if (dur > 1500) s.gb++;
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
  }, [active, record]);

  const stats = useCallback((gv: number, cam: boolean, gm: GuardMode): GuardStats => {
    const s = st.current;
    return { gl: s.gl, ga: s.ga, gb: s.gb, gf: s.gf, gp: s.gp, gw: s.gw, gv, cam, gm };
  }, []);
  return { notice, clearNotice: () => setNotice(null), record, recordGlance, stats, reset };
}

export function noticeText(nt: GuardNotice, mode: GuardMode): string {
  const what = nt.kind === "face" ? "กล้องไม่เห็นใบหน้า / มีวัตถุบังหน้า"
    : nt.kind === "cover" ? "มีหน้าต่างอื่นบังหน้าแอปนานเกิน 3 วินาที" : "ออกจากหน้าแอป";
  if (nt.kind === "phone")
    return `📱 กล้องเห็นมือถืออีกเครื่อง ครั้งที่ ${nt.n} — ข้อที่แล้วถูกข้าม (ได้ 0)${nt.n >= GUARD_FLAG_AT ? " · ครูจะเห็น 🚩" : ""}`;
  if (nt.kind === "face") // กล้อง: ข้ามข้อทันทีทุกช่วง (ไม่หักคะแนนเพิ่ม)
    return `📷 ไม่เห็นใบหน้า / มีวัตถุบังหน้าเกิน 0.8 วินาที ครั้งที่ ${nt.n} — ข้อที่แล้วถูกข้าม (ได้ 0)${nt.n >= GUARD_FLAG_AT ? " · ครูจะเห็น 🚩" : ""}`;
  const tail = mode === "enforce"
    ? (nt.penalized ? " — ข้อนี้ไม่ได้คะแนน" : "")
    : " — ช่วงทดลอง ระบบบันทึกให้ครูเห็น (ยังไม่หักคะแนน)";
  return `⚠️ ${what} ครั้งที่ ${nt.n}${tail}${nt.n >= GUARD_FLAG_AT ? " · ครูจะเห็น 🚩" : ""}`;
}

// กันคัดลอกข้อความโจทย์ / เมนูกดค้าง
export const noCopyProps = {
  onCopy: (e: { preventDefault: () => void }) => e.preventDefault(),
  onCut: (e: { preventDefault: () => void }) => e.preventDefault(),
  onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  style: { WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" } as CSSProperties,
};

export const fmtAway = (ms?: number) => (!ms ? "0 วิ" : ms < 60000 ? `${Math.round(ms / 1000)} วิ` : `${Math.floor(ms / 60000)} นาที ${Math.round((ms % 60000) / 1000)} วิ`);
