"use client";
// app/admin/_parts/StudentManager.tsx
// ─────────────────────────────────────────────────────────────
// 🗑 จัดการรายชื่อในแดชบอร์ด (11 พ.ย. · ครูขอ): ซ่อนชื่อที่ไม่เกี่ยวข้อง (เช่น ชื่อปลอมที่ครูลองเข้าไปทำ) ให้หน้าสะอาด
//   - "ซ่อน" = ติดธงใน students/{id}.hidden — ไม่ลบข้อมูลจริง กู้คืนได้ · ซ่อนแล้วไม่อยู่ในตาราง สรุป อันดับ และแผงสด
//   - ธงอยู่ในเอกสารเดิม เครื่องของชื่อนั้นส่งข้อมูลมาอีกก็ไม่โผล่กลับมา (ลบจริงจะโผล่กลับมาได้)
//   - ตัวกรอง: ไม่อยู่ในรายชื่อ · ชื่อไม่ตรงรายชื่อ ⚠️ · ทั้งหมด · ซ่อนไว้แล้ว — เลือกหลายคนพร้อมกันได้
//   - ชื่อที่ตรงรายชื่อของครูทุกตัวอักษร (นักเรียนตัวจริง) ต้องกดยืนยันอีกชั้นก่อนซ่อน
//   - ใช้ได้ทั้งโรงเรียน (/admin) และห้องเรียนพิเศษ (/admin/extraclass)
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { displayName, fmtThaiTime, matchRoster, normName } from "../../lib/roster";
import { realEmail, setHidden } from "../../lib/extra";

export type ManagedDoc = {
  id: string;
  name?: string;
  email?: string;
  hidden?: boolean;
  hiddenAt?: number;
  courseActiveAt?: number;
  v300At?: number;
  updatedAt?: number;
  live?: { at?: number };
  courses?: Record<string, Record<string, { passed?: boolean }>>;
  v300?: { sets?: Record<string, unknown>; cards?: Record<string, unknown> };
} & Record<string, unknown>;

type Filter = "outside" | "mismatch" | "all" | "hidden";

export function StudentManager({ docs, roster = true, label = "นักเรียนโรงเรียน" }: { docs: ManagedDoc[]; roster?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>(roster ? "outside" : "all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, true>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const items = useMemo(
    () =>
      docs.map((d) => {
        const hit = roster ? matchRoster(d.name) : null;
        const exact = !!hit && normName(hit.name) === normName(d.name);
        const passedLessons = Object.values(d.courses || {}).reduce((n, c) => n + Object.values(c || {}).filter((x) => x?.passed).length, 0);
        const sets = Object.keys(d.v300?.sets || {}).length;
        const at = Math.max(d.courseActiveAt || 0, d.v300At || 0, d.live?.at || 0, d.updatedAt || 0);
        return { d, hit, exact, mismatch: !!hit && !exact, outside: !hit, passedLessons, sets, at };
      }),
    [docs, roster]
  );
  const counts = {
    outside: items.filter((x) => !x.d.hidden && x.outside).length,
    mismatch: items.filter((x) => !x.d.hidden && x.mismatch).length,
    all: items.filter((x) => !x.d.hidden).length,
    hidden: items.filter((x) => x.d.hidden).length,
  };
  const list = items
    .filter((x) => (filter === "hidden" ? !!x.d.hidden : !x.d.hidden && (filter === "all" || (filter === "outside" ? x.outside : x.mismatch))))
    .filter((x) => {
      const t = q.trim().toLowerCase();
      return !t || `${x.d.name || ""} ${x.d.email || ""} ${x.d.id}`.toLowerCase().includes(t);
    })
    .sort((a, b) => b.at - a.at);
  const picked = list.filter((x) => sel[x.d.id]);
  const pickedReal = picked.filter((x) => x.exact).length;

  const toggle = (id: string) => setSel((s) => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const allOn = list.length > 0 && list.every((x) => sel[x.d.id]);
  const toggleAll = () => setSel(allOn ? {} : Object.fromEntries(list.map((x) => [x.d.id, true as const])));

  const apply = async () => {
    const hide = filter !== "hidden";
    if (hide && pickedReal > 0 && !confirm) return setConfirm(true);
    setBusy(true);
    const ok = await setHidden(picked.map((x) => x.d.id), hide);
    setBusy(false);
    setConfirm(false);
    if (ok) {
      setMsg(hide ? `ซ่อนแล้ว ${picked.length} รายการ — กู้คืนได้ที่แท็บ “ซ่อนไว้แล้ว”` : `กู้คืนแล้ว ${picked.length} รายการ`);
      setSel({});
    } else setMsg("บันทึกไม่สำเร็จ (อินเทอร์เน็ตหรือสิทธิ์ของ Firebase) — ลองใหม่อีกครั้ง");
  };

  const tabs: { k: Filter; t: string; n: number }[] = [
    ...(roster ? ([{ k: "outside", t: "ไม่อยู่ในรายชื่อ", n: counts.outside }, { k: "mismatch", t: "ชื่อไม่ตรงรายชื่อ ⚠️", n: counts.mismatch }] as { k: Filter; t: string; n: number }[]) : []),
    { k: "all", t: "ทั้งหมด", n: counts.all },
    { k: "hidden", t: "ซ่อนไว้แล้ว", n: counts.hidden },
  ];

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-student-manager>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className="font-black text-gray-800">🗑 จัดการรายชื่อ{label ? ` · ${label}` : ""}</span>
        <span className="text-xs font-bold text-gray-500">ซ่อนชื่อที่ไม่เกี่ยวข้องให้แดชบอร์ดสะอาด{roster ? ` · ไม่อยู่ในรายชื่อ ${counts.outside}` : ""}{counts.hidden ? ` · ซ่อนอยู่ ${counts.hidden}` : ""}</span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-[11px] font-bold text-gray-500 mb-3">ซ่อน = ไม่ลบข้อมูลจริง กู้คืนได้ · ซ่อนแล้วไม่ถูกนับในตาราง สรุป อันดับ และแผง 🔴 กำลังทำอยู่</p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {tabs.map((t) => (
              <button key={t.k} type="button" onClick={() => { setFilter(t.k); setSel({}); setConfirm(false); setMsg(""); }} data-sm-tab={t.k}
                className={`px-3 py-1.5 rounded-xl text-xs font-black border-2 ${filter === t.k ? "bg-[#003399] text-[#FFD700] border-[#003399]" : "bg-white text-[#003399] border-[#003399]/15"}`}>
                {t.t} {t.n}
              </button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / อีเมล" className="ml-auto w-full sm:w-52 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-[#003399]" />
          </div>

          {list.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">{filter === "hidden" ? "ยังไม่มีรายชื่อที่ซ่อนไว้" : "ไม่มีรายการในมุมมองนี้"}</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-[11px] text-gray-500">
                  <tr>
                    <th className="px-2 py-2 w-8"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="เลือกทั้งหมดในรายการ" data-sm-all /></th>
                    <th className="text-left px-2 py-2">ชื่อที่ระบบเห็น</th>
                    <th className="text-left px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2">ผ่าน</th>
                    <th className="text-left px-2 py-2">ใช้งานล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((x) => (
                    <tr key={x.d.id} className={`border-t border-gray-50 ${sel[x.d.id] ? "bg-amber-50" : ""}`} data-sm-row={x.d.id}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={!!sel[x.d.id]} onChange={() => toggle(x.d.id)} aria-label={`เลือก ${x.d.name || x.d.id}`} /></td>
                      <td className="px-2 py-1.5 min-w-0">
                        <div className="font-bold text-gray-900 truncate max-w-[260px]">{displayName(x.d.name) || x.d.name || "(ไม่มีชื่อ)"}</div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[260px]">{realEmail(x.d.email || x.d.id)}</div>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] font-black whitespace-nowrap">
                        {!roster ? <span className="text-gray-400">–</span> : x.exact ? <span className="text-emerald-700">ในรายชื่อ ✓ (ตรงทุกตัวอักษร)</span> : x.mismatch ? <span className="text-amber-700">⚠️ ตรงกับ “{displayName(x.hit!.name)}” ({x.hit!.room} #{x.hit!.no}) แต่พิมพ์ไม่ตรง</span> : <span className="text-rose-700">ไม่อยู่ในรายชื่อ</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center text-xs tabular-nums text-gray-600">{x.sets ? `📚${x.sets}` : ""}{x.sets && x.passedLessons ? " · " : ""}{x.passedLessons ? `🧩${x.passedLessons}` : ""}{!x.sets && !x.passedLessons ? "–" : ""}</td>
                      <td className="px-2 py-1.5 text-[11px] text-gray-500 whitespace-nowrap">{x.at ? fmtThaiTime(x.at) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" onClick={apply} disabled={!picked.length || busy} data-sm-apply
              className={`px-4 py-2 rounded-xl font-black text-sm disabled:opacity-40 ${filter === "hidden" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
              {busy ? "กำลังบันทึก…" : filter === "hidden" ? `↩ กู้คืนที่เลือก (${picked.length})` : `🗑 ซ่อนที่เลือก (${picked.length})`}
            </button>
            {confirm && filter !== "hidden" && (
              <span className="flex items-center gap-2 text-xs font-bold text-rose-700 bg-rose-50 rounded-xl px-3 py-2" data-sm-confirm>
                ⚠️ ในที่เลือกมีนักเรียนตัวจริงที่ตรงรายชื่อ {pickedReal} คน — ซ่อนจริงหรือไม่?
                <button type="button" onClick={apply} className="px-2 py-1 bg-rose-600 text-white rounded-lg">ซ่อนเลย</button>
                <button type="button" onClick={() => setConfirm(false)} className="px-2 py-1 bg-white border border-gray-300 text-gray-600 rounded-lg">ยกเลิก</button>
              </span>
            )}
            {msg && <span className="text-xs font-bold text-gray-600" data-sm-msg>{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
