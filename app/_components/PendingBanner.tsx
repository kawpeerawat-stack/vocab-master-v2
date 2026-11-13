"use client";
// app/_components/PendingBanner.tsx — 📌 งานค้างของฉัน (หน้าเลือกห้อง · 13 พ.ย. 2569)
//   แสดงบท 🧩 / ชุด 📚 ที่เลยวันเรียนของห้องตัวเองมาแล้วแต่ยังไม่ผ่าน เพื่อเตือนให้กลับมาทำให้เสร็จ
//   เห็นเฉพาะข้อมูลของอีเมลที่เข้าอยู่ · ม.4 มีเฉพาะ 🧩 · ม.6 มี 🧩 และ 📚
import { useEffect, useState } from "react";
import { watchMyPending } from "../lib/pendingData";
import { STATE_TEXT, groupByTrack, type PendItem } from "../lib/pending";
import type { TrackKey } from "../lib/schedule";

const MAX_SHOW = 5;

export function PendingBanner({ email, room, onGo }: { email: string; room: string | null; onGo: (track: TrackKey) => void }) {
  const [items, setItems] = useState<PendItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    watchMyPending(email, room, (it) => alive && setItems(it), () => alive).catch((e) => console.warn("pending:", e));
    return () => {
      alive = false;
    };
  }, [email, room]);

  if (!items) return null;
  const late = items.filter((i) => i.late);
  const today = items.filter((i) => !i.late);

  if (late.length === 0) {
    return (
      <div className="mb-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-left" data-pending="clear">
        <p className="text-sm font-black text-emerald-800">✅ ไม่มีงานค้าง — เก่งมาก ทำต่อเนื่องแบบนี้ต่อไปนะ</p>
        {today.length > 0 && (
          <p className="text-xs font-bold text-emerald-700 mt-1" data-pending-today="1">
            📘 เปิดวันนี้: {today.map((i) => i.label).join(", ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border-2 border-orange-300 bg-orange-50 p-4 text-left" data-pending="late" data-pending-count={late.length}>
      <p className="font-black text-orange-900">📌 งานค้างของคุณ {late.length} รายการ</p>
      <p className="text-xs font-bold text-orange-800 mt-0.5 mb-3">กลับมาทำให้เสร็จ จะได้ไม่ตกหล่น · รอบที่นับคะแนนทำได้ในเวลา 06.00–16.30 น.</p>
      <div className="space-y-3">
        {groupByTrack(late).map((g) => (
          <div key={g.track} className="rounded-xl bg-white/80 border border-orange-200 p-3" data-pending-track={g.track}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-black text-gray-800">
                {g.icon} {g.trackName}
              </span>
              <button
                type="button"
                onClick={() => onGo(g.track)}
                data-pending-go={g.track}
                className="ml-auto shrink-0 px-3 py-1.5 rounded-lg bg-[#003399] text-white text-xs font-black"
              >
                ไปทำต่อ →
              </button>
            </div>
            <ul className="space-y-1">
              {g.items.slice(0, MAX_SHOW).map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-xs font-bold text-gray-700" data-pending-item={`${i.track}:${i.id}`}>
                  <span className="shrink-0 w-14 font-black text-gray-900">{i.label}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.title}</span>
                    {i.state !== "none" && <span className="block text-[11px] text-orange-700">{STATE_TEXT[i.state]}</span>}
                  </span>
                  <span className="shrink-0 text-orange-700">ค้าง {i.daysLate} วัน</span>
                </li>
              ))}
            </ul>
            {g.items.length > MAX_SHOW && <p className="text-[11px] font-bold text-gray-500 mt-1">และอีก {g.items.length - MAX_SHOW} รายการ</p>}
          </div>
        ))}
      </div>
      {today.length > 0 && (
        <p className="text-xs font-bold text-[#003399] mt-2" data-pending-today="1">
          📘 เปิดวันนี้: {today.map((i) => i.label).join(", ")}
        </p>
      )}
    </div>
  );
}
