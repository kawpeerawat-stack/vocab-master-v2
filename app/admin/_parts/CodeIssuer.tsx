"use client";
// app/admin/_parts/CodeIssuer.tsx — 🔑 ออกรหัสครูรายคน (v8.5)
//   • รหัส "กล้องใช้ไม่ได้" : นักเรียนเครื่องเปิดกล้องไม่ได้จริง → ครูเดินไปดูเครื่อง แล้วบอกรหัสของคนนั้น
//   • รหัส "ปลดล็อกรอบ"   : นักเรียนยกเลิกรอบครบกำหนดของวันนี้แต่มีเหตุจำเป็น (เครื่องดับ เน็ตหลุด)
//   ผูกกับนักเรียนคนนั้น · ใช้ได้ครั้งเดียว · หมดอายุใน 10–20 นาที → ส่งต่อให้เพื่อนในไลน์ไม่ได้
//   ⚠️ ใช้บนจอครูเท่านั้น (มีชื่อนักเรียน) · บอกรหัสด้วยปากต่อหน้านักเรียนคนนั้น อย่าพิมพ์ลงกลุ่มไลน์
import React, { useEffect, useMemo, useState } from "react";
import { serverNow, syncClock } from "../../lib/sync";
import { issueCode, type CodeKind } from "../../lib/teacherCode";
import { displayName, roomOf } from "../../lib/names";

type Doc = { id: string; name?: string; hidden?: boolean };
const KINDS: { kind: CodeKind; label: string; hint: string }[] = [
  { kind: "nocam", label: "กล้องใช้ไม่ได้", hint: "ทำรอบแบบจับเวลา ครูเห็น ⚠️ ในตาราง" },
  { kind: "lift", label: "ปลดล็อกรอบวันนี้", hint: "ให้เริ่มรอบนับคะแนนได้อีกในวันนี้" },
];

export function CodeIssuer({ docs }: { docs: Doc[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Doc | null>(null);
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!open) return;
    syncClock().then(() => setNow(serverNow()));
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return docs
      .filter((d) => !d.hidden)
      .filter((d) => `${displayName(d.name)} ${d.name ?? ""} ${d.id}`.toLowerCase().includes(t))
      .slice(0, 6);
  }, [docs, q]);

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-code-issuer>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="font-black text-gray-800">🔑 ออกรหัสให้นักเรียนรายคน</span>
        <span className="text-xs font-bold text-gray-500">กล้องใช้ไม่ได้ · ปลดล็อกรอบวันนี้</span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[11px] font-bold text-amber-700">⚠️ ดูบนจอครูเท่านั้น · บอกรหัสด้วยปากต่อหน้านักเรียนคนนั้น อย่าพิมพ์ลงกลุ่มไลน์ · รหัสใช้ได้ครั้งเดียวและหมดอายุใน 10–20 นาที</p>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPick(null);
            }}
            placeholder="พิมพ์ชื่อหรือส่วนของชื่อ (อย่างน้อย 2 ตัวอักษร)"
            aria-label="ค้นหานักเรียน"
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-bold"
          />
          {!pick && matches.length > 0 && (
            <ul className="grid gap-1">
              {matches.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setPick(d)} className="w-full text-left px-3 py-2 rounded-xl border border-gray-200 hover:border-[#003399]/50 text-sm font-bold" data-issuer-pick={d.id}>
                    {displayName(d.name)} <span className="text-xs text-gray-500">{roomOf(d.name) ? `ม.${roomOf(d.name)}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!pick && q.trim().length >= 2 && matches.length === 0 && <p className="text-xs text-gray-500">ไม่พบชื่อนี้</p>}
          {pick && (
            <div className="rounded-xl border-2 border-[#003399]/20 p-3 space-y-2" data-issuer-codes>
              <div className="text-sm font-black text-[#003399]">{displayName(pick.name)} {roomOf(pick.name) ? `· ม.${roomOf(pick.name)}` : ""}</div>
              {KINDS.map(({ kind, label, hint }) => {
                const c = issueCode(kind, pick.id, now);
                const min = Math.max(0, Math.floor(c.minMs / 60000));
                return (
                  <div key={kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs font-black text-gray-700 w-32">{label}</span>
                    <b className="tabular-nums tracking-widest text-xl text-gray-900" data-issuer-code={kind}>{c.code}</b>
                    <span className="text-[11px] font-bold text-gray-500">ใช้ได้อีกอย่างน้อย {min} นาที · {hint}</span>
                  </div>
                );
              })}
              <button type="button" onClick={() => setPick(null)} className="text-xs font-bold text-[#003399] underline">เลือกคนอื่น</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
