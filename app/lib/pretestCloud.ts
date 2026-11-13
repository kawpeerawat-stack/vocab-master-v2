// app/lib/pretestCloud.ts — ส่ง/อ่านผล Pre-test ม.4 บนระบบ (13 พ.ย. 2569)
//   อ่านเฉพาะเอกสารของอีเมลที่เข้าอยู่ · เขียนเฉพาะช่อง pretest4 ด้วย setDoc merge (เหมือน bookletCloud.ts)
import { doc, getDoc, setDoc } from "firebase/firestore";
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
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  return serial(`pre4:${emailId(email)}`, () => verifiedWrite(() => setDoc(doc(fs, "students", emailId(email)), { pretest4: clean }, { merge: true }), onSlow));
}
