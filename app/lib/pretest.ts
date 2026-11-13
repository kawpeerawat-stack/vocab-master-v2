// app/lib/pretest.ts — 📝 Pre-test ม.4 (ฉบับ A · 13 พ.ย. 2569)
//   ข้อสอบหลัก 40 ข้อ 50 นาที (8 ทักษะตามข้อสอบจริง · ระดับ A2/B1/ข้อสอบจริง · ติดป้ายหัวข้อย่อยเพื่อหาจุดอ่อน)
//   + ชุดวัดระดับคำศัพท์ 20 ข้อ 10 นาที (4 ระดับ × 5) · ไม่นับคะแนนเก็บ · ทำได้ครั้งเดียว (ครูกดให้ทำใหม่ได้)
//   เก็บคำตอบเป็นสายอักขระ (ตำแหน่งตัวเลือกเดิม 0–3 · "-" = ไม่ได้ตอบ) → หน้าครูคิดคะแนนใหม่จากเฉลยปัจจุบันเสมอ
//   (ถ้าครูแก้เฉลยภายหลัง ผลทุกคนปรับตามเอง)
import BANK_JSON from "../../data/pretest4.json";
import { emailId, fnv1a, mulberry32 } from "./booklet";

export type Level = "A2" | "B1" | "EX";
export type AreaId = "conv" | "gram" | "read";
export interface PItem { n: number; id: string; sk: string; sub: string; lv: Level; q: string; o: string[]; a: number; why: string; ctx?: string; fixed?: boolean }
export interface VItem { n: number; id: string; t: number; q: string; o: string[]; a: number }
export interface Ctx { kind: "dialogue" | "text" | "sign" | "notice" | "message" | "list" | "table"; title?: string; lines?: (string | string[])[]; paras?: string[]; head?: string[]; rows?: string[][] }
export interface Sub { area: AreaId; th: string; en: string; tip: string }
export interface Band { id: "S" | "M" | "H"; min: number; th: string; en: string; rule: string }
export interface Bank {
  form: string;
  title: string;
  minutes: number;
  vocabMinutes: number;
  bands: Band[];
  areas: Record<AreaId, string>;
  skills: Record<string, string>;
  subs: Record<string, Sub>;
  tiers: Record<string, { th: string; en: string }>;
  ctx: Record<string, Ctx>;
  items: PItem[];
  vocab: VItem[];
}
export const BANK = BANK_JSON as unknown as Bank;
export const PRE_ITEMS = BANK.items;
export const PRE_VOCAB = BANK.vocab;
export const MAIN_MS = BANK.minutes * 60000;
export const VOCAB_MS = BANK.vocabMinutes * 60000;
export const TIER_PASS = 4; // ระดับละ 5 ข้อ ถูก 4 ขึ้นไป = ระดับนั้นผ่าน
export const SKILL_ORDER = ["QR", "SC", "LC", "TC", "ED", "RC", "PO", "IG"];

// ── ลำดับตัวเลือกต่อคน (สุ่มตามอีเมล · ข้อ Error detection ไม่สลับ) ──
export function optionOrder(email: string, id: string, n: number, fixed?: boolean): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (fixed) return idx;
  const rnd = mulberry32(fnv1a(`anr-pre4|${BANK.form}|${emailId(email)}|${id}`));
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

// ── คำตอบ ↔ สายอักขระ ──
export type Picks = (number | null)[]; // ตำแหน่งตัวเลือกเดิม
export const encodePicks = (p: Picks) => p.map((x) => (x === null || x === undefined || x < 0 ? "-" : String(x))).join("");
export function decodePicks(s: unknown, len: number): Picks {
  const str = typeof s === "string" ? s : "";
  return Array.from({ length: len }, (_, i) => {
    const c = str[i];
    return c && c >= "0" && c <= "9" ? Number(c) : null;
  });
}

// ── ตรวจ ──
export interface Tally { c: number; t: number }
export interface MainResult {
  score: number;
  ex: number; // ถูกกี่ข้อในระดับข้อสอบจริง
  exTotal: number;
  answered: number;
  band: Band;
  byLv: Record<Level, Tally>;
  bySk: Record<string, Tally>;
  bySub: Record<string, Tally>;
  byArea: Record<AreaId, Tally>;
}
const add = (m: Record<string, Tally>, k: string, ok: boolean) => {
  const x = m[k] ?? (m[k] = { c: 0, t: 0 });
  x.t++;
  if (ok) x.c++;
};
export const bandOf = (score: number): Band => [...BANK.bands].reverse().find((b) => score >= b.min) ?? BANK.bands[0];
export function gradeMain(p: Picks): MainResult {
  const byLv = {} as Record<Level, Tally>;
  const bySk: Record<string, Tally> = {};
  const bySub: Record<string, Tally> = {};
  const byArea = {} as Record<AreaId, Tally>;
  let score = 0;
  let ex = 0;
  let answered = 0;
  PRE_ITEMS.forEach((it, i) => {
    const ok = p[i] === it.a;
    if (p[i] !== null && p[i] !== undefined) answered++;
    if (ok) score++;
    if (ok && it.lv === "EX") ex++;
    add(byLv, it.lv, ok);
    add(bySk, it.sk, ok);
    add(bySub, it.sub, ok);
    add(byArea, BANK.subs[it.sub].area, ok);
  });
  return { score, ex, exTotal: PRE_ITEMS.filter((i) => i.lv === "EX").length, answered, band: bandOf(score), byLv, bySk, bySub, byArea };
}
export interface VocabResult { score: number; tiers: number[]; start: number } // start = ระดับแรกที่ยังไม่ผ่าน (5 = ผ่านครบ)
export function gradeVocab(p: Picks): VocabResult {
  const tiers = [0, 0, 0, 0];
  let score = 0;
  PRE_VOCAB.forEach((v, i) => {
    if (p[i] === v.a) {
      score++;
      tiers[v.t - 1]++;
    }
  });
  const miss = tiers.findIndex((c) => c < TIER_PASS);
  return { score, tiers, start: miss < 0 ? 5 : miss + 1 };
}
export const tierStartText = (start: number) =>
  start >= 5 ? "ผ่านครบทั้ง 4 ระดับ — เริ่มคำศัพท์ขั้นสูง/คำเฉพาะข้อสอบได้เลย" : `เริ่มชุดคำศัพท์จากระดับ ${start} · ${BANK.tiers[String(start)].th}`;

// ── บันทึก ──
export interface GuardRec { lv?: number; aw?: number; cv?: number; ph?: number; sp?: number; cm?: string }
export interface PreRec {
  f: string; // ฉบับ
  at0: number; // เริ่มข้อสอบหลัก (เวลาเซิร์ฟเวอร์)
  a?: string; // คำตอบข้อสอบหลัก 40 ตัว
  at?: number; // ส่งข้อสอบหลัก
  ms?: number;
  to?: 1; // ส่งเพราะหมดเวลา
  sc?: number;
  ex?: number;
  bd?: string;
  g?: GuardRec;
  vt0?: number; // เริ่มชุดคำศัพท์
  v?: string;
  vat?: number;
  vs?: number;
  vto?: 1;
  r?: number; // ครูกดให้ทำใหม่ (เวลา)
}
export type PreStage = "new" | "main" | "vocab" | "done";
export function stageOf(r: PreRec | null | undefined): PreStage {
  if (!r || !r.at0) return "new";
  if (typeof r.a !== "string") return "main";
  if (typeof r.v !== "string") return "vocab";
  return "done";
}
export function parsePreRec(d: unknown): PreRec | null {
  const x = (d as { pretest4?: unknown } | null)?.pretest4;
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const num = (k: string) => (typeof r[k] === "number" && isFinite(r[k] as number) ? (r[k] as number) : undefined);
  const out: PreRec = { f: typeof r.f === "string" ? r.f : BANK.form, at0: num("at0") ?? 0 };
  if (typeof r.a === "string") out.a = r.a;
  if (typeof r.v === "string") out.v = r.v;
  for (const k of ["at", "ms", "sc", "ex", "vt0", "vat", "vs", "r"] as const) {
    const v = num(k);
    if (v !== undefined) out[k] = v;
  }
  if (r.to) out.to = 1;
  if (r.vto) out.vto = 1;
  if (typeof r.bd === "string") out.bd = r.bd;
  if (r.g && typeof r.g === "object") out.g = r.g as GuardRec;
  return out;
}
// ครูกดให้ทำใหม่ = เอกสารมีแค่ r (ไม่มี at0) หรือ r ใหม่กว่าการเริ่ม
export const isResetRec = (r: PreRec | null) => !!r && !!r.r && (!r.at0 || r.r > r.at0);

// ── สถานะในเครื่อง (ทำค้าง / ส่งไม่สำเร็จ) ──
export interface PreLocal { rec: PreRec; picks: Picks; vpicks: Picks; sent: "none" | "start" | "main" | "vocab"; cur?: number }
const LKEY = (email: string) => `pre4:${emailId(email)}`;
export function loadPreLocal(email: string): PreLocal | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LKEY(email)) : null;
    if (!raw) return null;
    const j = JSON.parse(raw) as PreLocal;
    if (!j || !j.rec || typeof j.rec.at0 !== "number") return null;
    return { ...j, picks: decodePicks(encodePicks(j.picks || []), PRE_ITEMS.length), vpicks: decodePicks(encodePicks(j.vpicks || []), PRE_VOCAB.length) };
  } catch {
    return null;
  }
}
export function savePreLocal(email: string, l: PreLocal | null) {
  try {
    if (l) localStorage.setItem(LKEY(email), JSON.stringify(l));
    else localStorage.removeItem(LKEY(email));
  } catch {
    /* ไม่เป็นไร */
  }
}
// รวมของในเครื่องกับบนระบบ: ระบบไปไกลกว่า = ใช้ระบบ · เครื่องไปไกลกว่า (ส่งไม่สำเร็จ) = ใช้เครื่อง แล้วส่งใหม่
const RANK: Record<PreStage, number> = { new: 0, main: 1, vocab: 2, done: 3 };
export function mergePre(local: PreLocal | null, cloud: PreRec | null): { rec: PreRec | null; useLocal: boolean } {
  if (isResetRec(cloud) && (!local || !cloud!.r || cloud!.r > local.rec.at0)) return { rec: null, useLocal: false };
  if (!local) return { rec: cloud && cloud.at0 ? cloud : null, useLocal: false };
  if (!cloud || !cloud.at0) return { rec: local.rec, useLocal: true };
  const lr = RANK[stageOf(local.rec)];
  const cr = RANK[stageOf(cloud)];
  if (cr > lr) return { rec: cloud, useLocal: false };
  if (lr > cr) return { rec: { ...cloud, ...local.rec }, useLocal: true };
  return { rec: { ...cloud, ...local.rec, at0: Math.min(cloud.at0, local.rec.at0) }, useLocal: true };
}

export const leftMs = (start: number, total: number, now: number) => Math.max(0, Math.min(total, start + total - now)); // นาฬิกาเครื่องคลาดเล็กน้อย → ไม่เกินเวลาเต็ม
export const fmtClock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ── หน้าครู: วิเคราะห์ทั้งห้อง ──
export interface ItemStat { n: number; id: string; p: number; d: number | null; dist: number[]; blank: number; top: number }
export interface ClassStats {
  n: number; // จำนวนคนที่ส่งส่วนที่ 1
  avg: number; // คะแนนเฉลี่ย /40
  exAvg: number;
  bands: Record<string, number>;
  byLv: Record<string, number>; // % ถูก
  bySk: Record<string, number>;
  byArea: Record<string, number>;
  bySub: { sub: string; pct: number; t: number }[]; // เรียงจากอ่อนสุด
  items: ItemStat[];
}
const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);
export function classStats(list: Picks[]): ClassStats {
  const n = list.length;
  const res = list.map((p) => ({ p, r: gradeMain(p) }));
  const sum = (f: (r: MainResult) => Record<string, Tally>) => {
    const acc: Record<string, Tally> = {};
    for (const { r } of res) for (const [k, v] of Object.entries(f(r))) {
      const a = acc[k] ?? (acc[k] = { c: 0, t: 0 });
      a.c += v.c;
      a.t += v.t;
    }
    return acc;
  };
  const toPct = (m: Record<string, Tally>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pct(v.c, v.t)]));
  const bands: Record<string, number> = Object.fromEntries(BANK.bands.map((b) => [b.id, 0]));
  for (const { r } of res) bands[r.band.id]++;
  const subs = sum((r) => r.bySub);
  const bySub = Object.keys(BANK.subs)
    .map((k) => ({ sub: k, pct: subs[k] ? pct(subs[k].c, subs[k].t) : 0, t: PRE_ITEMS.filter((i) => i.sub === k).length }))
    .sort((a, b) => a.pct - b.pct || b.t - a.t);
  // อำนาจจำแนก: กลุ่มสูง 27% − กลุ่มต่ำ 27% (ต้องมีอย่างน้อย 10 คน)
  const sorted = [...res].sort((a, b) => b.r.score - a.r.score);
  const g = Math.round(n * 0.27);
  const hi = sorted.slice(0, g);
  const lo = sorted.slice(n - g);
  const items: ItemStat[] = PRE_ITEMS.map((it, i) => {
    const dist = [0, 0, 0, 0];
    let blank = 0;
    for (const { p } of res) {
      const x = p[i];
      if (x === null || x === undefined || x < 0 || x > 3) blank++;
      else dist[x]++;
    }
    const wrong = dist.map((c, k) => (k === it.a ? -1 : c));
    const top = wrong.indexOf(Math.max(...wrong));
    const d = n >= 10 && g > 0 ? Math.round(((hi.filter((x) => x.p[i] === it.a).length - lo.filter((x) => x.p[i] === it.a).length) / g) * 100) / 100 : null;
    return { n: it.n, id: it.id, p: pct(dist[it.a], n), d, dist: dist.map((c) => pct(c, n)), blank, top };
  });
  return {
    n,
    avg: n ? Math.round((res.reduce((s, x) => s + x.r.score, 0) / n) * 10) / 10 : 0,
    exAvg: n ? Math.round((res.reduce((s, x) => s + x.r.ex, 0) / n) * 10) / 10 : 0,
    bands,
    byLv: toPct(sum((r) => r.byLv as Record<string, Tally>)),
    bySk: toPct(sum((r) => r.bySk)),
    byArea: toPct(sum((r) => r.byArea as Record<string, Tally>)),
    bySub,
    items,
  };
}
export function vocabStats(list: Picks[]): { n: number; tierPass: number[]; start: Record<number, number> } {
  const tierPass = [0, 0, 0, 0];
  const start: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of list) {
    const r = gradeVocab(p);
    r.tiers.forEach((c, k) => c >= TIER_PASS && tierPass[k]++);
    start[r.start]++;
  }
  return { n: list.length, tierPass: tierPass.map((c) => pct(c, list.length)), start };
}
// ข้อความไลน์: รายชื่อตามกลุ่ม / คนที่ยังไม่ทำ
export interface PreLineRow { no: number; name: string; band?: string | null; stage: PreStage }
export function preLineText(room: string, rows: PreLineRow[], mode: "groups" | "missing", withNames: boolean): string {
  const who = (r: PreLineRow) => (withNames ? `${r.no} ${r.name}` : `${r.no}`);
  const join = (rs: PreLineRow[]) => (withNames ? rs.map(who).join("\n") : rs.map(who).join(", "));
  if (mode === "missing") {
    const miss = rows.filter((r) => r.stage !== "done");
    const head = `📝 Pre-test ม.${room} — ยังทำไม่ครบ`;
    return miss.length ? `${head}\n${withNames ? "" : "เลขที่ "}${join(miss)}` : `${head}\n✅ ทำครบทุกคนแล้ว`;
  }
  const out = [`📝 Pre-test ม.${room} — แบ่งกลุ่มเสริม`];
  for (const b of [...BANK.bands].reverse()) {
    const rs = rows.filter((r) => r.band === b.id);
    out.push(`\n${b.th} (${b.rule}) ${rs.length} คน`);
    if (rs.length) out.push(`${withNames ? "" : "เลขที่ "}${join(rs)}`);
  }
  const miss = rows.filter((r) => !r.band);
  if (miss.length) out.push(`\nยังไม่ได้ทำ ${miss.length} คน: ${miss.map((r) => r.no).join(", ")}`);
  return out.join("\n");
}
