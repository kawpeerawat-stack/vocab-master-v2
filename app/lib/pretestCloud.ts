// app/lib/pretestCloud.ts — ส่ง/อ่านผล Pre-test ม.4 บนระบบ (13 พ.ย. 2569)
//   อ่านเฉพาะเอกสารของอีเมลที่เข้าอยู่ · เขียนเฉพาะช่อง pretest4 ด้วย setDoc merge (เหมือน bookletCloud.ts)
import { deleteField, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { emailId } from "./booklet";
import { parsePreRec, type PreRec } from "./pretest";
import { serial, verifiedWrite, type SyncIssue } from "./sync";

// คืน undefined = อ่านไม่ได้ (เน็ต) · null = ยังไม่มีผล
export async function readCloudPre(email: string, timeoutMs = 4000): Promise<PreRec | null | undefined> {
  if (!email || !db) return undefined;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "students", emailId(email))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return snap.exists() ? parsePreRec(snap.data()) : null;
  } catch (e) {
    console.warn("pretest cloud:", e);
    return undefined;
  }
}

export type PreWrite = { ok: true } | { ok: false; issue: SyncIssue };
export function writeCloudPre(email: string, data: Partial<PreRec>, onSlow?: () => void): Promise<PreWrite> {
  if (!db) return Promise.resolve({ ok: false, issue: "error" });
  const fs = db;
  const clean: Record<string, unknown> = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  // เขียน "เริ่มทำ" (มี at0 แต่ยังไม่มีคำตอบ) = ล้างผลเก่าค้างในเอกสาร (เช่น ผลทดลองจากข้อสอบฉบับ 40 ข้อ) กันปนกับผลใหม่
  if (data.at0 && typeof data.a !== "string") {
    for (const k of ["a", "ts", "sl", "vts", "vsl", "at", "ms", "to", "sc", "ex", "bd", "g", "vt0", "v", "vat", "vs", "vto"]) if (!(k in clean)) clean[k] = deleteField();
  }
  return serial(`pre4:${emailId(email)}`, () => verifiedWrite(() => setDoc(doc(fs, "students", emailId(email)), { pretest4: clean }, { merge: true }), onSlow));
}
