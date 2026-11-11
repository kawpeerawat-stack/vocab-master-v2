"use client";
// app/global-error.tsx — ข้อผิดพลาดระดับราก (layout) · ต้องมี html/body เอง
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8f9fa", color: "#1f2937" }}>
        <div data-app-error style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 24, padding: 24, textAlign: "center", borderTop: "10px solid #003399" }}>
            <h1 style={{ fontSize: 18, color: "#003399", margin: "0 0 8px" }}>หน้านี้เปิดไม่สำเร็จ</h1>
            <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 16px" }}>กดลองใหม่ ถ้ายังไม่ได้ให้ปิดแท็บแล้วเปิดลิงก์ใหม่</p>
            <button onClick={() => unstable_retry()} style={{ padding: "8px 16px", background: "#003399", color: "#fff", border: 0, borderRadius: 12, fontWeight: 700 }}>ลองใหม่</button>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 16, wordBreak: "break-all" }}>ส่งภาพหน้านี้ให้ครู · รหัส {error.digest || error.name || "-"}</p>
          </div>
        </div>
      </body>
    </html>
  );
}
