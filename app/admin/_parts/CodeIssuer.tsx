"use client";
// app/admin/_parts/CodeIssuer.tsx — 🔑 รหัสครูของห้อง (v8.6: ห้องละ 1 รหัสต่อคาบ)
//   • รหัส "กล้องใช้ไม่ได้" : นักเรียนเครื่องเปิดกล้องไม่ได้จริง → ครูเดินไปดูเครื่อง แล้วบอกรหัสของห้อง
//   • รหัส "ปลดล็อกรอบ"   : นักเรียนยกเลิกรอบครบกำหนดของวันนี้แต่มีเหตุจำเป็น (เครื่องดับ เน็ตหลุด)
//   ผูกกับห้อง · เปลี่ยนทุก 30 นาที (ใช้ได้ 30–60 นาที) · ห้องอื่นใช้ไม่ได้
//   ⚠️ บอกรหัสด้วยปากเฉพาะเครื่องที่ครูไปตรวจแล้ว อย่าประกาศทั้งห้องหรือพิมพ์ลงกลุ่มไลน์ — รหัสห้องส่งต่อให้เพื่อนในห้องเดียวกันได้ภายในช่วงเวลานั้น
import React, { useEffect, useState } from "react";
import { serverNow, syncClock } from "../../lib/sync";
import { issueCode, type CodeKind } from "../../lib/teacherCode";
import { GRADES } from "../../lib/names";

const KINDS: { kind: CodeKind; label: string; hint: string }[] = [
  { kind: "nocam", label: "กล้องใช้ไม่ได้", hint: "ทำรอบแบบจับเวลา ครูเห็น ⚠️ ในตาราง" },
  { kind: "lift", label: "ปลดล็อกรอบวันนี้", hint: "ให้เริ่มรอบนับคะแนนได้อีกในวันนี้" },
];

export function CodeIssuer() {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!open) return;
    syncClock().then(() => setNow(serverNow()));
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [open]);

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-code-issuer>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="font-black text-gray-800">🔑 รหัสครูของห้อง</span>
        <span className="text-xs font-bold text-gray-500">กล้องใช้ไม่ได้ · ปลดล็อกรอบวันนี้ · ห้องละ 1 รหัสต่อคาบ</span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[11px] font-bold text-amber-700">⚠️ บอกรหัสด้วยปากเฉพาะเครื่องที่ครูไปตรวจแล้ว · อย่าประกาศทั้งห้องหรือพิมพ์ลงกลุ่มไลน์ — รหัสเปลี่ยนทุก 30 นาที (ใช้ได้ 30–60 นาที) และใช้ได้เฉพาะนักเรียนห้องนั้น</p>
          <div className="space-y-2">
            {GRADES.map((g) => (
              <div key={g.grade} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-black text-gray-500 w-10">ม.{g.grade}</span>
                {g.rooms.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoom(r)}
                    aria-pressed={room === r}
                    data-issuer-room={r}
                    className={`px-3 py-1.5 rounded-xl border-2 text-sm font-black ${room === r ? "border-[#003399] bg-[#003399] text-white" : "border-gray-200 text-gray-700 hover:border-[#003399]/50"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {!room && <p className="text-xs font-bold text-gray-500">เลือกห้องเพื่อดูรหัส</p>}
          {room && (
            <div className="rounded-xl border-2 border-[#003399]/20 p-3 space-y-2" data-issuer-codes={room}>
              <div className="text-sm font-black text-[#003399]">ห้อง ม.{room}</div>
              {KINDS.map(({ kind, label, hint }) => {
                const c = issueCode(kind, room, now);
                const min = Math.max(0, Math.floor(c.minMs / 60000));
                const max = Math.max(0, Math.floor(c.expiresInMs / 60000));
                return (
                  <div key={kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs font-black text-gray-700 w-32">{label}</span>
                    <b className="tabular-nums tracking-widest text-2xl text-gray-900" data-issuer-code={kind}>{c.code}</b>
                    <span className="text-[11px] font-bold text-gray-500">ใช้ได้อีก {min}–{max} นาที · {hint}</span>
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
