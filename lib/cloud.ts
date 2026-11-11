// lib/cloud.ts
// ─────────────────────────────────────────────────────────────
//  เก็บความก้าวหน้ารายคนของ Grammar ขึ้น Firestore (ใช้อีเมลเป็นกุญแจ)
//  collection "grammarStudents", document id = อีเมล (ตัวพิมพ์เล็ก)
//
//  ภาคเรียนที่ 2/2569 (TERM = "2569-2")
//   • เก็บเฉพาะข้อมูลเทอมนี้: ชื่อ / อีเมล / profile (ชื่อ-ห้อง-เลขที่) / setBest คีย์ "T-…" / จำนวนรอบ
//   • ข้อมูลเทอมก่อน (topicProgress, correctIds, XP, คะแนนชุดเก่า EX-/MX-) ถูกล้างอัตโนมัติ
//     ตอนนักเรียนบันทึกครั้งแรกของเทอม หรือครูกด "ล้างข้อมูลเทอมก่อน" ในหน้า Admin
//   • หน้า Admin ฟังข้อมูลแบบ Real Time (onSnapshot) — โหลดครบครั้งแรกครั้งเดียว
//     จากนั้นรับเฉพาะเอกสารของนักเรียนที่คะแนนเปลี่ยน
// ─────────────────────────────────────────────────────────────
import { db, auth } from "./firebase";
import {
  doc, getDoc, setDoc, serverTimestamp, collection, getDocs, deleteField, onSnapshot,
} from "firebase/firestore";

const COLLECTION = "grammarStudents";

// ภาคเรียนปัจจุบัน + คีย์คะแนนของเทอมนี้ (ชุดหัวข้อ T-SS… และชุดรวม T-MX1… รวมคีย์รายพาร์ท T-SS:E)
export const TERM = "2569-2";
export const isTermKey = (k: string) => k.startsWith("T-");
// ฟิลด์ของเทอมก่อนที่ไม่ใช้แล้ว → ลบทิ้งเมื่อเจอ
const LEGACY_FIELDS = ["topicProgress", "correctIds", "weeklyXp", "weekId", "bestScore", "lastScore"];

function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}

function termSetBest(src: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(src || {}).forEach(([k, v]) => { if (isTermKey(k) && typeof v === "number") out[k] = v; });
  return out;
}

export interface GrammarProgress {
  name: string;
  email: string;
  term?: string;                          // "2569-2" = ข้อมูลเทอมนี้แล้ว (ล้างของเทอมก่อนแล้ว)
  masteredTopics: string[];               // หัวข้อที่ผ่าน (ทุกพาร์ท ≥ 3/5)
  masteredCount: number;
  totalRounds: number;                    // จำนวนรอบที่ทำจบในเทอมนี้
  setBest?: Record<string, number>;       // คะแนนดีสุดรายชุด (T-xx) + รายพาร์ท (T-xx:E / :S / :C)
  profile?: StudentProfile;               // ข้อมูลที่นักเรียนกรอกแยกช่อง (ชื่อ-นามสกุล / ห้อง / เลขที่)
  lastSet?: LastSet;                      // ชุดที่ทำจบล่าสุด → หน้า Admin โชว์ "ส่งงานล่าสุด" แบบสด
  guard?: Record<string, GuardRecord>;    // ผลระบบกัน AI รายชุด (รอบล่าสุด)
}

// ชุดที่ทำจบล่าสุด (round = รอบที่เท่าไรของเทอม ใช้แยกว่าเป็นการส่งครั้งใหม่) + ผลระบบกัน AI ของรอบนั้น
export interface LastSet { id: string; score: number; round: number; g?: GuardRecord; p?: "E" | "S" | "C" } // p = ทำเฉพาะพาร์ทนั้น (5 ข้อ)

// ── เกณฑ์ผ่าน: แต่ละพาร์ท (Error / Sentence / Cloze) ต้องได้ ≥ 60% (5 ข้อ → 3/5) — มีระบบกล้องตรวจจับแล้ว จึงไม่ตั้งเกณฑ์ตึงเกินไป ──
export const PASS_RATIO = 0.6;
export const passMark = (n: number) => Math.ceil(n * PASS_RATIO - 1e-9);
export interface ExamSetMeta { id: string; topic: string; total: number; parts?: { E: number; S: number; C: number } }
// ผ่านหัวข้อ = ทุกพาร์ทที่มีข้อ ได้ถึงเกณฑ์ (คีย์รายพาร์ท T-xx:E/:S/:C) · ไม่มีคีย์รายพาร์ทเลย (ข้อมูลเก่า) → ดูคะแนนรวมถึง 60%
export function topicPassed(best: Record<string, number> | undefined, es: ExamSetMeta): boolean {
  if (!es.total) return false;
  const b = best || {};
  const keys = (["E", "S", "C"] as const).filter(k => (es.parts?.[k] ?? 0) > 0);
  const anyPart = keys.some(k => b[`${es.id}:${k}`] !== undefined);
  if (keys.length && anyPart) return keys.every(k => (b[`${es.id}:${k}`] ?? 0) >= passMark(es.parts![k]));
  return (b[es.id] ?? 0) >= passMark(es.total);
}

// ผลระบบกัน AI ต่อชุด (รอบล่าสุด) — gl ออกจากหน้า/หน้าต่างบัง · gf ไม่เห็นใบหน้า · gp เห็นมือถือในกล้อง · gb เสียโฟกัสสั้น ๆ
// gv ข้อที่ไม่ได้คะแนน · cam เปิดกล้อง · gm log/enforce · mx = ครั้งมากที่สุดที่เคยเกิดในชุดนี้ · n = จำนวนรอบที่ทำ
export interface GuardRecord { gl: number; ga: number; gb: number; gf: number; gp?: number; gw?: number; gv: number; cam: boolean; gm: "log" | "enforce"; at?: number; mx?: number; n?: number }
const toGuardMap = (src: unknown): Record<string, GuardRecord> => {
  const out: Record<string, GuardRecord> = {};
  if (src && typeof src === "object") Object.entries(src as Record<string, GuardRecord>).forEach(([k, v]) => { if (isTermKey(k) && v && typeof v === "object") out[k] = v; });
  return out;
};

// ข้อมูลนักเรียนที่กรอกแยกช่องตอนเข้าใช้งาน → หน้า Admin จับคู่ทะเบียนด้วย ห้อง + เลขที่ ได้ตรง ๆ
export interface StudentProfile {
  fullName: string;
  room: string;   // เช่น "6/1"
  no: number;     // เลขที่
}

export async function loadGrammarProgress(email: string): Promise<GrammarProgress | null> {
  if (!email) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, emailToId(email)));
    if (!snap.exists()) return null;
    const d = snap.data() as GrammarProgress;
    return { ...d, setBest: termSetBest(d.setBest) }; // ส่งเฉพาะคะแนนเทอมนี้ให้แอป
  } catch (e) {
    console.error("loadGrammarProgress error:", e);
    return null;
  }
}

export async function saveGrammarProgress(params: {
  name: string;
  email: string;
  masteredTopics: string[];
  setScores?: Record<string, number>;
  countRound?: boolean; // false = ซิงค์คะแนนเฉย ๆ ไม่นับเป็นรอบ
  examSets?: ExamSetMeta[]; // ชุดข้อสอบรายหัวข้อ → ผ่านหัวข้อ = ทุกพาร์ทได้ ≥ 3/5
  profile?: StudentProfile;  // ชื่อ-นามสกุล / ห้อง / เลขที่ (บันทึกทับค่าเดิมทุกครั้ง)
  lastSet?: { id: string; score: number; p?: "E" | "S" | "C" }; // ชุดที่เพิ่งทำจบ (เฉพาะตอนนับรอบ) · p = ทำเฉพาะพาร์ท
  guard?: Omit<GuardRecord, "at" | "mx" | "n">; // ผลระบบกัน AI ของรอบนี้ (คู่กับ lastSet)
}): Promise<boolean> {
  const { name, masteredTopics, setScores } = params;
  const countRound = params.countRound !== false;
  // ใช้อีเมลจาก Firebase ก่อน ถ้าไม่มี (ล็อกอินแบบพิมพ์อีเมลเอง) ใช้อีเมลที่กรอก
  const user = auth?.currentUser;
  const email = (user?.email || params.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return false;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const prev = await getDoc(ref);
    const pd = prev.exists() ? (prev.data() as Partial<GrammarProgress> & Record<string, unknown>) : null;
    const sameTerm = pd?.term === TERM;
    // ผสานกับคะแนนบนคลาวด์ (เอาค่าสูงสุด) — เก็บเฉพาะคีย์ของเทอมนี้ (T-…)
    const mergedSetBest = termSetBest(setScores);
    Object.entries(termSetBest(pd?.setBest)).forEach(([k, v]) => {
      mergedSetBest[k] = Math.max(mergedSetBest[k] ?? 0, v ?? 0);
    });
    // หัวข้อที่ผ่าน = ทุกพาร์ทได้ถึงเกณฑ์ 3/5 — คำนวณจากคะแนนรวมบนคลาวด์เสมอ
    let mastered = masteredTopics;
    if (params.examSets && params.examSets.length) {
      mastered = params.examSets.filter(es => topicPassed(mergedSetBest, es)).map(es => es.topic);
    }
    const payload: Record<string, unknown> = {
      name,
      email,
      term: TERM,
      setBest: mergedSetBest,          // เขียนทับทั้งก้อน → คีย์ชุดเก่าหายไปเอง
      masteredTopics: mastered,
      masteredCount: mastered.length,
      totalRounds: (sameTerm ? (pd?.totalRounds ?? 0) : 0) + (countRound ? 1 : 0),
      updatedAt: serverTimestamp(),
    };
    if (params.profile && params.profile.fullName && params.profile.room && params.profile.no) {
      payload.profile = { fullName: params.profile.fullName, room: params.profile.room, no: params.profile.no };
    }
    if (countRound && params.lastSet) {
      const ls: LastSet = { id: params.lastSet.id, score: params.lastSet.score, round: payload.totalRounds as number };
      if (params.lastSet.p) ls.p = params.lastSet.p;
      if (params.guard && isTermKey(params.lastSet.id)) {
        const map = sameTerm ? toGuardMap(pd?.guard) : {};
        const prevG = map[params.lastSet.id];
        const hits = params.guard.gl + params.guard.gf + (params.guard.gp || 0);
        const rec: GuardRecord = { ...params.guard, at: Date.now(), mx: Math.max(prevG?.mx ?? 0, hits), n: (prevG?.n ?? 0) + 1 };
        map[params.lastSet.id] = rec;
        payload.guard = map;
        ls.g = rec;
      }
      payload.lastSet = ls;
    }
    // บันทึกครั้งแรกของเทอม → ลบข้อมูลเทอมก่อนทิ้ง (เก็บชื่อ / อีเมล / profile ไว้)
    if (pd && !sameTerm) LEGACY_FIELDS.forEach(f => { if (f in pd) payload[f] = deleteField(); });
    await setDoc(ref, payload, { mergeFields: Object.keys(payload) });
    return true;
  } catch (e) {
    console.error("saveGrammarProgress error:", e);
    return false;
  }
}

// ── สำหรับหน้า Admin ──────────────────────────────────────────
export interface GrammarStudentRow {
  email: string;
  name: string;
  totalRounds: number;                    // จำนวนรอบที่ทำจบในเทอมนี้
  updatedAt: number | null;               // เวลาเข้าทำล่าสุด (epoch ms)
  setBest: Record<string, number>;        // คะแนนดีสุดเทอมนี้ (T-…) + รายพาร์ท (T-…:E/S/C)
  profile: StudentProfile | null;         // ข้อมูลที่นักเรียนกรอกแยกช่อง (ถ้ามี)
  lastSet: LastSet | null;                // ชุดที่ทำจบล่าสุด (เทอมนี้)
  guard: Record<string, GuardRecord>;     // ผลระบบกัน AI รายชุด (รอบล่าสุด)
  legacy: boolean;                        // ยังมีข้อมูลเทอมก่อนค้างอยู่ (ยังไม่ถูกล้าง)
}

function toRow(id: string, raw: Record<string, unknown>): GrammarStudentRow {
  const data = raw as Partial<GrammarProgress> & { updatedAt?: { toMillis?: () => number } };
  const sameTerm = data.term === TERM;
  return {
    email: data.email ?? id,
    name: data.name ?? (data.email ?? id),
    totalRounds: sameTerm ? (data.totalRounds ?? 0) : 0,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
    setBest: termSetBest(data.setBest),
    profile: data.profile && data.profile.room && data.profile.no ? data.profile : null,
    lastSet: sameTerm && data.lastSet && isTermKey(data.lastSet.id || "") ? data.lastSet : null,
    guard: sameTerm ? toGuardMap(data.guard) : {},
    legacy: !sameTerm,
  };
}

export interface LiveInfo {
  first: boolean;          // snapshot แรก (โหลดครบทุกคน)
  changed: string[];       // อีเมลที่เพิ่ง เพิ่ม/เปลี่ยน (ไม่รวม snapshot แรก)
  fromCache: boolean;      // true = ออฟไลน์ แสดงข้อมูลล่าสุดที่มี
}

// ฟังข้อมูลนักเรียนทุกคนแบบ Real Time → คืนฟังก์ชันหยุดฟัง
// ครั้งแรกอ่านทุกเอกสาร 1 รอบ จากนั้น Firestore ส่งมาเฉพาะเอกสารที่เปลี่ยน
export function subscribeGrammarStudents(
  onData: (rows: GrammarStudentRow[], info: LiveInfo) => void,
  onError: (e: Error) => void,
): () => void {
  let first = true;
  return onSnapshot(
    collection(db, COLLECTION),
    { includeMetadataChanges: true },
    (snap) => {
      const rows: GrammarStudentRow[] = [];
      snap.forEach((d) => { rows.push(toRow(d.id, d.data())); });
      const changed = first ? [] : snap.docChanges()
        .filter(c => c.type !== "removed" && !c.doc.metadata.hasPendingWrites)
        .map(c => toRow(c.doc.id, c.doc.data()).email.toLowerCase());
      onData(rows, { first, changed, fromCache: snap.metadata.fromCache });
      first = false;
    },
    (e) => { console.error("subscribeGrammarStudents error:", e); onError(e); },
  );
}

// สำรองข้อมูลดิบทุกคน (ใช้ก่อนล้างข้อมูลเทอมก่อน)
export async function loadAllGrammarStudentsRaw(): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const snap = await getDocs(collection(db, COLLECTION));
  const out: { id: string; data: Record<string, unknown> }[] = [];
  snap.forEach(d => out.push({ id: d.id, data: d.data() }));
  return out;
}

// ล้างข้อมูลเทอมก่อนของนักเรียน 1 คน (ครูกดจากหน้า Admin) — เก็บชื่อ / อีเมล / profile / คะแนนเทอมนี้ไว้
// คืนค่า "ok" | "denied" (กฎ Firestore ไม่ให้ครูเขียนเอกสารของนักเรียน) | "error"
export async function cleanupLegacyStudent(
  id: string, raw: Record<string, unknown>,
  examSets: ExamSetMeta[],
): Promise<"ok" | "denied" | "error"> {
  try {
    const d = raw as Partial<GrammarProgress> & Record<string, unknown>;
    const best = termSetBest(d.setBest);
    const mastered = examSets.filter(es => topicPassed(best, es)).map(es => es.topic);
    const payload: Record<string, unknown> = {
      term: TERM, setBest: best, masteredTopics: mastered, masteredCount: mastered.length, totalRounds: 0,
    };
    LEGACY_FIELDS.forEach(f => { if (f in d) payload[f] = deleteField(); });
    await setDoc(doc(db, COLLECTION, id), payload, { mergeFields: Object.keys(payload) });
    return "ok";
  } catch (e) {
    console.error("cleanupLegacyStudent error:", e);
    const code = (e as { code?: string })?.code || "";
    return code.includes("permission-denied") ? "denied" : "error";
  }
}

// ── จับคู่มือ (หน้า Admin): ครูยืนยันตัวตนนักเรียนที่ระบบอัตโนมัติจับคู่ไม่ได้ ──
// เก็บไว้ที่เดียว: doc "adminData/manualOverrides" ฟิลด์ overrides = { [อีเมล]: {room, no, officialName, linkedAt} }
// ต้องตั้งกฎ Firestore ให้ "เขียน" ได้เฉพาะอีเมลแอดมินเท่านั้น (อ่านได้ทุกคนเพื่อให้หน้า Admin โหลดได้)
export interface ManualOverrideEntry {
  room: string;
  no: number;
  officialName: string; // เก็บชื่อทางการไว้ด้วยเผื่อดูย้อนหลัง/ตรวจสอบ
  linkedAt: number;      // เวลาที่จับคู่ (epoch ms) — ไว้ตรวจสอบย้อนหลัง
}

const OVERRIDES_DOC = doc(db, "adminData", "manualOverrides");

export async function loadManualOverrides(): Promise<Record<string, ManualOverrideEntry>> {
  try {
    const snap = await getDoc(OVERRIDES_DOC);
    if (!snap.exists()) return {};
    const data = snap.data() as { overrides?: Record<string, ManualOverrideEntry> };
    return data.overrides ?? {};
  } catch (e) {
    console.error("loadManualOverrides error:", e);
    return {};
  }
}

export async function saveManualOverride(
  email: string, room: string, no: number, officialName: string
): Promise<boolean> {
  const key = email.trim().toLowerCase();
  if (!key) return false;
  try {
    await setDoc(
      OVERRIDES_DOC,
      { overrides: { [key]: { room, no, officialName, linkedAt: Date.now() } } },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.error("saveManualOverride error:", e);
    return false;
  }
}

export async function removeManualOverride(email: string): Promise<boolean> {
  const key = email.trim().toLowerCase();
  if (!key) return false;
  try {
    await setDoc(OVERRIDES_DOC, { overrides: { [key]: deleteField() } }, { merge: true });
    return true;
  } catch (e) {
    console.error("removeManualOverride error:", e);
    return false;
  }
}
