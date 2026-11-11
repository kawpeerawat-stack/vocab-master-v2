// app/admin/_parts/purgeScan.ts — ตรวจหา + ล้างผลที่ทำล่วงหน้า (สัปดาห์ 3 ขึ้นไป) · ใช้เฉพาะหน้าครู
import { FieldPath, deleteField, doc, updateDoc, type Firestore } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { GRACE_UNTIL, doneEarly, thaiDayOf } from "../../lib/early";
import { openDay } from "../../lib/sync";
import { matchRoster, roomOf } from "../../lib/roster";
import { computeStats, passedCount, type VCourse, type VProgress } from "../../lib/vocab300";
import type { Course, CourseProgress } from "../../lib/courses";
import { purgeV300, type PurgeRec } from "../../lib/purge";

export type ScanDoc = {
  id: string;
  name?: string;
  hidden?: boolean;
  v300?: VProgress;
  courses?: Record<string, CourseProgress>;
  unlock?: Record<string, number>;
} & Record<string, unknown>;

export interface PurgeItem {
  id: string;
  name: string;
  room: string;
  rec: PurgeRec;
  // สรุปให้ครูอ่าน
  sets: number[];
  cards: number;
  lessons: { course: string; hour: number }[];
  prevOnly: number;
}

export interface ScanResult {
  items: PurgeItem[];
  skipped: number; // ไม่รู้ห้อง (ตัดสินวันเรียนไม่ได้) → ไม่แตะ
}

export function scanEarly(docs: ScanDoc[], vocab: VCourse, courses: Record<string, Course>, now = Date.now()): ScanResult {
  const items: PurgeItem[] = [];
  let skipped = 0;
  const wordsOfWeek = (k: number) => vocab.words.filter((w) => w.week === k);
  for (const d of docs) {
    if (d.hidden) continue;
    const hasAny = !!d.v300 || !!d.courses;
    if (!hasAny) continue;
    const room = roomOf(d.name) ?? matchRoster(d.name)?.room ?? null;
    if (!room) {
      skipped++;
      continue;
    }
    const sets: number[] = [];
    const prev: number[] = [];
    const cards: string[] = [];
    // ── 📚 ──
    const p = d.v300;
    if (p) {
      const unlock = d.unlock?.v300 ?? 0;
      for (let k = GRACE_UNTIL + 1; k <= vocab.weeks.length; k++) {
        const od = openDay(vocab.weeks[k - 1]?.start, room, vocab.classDays);
        if (!od || unlock >= k) continue;
        const rec = p.sets?.[String(k)];
        const early = !!rec && !rec.prev && doneEarly(rec.day, od, false, k); // รวมชุด legacy (เรียนครบ 10 คำแบบเดิม) ด้วย
        if (early) sets.push(k);
        else if (rec?.prev) prev.push(k);
        const validRedo = !!rec && !early;
        if (!validRedo) {
          for (const w of wordsOfWeek(k)) {
            const c = p.cards?.[w.id];
            if (c && c.first && c.first < od) cards.push(w.id);
          }
        }
      }
    }
    // ── 🧩 ──
    const lessons: Record<string, string[]> = {};
    const early: Record<string, string[]> = {};
    const lessonList: { course: string; hour: number }[] = [];
    for (const [cid, prog] of Object.entries(d.courses || {})) {
      const course = courses[cid];
      if (!course || !prog) continue;
      const unlock = d.unlock?.[cid] ?? 0;
      for (const l of course.lessons) {
        if (l.hour <= GRACE_UNTIL || l.hour <= unlock) continue;
        const x = prog[l.id];
        if (!x) continue;
        const od = openDay(l.start, room, course.classDays);
        if (!od) continue;
        const fresh = x.attempts > 0;
        if ((x.early && !fresh) || (fresh && doneEarly(thaiDayOf(x.firstAt ?? x.passedAt ?? x.lastAt ?? 0), od, false, l.hour))) {
          (lessons[cid] ||= []).push(l.id);
          lessonList.push({ course: cid, hour: l.hour });
        } else if (x.early) {
          (early[cid] ||= []).push(l.id);
        }
      }
    }
    const hasEarlyOnly = Object.values(early).some((a) => a.length) || prev.length;
    if (!sets.length && !cards.length && !lessonList.length && !hasEarlyOnly) continue;
    const rec: PurgeRec = { at: now };
    if (sets.length) rec.sets = sets;
    if (prev.length) rec.prev = prev;
    if (cards.length) rec.cards = cards;
    if (lessonList.length) rec.lessons = lessons;
    if (Object.keys(early).length) rec.early = early;
    items.push({
      id: d.id,
      name: d.name || d.id,
      room,
      rec,
      sets,
      cards: cards.length,
      lessons: lessonList,
      prevOnly: prev.length + Object.values(early).reduce((n, a) => n + a.length, 0),
    });
  }
  items.sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : a.name.localeCompare(b.name, "th")));
  return { items, skipped };
}

// ไฟล์สำรอง: ข้อมูลเดิมทั้งหมดของนักเรียนที่จะถูกแตะ (ครูเก็บไว้ก่อนลบ)
export function makeBackup(items: PurgeItem[], docs: ScanDoc[], now = Date.now()): string {
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  return JSON.stringify(
    {
      kind: "vocab-master-purge-backup",
      at: now,
      note: "ข้อมูลเดิมก่อนล้างผลที่ทำล่วงหน้า (สัปดาห์ 3 ขึ้นไป) · v300 = 📚 · courses = 🧩 · rec = รายการที่ถูกลบ",
      students: items.map((it) => {
        const d = byId.get(it.id);
        return { id: it.id, name: it.name, room: it.room, rec: it.rec, v300: d?.v300 ?? null, courses: d?.courses ?? null, unlock: d?.unlock ?? null };
      }),
    },
    null,
    1
  );
}

// สร้างคำสั่งแก้เอกสารนักเรียน 1 คน: ลบเฉพาะช่องที่ระบุ + ป้ายบอกเครื่องนักเรียน (purge) + คำนวณตัวเลขสรุป 📚 ใหม่
export function buildArgs(item: PurgeItem, d: ScanDoc | undefined): (string | FieldPath | unknown)[] {
  const { rec } = item;
  const args: unknown[] = ["purge", rec];
  for (const k of rec.sets || []) args.push(new FieldPath("v300", "sets", String(k)), deleteField());
  for (const k of rec.prev || []) args.push(new FieldPath("v300", "sets", String(k), "prev"), deleteField());
  for (const id of rec.cards || []) args.push(new FieldPath("v300", "cards", id), deleteField());
  for (const [cid, ids] of Object.entries(rec.lessons || {})) for (const id of ids) args.push(new FieldPath("courses", cid, id), deleteField());
  for (const [cid, ids] of Object.entries(rec.early || {})) for (const id of ids) args.push(new FieldPath("courses", cid, id, "early"), deleteField());
  if (d?.v300 && (rec.sets || rec.prev || rec.cards)) {
    const after = purgeV300({ cards: d.v300.cards || {}, days: d.v300.days || {}, sets: d.v300.sets || {} }, rec);
    const st = computeStats(after);
    args.push("v300Known", st.known, "v300Seen", st.seen, "v300Sets", passedCount(after));
  }
  return args;
}

export async function writePurge(item: PurgeItem, d: ScanDoc | undefined): Promise<void> {
  const fs = db as Firestore;
  const [first, second, ...rest] = buildArgs(item, d) as [string, unknown, ...unknown[]];
  await updateDoc(doc(fs, "students", item.id), first, second, ...rest);
}

export interface PurgeRunResult {
  ok: string[];
  failed: { id: string; name: string; error: string }[];
}
export async function runPurge(
  items: PurgeItem[],
  docs: ScanDoc[],
  onProgress?: (done: number, total: number) => void,
  write: (item: PurgeItem, d: ScanDoc | undefined) => Promise<void> = writePurge
): Promise<PurgeRunResult> {
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  const res: PurgeRunResult = { ok: [], failed: [] };
  let n = 0;
  for (const it of items) {
    try {
      await write(it, byId.get(it.id));
      res.ok.push(it.id);
    } catch (e) {
      res.failed.push({ id: it.id, name: it.name, error: String((e as { code?: string })?.code || (e as Error)?.message || e) });
    }
    onProgress?.(++n, items.length);
  }
  return res;
}
