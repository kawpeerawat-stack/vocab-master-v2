// app/lib/purge.ts
// ─────────────────────────────────────────────────────────────
// ล้างผลที่ทำล่วงหน้า (11 พ.ย. 2569 · ครูสั่ง): ผล 📚 ชุด / 🧩 บท ตั้งแต่สัปดาห์ 3 ขึ้นไปที่ทำก่อนวันเรียนของห้อง
//   และยังไม่ผ่านการตรวจ (ไม่ได้เปิดกล้องในคาบ) → ลบทิ้งจริง
//   1) หน้าครูลบออกจากระบบ (Firestore) ด้วย updateDoc + deleteField — Rules ห้ามลบเอกสาร จึงลบเฉพาะช่องข้อมูล
//   2) เขียนป้ายบอกเครื่องนักเรียนไว้ที่ students/{id}.purge → ตอนนักเรียนเปิดแอปครั้งถัดไป เครื่องจะลบของเดิมในเครื่องตาม
//      (ถ้าไม่ทำข้อนี้ เครื่องนักเรียนจะส่งผลเก่าขึ้นระบบกลับมาใหม่เอง)
//   ไฟล์นี้ใช้ฝั่งนักเรียนด้วย จึงห้ามอ้างอิงรายชื่อนักเรียน (roster) หรือ Firebase
// ─────────────────────────────────────────────────────────────
import type { VProgress } from "./vocab300";
import type { CourseProgress } from "./courses";

export interface PurgeRec {
  at: number;                          // เวลาที่ครูสั่งล้าง (ms)
  sets?: number[];                     // 📚 ลบทั้งชุด (ผลผ่านชุดที่ทำล่วงหน้า)
  prev?: number[];                     // 📚 ลบเฉพาะ prev (ผลเดิมที่ทำล่วงหน้า เหลือจากการทำใหม่)
  cards?: string[];                    // 📚 ลบการ์ดคำศัพท์ (รหัสคำ) ที่เรียนล่วงหน้า
  lessons?: Record<string, string[]>;  // 🧩 ลบทั้งบท (รหัสคอร์ส → รหัสบท)
  early?: Record<string, string[]>;    // 🧩 ลบเฉพาะ early (ผลเดิมที่ทำล่วงหน้า เหลือจากการทำใหม่)
}

export const isPurgeRec = (x: unknown): x is PurgeRec => !!x && typeof x === "object" && typeof (x as PurgeRec).at === "number";

const seenKey = (scope: string, emailId: string) => `purge:${scope}:${emailId}`;
export function purgeSeenAt(scope: string, emailId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(scope, emailId))) || 0;
  } catch {
    return 0;
  }
}
export function markPurgeSeen(scope: string, emailId: string, at: number) {
  try {
    localStorage.setItem(seenKey(scope, emailId), String(at));
  } catch {
    /* ไม่เป็นไร */
  }
}

// 📚 ลบออกจากข้อมูลในเครื่อง
export function purgeV300(p: VProgress, rec: PurgeRec): VProgress {
  const sets = { ...(p.sets || {}) };
  for (const k of rec.sets || []) delete sets[String(k)];
  for (const k of rec.prev || []) {
    const s = sets[String(k)];
    if (s && s.prev) {
      const { prev: _prev, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
      sets[String(k)] = rest;
    }
  }
  const cards = { ...(p.cards || {}) };
  for (const id of rec.cards || []) delete cards[id];
  return { ...p, cards, sets };
}

// 🧩 ลบออกจากข้อมูลในเครื่อง
export function purgeCourse(p: CourseProgress, courseId: string, rec: PurgeRec): CourseProgress {
  const out: CourseProgress = { ...p };
  for (const id of rec.lessons?.[courseId] || []) delete out[id];
  for (const id of rec.early?.[courseId] || []) {
    const x = out[id];
    if (x && x.early) {
      const { early: _early, ...rest } = x; // eslint-disable-line @typescript-eslint/no-unused-vars
      out[id] = rest;
    }
  }
  return out;
}
