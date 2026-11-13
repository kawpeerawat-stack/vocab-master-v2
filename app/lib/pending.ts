// app/lib/pending.ts — คำนวณ "งานค้าง" รายนักเรียน (13 พ.ย. 2569)
// ─────────────────────────────────────────────────────────────
// ค้าง = บท 🧩 / ชุด 📚 ที่ถึงวันเปิดของห้องตัวเองแล้ว (หรือเปิดวันนี้) แต่ยังไม่ผ่าน
//   • ใช้กติกาเดียวกับห้องเรียนและหน้าครูเป๊ะ: วันเปิด = วันจันทร์ของสัปดาห์ + วันเรียนของห้อง (openDay)
//     ทำล่วงหน้าก่อนวันเปิด (สัปดาห์ 3+) ไม่นับ = ยังค้าง · สัปดาห์ 1–2 อนุโลม · ครูเปิดล่วงหน้าให้ (unlock) = นับ
//   • ม.4 มีเฉพาะห้อง 🧩 (decoder4) · ม.6 มี 🧩 (decoder) และ 📚 (คำศัพท์แกน 120 คำ)
//   • late = เลยวันเปิดมาแล้ว ≥ 1 วัน (ค้างจริง) · ไม่ late = เปิดวันนี้ (ยังอยู่ในกำหนด)
// ไฟล์นี้ไม่ import รายชื่อนักเรียน (ไม่ให้รายชื่อไปอยู่ในหน้านักเรียน)
// ─────────────────────────────────────────────────────────────
import { doneEarly, thaiDayOf } from "./early";
import { gradeOf } from "./names";
import { openDay, thaiShort } from "./sync";
import type { Schedule, TrackKey } from "./schedule";

export interface LessonLike {
  passed?: boolean;
  attempts?: number;
  firstAt?: number;
  passedAt?: number;
  lastAt?: number;
  early?: unknown; // มีค่า = ผลเดิมถูกล้างเพราะทำล่วงหน้า
}
export interface SetLike {
  day?: string;
  prev?: unknown; // มีค่า = รอบทำใหม่หลังทำล่วงหน้า (นับ)
}
export interface PendInput {
  room: string | null;
  today: string; // YYYY-MM-DD ตามเวลาประเทศไทย
  unlock: Record<string, number>; // ครูเปิดล่วงหน้า { decoder: n, decoder4: n, v300: n }
  lessons: Partial<Record<TrackKey, Record<string, LessonLike>>>; // ผลบท 🧩 ที่รวมแล้ว
  sets: Record<string, SetLike>[]; // ผลชุด 📚 ของแต่ละเอกสาร/บัญชี (นับว่าผ่านถ้าบัญชีใดบัญชีหนึ่งนับ)
}
// none = ยังไม่ได้ทำ · tried = ทำแล้วแต่ยังไม่ผ่าน · early = ทำล่วงหน้า (ไม่นับ ต้องทำใหม่)
export type PendState = "none" | "tried" | "early";
export interface PendItem {
  track: TrackKey;
  icon: string;
  trackName: string;
  unit: string;
  kind: "lesson" | "set";
  id: string;
  no: number;
  title: string;
  label: string;   // เช่น "บท 3" / "ชุด 2"
  open: string;    // วันเปิดของห้องนี้
  openText: string;
  daysLate: number;
  late: boolean;
  state: PendState;
}

export const STATE_TEXT: Record<PendState, string> = {
  none: "ยังไม่ได้ทำ",
  tried: "ทำแล้วแต่ยังไม่ผ่าน",
  early: "ทำล่วงหน้า (ไม่นับ) ต้องทำใหม่",
};

const dayNum = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, dd) / 86400000);
};
export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);

export function computePending(sch: Schedule | null, inp: PendInput): PendItem[] {
  const g = gradeOf(inp.room);
  if (!sch || !g || !inp.room) return [];
  const out: PendItem[] = [];
  for (const t of sch.tracks) {
    if (t.grade !== g) continue;
    const unlockN = inp.unlock[t.key] || 0;
    for (const it of t.items) {
      const open = openDay(it.start, inp.room, t.classDays);
      if (!open || open > inp.today) continue; // ยังไม่ถึงวันเปิด
      const unlocked = it.no <= unlockN;
      let state: PendState | null;
      if (t.kind === "lesson") {
        const x = inp.lessons[t.key]?.[it.id];
        const attempted = (x?.attempts ?? 0) > 0;
        const early = !!x && attempted && doneEarly(thaiDayOf(x.firstAt ?? x.passedAt ?? x.lastAt ?? 0), open, unlocked, it.no);
        if (x?.passed && !early) state = null;
        else state = early || (!!x?.early && !attempted) ? "early" : attempted ? "tried" : "none";
      } else {
        const recs = inp.sets.map((s) => s[it.id]).filter((r): r is SetLike => !!r);
        const counted = recs.some((r) => !!r.prev || !doneEarly(r.day, open, unlocked, it.no));
        state = counted ? null : recs.length ? "early" : "none";
      }
      if (!state) continue;
      const daysLate = Math.max(0, daysBetween(open, inp.today));
      out.push({
        track: t.key, icon: t.icon, trackName: t.name, unit: t.unit, kind: t.kind, id: it.id, no: it.no, title: it.title,
        label: `${t.unit} ${it.no}`, open, openText: thaiShort(open), daysLate, late: daysLate > 0, state,
      });
    }
  }
  return out;
}

// จัดกลุ่มตามห้อง (🧩 / 📚) คงลำดับเดิม
export function groupByTrack(items: PendItem[]): { track: TrackKey; icon: string; trackName: string; unit: string; items: PendItem[] }[] {
  const out: { track: TrackKey; icon: string; trackName: string; unit: string; items: PendItem[] }[] = [];
  for (const it of items) {
    let g = out.find((x) => x.track === it.track);
    if (!g) out.push((g = { track: it.track, icon: it.icon, trackName: it.trackName, unit: it.unit, items: [] }));
    g.items.push(it);
  }
  return out;
}
// ข้อความสั้น ๆ เช่น "🧩 บท 1, 3 · 📚 ชุด 2"
export function compactText(items: PendItem[]): string {
  return groupByTrack(items)
    .map((g) => `${g.icon} ${g.unit} ${g.items.map((i) => i.no).join(", ")}`)
    .join(" · ");
}

// ข้อความสำหรับวางในกลุ่มไลน์ของห้อง (เฉพาะงานที่ "ค้างจริง" เลยวันเปิดมาแล้ว) — withNames=false ใช้เลขที่อย่างเดียว (แนะนำ ไม่ประจานชื่อ)
export function lineText(room: string, today: string, rows: { no: number | null; name: string; items: PendItem[] }[], withNames: boolean): string {
  const lines = rows
    .map((r) => ({ ...r, late: r.items.filter((i) => i.late) }))
    .filter((r) => r.late.length > 0)
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
    .map((r) => `เลขที่ ${r.no ?? "-"}${withNames ? ` ${r.name}` : ""}: ${compactText(r.late)}`);
  if (!lines.length) return `✅ ม.${room} ไม่มีงานค้าง (ณ ${thaiShort(today)}) เก่งมากทุกคน`;
  return [
    `📌 งานค้าง ม.${room} (ณ ${thaiShort(today)})`,
    ...lines,
    "",
    "👉 เปิด Vocab Master → เข้าด้วยอีเมลเดิม → กด “ไปทำต่อ” ในกรอบ 📌 งานค้างของคุณ",
    "⏰ รอบที่นับคะแนนทำได้ในเวลา 06.00–16.30 น.",
  ].join("\n");
}
