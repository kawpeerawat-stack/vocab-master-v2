// app/lib/student.ts
// ─────────────────────────────────────────────────────────────
// ข้อมูลตัวตนนักเรียน (กรอกแยกช่อง: ชื่อ · นามสกุล · เลขที่ · ชั้นเรียน · อีเมล)
//   - ไฟล์นี้ใช้ในหน้านักเรียน จึง "ไม่" import รายชื่อนักเรียน (data/roster.json)
//     การตรวจกับรายชื่อของครูทำที่เซิร์ฟเวอร์ผ่าน /api/roster เพื่อไม่ให้รายชื่อหลุดไปกับหน้าเว็บ
//   - ชื่อที่บันทึกขึ้นระบบ = "ชื่อ นามสกุล No.เลขที่ M.ห้อง" (หน้าครูแยกห้อง/เลขที่จากรูปแบบนี้ได้แน่นอน)
//     และเก็บแยกช่องไว้ใน students/{email}.profile ด้วย
// ─────────────────────────────────────────────────────────────
import { db } from "./firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export {
  GRADES,
  gradeOf,
  ROOM_OPTIONS,
  MAX_NO,
  cleanNamePart,
  composeName,
  displayName,
  roomOf,
  extractNo,
  profileFromLegacyName,
  validateProfile,
} from "./names";
export type { StudentProfile, ProfileField } from "./names";
import type { StudentProfile } from "./names";
import { composeName } from "./names";

// ตรวจกับรายชื่อของครู (ที่เซิร์ฟเวอร์) — ok = ตรง · อื่น ๆ = ให้นักเรียนตรวจอีกครั้งก่อนยืนยัน
export type RosterCheck = "ok" | "partial" | "elsewhere" | "mismatch" | "notfound" | "unknown";
export async function checkRoster(p: Pick<StudentProfile, "first" | "last" | "no" | "room">): Promise<RosterCheck> {
  try {
    const q = new URLSearchParams({ room: p.room, no: String(p.no), first: p.first, last: p.last });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`/api/roster?${q.toString()}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return "unknown";
    const j = (await res.json()) as { result?: RosterCheck };
    return j.result ?? "unknown";
  } catch {
    return "unknown";
  }
}

function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}

// บันทึกข้อมูลตัวตนแยกช่องขึ้นระบบ (เรียกตอนเข้าสู่ระบบ) — ไม่สำเร็จก็ไม่เป็นไร ชื่อรวมยังถูกบันทึกพร้อมผลการเรียน
export async function saveProfile(p: StudentProfile): Promise<boolean> {
  if (!db || !p.email) return false;
  try {
    await Promise.race([
      setDoc(
        doc(db, "students", emailToId(p.email)),
        {
          name: composeName(p),
          email: p.email.trim().toLowerCase(),
          profile: { first: p.first, last: p.last, no: p.no, room: p.room },
          profileAt: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
    ]);
    return true;
  } catch (e) {
    console.error("saveProfile error:", e);
    return false;
  }
}
