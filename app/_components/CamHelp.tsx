"use client";
// app/_components/CamHelp.tsx — กล่อง "แก้ปัญหากล้อง" (13 พ.ย. 2569)
//   แสดงเมื่อเปิดกล้องไม่ได้: บอกสาเหตุ + ขั้นตอนแก้ที่ตรงกับเครื่อง (iPhone/Android/คอม) และอาการจริงที่เบราว์เซอร์รายงาน
//   ท้ายกล่องมี "รหัสอาการ" ให้นักเรียนถ่ายรูปส่งครู · ไม่ส่งข้อมูลใด ๆ ออกจากเครื่อง
import { useEffect, useMemo, useState } from "react";
import { NO_PROBE, detectEnv, diagnoseCam, probeCam, type CamProbe } from "../lib/camHelp";

export function CamHelp({ status, detail }: { status: "denied" | "error"; detail: string }) {
  const env = useMemo(() => detectEnv(), []);
  const [probe, setProbe] = useState<CamProbe>(NO_PROBE);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    probeCam().then((p) => alive && setProbe(p));
    return () => {
      alive = false;
    };
  }, [detail]);

  const d = useMemo(() => diagnoseCam(detail, env, probe, status), [detail, env, probe, status]);

  async function copyLink() {
    const url = typeof location === "undefined" ? "" : location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ไม่เป็นไร */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="space-y-2" data-cam-help data-cam-kind={d.kind} data-cam-code={d.code}>
      <div className="bg-rose-50 rounded-xl p-3">
        <p className="text-sm font-black text-rose-700" data-cam-help-title>
          {d.title}
        </p>
        <p className="text-xs font-bold text-rose-600 mt-1 leading-relaxed">{d.why}</p>
      </div>
      <div className="bg-gray-50 rounded-xl p-3">
        <p className="text-xs font-black text-gray-700 mb-1">ลองตามนี้ (ทำทีละข้อ):</p>
        <ol className="list-decimal pl-5 space-y-1 text-xs font-bold text-gray-700 leading-relaxed" data-cam-help-steps>
          {d.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {d.kind === "inapp" && (
          <button type="button" onClick={copyLink} data-cam-copylink className="mt-2 px-3 py-1.5 rounded-lg bg-[#003399] text-white text-xs font-black">
            {copied ? "คัดลอกแล้ว ✓ ไปวางใน Safari / Chrome" : "📋 คัดลอกลิงก์ไปเปิดใน Safari / Chrome"}
          </button>
        )}
      </div>
      {d.more && (
        <details className="bg-gray-50 rounded-xl p-3" data-cam-help-more>
          <summary className="text-xs font-black text-gray-700 cursor-pointer">{d.more.title}</summary>
          <ol className="list-decimal pl-5 mt-1 space-y-1 text-xs font-bold text-gray-700 leading-relaxed">
            {d.more.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}
      <p className="text-[11px] font-bold text-gray-400" data-cam-error="1">
        รหัสอาการ {d.code} · {d.envText}
        {detail ? ` · ${detail}` : ""} <span className="text-gray-300">(ถ่ายรูปส่งครูได้)</span>
      </p>
    </div>
  );
}
