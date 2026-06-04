// proxy.ts  (Next.js 16 — แทนที่ middleware.ts เดิม)
// ─────────────────────────────────────────────────────────────
// ประตูรหัสผ่านสำหรับหน้า /admin (HTTP Basic Auth)
//   - รหัสผ่านเก็บใน Environment Variable ฝั่งเซิร์ฟเวอร์ (ไม่หลุดไป client)
//   - ตั้งค่าใน Vercel: ADMIN_USER และ ADMIN_PASS แล้ว Redeploy
//   - เปิด /admin ครั้งแรกเบราว์เซอร์จะเด้งช่องให้กรอก user/pass
//
// หมายเหตุ: ถ้ายังไม่ได้ตั้ง ADMIN_PASS หน้า /admin จะยังเปิดได้ตามปกติ
//          (กันล็อกตัวเองออก) — ตั้งค่าให้เรียบร้อยเพื่อให้เริ่มป้องกัน
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  const USER = process.env.ADMIN_USER || "teacher";
  const PASS = process.env.ADMIN_PASS || "";

  // ยังไม่ตั้งรหัส → ปล่อยผ่าน (กันล็อกตัวเองออกก่อนตั้งค่า)
  if (!PASS) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const idx = decoded.indexOf(":");
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      if (u === USER && p === PASS) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("ต้องเข้าสู่ระบบเพื่อดูหน้านี้ (Authentication required)", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin Dashboard", charset="UTF-8"' },
  });
}

// ป้องกันเฉพาะหน้า /admin (รวมหน้าย่อยใต้ /admin)
export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
