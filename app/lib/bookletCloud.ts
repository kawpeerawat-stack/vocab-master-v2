// app/lib/bookletCloud.ts — ส่ง/อ่านความก้าวหน้า Smart Booklet บนระบบ (13 พ.ย. 2569)
//   อ่านเฉพาะเอกสารของอีเมลที่เข้าอยู่ · เขียนเฉพาะช่อง booklet.parts.{n} ด้วย setDoc merge (เหมือน rounds.ts)
//   ใช้ตัวส่งกลางของแอป: ส่งทีละครั้ง · แจ้งเน็ตช้า · แยกสาเหตุที่ส่งไม่ได้ (รหัส N1/V2/F3/Q4/E5)
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { serial, verifiedWrite, type SyncIssue } from "./sync";
import { cloudPartData, emailId, parseCloudBooklet, type BookProg, type PartRec } from "./booklet";

export async function readCloudBooklet(email: string, timeoutMs = 4000): Promise<BookProg | null> {
  if (!email || !db) return null;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "students", emailId(email))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return snap.exists() ? parseCloudBooklet(snap.data()) : {};
  } catch (e) {
    console.warn("booklet cloud:", e);
    return null;
  }
}

export type BookWrite = { ok: true } | { ok: false; issue: SyncIssue };
export function writeCloudPart(email: string, part: number, rec: PartRec, onSlow?: () => void): Promise<BookWrite> {
  if (!db) return Promise.resolve({ ok: false, issue: "error" });
  const fs = db;
  return serial(`bk:${emailId(email)}`, () =>
    verifiedWrite(() => setDoc(doc(fs, "students", emailId(email)), { booklet: { parts: { [String(part)]: cloudPartData(rec) } } }, { merge: true }), onSlow)
  );
}
