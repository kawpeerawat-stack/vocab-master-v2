// app/lib/sameOrigin.ts — ตรวจว่าคำขอ API มาจากหน้าเว็บของเราเอง (ใช้กับ /api/course และ /api/roster)
// ─────────────────────────────────────────────────────────────
// เดิมตรวจแค่ "Referer ต้องมีชื่อเว็บเรา" → เบราว์เซอร์/โหมดความเป็นส่วนตัวบางแบบไม่ส่ง Referer
//   (เบราว์เซอร์ของเครื่องจีนบางยี่ห้อ, ตัวบล็อกโฆษณา/การติดตาม, โหมดประหยัดข้อมูล) → ตอบ 403
//   → นักเรียนเข้าแถบ 📚 แล้วโหลดคำศัพท์ไม่ได้ (เกิดกับบางเครื่องเท่านั้น)
// ตอนนี้: ปฏิเสธเฉพาะ "รู้ว่ามาจากเว็บอื่น" · ถ้าเบราว์เซอร์ไม่บอกอะไรเลย ปล่อยผ่าน
//   (ตัวนี้เป็นด่านกันแบบหลวม ๆ อยู่แล้ว — ข้อมูลที่ป้องกันจริงอยู่ที่รายชื่อ ซึ่งไม่ส่งกลับไป)
// ─────────────────────────────────────────────────────────────

const hostOf = (u: string): string | null => {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
};

export function fromOurSite(headers: { get(name: string): string | null }): boolean {
  const host = headers.get("host") || "";
  if (!host) return true;
  // 1) เบราว์เซอร์ใหม่บอกเองว่าคำขอมาจากไหน (ปลอมจากหน้าเว็บไม่ได้)
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  // 2) เบราว์เซอร์เก่า: ดู Origin แล้วดู Referer — ถ้ามีและเป็นเว็บอื่น = ปฏิเสธ
  const origin = headers.get("origin");
  if (origin) return hostOf(origin) === host;
  const referer = headers.get("referer");
  if (referer) return hostOf(referer) === host;
  // 3) ไม่ส่งอะไรมาเลย (ปิด Referer) → ไม่ปฏิเสธ
  return true;
}
