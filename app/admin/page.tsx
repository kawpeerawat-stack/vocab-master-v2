"use client";

import React, { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import type { SrsCard } from "../lib/srs";
import { RQTYPE_LABELS } from "../lib/reading";
import { CONV_FORMAT_LABELS } from "../lib/conversation";
import ROSTER_JSON from "../../data/roster.json";

type ReadingStatRow = {
  attempts?: number;
  totalAnswered?: number;
  totalCorrect?: number;
  bestPct?: number;
  byType?: Record<string, { answered: number; correct: number }>;
  totalLeaves?: number;
  autoSubmits?: number;
  lastActiveAt?: number;
  history?: { ts: number; pct: number; answered: number }[];
};
type ReadingLeaveRow = { title?: string; examStyle?: string; leaves: number; attempts: number; lastLeaves?: number; autoSubmits?: number };
type ConversationStatRow = {
  attempts?: number;
  totalAnswered?: number;
  totalCorrect?: number;
  bestPct?: number;
  byFormat?: Record<string, { answered: number; correct: number }>;
  lastActiveAt?: number;
  history?: { ts: number; pct: number; answered: number }[];
};

type StudentDoc = {
  id: string;
  name?: string;
  email?: string;
  mastered?: number;
  learning?: number;
  seen?: number;
  total?: number;
  bestScore?: number;
  lastScore?: number;
  score?: number;
  streak?: number;
  srs?: Record<string, SrsCard>;
  reading?: ReadingStatRow;
  conversation?: ConversationStatRow;
  readingLeaves?: Record<string, ReadingLeaveRow>;
  percent?: number;
  answered?: number;
  lastDeltaPercent?: number;
  lastDeltaAnswered?: number;
  lastActiveAt?: number;
  history?: { ts: number; percent: number; answered: number; seen: number }[];
  completedPassages?: string[]; // id บท Reading ที่ทำจบแล้ว
  masteredPassages?: string[];  // id บท Reading ที่ "พิชิต" (ถูกครบทุกข้อ)
  completedConvos?: string[];   // id ชุด Conversation ที่ทำจบแล้ว
  masteredConvos?: string[];    // id ชุด Conversation ที่ "พิชิต"
};

type VocabMeaning = { thai: string; level: string };

// คำถือว่า "ยังอ่อน" เมื่ออยู่กล่องต่ำ หรือเคยลืม (lapses > 0)
// แปลงเวลา (ms) เป็นข้อความไทยแบบสั้น เช่น "5 นาทีที่แล้ว", "2 ชม.ที่แล้ว", "24 มิ.ย. 21:45"
function fmtThaiTime(ms?: number): string {
  if (!ms) return "–";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  const d = new Date(ms);
  const th = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${th[d.getMonth()]} ${hh}:${mm}`;
}

// ดึงห้องจากชื่อที่นักเรียนกรอก เช่น "...M.6/4" → "6/4" (ตรรกะเดียวกับฝั่งนักเรียน)
function roomOf(name?: string): string | null {
  const m = (name || "").match(/6\s*[\/._-]\s*([1-5])/);
  return m ? `6/${m[1]}` : null;
}
const ROOMS = ["6/1", "6/2", "6/3", "6/4", "6/5"];
function roomTarget(room: string | null): number {
  return room === "6/4" || room === "6/5" ? 1000 : 3497;
}
// จำนวนหัวข้อ Reading/Conversation ทั้งหมดที่ห้องนั้นเห็น (ตรงกับ topicCap ฝั่งหน้านักเรียนใน page.tsx)
function topicTarget(room: string | null): number {
  return room === "6/4" || room === "6/5" ? 30 : 60;
}

// ── รายชื่อทางการ + จับคู่ชื่อที่นักเรียนพิมพ์ ──
type RosterEntry = { room: string; no: number; name: string };
const ROSTER = ROSTER_JSON as RosterEntry[];
function normName(s?: string): string {
  return (s || "")
    .replace(/(นางสาว|เด็กชาย|เด็กหญิง|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.)/g, "")
    .replace(/no\.?\s*\d+|เลขที่\s*\d+|m\.?\s*6\s*\/\s*[1-5]|ม\.?\s*6\s*\/\s*[1-5]|6\s*\/\s*[1-5]/gi, "")
    .replace(/[^ก-๙a-zA-Z]/g, "")
    .toLowerCase();
}
// ดึง "เลขที่" จากชื่อที่พิมพ์ เช่น "Phichaya no31 m.6/5" → 31 (รองรับ no./เลขที่/#)
function extractNo(s?: string): number | null {
  const m = (s || "").match(/no\.?\s*(\d{1,2})\b/i) || (s || "").match(/เลขที่\s*(\d{1,2})/) || (s || "").match(/#\s*(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}
const rosterIndex: Record<string, RosterEntry[]> = {};
for (const r of ROSTER) {
  const k = normName(r.name);
  (rosterIndex[k] ||= []).push(r);
}
function matchRoster(name?: string): { entry: RosterEntry; via: "name" | "roomNo" } | null {
  const n = normName(name);
  // 1) ชื่อไทยตรงเป๊ะ (แม่นที่สุด)
  if (n && rosterIndex[n]) return { entry: rosterIndex[n][0], via: "name" };
  // 2) ห้อง + เลขที่ (แม่นยำแม้พิมพ์ชื่อเป็นภาษาอังกฤษ เช่น "Phichaya no31 m.6/5")
  const room = roomOf(name);
  const no = extractNo(name);
  if (room && no != null) {
    const hit = ROSTER.find((r) => r.room === room && r.no === no);
    if (hit) return { entry: hit, via: "roomNo" };
  }
  // 3) จับคู่ชื่อบางส่วน (เฉพาะเมื่อไม่กำกวม)
  if (!n) return null;
  const cand: RosterEntry[] = [];
  for (const k in rosterIndex) {
    if (k.startsWith(n) || n.startsWith(k)) cand.push(...rosterIndex[k]);
  }
  return cand.length === 1 ? { entry: cand[0], via: "name" } : null;
}

// ── สิทธิ์เข้าหน้า /admin ──
const ADMIN_EMAIL = "kawpeerawat@gmail.com";
// ตั้งรหัสผ่านจริงผ่าน Vercel → Environment Variables: NEXT_PUBLIC_ADMIN_PASSWORD
// ถ้ายังไม่ตั้ง จะใช้ค่าเริ่มต้นชั่วคราวด้านล่าง (ควรเปลี่ยนโดยเร็ว)
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "anukoolnaree2025";
const ADMIN_USING_DEFAULT_PW = !process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

function isWeak(card: SrsCard): boolean {
  return card.box <= 1 || card.lapses > 0;
}

// แสดงความก้าวหน้ารายหมวด (Reading/Conversation) ในรูปแบบเดียวกับคำศัพท์
function SubjectProgress({
  title,
  icon,
  accent,
  stat,
  topicsDone,
  topicsTarget,
}: {
  title: string;
  icon: string;
  accent: string;
  stat?: {
    attempts?: number;
    totalAnswered?: number;
    totalCorrect?: number;
    bestPct?: number;
    lastActiveAt?: number;
    history?: { ts: number; pct: number; answered: number }[];
  };
  topicsDone: number;
  topicsTarget: number;
}) {
  if (!stat || !stat.attempts) {
    return (
      <div className="mb-4">
        <div className={`text-xs font-bold ${accent} mb-1`}>{icon} {title}</div>
        <div className="text-xs text-neutral-600">ยังไม่มีข้อมูล (นักเรียนยังไม่ได้เข้าทำหมวดนี้) — สำเร็จ 0/{topicsTarget} หัวข้อ</div>
      </div>
    );
  }
  const acc =
    (stat.totalAnswered ?? 0) > 0 ? Math.round(((stat.totalCorrect ?? 0) / (stat.totalAnswered ?? 1)) * 100) : 0;
  const hist = stat.history ?? [];
  return (
    <div className="mb-4">
      <div className={`text-xs font-bold ${accent} mb-2`}>
        {icon} {title} · เข้าทำล่าสุด {fmtThaiTime(stat.lastActiveAt)}
      </div>
      <div className="flex flex-wrap gap-2 mb-2 text-xs">
        <span className="bg-neutral-900/60 rounded-lg px-3 py-1.5 text-neutral-300">
          หัวข้อสำเร็จ <b className={accent}>{topicsDone}/{topicsTarget}</b>
        </span>
        <span className="bg-neutral-900/60 rounded-lg px-3 py-1.5 text-neutral-300">ความแม่น <b className={accent}>{acc}%</b></span>
        <span className="bg-neutral-900/60 rounded-lg px-3 py-1.5 text-neutral-300">ดีที่สุด <b>{stat.bestPct ?? 0}%</b></span>
        <span className="bg-neutral-900/60 rounded-lg px-3 py-1.5 text-neutral-300">ทำไป <b>{stat.attempts ?? 0}</b> รอบ</span>
        <span className="bg-neutral-900/60 rounded-lg px-3 py-1.5 text-neutral-300">ตอบสะสม <b>{stat.totalAnswered ?? 0}</b> ข้อ</span>
      </div>
      {hist.length > 0 && (
        <div className="flex flex-col gap-1">
          {hist.slice(-6).reverse().map((h, i, arr) => {
            const prev = arr[i + 1];
            const dPct = prev ? Math.round((h.pct - prev.pct) * 10) / 10 : 0;
            const dAns = prev ? Math.max(0, h.answered - prev.answered) : 0;
            return (
              <div key={h.ts} className="flex items-center gap-3 text-xs bg-neutral-900/40 rounded-lg px-3 py-1.5">
                <span className="text-neutral-500 w-32 shrink-0">{fmtThaiTime(h.ts)}</span>
                <span className={`font-black ${accent} w-14`}>{h.pct}%</span>
                {prev ? (
                  <span className="text-sky-300">
                    {dPct >= 0 ? "▲ +" : "▼ "}{dPct}% · ทำเพิ่ม {dAns} ข้อ
                  </span>
                ) : (
                  <span className="text-neutral-600">—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [vocabMap, setVocabMap] = useState<Record<string, VocabMeaning>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [roomFilter, setRoomFilter] = useState<string>("ALL");
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [subject, setSubject] = useState<"vocab" | "reading" | "conversation">("vocab");

  // ตรวจสิทธิ์จาก session (ผ่านรหัสแล้วไม่ต้องกรอกซ้ำในเบราว์เซอร์เดิม)
  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("vocab_admin_ok") === "1") {
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (!authed) return; // ยังไม่ผ่านรหัสผ่าน → ไม่โหลด/ไม่อ่านข้อมูลนักเรียน
    const load = async () => {
      try {
        // 1) แผนที่ความหมายคำศัพท์ (ไว้แสดงภาษาไทย)
        try {
          const res = await fetch("/api/vocab");
          if (res.ok) {
            const words = (await res.json()) as { word: string; thai_meaning: string; level: string }[];
            const map: Record<string, VocabMeaning> = {};
            for (const w of words) map[w.word] = { thai: w.thai_meaning, level: w.level };
            setVocabMap(map);
          }
        } catch (e) {
          console.error("load vocab error:", e);
        }

        // 2) ข้อมูลนักเรียนจาก Firestore
        const snap = await getDocs(collection(db, "students"));
        const data: StudentDoc[] = [];
        snap.forEach((d) => data.push({ id: d.id, ...(d.data() as object) } as StudentDoc));
        data.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || (b.mastered ?? 0) - (a.mastered ?? 0));
        setStudents(data);
      } catch (error) {
        console.error("Error fetching students:", error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [authed]);

  // คำที่ทั้งห้องพลาดบ่อย: รวมจำนวนคนที่ยังอ่อน + lapses รวม ของแต่ละคำ
  const classHardWords = (() => {
    const agg: Record<string, { strugglers: number; lapses: number }> = {};
    for (const s of students) {
      if (!s.srs) continue;
      for (const [word, card] of Object.entries(s.srs)) {
        if (!card) continue;
        if (isWeak(card)) {
          if (!agg[word]) agg[word] = { strugglers: 0, lapses: 0 };
          agg[word].strugglers += 1;
          agg[word].lapses += card.lapses || 0;
        }
      }
    }
    return Object.entries(agg)
      .map(([word, v]) => ({ word, ...v }))
      .sort((a, b) => b.strugglers - a.strugglers || b.lapses - a.lapses)
      .slice(0, 20);
  })();

  // คำที่อ่อนของนักเรียนแต่ละคน (เรียงตามเคยลืมบ่อย → กล่องต่ำ)
  const weakWordsOf = (s: StudentDoc) => {
    if (!s.srs) return [];
    return Object.entries(s.srs)
      .filter(([, c]) => c && isWeak(c))
      .sort((a, b) => (b[1].lapses || 0) - (a[1].lapses || 0) || a[1].box - b[1].box)
      .slice(0, 15)
      .map(([word, c]) => ({ word, box: c.box, lapses: c.lapses }));
  };

  // นักเรียนที่ออกจากหน้าจอระหว่างทำ Reading (กันโกง) — โดนส่งอัตโนมัติขึ้นก่อน แล้วเรียงตามจำนวนครั้ง
  const flaggedStudents = students
    .map((s) => ({ s, leaves: s.reading?.totalLeaves ?? 0, autos: s.reading?.autoSubmits ?? 0 }))
    .filter((x) => x.leaves > 0 || x.autos > 0)
    .sort((a, b) => b.autos - a.autos || b.leaves - a.leaves);

  // ── แยกตามห้อง + กรอง ──
  const roomCounts: Record<string, number> = { ALL: students.length, __none: 0 };
  for (const r of ROOMS) roomCounts[r] = 0;
  for (const s of students) {
    const r = roomOf(s.name);
    if (r) roomCounts[r] = (roomCounts[r] ?? 0) + 1;
    else roomCounts.__none += 1;
  }
  const filteredStudents =
    roomFilter === "ALL"
      ? students
      : roomFilter === "__none"
      ? students.filter((s) => !roomOf(s.name))
      : students.filter((s) => roomOf(s.name) === roomFilter);

  // ── เทียบรายชื่อทางการ: ใครเข้าทำแล้ว/ยัง + ชื่อที่จับคู่ไม่ได้ ──
  const rosterMatched = new Set<string>(); // key = "ห้อง|เลขที่" ที่มีนักเรียนเข้าทำแล้ว
  const rosterUnmatched: StudentDoc[] = []; // นักเรียนที่พิมพ์ชื่อไม่ตรงรายชื่อใด ๆ เลย
  const rosterByNumber: { s: StudentDoc; entry: RosterEntry }[] = []; // จับคู่ได้ด้วยห้อง+เลขที่ (ชื่อมักเป็นอังกฤษ) — ควรตรวจสอบ
  for (const s of students) {
    const m = matchRoster(s.name);
    if (m) {
      rosterMatched.add(`${m.entry.room}|${m.entry.no}`);
      if (m.via === "roomNo") rosterByNumber.push({ s, entry: m.entry });
    } else {
      rosterUnmatched.push(s);
    }
  }
  const shownUnmatched =
    roomFilter === "ALL" || roomFilter === "__none"
      ? rosterUnmatched
      : rosterUnmatched.filter((s) => roomOf(s.name) === roomFilter);
  const shownByNumber =
    roomFilter === "ALL" || roomFilter === "__none"
      ? rosterByNumber
      : rosterByNumber.filter((x) => x.entry.room === roomFilter);
  const panelRooms = roomFilter === "__none" ? [] : roomFilter === "ALL" ? ROOMS : [roomFilter];

  // ── ดาวน์โหลดข้อมูลนักเรียนทั้งห้องเป็นไฟล์ CSV (เปิดใน Excel ได้) ──
  const escapeCsv = (val: string | number) => {
    const s = String(val ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const downloadCsv = () => {
    const headers = ["ชื่อ", "อีเมล", "ก้าวหน้า %", "ขยับล่าสุด %", "ทำเพิ่มล่าสุด (ข้อ)", "ตอบสะสม (ข้อ)", "เข้าทำล่าสุด", "จำได้", "กำลังเรียน", "เคยเจอ", "คะแนนสูงสุด", "วันติด(streak)", "Reading สำเร็จ", "Reading เป้าหมาย", "Conversation สำเร็จ", "Conversation เป้าหมาย", "ออกจากจอรวม", "ส่งอัตโนมัติ", "บทที่ออกจากจอ", "คำที่ยังอ่อน"];
    const rows = students.map((s) => {
      const weak = weakWordsOf(s)
        .map((w) => (vocabMap[w.word] ? `${w.word}(${vocabMap[w.word].thai})` : w.word))
        .join("; ");
      const leaveDetail = Object.values(s.readingLeaves || {})
        .sort((a, b) => b.leaves - a.leaves)
        .map((lv) => `${lv.title || "(บท)"}(${lv.leaves}×${(lv.autoSubmits ?? 0) > 0 ? `, ส่งอัตโนมัติ ${lv.autoSubmits}` : ""})`)
        .join("; ");
      const target = topicTarget(roomOf(s.name));
      return [
        s.name || "",
        s.email || s.id,
        (s.percent ?? 0).toFixed(1),
        (s.lastDeltaPercent ?? 0).toFixed(1),
        s.lastDeltaAnswered ?? 0,
        s.answered ?? 0,
        fmtThaiTime(s.lastActiveAt),
        s.mastered ?? 0,
        s.learning ?? 0,
        s.seen ?? 0,
        s.bestScore ?? s.score ?? 0,
        s.streak ?? 0,
        (s.completedPassages ?? []).length,
        target,
        (s.completedConvos ?? []).length,
        target,
        s.reading?.totalLeaves ?? 0,
        s.reading?.autoSubmits ?? 0,
        leaveDetail,
        weak,
      ].map(escapeCsv).join(",");
    });
    // ใส่ BOM (\uFEFF) เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `vocab-master-students-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const submitPw = () => {
    if (pw === ADMIN_PASSWORD) {
      setAuthed(true);
      setPwError(false);
      try { sessionStorage.setItem("vocab_admin_ok", "1"); } catch {}
    } else {
      setPwError(true);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔒</div>
            <h1 className="text-xl font-black text-amber-200">หน้าผู้ดูแลระบบ</h1>
            <p className="text-xs text-neutral-500 mt-1">สำหรับ {ADMIN_EMAIL} เท่านั้น</p>
          </div>
          <label className="block text-xs font-bold text-neutral-400 mb-1">รหัสผ่าน</label>
          <input
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setPwError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") submitPw(); }}
            autoFocus
            className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-400"
            placeholder="กรอกรหัสผ่าน"
          />
          {pwError && <p className="text-rose-400 text-xs mt-2 font-bold">รหัสผ่านไม่ถูกต้อง</p>}
          <button
            onClick={submitPw}
            className="w-full mt-4 bg-amber-300 hover:bg-amber-200 text-neutral-900 font-black rounded-xl py-3 transition-colors"
          >
            เข้าสู่ระบบ
          </button>
          {ADMIN_USING_DEFAULT_PW && (
            <p className="text-amber-500/70 text-[10px] mt-4 leading-relaxed">
              ⚠️ กำลังใช้รหัสผ่านเริ่มต้น — แนะนำให้ตั้งค่า <span className="font-mono">NEXT_PUBLIC_ADMIN_PASSWORD</span> ใน Vercel แล้ว redeploy เพื่อความปลอดภัย
            </p>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-amber-400 font-bold text-xl animate-pulse">
        กำลังโหลดข้อมูลนักเรียน...
      </div>
    );
  }

  const totalStudents = students.length;
  const avgMastered = totalStudents
    ? Math.round(students.reduce((sum, s) => sum + (s.mastered ?? 0), 0) / totalStudents)
    : 0;

  // มุมมองรายหมวดของนักเรียนหนึ่งคน (ใช้กับ Tab คำศัพท์/Reading/Conversation)
  const subjectView = (s: StudentDoc) => {
    if (subject === "vocab") {
      return {
        pct: s.percent ?? 0,
        sub: `ทำได้ ${s.mastered ?? 0}/${s.total ?? 0} คำ`,
        deltaPct: s.lastDeltaPercent ?? 0,
        deltaAns: s.lastDeltaAnswered ?? 0,
        lastActive: s.lastActiveAt,
      };
    }
    const st = subject === "reading" ? s.reading : s.conversation;
    const acc = (st?.totalAnswered ?? 0) > 0 ? Math.round(((st?.totalCorrect ?? 0) / (st?.totalAnswered ?? 1)) * 100) : 0;
    const hist = st?.history ?? [];
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    const completedIds = (subject === "reading" ? s.completedPassages : s.completedConvos) ?? [];
    const target = topicTarget(roomOf(s.name));
    return {
      pct: acc,
      sub: `สำเร็จ ${completedIds.length}/${target} หัวข้อ · ทำไป ${st?.attempts ?? 0} รอบ`,
      deltaPct: last && prev ? Math.round((last.pct - prev.pct) * 10) / 10 : 0,
      deltaAns: last && prev ? Math.max(0, last.answered - prev.answered) : 0,
      lastActive: st?.lastActiveAt,
      topicsDone: completedIds.length,
      topicsTarget: target,
    };
  };
  // เรียงตาม % ของหมวดที่เลือก (มากสุดก่อน)
  // เรียงตาม "เลขที่" (1,2,3,...) ทุกแท็บ — ง่ายต่อการดูรายเลขที่ว่าทำได้กี่คำ/กี่% แล้ว
  //   คนที่จับคู่รายชื่อทางการไม่ได้ (ไม่มีเลขที่) จะถูกจัดไว้ท้ายสุด เรียงตามชื่อ
  const sortedStudents = [...filteredStudents].sort((a, b) => {
    const noA = matchRoster(a.name)?.entry.no;
    const noB = matchRoster(b.name)?.entry.no;
    if (noA != null && noB != null) return noA - noB;
    if (noA != null) return -1; // มีเลขที่มาก่อนคนที่ไม่มี
    if (noB != null) return 1;
    return (a.name || "").localeCompare(b.name || "", "th");
  });

  // ค่าการ์ดสรุป (เปลี่ยนตามหมวด)
  const subjLabel = subject === "vocab" ? "คำศัพท์" : subject === "reading" ? "Reading" : "Conversation";
  const subjAcct = students.filter((s) => (subject === "reading" ? s.reading : s.conversation)?.attempts);
  const avgAcc = subjAcct.length
    ? Math.round(
        subjAcct.reduce((a, s) => {
          const st = subject === "reading" ? s.reading : s.conversation;
          return a + ((st?.totalAnswered ?? 0) > 0 ? ((st?.totalCorrect ?? 0) / (st?.totalAnswered ?? 1)) * 100 : 0);
        }, 0) / subjAcct.length
      )
    : 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-200 mb-1 tracking-tight">
              📊 แดชบอร์ดครู — Vocab Master
            </h1>
            <p className="text-neutral-500 font-bold tracking-widest uppercase text-xs">
              Student Progress · Live from Cloud
            </p>
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={students.length === 0}
            className="bg-amber-400 text-neutral-950 font-black px-5 py-3 rounded-2xl hover:bg-amber-300 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
          >
            📥 ดาวน์โหลด CSV
          </button>
        </div>

        {/* สรุปภาพรวม */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-3xl font-black text-amber-400">{totalStudents}</div>
            <div className="text-xs font-bold text-neutral-500 uppercase mt-1">นักเรียนที่มีข้อมูล</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-3xl font-black text-green-400">{subject === "vocab" ? avgMastered : `${avgAcc}%`}</div>
            <div className="text-xs font-bold text-neutral-500 uppercase mt-1">
              {subject === "vocab" ? "เฉลี่ยคำที่จำได้/คน" : `เฉลี่ยความแม่น ${subjLabel}/คน`}
            </div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 col-span-2 md:col-span-1">
            <div className="text-3xl font-black text-rose-400">{subject === "vocab" ? classHardWords.length : subjAcct.length}</div>
            <div className="text-xs font-bold text-neutral-500 uppercase mt-1">
              {subject === "vocab" ? "คำที่ห้องยังอ่อน" : `เข้าทำ ${subjLabel} แล้ว`}
            </div>
          </div>
        </div>

        {/* Tab สลับหมวดความก้าวหน้า */}
        <div className="flex flex-wrap gap-2 mb-8">
          {[
            { key: "vocab", label: "📚 คำศัพท์" },
            { key: "reading", label: "📖 Reading" },
            { key: "conversation", label: "💬 Conversation" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setSubject(t.key as "vocab" | "reading" | "conversation")}
              className={`px-5 py-2.5 rounded-2xl text-sm font-black transition-colors ${
                subject === t.key
                  ? "bg-amber-300 text-neutral-900 shadow-lg"
                  : "bg-neutral-900 border border-neutral-800 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* คำที่ทั้งห้องพลาดบ่อย (เฉพาะหมวดคำศัพท์) */}
        {subject === "vocab" && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 mb-8">
          <h2 className="text-lg font-black text-rose-300 mb-1">🔥 คำที่ทั้งห้องยังอ่อน (ควรสอนซ้ำ)</h2>
          <p className="text-xs text-neutral-500 mb-4">เรียงตามจำนวนนักเรียนที่ยังไม่แม่น</p>
          {classHardWords.length === 0 ? (
            <p className="text-neutral-600 text-sm">ยังไม่มีข้อมูล — เมื่อเด็กเล่นจบรอบ ข้อมูลจะขึ้นที่นี่</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classHardWords.map((w) => (
                <span key={w.word} className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2 text-sm">
                  <span className="font-bold text-rose-200">{w.word}</span>
                  {vocabMap[w.word] && <span className="text-neutral-400"> · {vocabMap[w.word].thai}</span>}
                  <span className="text-neutral-500 text-xs"> ({w.strugglers} คน)</span>
                </span>
              ))}
            </div>
          )}
        </div>
        )}

        {/* 🚨 กันโกง: ออกจากหน้าจอระหว่างทำ Reading (เฉพาะหมวด Reading) */}
        {subject === "reading" && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 mb-8">
          <h2 className="text-lg font-black text-rose-300 mb-1">🚨 ออกจากหน้าจอระหว่างทำ Reading (กันโกง)</h2>
          <p className="text-xs text-neutral-500 mb-4">นับเฉพาะตอนทำข้อสอบจริง — สลับแอป/สลับแท็บ เช่น เปิดแอปแปลภาษาหรือค้นเน็ต · คลิกชื่อเพื่อดูรายบท</p>
          {flaggedStudents.length === 0 ? (
            <p className="text-neutral-600 text-sm">ยังไม่พบใครออกจากหน้าจอ 👍</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {flaggedStudents.map(({ s, leaves, autos }) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setExpanded(s.id)}
                  className={`rounded-xl px-3 py-2 text-sm transition-colors border ${autos > 0 ? "bg-red-500/15 border-red-500/50 hover:bg-red-500/25" : "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20"}`}
                >
                  <span className={`font-bold ${autos > 0 ? "text-red-200" : "text-rose-200"}`}>{s.name || "(ไม่มีชื่อ)"}</span>
                  <span className="text-neutral-400"> · ออกจากจอ {leaves} ครั้ง</span>
                  {autos > 0 && <span className="ml-1 font-black text-red-300">· ⛔ ส่งอัตโนมัติ {autos}×</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {/* รายชื่อนักเรียน */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-neutral-800">
            <h2 className="text-lg font-black text-amber-200">นักเรียนรายคน — {subjLabel}</h2>
            <p className="text-xs text-neutral-500">เรียงตามเลขที่ (1, 2, 3, ...) · คลิกที่แถวเพื่อดูประวัติทุกหมวด</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: "ALL", label: "ทั้งหมด" },
                ...ROOMS.map((r) => ({ key: r, label: `ห้อง ${r}` })),
                { key: "__none", label: "ไม่ระบุห้อง" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setRoomFilter(t.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    roomFilter === t.key
                      ? "bg-amber-300 text-neutral-900"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  {t.label} ({roomCounts[t.key] ?? 0})
                  {t.key !== "ALL" && t.key !== "__none" && (
                    <span className="ml-1 opacity-70">· {roomTarget(t.key).toLocaleString()} คำ</span>
                  )}
                </button>
              ))}
            </div>

            {/* สถานะการเข้าทำเทียบรายชื่อทางการ */}
            {panelRooms.length > 0 && (
              <div className="mt-4 bg-neutral-950/50 border border-neutral-800 rounded-2xl p-4">
                <div className="text-xs font-bold text-amber-200 mb-2">📋 เทียบรายชื่อทางการ — ใครเข้าทำแล้ว/ยัง</div>
                {panelRooms.map((r) => {
                  const list = ROSTER.filter((x) => x.room === r);
                  const notDone = list.filter((x) => !rosterMatched.has(`${r}|${x.no}`));
                  const doneCount = list.length - notDone.length;
                  return (
                    <div key={r} className="mb-3 last:mb-0">
                      <div className="text-sm font-bold text-neutral-200">
                        ห้อง {r}: เข้าทำแล้ว <span className="text-emerald-400">{doneCount}</span> / {list.length} คน
                        {notDone.length > 0 && <span className="text-neutral-500 font-normal"> · ยังไม่เข้าทำ {notDone.length} คน</span>}
                      </div>
                      {notDone.length > 0 && (
                        <div className="text-xs text-neutral-400 mt-1 leading-relaxed">
                          <span className="text-rose-300 font-bold">ยังไม่เข้าทำ:</span>{" "}
                          {notDone.map((x) => `${x.no}.${x.name.replace(/^(นางสาว|นาย|นาง)/, "")}`).join(" · ")}
                        </div>
                      )}
                    </div>
                  );
                })}
                {shownUnmatched.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-neutral-800 text-xs">
                    <span className="text-amber-300 font-bold">⚠️ พิมพ์ชื่อไม่ตรงรายชื่อ ({shownUnmatched.length} บัญชี):</span>{" "}
                    <span className="text-neutral-300">{shownUnmatched.map((s) => s.name || "(ไม่มีชื่อ)").join(" · ")}</span>
                    <div className="text-neutral-500 mt-1">→ อาจพิมพ์ผิด/ใช้ชื่ออังกฤษ หรือเป็นบัญชีทดสอบ (ระบบนับให้เฉพาะชื่อที่ตรงรายชื่อไทย)</div>
                  </div>
                )}
                {shownByNumber.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-neutral-800 text-xs">
                    <span className="text-sky-300 font-bold">🔢 จับคู่ด้วยห้อง+เลขที่ ({shownByNumber.length} บัญชี — ชื่อที่พิมพ์ไม่ใช่ภาษาไทย โปรดตรวจสอบว่าตรงคน):</span>
                    <div className="mt-1 flex flex-col gap-1">
                      {shownByNumber.map(({ s, entry }) => (
                        <div key={s.id} className="text-neutral-300">
                          พิมพ์ว่า <span className="text-neutral-100 font-bold">&quot;{s.name}&quot;</span> → จับคู่กับ{" "}
                          <span className="text-emerald-300 font-bold">
                            {entry.room} เลขที่ {entry.no} {entry.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-neutral-950/60 border-b border-neutral-800 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="p-4">ชื่อ</th>
                  <th className="p-4 hidden md:table-cell">อีเมล</th>
                  <th className="p-4 text-center">ก้าวหน้า</th>
                  <th className="p-4 text-center">ขยับล่าสุด</th>
                  <th className="p-4 text-center hidden lg:table-cell">เข้าทำล่าสุด</th>
                  <th className="p-4 text-center">จำได้</th>
                  <th className="p-4 text-center hidden md:table-cell">กำลังเรียน</th>
                  <th className="p-4 text-center hidden sm:table-cell">คะแนนสูงสุด</th>
                  <th className="p-4 text-center hidden sm:table-cell">อ่าน %</th>
                  <th className="p-4 text-center hidden sm:table-cell">สนทนา %</th>
                  <th className="p-4 text-center">ออกจากจอ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {sortedStudents.length === 0 && (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-neutral-500 text-sm">
                      ยังไม่มีข้อมูลนักเรียนในห้องนี้ (นักเรียนต้องเข้าทำอย่างน้อย 1 รอบหลังอัปเดต)
                    </td>
                  </tr>
                )}
                {sortedStudents.map((s) => {
                  const weak = weakWordsOf(s);
                  const v = subjectView(s);
                  const isOpen = expanded === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <tr
                        className="hover:bg-neutral-800/30 transition-colors cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : s.id)}
                      >
                        <td className="p-4 font-bold text-white">
                          {matchRoster(s.name) && (
                            <span className="inline-block w-6 text-amber-300 font-black">{matchRoster(s.name)?.entry.no}.</span>
                          )}
                          {s.name || "(ไม่มีชื่อ)"}
                        </td>
                        <td className="p-4 text-neutral-500 text-sm font-mono hidden md:table-cell">{s.email}</td>
                        <td className="p-4 text-center">
                          <div className="font-black text-lg text-emerald-400">{v.pct.toFixed(1)}%</div>
                          <div className="text-[10px] text-neutral-500">{v.sub}</div>
                        </td>
                        <td className="p-4 text-center">
                          {(v.deltaPct ?? 0) > 0 || (v.deltaAns ?? 0) > 0 ? (
                            <div>
                              <div className="font-black text-sky-300">▲ +{(v.deltaPct ?? 0).toFixed(1)}%</div>
                              <div className="text-[10px] text-neutral-500">ทำเพิ่ม {v.deltaAns ?? 0} ข้อ</div>
                            </div>
                          ) : (
                            <span className="text-neutral-600">–</span>
                          )}
                        </td>
                        <td className="p-4 text-center text-xs text-neutral-400 hidden lg:table-cell">{fmtThaiTime(v.lastActive)}</td>
                        <td className="p-4 text-center font-black text-green-400">{s.mastered ?? 0}</td>
                        <td className="p-4 text-center font-bold text-amber-400 hidden md:table-cell">{s.learning ?? 0}</td>
                        <td className="p-4 text-center font-bold text-neutral-200 hidden sm:table-cell">{s.bestScore ?? s.score ?? 0}</td>
                        <td className="p-4 text-center font-bold text-sky-400 hidden sm:table-cell">{s.reading?.bestPct != null ? `${s.reading.bestPct}%` : "–"}</td>
                        <td className="p-4 text-center font-bold text-purple-400 hidden sm:table-cell">{s.conversation?.bestPct != null ? `${s.conversation.bestPct}%` : "–"}</td>
                        <td className="p-4 text-center font-black">{(s.reading?.totalLeaves ?? 0) > 0 || (s.reading?.autoSubmits ?? 0) > 0 ? <span className="text-rose-400">{s.reading?.totalLeaves ?? 0}×{(s.reading?.autoSubmits ?? 0) > 0 ? <span className="text-red-300"> ⛔{s.reading?.autoSubmits}</span> : null}</span> : <span className="text-neutral-600">0</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-neutral-950/40">
                          <td colSpan={11} className="p-4">
                            {s.history && s.history.length > 0 && (
                              <div className="mb-4">
                                <div className="text-xs font-bold text-emerald-300 mb-2">
                                  📈 ประวัติความก้าวหน้า (ล่าสุด {Math.min(s.history.length, 8)} ครั้ง · เข้าทำล่าสุด {fmtThaiTime(s.lastActiveAt)})
                                </div>
                                <div className="flex flex-col gap-1">
                                  {s.history.slice(-8).reverse().map((h, i, arr) => {
                                    const prev = arr[i + 1];
                                    const dPct = prev ? Math.round((h.percent - prev.percent) * 10) / 10 : 0;
                                    const dAns = prev ? Math.max(0, h.answered - prev.answered) : 0;
                                    return (
                                      <div key={h.ts} className="flex items-center gap-3 text-xs bg-neutral-900/60 rounded-lg px-3 py-1.5">
                                        <span className="text-neutral-500 w-32 shrink-0">{fmtThaiTime(h.ts)}</span>
                                        <span className="font-black text-emerald-400 w-16">{h.percent.toFixed(1)}%</span>
                                        {prev && (dPct > 0 || dAns > 0) ? (
                                          <span className="text-sky-300">▲ +{dPct.toFixed(1)}% · ทำเพิ่ม {dAns} ข้อ</span>
                                        ) : (
                                          <span className="text-neutral-600">—</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <SubjectProgress
                              title="ความก้าวหน้า Reading (การอ่าน)"
                              icon="📖"
                              accent="text-sky-300"
                              stat={s.reading}
                              topicsDone={(s.completedPassages ?? []).length}
                              topicsTarget={topicTarget(roomOf(s.name))}
                            />
                            <SubjectProgress
                              title="ความก้าวหน้า Conversation (บทสนทนา)"
                              icon="💬"
                              accent="text-purple-300"
                              stat={s.conversation}
                              topicsDone={(s.completedConvos ?? []).length}
                              topicsTarget={topicTarget(roomOf(s.name))}
                            />

                            <div className="text-xs font-bold text-neutral-400 mb-2">คำที่ {s.name} ยังอ่อน:</div>                            {weak.length === 0 ? (
                              <span className="text-neutral-600 text-sm">ยังไม่มีคำที่อ่อน หรือยังไม่มีข้อมูล</span>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {weak.map((w) => (
                                  <span key={w.word} className="bg-neutral-800 rounded-lg px-2.5 py-1.5 text-xs">
                                    <span className="font-bold text-neutral-100">{w.word}</span>
                                    {vocabMap[w.word] && <span className="text-neutral-500"> · {vocabMap[w.word].thai}</span>}
                                    {w.lapses > 0 && <span className="text-rose-400"> · ลืม {w.lapses}×</span>}
                                  </span>
                                ))}
                              </div>
                            )}

                            {s.readingLeaves && Object.keys(s.readingLeaves).length > 0 && (
                              <div className="mt-4 border-t border-neutral-800 pt-3">
                                <div className="text-xs font-bold text-rose-300 mb-2">🚨 ออกจากหน้าจอราย​บท (กันโกง) — รวม {s.reading?.totalLeaves ?? 0} ครั้ง{(s.reading?.autoSubmits ?? 0) > 0 ? ` · ⛔ ส่งอัตโนมัติ ${s.reading?.autoSubmits} ครั้ง` : ""}</div>
                                <div className="flex flex-wrap gap-2">
                                  {Object.values(s.readingLeaves)
                                    .sort((a, b) => b.leaves - a.leaves)
                                    .map((lv, i) => (
                                      <span key={i} className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5 text-xs">
                                        <span className="font-bold text-rose-200">{lv.title || "(บท)"}</span>
                                        {lv.examStyle && <span className="text-neutral-500"> · {lv.examStyle}</span>}
                                        <span className="text-rose-300"> · ออก {lv.leaves}× ใน {lv.attempts} รอบ</span>
                                        {(lv.autoSubmits ?? 0) > 0 && <span className="ml-1 font-black text-red-300">· ⛔ ส่งอัตโนมัติ {lv.autoSubmits}×</span>}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            )}

                            <div className="mt-4 grid sm:grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                              <div>
                                <div className="text-xs font-bold text-sky-300 mb-1">📖 การอ่าน (Reading)</div>
                                {s.reading ? (
                                  <div className="text-xs text-neutral-400 space-y-0.5">
                                    <div>ทำไป {s.reading.attempts ?? 0} รอบ · ดีสุด {s.reading.bestPct ?? 0}% · สะสม {s.reading.totalCorrect ?? 0}/{s.reading.totalAnswered ?? 0}</div>
                                    {s.reading.byType &&
                                      Object.entries(s.reading.byType).map(([t, v]) => (
                                        <div key={t} className="text-neutral-500">
                                          • {(RQTYPE_LABELS as Record<string, string>)[t] ?? t}: {v.correct}/{v.answered}
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <span className="text-neutral-600 text-xs">ยังไม่มีข้อมูล</span>
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-bold text-purple-300 mb-1">💬 บทสนทนา (Conversation)</div>
                                {s.conversation ? (
                                  <div className="text-xs text-neutral-400 space-y-0.5">
                                    <div>ทำไป {s.conversation.attempts ?? 0} รอบ · ดีสุด {s.conversation.bestPct ?? 0}% · สะสม {s.conversation.totalCorrect ?? 0}/{s.conversation.totalAnswered ?? 0}</div>
                                    {s.conversation.byFormat &&
                                      Object.entries(s.conversation.byFormat).map(([t, v]) => (
                                        <div key={t} className="text-neutral-500">
                                          • {(CONV_FORMAT_LABELS as Record<string, string>)[t] ?? t}: {v.correct}/{v.answered}
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <span className="text-neutral-600 text-xs">ยังไม่มีข้อมูล</span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-neutral-600 font-bold">
                      ยังไม่มีข้อมูลนักเรียน — เมื่อเด็กเล่นจบรอบและซิงก์ขึ้นคลาวด์ จะปรากฏที่นี่
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-neutral-700 text-xs mt-8">
          ข้อมูลนี้เป็นความลับของนักเรียน — อย่าเปิดเผยลิงก์หน้านี้ให้คนนอก
        </p>
      </div>
    </div>
  );
}
