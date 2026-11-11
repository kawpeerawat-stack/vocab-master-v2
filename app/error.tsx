"use client";
// app/error.tsx — หน้าแจ้งเมื่อแอปสะดุด (แทนหน้าขาว/ข้อความภาษาอังกฤษ) · นักเรียนถ่ายหน้าจอส่งครูได้
// ไม่แสดงและไม่เก็บชื่อ/อีเมลนักเรียน — มีแค่รหัสข้อผิดพลาดกับรุ่นเบราว์เซอร์
import { useEffect } from "react";

export default function AppError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "";
  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4 font-sans text-gray-800" data-app-error>
      <div className="w-full max-w-md bg-white shadow-xl rounded-3xl p-6 border-t-[10px] border-[#003399] text-center">
        <p className="text-2xl mb-2">⚠️</p>
        <h1 className="text-lg font-black text-[#003399] mb-2">หน้านี้เปิดไม่สำเร็จ</h1>
        <p className="text-sm text-gray-600 mb-4">ผลที่ทำไว้ไม่หาย กดลองใหม่ได้เลย ถ้ายังไม่ได้ ให้ปิดแท็บแล้วเปิดลิงก์ใหม่ (ไม่ต้องเปิดจากในแอปไลน์)</p>
        <div className="flex gap-2 justify-center mb-4">
          <button onClick={() => unstable_retry()} className="px-4 py-2 bg-[#003399] text-white rounded-xl font-bold text-sm">ลองใหม่</button>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-white border-2 border-[#003399]/30 text-[#003399] rounded-xl font-bold text-sm">โหลดหน้าใหม่</button>
        </div>
        <p className="text-[11px] text-gray-400 break-all">ส่งภาพหน้านี้ให้ครู · รหัส {error.digest || error.name || "-"} · {ua}</p>
      </div>
    </div>
  );
}
