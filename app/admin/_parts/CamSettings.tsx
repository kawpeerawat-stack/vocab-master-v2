"use client";
// app/admin/_parts/CamSettings.tsx — ⏱️ ตั้งค่ากล้อง: เวลาบังหน้าก่อนนับ 1 ครั้ง (12 พ.ย. 2569)
//   ค่าเริ่มต้น 1.5 วินาที · ปรับได้ 1.0–3.0 วินาที · หน้านักเรียนอ่านค่านี้ตอน "เปิดกล้อง"
//   (เครื่องที่เปิดกล้องค้างอยู่แล้ว จะได้ค่าใหม่เมื่อเปิดกล้องครั้งถัดไป)
//   ใช้เฉพาะ "บังตา–หน้าผาก/ไม่พบหน้า" · การเห็นมือถือในภาพไม่ใช้ค่านี้
import React, { useEffect, useState } from "react";
import { COVER_MS_DEFAULT, COVER_MS_MAX, COVER_MS_MIN, COVER_MS_STEP, clampCoverMs, fetchCamCfg, saveCoverMs } from "../../lib/camSettings";

const PRESETS: { ms: number; label: string; hint: string }[] = [
  { ms: 1000, label: "1.0", hint: "เข้มสุด · เสี่ยงทักผิดตอนกะพริบตา/ส่ายหน้า" },
  { ms: 1200, label: "1.2", hint: "เข้ม" },
  { ms: 1500, label: "1.5", hint: "แนะนำ (ค่าเริ่มต้น)" },
  { ms: 2000, label: "2.0", hint: "ผ่อนปรน · ใช้เมื่อยังทักผิดบ่อย" },
  { ms: 2500, label: "2.5", hint: "ผ่อนปรนมาก" },
  { ms: 3000, label: "3.0", hint: "ผ่อนปรนสุด · เด็กมีเวลาก้มดูของใต้โต๊ะได้" },
];

const fmt = (ms: number) => (ms / 1000).toFixed(1);

export function CamSettings() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<number | null>(null); // ค่าที่บันทึกอยู่ในระบบ
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [val, setVal] = useState(COVER_MS_DEFAULT);
  const [load, setLoad] = useState<"idle" | "ok" | "fail">("idle") // idle = ยังไม่ได้อ่าน/กำลังอ่าน;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || load !== "idle") return;
    let alive = true;
    fetchCamCfg(8000).then((c) => {
      if (!alive) return;
      if (!c) {
        setLoad("fail");
        return;
      }
      setSaved(c.coverMs);
      setSavedAt(c.updatedAt);
      setVal(c.coverMs);
      setLoad("ok");
    });
    return () => {
      alive = false;
    };
  }, [open, load]);

  const dirty = saved !== val;

  async function save() {
    setBusy(true);
    setMsg(null);
    const err = await saveCoverMs(val);
    setBusy(false);
    if (err) {
      setMsg({ ok: false, text: `บันทึกไม่สำเร็จ (${err}) — ตรวจอินเทอร์เน็ตแล้วลองใหม่` });
      return;
    }
    setSaved(val);
    setSavedAt(Date.now());
    setLoad("ok");
    setMsg({ ok: true, text: `บันทึกแล้ว: บังหน้านาน ${fmt(val)} วินาที จึงนับ 1 ครั้ง — มีผลกับนักเรียนที่เปิดกล้องครั้งถัดไป` });
  }

  return (
    <section className="mb-5 bg-white rounded-2xl border-2 border-gray-200 shadow-sm" data-cam-settings>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="font-black text-gray-800">⏱️ ตั้งค่ากล้อง</span>
        <span className="text-xs font-bold text-gray-500">เวลาบังหน้าก่อนนับ 1 ครั้ง{saved != null ? ` · ตอนนี้ ${fmt(saved)} วินาที` : ""}</span>
        <span className="ml-auto text-xs font-bold text-gray-400">{open ? "ย่อ ▲" : "ขยาย ▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {load === "idle" && <p className="text-xs font-bold text-gray-500">กำลังอ่านค่าที่ตั้งไว้…</p>}
          {load === "fail" && (
            <p className="text-xs font-bold text-amber-700">
              อ่านค่าที่บันทึกไว้ไม่ได้ (ใช้ค่าเริ่มต้น {fmt(COVER_MS_DEFAULT)} วินาทีในช่องด้านล่าง){" "}
              <button type="button" onClick={() => setLoad("idle")} className="underline">ลองอ่านอีกครั้ง</button>
            </p>
          )}
          <p className="text-sm font-bold text-gray-700">
            ถ้าบังตา–หน้าผาก หรือไม่พบหน้า ต่อเนื่องนานเท่านี้ → นับ 1 ครั้ง และข้ามข้อนั้น (ไม่ได้คะแนน)
          </p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="เวลาบังหน้า">
            {PRESETS.map((p) => (
              <button
                key={p.ms}
                type="button"
                role="radio"
                aria-checked={val === p.ms}
                data-cover-preset={p.ms}
                onClick={() => setVal(p.ms)}
                className={`px-3 py-1.5 rounded-xl border-2 text-sm font-black ${val === p.ms ? "border-[#003399] bg-[#003399] text-white" : "border-gray-200 text-gray-700 hover:border-[#003399]/50"}`}
              >
                {p.label} วิ
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={COVER_MS_MIN}
              max={COVER_MS_MAX}
              step={COVER_MS_STEP}
              value={val}
              onChange={(e) => setVal(clampCoverMs(Number(e.target.value)))}
              aria-label="เวลาบังหน้า (วินาที)"
              data-cover-range
              className="flex-1 accent-[#003399]"
            />
            <span className="w-16 text-right text-lg font-black text-[#003399] tabular-nums" data-cover-value>{fmt(val)} วิ</span>
          </div>
          <p className="text-xs font-bold text-gray-500" data-cover-hint>
            {PRESETS.find((p) => p.ms === val)?.hint ?? (val < COVER_MS_DEFAULT ? "เข้มกว่าค่าเริ่มต้น · เสี่ยงทักผิดมากขึ้น" : "ผ่อนปรนกว่าค่าเริ่มต้น · เด็กมีเวลาบังได้นานขึ้น")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              data-cover-save
              className="px-4 py-2 rounded-xl bg-[#003399] text-white font-black text-sm disabled:opacity-40"
            >
              {busy ? "กำลังบันทึก…" : "บันทึก"}
            </button>
            {val !== COVER_MS_DEFAULT && (
              <button type="button" onClick={() => setVal(COVER_MS_DEFAULT)} className="px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-black text-gray-600">
                กลับเป็น {fmt(COVER_MS_DEFAULT)} วิ
              </button>
            )}
            {savedAt && (
              <span className="text-[11px] font-bold text-gray-400">
                บันทึกล่าสุด {new Date(savedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
              </span>
            )}
          </div>
          {msg && (
            <p className={`text-xs font-bold ${msg.ok ? "text-emerald-700" : "text-rose-700"}`} data-cover-msg>
              {msg.text}
            </p>
          )}
          <ul className="text-[11px] font-bold text-gray-500 list-disc pl-4 space-y-0.5">
            <li>ใช้กับ “บังตา–หน้าผาก / ไม่พบหน้า” เท่านั้น — การเห็นมือถือในภาพไม่ใช้ค่านี้</li>
            <li>เครื่องที่เปิดกล้องค้างอยู่แล้ว จะได้ค่าใหม่เมื่อเปิดกล้องครั้งถัดไป (หรือโหลดหน้าใหม่)</li>
            <li>แนะนำให้ลองในคาบกับ 2–3 เครื่อง: ทักผิดบ่อย → เพิ่มทีละ 0.5 วิ · เด็กหลุดรอดมาก → ลดทีละ 0.3 วิ</li>
          </ul>
        </div>
      )}
    </section>
  );
}
