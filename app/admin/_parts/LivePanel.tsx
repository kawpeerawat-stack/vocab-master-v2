"use client";
// app/admin/_parts/LivePanel.tsx
// ─────────────────────────────────────────────────────────────
// 🔴 กำลังทำอยู่ตอนนี้ — ครูเห็นนักเรียนที่กำลังทำรอบเข้าสมุดคะแนนแบบสด (จากฟิลด์ students/{id}.live)
//   - ทำถึงข้อไหน · ใช้กล้อง/ไม่ใช้ · ออกจากหน้า ↗ · พบมือถือ 📱 · บังหน้า 📷 · หมดเวลา ⏱ · 📱✕ = เครื่องนี้ตรวจมือถือไม่ได้
//   - เหตุการณ์ใหม่ (15 วินาทีล่าสุด) → กรอบแดงกระพริบ · คนที่มีเหตุการณ์มากเรียงขึ้นบน
//   - ⚠️ ใช้บนจอครูเท่านั้น อย่าฉายขึ้นโปรเจกเตอร์ (มีชื่อนักเรียน)
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import type { LiveDoc } from "../../lib/live";
import { serverNow, syncClock } from "../../lib/sync";

export type LiveEntry = { id: string; name: string; no: number | null; room: string | null; live: LiveDoc };

const ACTIVE_MS = 20 * 60000; // เงียบเกินนี้ = ไม่แสดง
const DONE_KEEP_MS = 10 * 60000; // ส่งแล้วแสดงต่ออีก 10 นาที
const QUIET_MS = 2 * 60000; // ไม่มีความเคลื่อนไหวเกินนี้ = "เงียบ"
const FLASH_MS = 15000;

const CM_LABEL: Record<string, string> = { cam: "📷 กล้อง", nocam: "🚫 ไม่ใช้กล้อง", camfail: "🚫 กล้องใช้ไม่ได้" };
const EV_LABEL: Record<string, string> = { leave: "↗ ออกจากหน้า", face: "📷 บังหน้า", time: "⏱ หมดเวลา", phone: "📱 พบมือถือ", far: "📱 มือถือไกล ๆ (ไม่ข้ามข้อ · ดูว่าใครถือ)", split: "📐 แบ่งจอ / หน้าต่างไม่เต็มจอ" };
const events = (d: LiveDoc) => (d.lv || 0) + (d.cv || 0) + (d.to || 0) + (d.ph || 0); // lv รวมแบ่งจอแล้ว
const ago = (ms: number) => (ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))} วิ` : `${Math.floor(ms / 60000)} นาที`);

export function LivePanel({ entries }: { entries: LiveEntry[] }) {
  const [now, setNow] = useState(() => serverNow());
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // เวลาเดียวกับเครื่องนักเรียน (เวลาเซิร์ฟเวอร์) — นาฬิกาโน้ตบุ๊กครูคลาดก็ไม่เพี้ยน
    syncClock().then(() => setNow(serverNow()));
    const t = setInterval(() => setNow(serverNow()), 3000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => {
    const shown = entries.filter((e) => {
      const age = now - (e.live.at || 0);
      return e.live.done ? age < DONE_KEEP_MS : age < ACTIVE_MS;
    });
    // กำลังทำก่อน · เหตุการณ์มาก/ไม่ใช้กล้องขึ้นบน · ล่าสุดก่อน
    const rank = (e: LiveEntry) => (e.live.done ? 0 : 1000) + events(e.live) * 10 + (e.live.cm !== "cam" ? 3 : 0);
    return shown.sort((a, b) => rank(b) - rank(a) || (b.live.evAt || 0) - (a.live.evAt || 0) || (a.no ?? 99) - (b.no ?? 99));
  }, [entries, now]);

  const active = list.filter((e) => !e.live.done);
  const alerts = active.filter((e) => events(e.live) > 0).length;
  const noCam = active.filter((e) => e.live.cm !== "cam").length;

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-rose-200 shadow-sm" data-live-panel>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className="font-black text-rose-700">
          <span className={active.length ? "inline-block w-2.5 h-2.5 rounded-full bg-rose-600 mr-1.5 animate-pulse align-middle" : "inline-block w-2.5 h-2.5 rounded-full bg-gray-300 mr-1.5 align-middle"} />
          กำลังทำอยู่ตอนนี้
        </span>
        <span className="text-sm font-bold text-gray-700 tabular-nums">{active.length} คน</span>
        {alerts > 0 && <span className="text-sm font-black text-rose-700 tabular-nums">มีเหตุการณ์ {alerts} คน</span>}
        {noCam > 0 && <span className="text-sm font-bold text-gray-600 tabular-nums">ไม่ใช้กล้อง {noCam} คน</span>}
        <span className="ml-auto text-xs font-bold text-gray-500" data-nocam-today title="รหัสกล้องใช้ไม่ได้เป็นรายคนแล้ว (v8.5) — ดูที่กล่อง 🔑 ออกรหัสให้นักเรียนรายคน ด้านล่าง">🔑 รหัสครู: ดูที่กล่องด้านล่าง</span>
        <span className="text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-[11px] font-bold text-amber-700 mb-3">⚠️ ดูบนจอครูเท่านั้น อย่าฉายขึ้นจอ · แสดงเฉพาะรอบที่เข้าสมุดคะแนน · อัปเดตตอนเริ่ม ทุกครั้งที่มีเหตุการณ์ และทุก 3 ข้อ</p>
          {list.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่มีนักเรียนทำรอบที่เข้าสมุดคะแนนในตอนนี้ (ห้องที่เลือก)</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((e) => {
                const d = e.live;
                const flash = !d.done && d.ev && now - (d.evAt || 0) < FLASH_MS;
                const quiet = !d.done && now - (d.at || 0) > QUIET_MS;
                const ev = events(d);
                const pctDone = d.tot ? Math.round((Math.min(d.q, d.tot) / d.tot) * 100) : 0;
                const tone = flash
                  ? "border-rose-500 bg-rose-50 ring-2 ring-rose-400 animate-pulse"
                  : d.done
                  ? "border-gray-100 bg-gray-50 opacity-70"
                  : ev > 0
                  ? "border-rose-300 bg-rose-50/50"
                  : d.cm !== "cam"
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-gray-200 bg-white";
                return (
                  <div key={e.id} className={`rounded-xl border-2 p-3 min-w-0 ${tone}`} data-live-row={e.id}>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-xs font-black text-[#003399] shrink-0 tabular-nums">{e.room ? `ม.${e.room}` : "?"}{e.no ? ` · ${e.no}` : ""}</span>
                      <span className="font-black text-sm text-gray-900 truncate">{e.name}</span>
                      <span className="ml-auto text-[11px] font-bold text-gray-500 shrink-0">{d.t}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full ${d.done ? "bg-emerald-500" : "bg-[#003399]"}`} style={{ width: `${pctDone}%` }} />
                      </div>
                      <span className="text-xs font-black tabular-nums text-gray-700 shrink-0">{Math.min(d.q, d.tot)}/{d.tot}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-xs font-bold">
                      <span className={d.cm === "cam" ? "text-gray-600" : "text-amber-700"}>{CM_LABEL[d.cm] ?? d.cm}</span>
                      {d.lv > 0 && <span className="text-rose-700 tabular-nums">↗{d.lv}</span>}
                      {(d.sp || 0) > 0 && <span className="text-rose-700 tabular-nums" title="หน้าต่างแอปไม่เต็มจอ (แบ่งจอ / หน้าต่างลอย)">📐{d.sp}</span>}
                      {(d.ab || 0) > 0 && <span className="text-amber-700 tabular-nums" title="วันนี้ยกเลิกรอบมาแล้วกี่ครั้ง (ออกกลางรอบ / รีเฟรช / แบ่งจอ)">ยกเลิกวันนี้ {d.ab}</span>}
                      {(d.ph || 0) > 0 && <span className="text-rose-700 tabular-nums">📱{d.ph}</span>}
                      {(d.pf || 0) > 0 && <span className="text-amber-700 tabular-nums" title="มือถือเล็ก ๆ ไกล ๆ ในกล้อง (ไม่ข้ามข้อ)">📱ไกล{d.pf}</span>}
                      {d.cv > 0 && <span className="text-rose-700 tabular-nums">📷{d.cv}</span>}
                      {d.cm === "cam" && d.pd && d.pd !== "ready" && <span className="text-amber-700" title="เครื่องนี้ตรวจมือถือไม่ได้ (ยังจับบังหน้าได้)">📱✕</span>}
                      {d.to > 0 && <span className="text-rose-700 tabular-nums">⏱{d.to}</span>}
                      <span className="ml-auto text-gray-500">
                        {d.done
                          ? d.quit
                            ? "ออกกลางคัน"
                            : `ส่งแล้ว ${d.sc ?? "-"}/${d.tot}`
                          : quiet
                          ? `เงียบ ${ago(now - d.at)}`
                          : d.q >= d.tot
                          ? "ทวนข้อที่ผิด"
                          : "กำลังทำ"}
                      </span>
                    </div>
                    {flash && d.ev && <p className="text-xs font-black text-rose-700 mt-1">ล่าสุด: {EV_LABEL[d.ev]} · {ago(now - d.evAt)}ที่แล้ว</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
