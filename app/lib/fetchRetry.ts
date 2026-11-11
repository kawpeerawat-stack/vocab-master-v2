// app/lib/fetchRetry.ts — โหลดเนื้อหาจาก API ซ้ำอัตโนมัติเมื่อเน็ตโรงเรียนสะดุด (เครือข่ายหลุด / 5xx)
// ไม่ลองซ้ำเมื่อเซิร์ฟเวอร์ปฏิเสธชัดเจน (403/404) — ลองซ้ำก็ไม่ช่วย
export async function fetchJsonRetry<T>(url: string, tries = 3, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return (await res.json()) as T;
      last = new Error(`HTTP ${res.status} ${url}`);
      if (res.status >= 400 && res.status < 500) break;
    } catch (e) {
      last = e;
    }
    if (i < tries - 1) await wait(500 * (i + 1) * (i + 1));
  }
  throw last instanceof Error ? last : new Error(`โหลดไม่สำเร็จ ${url}`);
}
