// app/lib/camHelp.ts — จัดประเภท "เปิดกล้องไม่ได้" แล้วบอกวิธีแก้ที่ตรงกับเครื่องนักเรียน (13 พ.ย. 2569)
//   • อ่านรหัสข้อผิดพลาดของเบราว์เซอร์ (NotAllowedError, NotReadableError, ...) + ประเภทเครื่อง (iPhone/Android/คอม) + เบราว์เซอร์
//   • แยกเบราว์เซอร์ในแอป (LINE/Facebook/Instagram/TikTok ...) ออกมาเป็นอีกกรณี
//   • ไม่มี React / ไม่ import อะไร → ทดสอบแยกได้ · ข้อความทั้งหมดเป็นภาษาไทยสำหรับนักเรียน
//   • รหัสอาการ (A1, B1 ...) ให้นักเรียนถ่ายรูปส่งครู เพื่อดูว่าปัญหาส่วนใหญ่มาจากอะไร

export type CamKind =
  | "blocked" // A1 กดบล็อก/ไม่อนุญาตไว้ (เว็บนี้)
  | "dismissed" // A2 ปิดหน้าต่างขอสิทธิ์ทิ้ง
  | "system" // A3 เบราว์เซอร์ได้สิทธิ์แล้วแต่ระบบเครื่อง/ผู้ดูแลไม่ให้
  | "busy" // B1 แอป/แท็บอื่นใช้กล้องอยู่
  | "nodevice" // C1 ระบบมองไม่เห็นกล้อง
  | "inapp" // D1 เปิดในเบราว์เซอร์ของแอป
  | "unsupported" // E1 เบราว์เซอร์ไม่รองรับ/เก่า
  | "insecure" // E2 ไม่ใช่ https
  | "framed" // E3 หน้าถูกฝังในหน้าอื่น
  | "constraint" // F1 กล้องไม่รองรับค่าที่ขอ
  | "detector" // G1 กล้องเปิดได้ แต่ตัวตรวจใบหน้าทำงานไม่ได้
  | "unknown"; // Z0

export const CAM_CODE: Record<CamKind, string> = {
  blocked: "A1",
  dismissed: "A2",
  system: "A3",
  busy: "B1",
  nodevice: "C1",
  inapp: "D1",
  unsupported: "E1",
  insecure: "E2",
  framed: "E3",
  constraint: "F1",
  detector: "G1",
  unknown: "Z0",
};

export type CamPlatform = "ios" | "android" | "windows" | "mac" | "chromeos" | "other";
export type CamBrowser = "safari" | "chrome" | "samsung" | "firefox" | "edge" | "other";

export interface CamEnv {
  platform: CamPlatform;
  browser: CamBrowser;
  inApp: string | null; // ชื่อแอปที่ครอบเบราว์เซอร์ (LINE, Facebook, ...) หรือ null
  secure: boolean; // https / localhost
  framed: boolean; // อยู่ใน iframe
  hasMedia: boolean; // navigator.mediaDevices.getUserMedia มีหรือไม่
}

export interface CamProbe {
  permission: "granted" | "denied" | "prompt" | null; // สิทธิ์กล้องของเว็บนี้ (Safari อ่านไม่ได้ = null)
  videoInputs: number | null; // จำนวนกล้องที่ระบบเห็น (null = อ่านไม่ได้)
}

export const NO_PROBE: CamProbe = { permission: null, videoInputs: null };

export interface CamDiag {
  kind: CamKind;
  code: string;
  title: string;
  why: string;
  steps: string[];
  more?: { title: string; steps: string[] }; // วิธีที่สอง (พับไว้) เมื่อวิธีแรกไม่หาย
  name: string; // ชื่อ error เช่น NotAllowedError
  envText: string; // เช่น "iPhone · Safari"
}

const IN_APPS: [RegExp, string][] = [
  [/\bLine\//i, "LINE"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/MicroMessenger/i, "WeChat"],
  [/KAKAOTALK/i, "KakaoTalk"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Twitter/i, "X (Twitter)"],
  [/; wv\)/i, "แอปอื่น (WebView)"],
];

type NavLike = { userAgent?: string; platform?: string; maxTouchPoints?: number; mediaDevices?: { getUserMedia?: unknown } };
type WinLike = { isSecureContext?: boolean; top?: unknown; self?: unknown };

export function detectEnv(nav: NavLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as unknown as NavLike), win: WinLike | undefined = typeof window === "undefined" ? undefined : (window as unknown as WinLike)): CamEnv {
  const ua = nav?.userAgent ?? "";
  const iPadOs = /Macintosh/i.test(ua) && (nav?.maxTouchPoints ?? 0) > 1; // iPad ที่ขอเว็บแบบคอม
  let platform: CamPlatform = "other";
  if (/iPhone|iPad|iPod/i.test(ua) || iPadOs) platform = "ios";
  else if (/Android/i.test(ua)) platform = "android";
  else if (/CrOS/i.test(ua)) platform = "chromeos";
  else if (/Windows/i.test(ua)) platform = "windows";
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = "mac";

  let browser: CamBrowser = "other";
  if (/EdgiOS|EdgA|Edg\//i.test(ua)) browser = "edge";
  else if (/SamsungBrowser/i.test(ua)) browser = "samsung";
  else if (/FxiOS|Firefox/i.test(ua)) browser = "firefox";
  else if (/CriOS|Chrome\//i.test(ua)) browser = "chrome";
  else if (/Safari\//i.test(ua)) browser = "safari";
  else if (platform === "ios") browser = "safari"; // เบราว์เซอร์ในแอปบน iOS ไม่มีคำว่า Safari/ เสมอไป

  let inApp: string | null = null;
  for (const [re, name] of IN_APPS) {
    if (re.test(ua)) {
      inApp = name;
      break;
    }
  }
  let framed = false;
  try {
    framed = !!win && win.top !== win.self;
  } catch {
    framed = true; // อ่าน top ไม่ได้ = ข้ามโดเมน = อยู่ใน iframe
  }
  return {
    platform,
    browser,
    inApp,
    secure: win?.isSecureContext !== false,
    framed,
    hasMedia: !!nav?.mediaDevices?.getUserMedia,
  };
}

const PLATFORM_TEXT: Record<CamPlatform, string> = { ios: "iPhone/iPad", android: "Android", windows: "Windows", mac: "Mac", chromeos: "Chromebook", other: "เครื่องอื่น" };
const BROWSER_TEXT: Record<CamBrowser, string> = { safari: "Safari", chrome: "Chrome", samsung: "Samsung Internet", firefox: "Firefox", edge: "Edge", other: "เบราว์เซอร์อื่น" };
export function envText(env: CamEnv): string {
  return `${PLATFORM_TEXT[env.platform]} · ${env.inApp ? `ในแอป ${env.inApp}` : BROWSER_TEXT[env.browser]}`;
}

// "NotAllowedError: Permission denied" → { name, message }
export function parseCamError(raw: string): { name: string; message: string } {
  const s = (raw || "").trim();
  const m = /^([A-Za-z]+(?:Error|Exception)|NoMediaDevices)(?:\s*[:：]\s*([\s\S]*))?$/.exec(s);
  if (m) return { name: m[1], message: (m[2] || "").trim() };
  return { name: "", message: s };
}

// ชื่อเบราว์เซอร์ที่ใช้พูดในขั้นตอน
function browserName(env: CamEnv): string {
  if (env.platform === "ios") return env.browser === "chrome" ? "Chrome" : env.browser === "firefox" ? "Firefox" : env.browser === "edge" ? "Edge" : "Safari";
  return BROWSER_TEXT[env.browser];
}

// วิธีเปิดสิทธิ์ของเว็บนี้ (ระดับเว็บไซต์)
function siteAllowSteps(env: CamEnv): string[] {
  switch (env.platform) {
    case "ios":
      return env.browser === "safari"
        ? ["กดตัว “aA” ทางซ้ายของช่องที่อยู่เว็บ → “การตั้งค่าเว็บไซต์” (Website Settings)", "ตรง “กล้อง” เลือก “อนุญาต” (Allow)", "กลับมาที่หน้านี้ แล้วกด “ลองเปิดกล้องอีกครั้ง” (ถ้ายังไม่ขึ้น ให้ดึงหน้าลงเพื่อโหลดใหม่)"]
        : [`เปิด ตั้งค่า (Settings) ของ iPhone → เลื่อนหา “${browserName(env)}” → เปิดสวิตช์ “กล้อง”`, "กลับมาที่หน้านี้ แล้วกด “ลองเปิดกล้องอีกครั้ง”"];
    case "android":
      return env.browser === "samsung"
        ? ["กดเมนู ≡ → การตั้งค่า → “ไซต์และการดาวน์โหลด” → “สิทธิ์ของไซต์” → กล้อง → เปิดให้เว็บนี้", "กลับมาที่หน้านี้ แล้วกด “ลองเปิดกล้องอีกครั้ง”"]
        : ["กดไอคอนทางซ้ายของช่องที่อยู่เว็บ (รูปกุญแจ 🔒 หรือไอคอนปรับแต่ง) → “สิทธิ์” (Permissions) → “กล้อง” → เลือก “อนุญาต”", "กลับมาที่หน้านี้ แล้วกด “ลองเปิดกล้องอีกครั้ง” (ถ้ายังไม่ขึ้น ให้โหลดหน้าใหม่)"];
    case "mac":
      return env.browser === "safari"
        ? ["เมนู Safari → “การตั้งค่า” (Settings) → แท็บ “เว็บไซต์” → “กล้อง” → ตั้งเว็บนี้เป็น “อนุญาต”", "โหลดหน้าใหม่ แล้วกด “ลองเปิดกล้องอีกครั้ง”"]
        : ["กดไอคอนทางซ้ายของช่องที่อยู่เว็บ (กุญแจ 🔒) → “กล้อง” → เปิดสวิตช์เป็นอนุญาต", "โหลดหน้าใหม่ (⌘R) แล้วกด “ลองเปิดกล้องอีกครั้ง”"];
    default:
      return ["กดไอคอนทางซ้ายของช่องที่อยู่เว็บ (รูปกุญแจ 🔒) → “กล้อง” → เลือก “อนุญาต”", "โหลดหน้าใหม่ (F5) แล้วกด “ลองเปิดกล้องอีกครั้ง”"];
  }
}

// วิธีเปิดสิทธิ์กล้องของ "เบราว์เซอร์" ที่ระบบเครื่อง
function systemAllowSteps(env: CamEnv): string[] {
  switch (env.platform) {
    case "ios":
      return [`เปิด ตั้งค่า (Settings) → เลื่อนหา “${browserName(env)}” → เปิดสวิตช์ “กล้อง”`, "ปิดหน้าเว็บนี้แล้วเปิดใหม่ ก่อนกด “ลองเปิดกล้องอีกครั้ง”"];
    case "android":
      return ["เปิด ตั้งค่า → แอป → เลือกเบราว์เซอร์ที่ใช้ (Chrome ฯลฯ) → สิทธิ์ (Permissions) → กล้อง → “อนุญาต”", "มือถือบางยี่ห้อ (Xiaomi/OPPO/vivo/Huawei ฯลฯ) ให้ดูที่ ตั้งค่า → ความเป็นส่วนตัว → ตัวจัดการสิทธิ์ ด้วย", "ปิดเบราว์เซอร์ให้สนิทแล้วเปิดใหม่ ก่อนกด “ลองเปิดกล้องอีกครั้ง”"];
    case "windows":
      return ["เปิด ตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย → กล้อง", "เปิด “การเข้าถึงกล้อง” และ “ให้แอปเข้าถึงกล้อง” และ “ให้แอปบนเดสก์ท็อปเข้าถึงกล้อง”", "ปิดเบราว์เซอร์แล้วเปิดใหม่ ก่อนกด “ลองเปิดกล้องอีกครั้ง”"];
    case "mac":
      return ["เมนู  → การตั้งค่าระบบ → ความเป็นส่วนตัวและความปลอดภัย → กล้อง", "เปิดสวิตช์ให้เบราว์เซอร์ที่ใช้อยู่ แล้วปิดและเปิดเบราว์เซอร์ใหม่", "กลับมากด “ลองเปิดกล้องอีกครั้ง”"];
    case "chromeos":
      return ["เปิด การตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย → ตัวควบคุมความเป็นส่วนตัว → กล้อง → เปิด", "ถ้าเป็น Chromebook หรือบัญชีของโรงเรียน ผู้ดูแลอาจล็อกกล้องไว้ — ยกมือเรียกครู"];
    default:
      return ["เปิดการตั้งค่าของเครื่อง → ความเป็นส่วนตัว → กล้อง แล้วเปิดให้เบราว์เซอร์ที่ใช้", "ปิดและเปิดเบราว์เซอร์ใหม่ ก่อนกด “ลองเปิดกล้องอีกครั้ง”"];
  }
}

const OPEN_OUTSIDE = (env: CamEnv) =>
  env.platform === "ios"
    ? "กดไอคอนแชร์ (สี่เหลี่ยมมีลูกศรขึ้น) หรือ ⋯ แล้วเลือก “เปิดใน Safari”"
    : "กดปุ่ม ⋮ หรือ ⋯ มุมขวา แล้วเลือก “เปิดในเบราว์เซอร์” / “เปิดด้วย Chrome”";

// kind จากรหัสข้อผิดพลาด + สภาพเครื่อง · st = "denied" (เปิดกล้องไม่ได้) | "error" (ตัวตรวจใบหน้าไม่ทำงาน)
export function classifyCam(raw: string, env: CamEnv, probe: CamProbe, st: "denied" | "error"): { kind: CamKind; name: string; message: string } {
  const { name, message } = parseCamError(raw);
  const base = { name, message };
  if (st === "error") return { kind: "detector", ...base };
  if (name === "NoMediaDevices" || !env.hasMedia) {
    if (env.inApp) return { kind: "inapp", ...base };
    if (!env.secure) return { kind: "insecure", ...base };
    return { kind: "unsupported", ...base };
  }
  if (env.inApp) return { kind: "inapp", ...base };
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      if (/by system/i.test(message) || probe.permission === "granted") return { kind: "system", ...base };
      if (/dismiss/i.test(message)) return { kind: "dismissed", ...base };
      return { kind: "blocked", ...base };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { kind: "nodevice", ...base };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { kind: "busy", ...base };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { kind: "constraint", ...base };
    case "SecurityError":
      return { kind: env.framed ? "framed" : env.secure ? "system" : "insecure", ...base };
    case "TypeError":
      return { kind: "unsupported", ...base };
    default:
      return { kind: "unknown", ...base };
  }
}

export function diagnoseCam(raw: string, env: CamEnv, probe: CamProbe = NO_PROBE, st: "denied" | "error" = "denied"): CamDiag {
  const { kind, name, message } = classifyCam(raw, env, probe, st);
  const out = (title: string, why: string, steps: string[], more?: { title: string; steps: string[] }): CamDiag => ({ kind, code: CAM_CODE[kind], title, why, steps, more, name, envText: envText(env) });
  const school = env.platform === "chromeos" ? ["เป็น Chromebook/บัญชีของโรงเรียน? ผู้ดูแลอาจปิดกล้องไว้ — ยกมือเรียกครู"] : [];
  switch (kind) {
    case "blocked":
      return out(
        "ไม่ได้รับอนุญาตให้ใช้กล้อง",
        probe.permission === "denied" ? "เว็บนี้ถูกตั้งเป็น “บล็อกกล้อง” ไว้ (อาจกดไม่อนุญาตโดยไม่ตั้งใจ) — เบราว์เซอร์จะไม่ถามซ้ำให้เอง ต้องเปิดสิทธิ์ด้วยตัวเอง" : "เบราว์เซอร์ไม่ได้รับสิทธิ์กล้องสำหรับเว็บนี้ (กดไม่อนุญาตไว้ หรือเคยบล็อกไว้) — เบราว์เซอร์จะไม่ถามซ้ำให้เอง",
        [...siteAllowSteps(env), ...school],
        env.platform === "ios" || env.platform === "android" ? { title: "ทำแล้วยังไม่ได้? เครื่องอาจปิดสิทธิ์กล้องของเบราว์เซอร์ไว้", steps: systemAllowSteps(env) } : undefined,
      );
    case "dismissed":
      return out("ยังไม่ได้อนุญาตให้ใช้กล้อง", "หน้าต่างขอสิทธิ์กล้องถูกปิดไปโดยไม่ได้กดอนุญาต", ["กด “ลองเปิดกล้องอีกครั้ง”", "เมื่อมีหน้าต่างถามขึ้นมา ให้กด “อนุญาต” (Allow / ขณะใช้แอป)", "ถ้าไม่มีหน้าต่างถามขึ้นมาอีก ให้ทำตามวิธีเปิดสิทธิ์ที่ช่องที่อยู่เว็บ", ...siteAllowSteps(env)]);
    case "system":
      return out("ไม่ได้รับอนุญาตให้ใช้กล้อง (เครื่องปิดสิทธิ์ไว้)", "เว็บนี้อนุญาตแล้ว แต่ระบบของเครื่องไม่ให้เบราว์เซอร์ใช้กล้อง (หรือผู้ดูแลเครื่องตั้งล็อกไว้)", [...systemAllowSteps(env), ...school]);
    case "busy":
      return out(
        "กล้องกำลังถูกใช้อยู่ หรือเริ่มทำงานไม่สำเร็จ",
        "มีแอปหรือแท็บอื่นจับกล้องไว้อยู่ (เช่น LINE วิดีโอคอล Zoom Meet Teams กล้องถ่ายรูป TikTok) หรือกล้องเพิ่งถูกใช้แล้วยังไม่คืน — กล้องใช้พร้อมกันหลายแอปไม่ได้",
        [
          "ปิดแอปที่อาจใช้กล้องอยู่: วิดีโอคอล LINE / Zoom / Meet / Teams / กล้องถ่ายรูป / TikTok",
          "ปิดแท็บอื่นของเว็บนี้ที่เปิดค้างไว้ให้เหลือแท็บเดียว",
          env.platform === "windows" || env.platform === "mac" ? "ปิดโปรแกรมที่ใช้กล้อง (Zoom, Teams, OBS, Camera) แล้วกด “ลองเปิดกล้องอีกครั้ง”" : "เปิดหน้าสลับแอป แล้วปัดแอปที่ไม่ใช้ทิ้ง จากนั้นกด “ลองเปิดกล้องอีกครั้ง”",
          "ยังไม่ได้? ปิดเบราว์เซอร์ให้สนิท หรือรีสตาร์ทเครื่อง แล้วเข้าใหม่",
          ...school,
        ],
      );
    case "nodevice":
      return out(
        "ระบบหากล้องไม่เจอ",
        probe.videoInputs === 0 ? "เครื่องนี้ไม่มีกล้องที่ระบบมองเห็น (คอมตั้งโต๊ะมักไม่มีกล้อง หรือกล้องถูกปิดอยู่)" : "เบราว์เซอร์หากล้องไม่เจอ (กล้องอาจถูกปิดที่ระบบ หรือเสียบไม่แน่น)",
        [
          env.platform === "ios" || env.platform === "android" ? "ลองเปิดด้วยเบราว์เซอร์หลักของเครื่อง (Safari / Chrome) แล้วกด “ลองเปิดกล้องอีกครั้ง”" : "ถ้าเป็นคอมตั้งโต๊ะ/กล้อง USB: ตรวจว่าเสียบสายแน่น และไม่มีฝาปิดหรือสวิตช์ปิดกล้อง (บางรุ่นมีปุ่ม Fn)",
          env.platform === "windows" ? "ตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย → กล้อง ต้องไม่ถูกปิด" : "ตรวจในการตั้งค่าเครื่องว่ากล้องไม่ถูกปิดอยู่",
          "ปิดเบราว์เซอร์แล้วเปิดใหม่ หรือรีสตาร์ทเครื่อง",
          "ถ้าเครื่องนี้ไม่มีกล้องจริง ๆ ให้ใช้มือถือของตัวเอง หรือยกมือเรียกครู",
        ],
      );
    case "inapp":
      return out(
        `เปิดจากในแอป ${env.inApp ?? "อื่น"} กล้องจึงใช้ไม่ได้`,
        "เบราว์เซอร์ที่อยู่ในแอป (LINE / Facebook / Instagram / TikTok ฯลฯ) มักไม่ยอมให้เว็บใช้กล้อง — ต้องเปิดด้วย Safari หรือ Chrome ของเครื่องแทน",
        [
          OPEN_OUTSIDE(env),
          "หรือกดปุ่ม “คัดลอกลิงก์” ด้านล่าง แล้วไปวางในช่องที่อยู่เว็บของ Safari / Chrome",
          "เปิดใหม่แล้วกด “อนุญาต” เมื่อเบราว์เซอร์ถามเรื่องกล้อง",
          "ถ้าเปิดด้วย Safari / Chrome แล้วยังไม่ได้ กล่องนี้จะขึ้นอีกครั้งพร้อมวิธีแก้ตามอาการจริง",
        ],
      );
    case "unsupported":
      return out("เบราว์เซอร์นี้ใช้กล้องไม่ได้", "เบราว์เซอร์เก่าเกินไป หรือไม่รองรับการเปิดกล้องจากเว็บ", [env.platform === "ios" ? "เปิดด้วย Safari (อัปเดต iOS ถ้ามีรุ่นใหม่)" : "เปิดด้วย Chrome รุ่นล่าสุด (อัปเดตที่ Google Play หรือหน้าตั้งค่า Chrome)", env.platform === "android" ? "อัปเดต “Android System WebView” และ Chrome ใน Google Play" : "ปิดเบราว์เซอร์แล้วเปิดใหม่หลังอัปเดต", "ยังไม่ได้? ใช้เครื่องอื่น หรือยกมือเรียกครู"]);
    case "insecure":
      return out("เว็บนี้เปิดแบบไม่ปลอดภัย กล้องจึงถูกปิด", "เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะเว็บที่ขึ้นต้นด้วย https:// เท่านั้น", ["ตรวจที่ช่องที่อยู่เว็บว่าขึ้นต้นด้วย https://", "เปิดจากลิงก์ที่ครูให้ หรือพิมพ์ที่อยู่เว็บของโรงเรียนใหม่", "ยังไม่ได้? ยกมือเรียกครู"]);
    case "framed":
      return out("หน้านี้ถูกเปิดซ้อนอยู่ในหน้าอื่น กล้องจึงถูกกั้น", "เบราว์เซอร์ไม่ให้เว็บที่ถูกฝังอยู่ในหน้าอื่นใช้กล้อง", ["เปิดลิงก์ของโรงเรียนโดยตรงในแท็บใหม่ (ไม่เปิดผ่านหน้าอื่น)", "ยังไม่ได้? ยกมือเรียกครู"]);
    case "constraint":
      return out("กล้องของเครื่องนี้ไม่รองรับค่าที่ขอ", "กล้องบางรุ่นเปิดตามขนาดภาพที่เว็บขอไม่ได้", ["ปิดเบราว์เซอร์แล้วเปิดใหม่ แล้วกด “ลองเปิดกล้องอีกครั้ง”", "ลองเบราว์เซอร์อื่น (Chrome / Safari)", "ยังไม่ได้? ยกมือเรียกครู"]);
    case "detector": {
      const slow = /หมดเวลา|ไม่ตอบ|timeout/i.test(message);
      return out(
        "เปิดกล้องได้ แต่ตัวตรวจใบหน้าทำงานไม่ได้ในเครื่องนี้",
        slow ? "ตัวตรวจใบหน้าตอบช้าเกินกำหนด (เครื่องช้า หน่วยความจำเต็ม หรือสัญญาณเน็ตช้าตอนโหลดไฟล์ครั้งแรก)" : "โหลดไฟล์ตัวตรวจใบหน้าไม่ครบ (สัญญาณเน็ตหลุดหรือช้า) หรือเครื่องนี้ใช้ไม่ได้",
        ["ต่อ Wi-Fi ให้นิ่ง แล้วกด “ลองเปิดกล้องอีกครั้ง” (ครั้งแรกใช้เวลานานกว่าปกติ)", "ปิดแอปและแท็บอื่นให้เหลือน้อยที่สุด เพื่อให้เครื่องมีแรมเหลือ", env.platform === "ios" ? "เปิดด้วย Safari (อัปเดต iOS ถ้ามีรุ่นใหม่)" : "เปิดด้วย Chrome รุ่นล่าสุด", "ยังไม่ได้? ยกมือเรียกครู — ครูให้รหัสทำแบบจับเวลาแทนได้"],
      );
    }
    default:
      return out("เปิดกล้องไม่สำเร็จ", "ไม่ทราบสาเหตุแน่ชัด — ลองตามลำดับนี้ก่อน", ["ปิดแอปและแท็บอื่นที่อาจใช้กล้อง", "โหลดหน้านี้ใหม่ แล้วกด “ลองเปิดกล้องอีกครั้ง”", env.platform === "ios" ? "เปิดด้วย Safari" : "เปิดด้วย Chrome", "ปิดเบราว์เซอร์ให้สนิทหรือรีสตาร์ทเครื่อง", "ยังไม่ได้? ถ่ายรูปหน้าจอนี้ให้ครู (มีรหัสอาการอยู่ด้านล่าง)"]);
  }
}

// อ่านสถานะสิทธิ์/จำนวนกล้อง · ไม่ throw · ใช้เวลาไม่เกิน ~1.5 วินาที
export async function probeCam(nav: unknown = typeof navigator === "undefined" ? undefined : navigator): Promise<CamProbe> {
  const n = nav as { permissions?: { query?: (d: { name: string }) => Promise<{ state?: string }> }; mediaDevices?: { enumerateDevices?: () => Promise<{ kind: string }[]> } } | undefined;
  const tm = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500))]);
  let permission: CamProbe["permission"] = null;
  let videoInputs: number | null = null;
  try {
    if (n?.permissions?.query) {
      const s = (await tm(n.permissions.query({ name: "camera" }))).state;
      if (s === "granted" || s === "denied" || s === "prompt") permission = s;
    }
  } catch {
    /* Safari/Firefox บางรุ่นอ่านไม่ได้ — ไม่เป็นไร */
  }
  try {
    if (n?.mediaDevices?.enumerateDevices) videoInputs = (await tm(n.mediaDevices.enumerateDevices())).filter((d) => d.kind === "videoinput").length;
  } catch {
    /* ไม่เป็นไร */
  }
  return { permission, videoInputs };
}

// ชื่อ + ข้อความสั้น ๆ ของ error สำหรับเก็บใน errorDetail
export function describeCamError(e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  const name = err?.name || "Error";
  const msg = (err?.message || "").replace(/\s+/g, " ").trim().slice(0, 100);
  return msg && msg !== name ? `${name}: ${msg}` : name;
}

// error ไหนควรลองใหม่ด้วยค่าที่เรียบง่ายกว่า (ไม่รวม NotAllowedError — ลองซ้ำจะรบกวนนักเรียนให้ถูกถามอีก)
export function shouldRetrySimple(e: unknown): boolean {
  const n = (e as { name?: string } | null)?.name || "";
  return n === "OverconstrainedError" || n === "ConstraintNotSatisfiedError" || n === "NotReadableError" || n === "TrackStartError" || n === "AbortError";
}
