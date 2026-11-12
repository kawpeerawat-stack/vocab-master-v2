// app/lib/pool.ts
// ─────────────────────────────────────────────────────────────
// คลังโจทย์ (v8.7): แต่ละบทมีโจทย์ชุดเดิม (lesson.questions = 15 ข้อ ใช้นับคะแนนเต็ม/เกณฑ์ผ่าน)
// และคลังโจทย์ใหม่ (lesson.pool = 30 ข้อ คำศัพท์เดิม ประโยคใหม่) — ทุกรอบสุ่มออกมา 15 ข้อ
//   - สัดส่วนประเภทข้อ (form / choose / decode ...) เท่ากับชุดเดิมของบทนั้น
//   - ข้อที่ยังไม่เคยเจอในเครื่องนี้มาก่อน (จำใน localStorage) · ทำซ้ำรอบใหม่จึงได้ข้อใหม่ก่อน
//   - ถ้าไม่มีคลัง (หรือคลังน้อยกว่าจำนวนข้อ) ใช้ชุดเดิมแบบเดิมทุกประการ
//   - ชุดเดิมไม่ถูกนำมาออกรอบที่มีคะแนน เมื่อมีคลังครบ — เฉลยท้ายแบบฝึกหัดจึงใช้ไม่ได้
// ─────────────────────────────────────────────────────────────

import type { CourseLesson, CourseQuestion } from "./courses";

const SEEN_KEY = "vm:poolSeen:v1";

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readSeen(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function writeSeen(o: Record<string, string[]>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(o));
  } catch {
    /* ไม่มี localStorage ก็สุ่มได้ตามปกติ */
  }
}

/** ข้อทั้งหมดที่ใช้ค้นหาตาม id (ชุดเดิม + คลังใหม่) — ใช้ในหน้าทบทวนข้อผิด/หน้าครู */
export function allQuestions(lesson: CourseLesson): CourseQuestion[] {
  return [...lesson.questions, ...(lesson.pool ?? [])];
}
export function questionMap(lesson: CourseLesson): Record<string, CourseQuestion> {
  return Object.fromEntries(allQuestions(lesson).map((q) => [q.id, q]));
}

/** เลือกโจทย์ 1 รอบ */
export function drawRound(lesson: CourseLesson, seenScope: string): CourseQuestion[] {
  const base = lesson.questions;
  const need = base.length;
  const pool = lesson.pool ?? [];
  if (pool.length < need) return shuffleArr(base);

  const quota: Record<string, number> = {};
  for (const q of base) quota[q.type] = (quota[q.type] ?? 0) + 1;

  const all = readSeen();
  const key = `${seenScope}:${lesson.id}`;
  let seen = new Set(all[key] ?? []);
  // เห็นครบทั้งคลังแล้ว → เริ่มวนใหม่
  if (pool.every((q) => seen.has(q.id))) seen = new Set();

  const order = (list: CourseQuestion[]) => {
    const fresh = shuffleArr(list.filter((q) => !seen.has(q.id)));
    const old = shuffleArr(list.filter((q) => seen.has(q.id)));
    return [...fresh, ...old];
  };

  const picked: CourseQuestion[] = [];
  const used = new Set<string>();
  for (const [type, n] of Object.entries(quota)) {
    for (const q of order(pool.filter((p) => p.type === type)).slice(0, n)) {
      picked.push(q);
      used.add(q.id);
    }
  }
  // ประเภทไหนในคลังไม่พอ → เติมจากประเภทอื่นที่เหลือ
  if (picked.length < need) {
    for (const q of order(pool.filter((p) => !used.has(p.id)))) {
      if (picked.length >= need) break;
      picked.push(q);
      used.add(q.id);
    }
  }
  for (const q of picked) seen.add(q.id);
  all[key] = Array.from(seen);
  writeSeen(all);
  return shuffleArr(picked);
}
