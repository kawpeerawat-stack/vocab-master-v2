import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider, getToken, type AppCheck } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyBc9vwV3bvHzOwzlwjtOTsE1Ce7fHEktm8",
  authDomain: "smart-vocab-master.firebaseapp.com",
  projectId: "smart-vocab-master",
  storageBucket: "smart-vocab-master.firebasestorage.app",
  messagingSenderId: "225185933112",
  appId: "1:225185933112:web:16d0d75359279ec44a83cd"
};

// reCAPTCHA v3 site key — เป็น "คีย์สาธารณะ" ใส่ในโค้ดได้ (ความลับคือ secret ที่อยู่ใน Firebase Console)
// ⚠️ เปลี่ยนค่าด้านล่างเป็น site key จริงของคุณครู (จากขั้นตอนตั้งค่า reCAPTCHA)
const RECAPTCHA_SITE_KEY = "6Lfc1hgtAAAAAA_ots_YmAA7Xc6q_1qgcz0G2xIp";

// ป้องกัน initialize ซ้ำ
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

let appCheck: AppCheck | null = null;

// ── App Check: อนุญาตเฉพาะคำขอจากแอปจริงของเรา (รันบนเบราว์เซอร์ที่มี site key เท่านั้น) ──
if (typeof window !== "undefined" && RECAPTCHA_SITE_KEY) {
  // ตอนพัฒนาในเครื่อง (localhost) ใช้ debug token เพื่อไม่ให้ App Check บล็อก
  if (process.env.NODE_ENV === "development") {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("App Check init error:", e);
  }
}

export const auth = typeof window !== "undefined" ? getAuth(app) : null as any;
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// ต่ออายุใบยืนยันแอป (App Check) — เรียกเมื่อนักเรียนกลับเข้าหน้าแอป (เช่น จอดับช่วงพักคาบ) และก่อนส่งผล
//   คืนค่า true = ใช้ได้ · false = ยืนยันไม่ผ่าน (ให้นักเรียนปิดแท็บแล้วเปิดใหม่)
let lastCheck = 0;
export async function refreshAppCheck(): Promise<boolean> {
  if (!appCheck) return true;
  if (Date.now() - lastCheck < 20000) return true; // ไม่ถามถี่เกินไป
  try {
    // รอไม่เกิน 6 วินาที (เน็ตช้า/โหลด reCAPTCHA ไม่ขึ้น → ไม่รู้ผล ให้ลองส่งไปก่อน ระบบจะบอกสาเหตุเองถ้าถูกปฏิเสธ)
    const r = await Promise.race([
      getToken(appCheck, false).then(() => "ok" as const),
      new Promise<"wait">((res) => setTimeout(() => res("wait"), 6000)),
    ]);
    if (r === "ok") lastCheck = Date.now();
    return true;
  } catch (e) {
    console.error("App Check refresh failed:", e);
    return false;
  }
}
