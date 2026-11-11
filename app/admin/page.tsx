'use client'

// ─────────────────────────────────────────────────────────────
// หน้า Admin — ความก้าวหน้านักเรียน (Grammar Master)
//  • แสดงหัวข้อที่นักเรียนผ่าน (ทุกพาร์ทได้ ≥ 3/5) + คะแนนดีสุดรายหัวข้อ + รายพาร์ท (Error / Sentence / Cloze)
//  • 12 หัวข้อ (ปรับตามสถิติ NETSAT ต.ค. 2569) — นับจาก id ข้อที่ตอบถูกจริง จึงรองรับหัวข้อที่ถูกย้าย/ยุบรวม
//  • ข้อสอบรายหัวข้อ (Error + Sentence) เก็บคะแนนดีสุดใน setBest คีย์ EX-…
//  • ภาคเรียนที่ 2/2569: แต่ละหัวข้อ = แบบฝึก 15 ข้อ (Error 5 + Sentence 5 + Cloze 5) จาก /examSets.json (ชุด T-…)
//    "ผ่านหัวข้อ" = ทุกพาร์ท (Error / Sentence / Cloze) ได้ ≥ 3/5 · คะแนนรายพาร์ทเก็บใน setBest คีย์ T-xx:E / :S / :C
//  • ทะเบียนนักเรียนจริง /roster.json (ชื่อไทย + ห้อง + เลขที่) → ติดตามการเข้าทำ
//  • จับคู่บัญชีในแอปกับทะเบียนด้วย "ห้อง + เลขที่" ที่นักเรียนกรอกในชื่อ
//  • กั้นสิทธิ์: เห็นได้เฉพาะอีเมลใน ADMIN_EMAILS
//  • Real Time: ฟังข้อมูลนักเรียนด้วย onSnapshot — โหลดครบครั้งแรกครั้งเดียว แล้วรับเฉพาะคนที่คะแนนเปลี่ยน
//    (ไม่ต้องกดรีเฟรช) · "ส่งงานล่าสุด" มาจาก lastSet ที่แอปนักเรียนบันทึกตอนทำจบ 1 ชุด
//  • ภาคเรียนที่ 2/2569: ไม่ใช้ข้อมูลเทอมก่อนแล้ว (ประวัติ Mix / Error / Sentence เดิม) — ปุ่มล้างข้อมูลเทอมก่อนอยู่ท้ายหน้า
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/AuthProvider'
import {
  subscribeGrammarStudents, loadAllGrammarStudentsRaw, cleanupLegacyStudent, TERM, topicPassed, passMark, type GrammarStudentRow, type GuardRecord,
  loadManualOverrides, saveManualOverride, removeManualOverride, type ManualOverrideEntry,
} from '@/lib/cloud'

// ⭐ แก้/เพิ่มอีเมลแอดมินที่นี่ (ตัวพิมพ์เล็ก)
const ADMIN_EMAILS = ['kawpeerawat@gmail.com']
// บัญชีทดสอบของอาจารย์เอง (ไม่ใช่นักเรียนจริง) → ไม่ต้องแสดงในรายชื่อ/แท็บยังไม่จับคู่
const EXCLUDED_EMAILS = ['kawwichiannit@gmail.com']

// ลำดับหัวข้อที่อยากให้แสดง (ให้ตรงกับในแอป) — หัวข้ออื่นที่ไม่อยู่ในนี้จะต่อท้าย
// เรียงตามลำดับคาบสอน อ33206 (คาบ 1–6, 8–13 · คาบ 7/14 = ทบทวน)
const TOPIC_ORDER = [
  'Sentence Structure', 'Relative Clauses', 'Noun Clauses', 'Connectors',
  'Parallel Structure', 'Non-finite Verbs', 'Comparison', 'Word Order',
  'Word Form', 'Subject-Verb Agreement', 'Gerund Infinitive', 'Prepositions',
]
const TOPIC_SESSION: Record<string, number> = {
  'Sentence Structure': 1, 'Relative Clauses': 2, 'Noun Clauses': 3, 'Connectors': 4,
  'Parallel Structure': 5, 'Non-finite Verbs': 6, 'Comparison': 8, 'Word Order': 9,
  'Word Form': 10, 'Subject-Verb Agreement': 11, 'Gerund Infinitive': 12, 'Prepositions': 13,
}
// ชื่อที่แสดง (key เดิมบางตัวคงไว้เพื่อให้ข้อมูลเก่าต่อเนื่อง แต่เนื้อหาถูกยุบรวมแล้ว)
const TOPIC_LABELS: Record<string, string> = {
  'Non-finite Verbs': 'Participles (Non-finite)',
  'Prepositions': 'Prepositions & Collocations',
  'Word Form': 'Word Form & Determiners',
  'Subject-Verb Agreement': 'Agreement (SVA + Pronoun)',
  'Gerund Infinitive': 'Verb Patterns & If-Clause',
}
const topicLabel = (t: string) => TOPIC_LABELS[t] || t

type RosterEntry = { room: string; no: number; name: string }
type PartKey = 'E' | 'S' | 'C'
// ข้อสอบรายหัวข้อ / ชุดรวม (id ชุด + หัวข้อ + จำนวนข้อรวม + จำนวนข้อแต่ละพาร์ท)
type SetInfo = { id: string; topic: string; total: number; title?: string; parts: Record<PartKey, number> }
const PART_LABEL: Record<PartKey, string> = { E: '🔍 Error', S: '🧩 Sentence', C: '📄 Cloze' }
function toSetInfo(s: { id: string; topic?: string; title?: string; items?: { question_format?: string }[] }, fallbackTopic = ''): SetInfo {
  const parts: Record<PartKey, number> = { E: 0, S: 0, C: 0 }
  ;(s.items || []).forEach(q => {
    if (q.question_format === 'Error Identification') parts.E++
    else if (q.question_format === 'Cloze Test') parts.C++
    else parts.S++
  })
  return { id: s.id, topic: s.topic || fallbackTopic, title: s.title, total: s.items?.length || 0, parts }
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
type LiveEvent = { id: number; email: string; setId: string; score: number; at: number; g?: GuardRecord; p?: PartKey }

// ── ระบบกัน AI (กติกาเดียวกับ Vocab Master) ──
const GUARD_FLAG_AT = 3
const fmtAway = (ms?: number) => (!ms ? '0 วิ' : ms < 60000 ? `${Math.round(ms / 1000)} วิ` : `${Math.floor(ms / 60000)} นาที ${Math.round((ms % 60000) / 1000)} วิ`)
const guardHits = (g?: GuardRecord | null) => (g ? (g.gl || 0) + (g.gf || 0) + (g.gp || 0) : 0)
function guardTip(g?: GuardRecord | null): string {
  if (!g) return ''
  const lines = [
    `รอบล่าสุด (${g.gm === 'enforce' ? 'หักคะแนนจริง' : 'ช่วงทดลอง'}):`,
    `ออกจากหน้า / หน้าต่างบัง ${g.gl} ครั้ง (รวม ${fmtAway(g.ga)})`,
    g.cam ? `กล้องไม่เห็นใบหน้าเกิน 0.8 วิ ${g.gf} ครั้ง · เห็นมือถือ ${g.gp ?? 0} ครั้ง (ข้ามข้อ ได้ 0)` : 'ไม่ได้เปิดกล้อง',
    `เสียโฟกัสสั้น ๆ ${g.gb} ครั้ง (ไม่หักคะแนน)`,
  ]
  if (g.gv) lines.push(`ข้อที่ไม่ได้คะแนน ${g.gv} ข้อ`)
  if (g.n) lines.push(`ทำชุดนี้ทั้งหมด ${g.n} รอบ · มากที่สุดที่เคยเกิด ${g.mx ?? 0} ครั้ง`)
  return lines.join('\n')
}
function GuardCell({ g }: { g?: GuardRecord | null }) {
  if (!g) return <span className="text-gray-300 font-black">—</span>
  const hits = guardHits(g)
  const flagged = hits >= GUARD_FLAG_AT
  return (
    <span title={guardTip(g)} className="inline-flex items-center gap-1 whitespace-nowrap cursor-help">
      {flagged ? <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-black">🚩{hits}</span>
        : hits > 0 ? <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-black">↗{hits}</span>
        : <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-black">✓</span>}
      {!g.cam && <span className="text-[9px] font-black text-gray-400">📷✗</span>}
    </span>
  )
}
type LiveState = 'connecting' | 'live' | 'offline' | 'error'
function timeAgo(ms: number | null): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), day = Math.floor(h / 24)
  if (day > 0) return `${day} วันก่อน`
  if (h > 0) return `${h} ชม.ก่อน`
  if (m > 0) return `${m} นาทีก่อน`
  return 'เมื่อสักครู่'
}

// ดึง "ห้อง" จากชื่อ เช่น "... M.6/2" / "ม.6/5" / "6/3" → "6/2"
function parseRoom(name: string): string | null {
  const ms = name.match(/\d{1,2}\s*\/\s*\d{1,2}/g)
  if (!ms || ms.length === 0) return null
  return ms[ms.length - 1].replace(/\s/g, '')
}
// ดึง "เลขที่" จากชื่อ — รองรับ 3 รูปแบบ:
//  1) ชัดเจน: No.16 / เลขที่ 16 / เบอร์ 16 / #16 / N.16
//  2) เลขเดี่ยวลอย ๆ (มีช่องว่างคั่น) เช่น "... 6/5 25" หรือ "25 6/5" (ตัดส่วนห้องออกก่อน)
//  3) เลขติดท้ายคำ (ไม่มีช่องว่าง) เช่น "ไชยวรรณ24 6/3" — เอาเฉพาะเลข 1-2 หลักที่ไม่ติดเลขอื่น
function parseNo(name: string): number | null {
  const m1 = name.match(/(?:no\.?|เลขที่|เบอร์|#|n\.)\s*(\d{1,2})\b/i)
  if (m1) return parseInt(m1[1], 10)
  const stripped = name.replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ') // ตัด "ห้อง" เช่น 6/3 ออกก่อน กันสับสน
  const m2 = stripped.match(/(?<![\d.])\b(\d{1,2})\b(?![\d.])/g)
  if (m2 && m2.length > 0) return parseInt(m2[m2.length - 1], 10)
  const m3 = stripped.match(/(?<!\d)(\d{1,2})(?!\d)/g)
  if (m3 && m3.length > 0) return parseInt(m3[m3.length - 1], 10)
  return null
}

// ตัดคำนำหน้าชื่อไทย + ช่องว่าง เพื่อเทียบชื่อแบบหลวม ๆ
function normalizeThaiName(s: string): string {
  return s.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '').replace(/\s+/g, '').trim()
}

// จับคู่สำรองด้วย "ชื่อไทย" เมื่อไม่มีเลขที่ในชื่อที่กรอก — เทียบเฉพาะนักเรียนในห้องเดียวกัน
// คืนค่ารายการทะเบียนที่ตรง ถ้าตรงมากกว่า 1 คน (กำกวม) จะไม่จับคู่ (คืน null) เพื่อความปลอดภัย
function matchByThaiName(accountName: string, roomEntries: RosterEntry[]): RosterEntry | null {
  const norm = normalizeThaiName(accountName)
  if (!/[\u0E00-\u0E7F]/.test(norm)) return null // ต้องมีอักษรไทยอย่างน้อย 1 ตัว
  const hits = roomEntries.filter(e => norm.includes(normalizeThaiName(e.name)))
  return hits.length === 1 ? hits[0] : null
}

// จับคู่ชื่อไทยแบบ "พิมพ์ผิด/สะกดคลาดเคลื่อนได้บ้าง" — ใช้เมื่อเทียบตรงตัวเป๊ะ (matchByThaiName) หาไม่เจอ
// เทียบด้วยค่าความคล้าย (Levenshtein) แทนการต้องตรงตัวทุกตัวอักษร รองรับกรณีพิมพ์ตกหล่น/วรรณยุกต์ผิด/สะกดเพี้ยนเล็กน้อย
// เกณฑ์ 0.75 + ห่างอันดับ 2 ≥0.15 (ทดสอบแล้วชื่อคนละคนในห้องเดียวกันคล้ายสุดแค่ ~0.64 จึงเว้นระยะปลอดภัยไว้มาก)
function matchByThaiNameFuzzy(accountName: string, roomEntries: RosterEntry[], threshold = 0.75, margin = 0.15): RosterEntry | null {
  const cleaned = cleanEnteredName(accountName) // ตัดห้อง/เลขที่/คำนำหน้าออกก่อน
  const norm = normalizeThaiName(cleaned)
  if (!norm || !/[\u0E00-\u0E7F]/.test(norm)) return null // ต้องมีอักษรไทยอย่างน้อย 1 ตัว
  if (roomEntries.length === 0) return null
  const scored = roomEntries
    .map(e => ({ e, score: stringSimilarity(norm, normalizeThaiName(e.name)) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (best.score < threshold) return null
  if (second && best.score - second.score < margin) return null // ใกล้เคียงกันเกินไป กำกวม ไม่จับคู่
  return best.e
}

// ดึง "ชื่อจริง" อย่างเดียวจากชื่อทางการ (ตัดคำนำหน้า + เอาแค่คำแรกก่อนช่องว่าง — นามสกุลไทยมักไม่มีช่องว่างคั่นในตัวเอง)
function extractFirstName(officialName: string): string {
  const clean = officialName.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '').trim()
  return clean.split(/\s+/)[0] || ''
}

// จับคู่เมื่อพิมพ์แค่ "ชื่อจริง" อย่างเดียว ไม่ใส่นามสกุล (นักเรียนบางคนขี้เกียจพิมพ์นามสกุล)
// ใช้ "ขึ้นต้นด้วยชื่อจริง" (ไม่ใช่ตรงเป๊ะ) กันเศษอักษรตกค้าง เช่น "ม" จากการตัดคำว่าห้องที่ไม่สมบูรณ์
// ต้องมีคนเดียวในห้องที่ชื่อจริงนี้ (ทดสอบแล้วทั้งโรงเรียนซ้ำกันแค่คู่เดียว "ธนภัทร" ห้อง 6/2)
function matchByFirstNameOnly(accountName: string, roomEntries: RosterEntry[]): RosterEntry | null {
  const cleaned = normalizeThaiName(cleanEnteredName(accountName))
  if (!cleaned || !/[\u0E00-\u0E7F]/.test(cleaned)) return null
  const hits = roomEntries.filter(e => {
    const fn = extractFirstName(e.name)
    return fn.length >= 2 && cleaned.startsWith(fn) // กันชื่อจริงสั้นเกิน 1 ตัวอักษรที่เสี่ยงจับมั่ว
  })
  return hits.length === 1 ? hits[0] : null
}


// ── จับคู่สำรองชั้นที่ 4: เทียบชื่ออังกฤษที่กรอก กับ "ชื่อไทยทับศัพท์เป็นอังกฤษ" (roster-roman.json) ──
type RosterRoman = { room: string; no: number; name: string; roman: string }

// ตัดห้อง/เลขที่/คำนำหน้า ออกจากชื่อที่กรอก เหลือแต่ตัวชื่อ (lowercase) สำหรับเทียบทับศัพท์
function cleanEnteredName(name: string): string {
  let s = name.replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ')
  s = s.replace(/(?:no\.?|เลขที่|เบอร์|#|n\.|[mม]\.?)\s*\d{0,2}\b/gi, ' ')
  s = s.replace(/[.,]/g, ' ')
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Levenshtein distance → ค่าความคล้าย 0-1 (1 = เหมือนกันทุกตัวอักษร)
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const dp: number[] = Array(b.length + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  const dist = dp[b.length]
  return 1 - dist / Math.max(a.length, b.length)
}

// จับคู่ด้วยชื่ออังกฤษเทียบทับศัพท์ — ต้องได้คะแนนสูงพอ (≥0.55) และนำอันดับ 2 พอสมควร (กันกำกวม)
// จับคู่ด้วยชื่ออังกฤษเทียบทับศัพท์ — ต้องได้คะแนนสูงพอและนำอันดับ 2 พอสมควร (กันกำกวม)
// scope แคบ (ในห้องเดียว) ใช้เกณฑ์ปกติ (0.55/0.08); scope กว้าง (ข้ามทุกห้อง) ต้องเข้มกว่า เพราะตัวเลือกเยอะขึ้นเสี่ยงชนกันง่ายกว่า
function matchByRomanName(accountName: string, roomRoman: RosterRoman[], threshold = 0.55, margin = 0.08): RosterRoman | null {
  const entered = cleanEnteredName(accountName)
  if (!entered || /[\u0E00-\u0E7F]/.test(entered)) return null // เฉพาะชื่อที่กรอกเป็นอังกฤษล้วน
  if (roomRoman.length === 0) return null
  const scored = roomRoman
    .map(e => ({ e, score: stringSimilarity(entered, e.roman) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (best.score < threshold) return null
  if (second && best.score - second.score < margin) return null // ใกล้เคียงกันเกินไป กำกวม ไม่จับคู่
  return best.e
}

// เทียบ "คำแรก" ของชื่อ (ตัดคำนำหน้าไทยออกก่อน) แบบ lowercase — ใช้แยกว่าเป็นคนเดียวกัน (สมัครซ้ำ) หรือคนละคน (พิมพ์เลขที่ชนกัน)
function normalizeThaiOrLatinFirstWord(name: string): string {
  const cleaned = name.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '').trim()
  return (cleaned.split(/\s+/)[0] || '').toLowerCase()
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] p-6">
      <div className="text-center text-gray-500 font-bold max-w-md">{children}</div>
    </div>
  )
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const email = (session?.user?.email || '').toLowerCase()
  const isAdmin = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)

  const [students, setStudents] = useState<GrammarStudentRow[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [rosterRoman, setRosterRoman] = useState<RosterRoman[]>([])
  const [overrides, setOverrides] = useState<Record<string, ManualOverrideEntry>>({})
  const [examSetInfo, setExamSetInfo] = useState<SetInfo[]>([])     // ข้อสอบรายหัวข้อ (สด จาก examSets.json)
  const [mixedSetInfo, setMixedSetInfo] = useState<SetInfo[]>([])   // แบบทดสอบรวมทุกหัวข้อ 5 ชุด (สด จาก mixedSets.json)
  const [totalByTopic, setTotalByTopic] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'completed' | 'name' | 'recent'>('completed')
  const [room, setRoom] = useState('all')
  const [trackSetId, setTrackSetId] = useState<string>('')   // ชุดที่กำลังดู "ใครทำ Error / Sentence / Cloze แล้วบ้าง"
  const [onlyNotDone, setOnlyNotDone] = useState(false)
  const [onlyNotSubmitted, setOnlyNotSubmitted] = useState(false) // แผงติดตาม: เฉพาะคนที่ยังไม่ส่งชุดนี้

  // ── Real Time ──
  const [ready, setReady] = useState(false)                       // โหลดไฟล์ทะเบียน/ชุดข้อสอบเสร็จ → เริ่มฟังข้อมูลนักเรียน
  const [live, setLive] = useState<LiveState>('connecting')
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [events, setEvents] = useState<LiveEvent[]>([])           // ส่งงานล่าสุด (ตั้งแต่เปิดหน้านี้)
  const [flash, setFlash] = useState<Record<string, number>>({})  // อีเมล → เวลาที่เพิ่งอัปเดต (ไฮไลต์แถวชั่วคราว)
  const prevRowsRef = useRef<Record<string, GrammarStudentRow>>({})
  const eventIdRef = useRef(0)
  const [cleanup, setCleanup] = useState<{ running: boolean; done: number; failed: number; total: number; msg: string; denied?: boolean } | null>(null)

  // ── จับคู่มือ: state ของ modal เลือกนักเรียนจากทะเบียน ──
  const [linkingEmail, setLinkingEmail] = useState<string | null>(null) // อีเมลบัญชีที่กำลังจะจับคู่ (เปิด modal เมื่อไม่ null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState('')


  // 1) ไฟล์คงที่ (ทะเบียน / ชุดข้อสอบ / จับคู่มือ) โหลดครั้งเดียว — ให้เบราว์เซอร์ใช้แคชได้ ไม่ต้องดาวน์โหลดซ้ำทุกครั้ง
  useEffect(() => {
    if (status !== 'authenticated' || !isAdmin) { setLoading(false); return }
    let alive = true
    ;(async () => {
      setLoading(true); setError('')
      try {
        const [rRes, rmRes, ovRes, exRes, mxRes, fsOverrides] = await Promise.all([
          fetch('/roster.json').catch(() => null),
          fetch('/roster-roman.json').catch(() => null),
          fetch('/manual-overrides.json').catch(() => null),
          fetch('/examSets.json').catch(() => null),    // ข้อสอบรายหัวข้อ
          fetch('/mixedSets.json').catch(() => null),   // ชุดรวมทุกหัวข้อ
          loadManualOverrides().catch(() => ({})), // จับคู่มือที่บันทึกถาวรบน Firestore (ยืนยันในหน้า Admin)
        ])
        let rosterData: RosterEntry[] = []
        if (rRes && rRes.ok) { try { rosterData = await rRes.json() } catch { rosterData = [] } }
        let romanData: RosterRoman[] = []
        if (rmRes && rmRes.ok) { try { romanData = await rmRes.json() } catch { romanData = [] } }
        let examSetsRaw: { id: string; topic?: string; items?: unknown[] }[] = []
        if (exRes && exRes.ok) { try { examSetsRaw = await exRes.json() } catch { examSetsRaw = [] } }
        if (!Array.isArray(examSetsRaw) || examSetsRaw.length === 0) throw new Error('examSets.json missing')
        let mixedSetsRaw: { id: string; topic?: string; items?: unknown[] }[] = []
        if (mxRes && mxRes.ok) { try { mixedSetsRaw = await mxRes.json() } catch { mixedSetsRaw = [] } }
        // ตัวหารต่อหัวข้อ = จำนวนข้อในชุดข้อสอบของหัวข้อนั้น (15)
        const totals: Record<string, number> = {}
        examSetsRaw.forEach(s => { if (s.topic) totals[s.topic] = s.items?.length || 0 })
        // ไฟล์ manual-overrides.json = seed เริ่มต้น (คนที่ยืนยันไปก่อนหน้านี้) — Firestore ทับได้ถ้าซ้ำคีย์กัน (ใหม่กว่าเชื่อ Firestore)
        let seedOverrides: Record<string, { room: string; no: number }> = {}
        if (ovRes && ovRes.ok) { try { seedOverrides = await ovRes.json() } catch { seedOverrides = {} } }
        const mergedOverrides: Record<string, ManualOverrideEntry> = {}
        Object.entries(seedOverrides).forEach(([email, v]) => {
          mergedOverrides[email] = { room: v.room, no: v.no, officialName: '', linkedAt: 0 }
        })
        Object.entries(fsOverrides).forEach(([email, v]) => { mergedOverrides[email] = v })
        if (!alive) return
        setTotalByTopic(totals)
        setRoster(Array.isArray(rosterData) ? rosterData : [])
        setRosterRoman(Array.isArray(romanData) ? romanData : [])
        setOverrides(mergedOverrides)
        setExamSetInfo(Array.isArray(examSetsRaw) ? examSetsRaw.map(s => toSetInfo(s as never)) : [])
        setMixedSetInfo(Array.isArray(mixedSetsRaw) ? mixedSetsRaw.map(s => toSetInfo(s as never, 'MIXED')) : [])
        setReady(true)
      } catch (e) {
        if (alive) { setError('โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง'); setLoading(false) }
        console.error(e)
      }
    })()
    return () => { alive = false }
  }, [status, isAdmin])

  // 2) ข้อมูลนักเรียนแบบ Real Time — ครั้งแรกได้ครบทุกคน จากนั้นได้เฉพาะคนที่เปลี่ยน (ไม่ต้องกดรีเฟรช)
  useEffect(() => {
    if (!ready) return
    setLive('connecting')
    let gotFirst = false
    const unsub = subscribeGrammarStudents((rows, info) => {
      const byEmail: Record<string, GrammarStudentRow> = {}
      rows.forEach(r => { byEmail[r.email.toLowerCase()] = r })
      if (!info.first && info.changed.length) {
        const now = Date.now()
        const fresh: LiveEvent[] = []
        info.changed.forEach(em => {
          const cur = byEmail[em]
          if (!cur) return
          const prev = prevRowsRef.current[em]
          const ls = cur.lastSet
          if (ls && (!prev?.lastSet || prev.lastSet.round !== ls.round || prev.lastSet.id !== ls.id)) {
            fresh.push({ id: ++eventIdRef.current, email: em, setId: ls.id, score: ls.score, at: now, g: ls.g, p: ls.p })
          } else {
            // แอปเวอร์ชันเก่าที่ยังเปิดค้าง (ไม่มี lastSet) → ดูจากคะแนนดีสุดที่เพิ่มขึ้นแทน
            Object.entries(cur.setBest).forEach(([k, v]) => {
              if (!k.includes(':') && v > (prev?.setBest[k] ?? 0)) fresh.push({ id: ++eventIdRef.current, email: em, setId: k, score: v, at: now })
            })
          }
        })
        if (fresh.length) setEvents(prev => [...fresh.reverse(), ...prev].slice(0, 30))
        setFlash(prev => {
          const n = { ...prev }
          info.changed.forEach(em => { n[em] = now })
          return n
        })
      }
      prevRowsRef.current = byEmail
      setStudents(rows)
      setLive(info.fromCache ? 'offline' : 'live')
      if (!info.fromCache) setLastSync(Date.now())
      if (!gotFirst) { gotFirst = true; setLoading(false) }
    }, () => {
      setLive('error')
      if (!gotFirst) { setError('โหลดข้อมูลนักเรียนไม่สำเร็จ ลองรีเฟรชอีกครั้ง'); setLoading(false) }
    })
    return () => unsub()
  }, [ready])

  // ไฮไลต์แถวที่เพิ่งอัปเดตไว้ 10 วินาทีแล้วหายเอง
  useEffect(() => {
    const keys = Object.keys(flash)
    if (!keys.length) return
    const t = setTimeout(() => {
      const cutoff = Date.now() - 10000
      setFlash(prev => {
        const n: Record<string, number> = {}
        Object.entries(prev).forEach(([k, v]) => { if (v > cutoff) n[k] = v })
        return n
      })
    }, 2000)
    return () => clearTimeout(t)
  }, [flash])

  // หัวข้อทั้งหมด เรียงตาม TOPIC_ORDER ก่อน
  const allTopics = useMemo(() => {
    const keys = Object.keys(totalByTopic)
    const ordered = TOPIC_ORDER.filter(t => keys.includes(t))
    const extra = keys.filter(t => !TOPIC_ORDER.includes(t)).sort()
    return [...ordered, ...extra]
  }, [totalByTopic])
  const totalTopics = allTopics.length

  // แผนที่ทะเบียน: "ห้อง-เลขที่" → ชื่อไทย
  const rosterMap = useMemo(() => {
    const m: Record<string, string> = {}
    roster.forEach(e => { m[`${e.room}-${e.no}`] = e.name })
    return m
  }, [roster])

  // ทะเบียนแยกตามห้อง (เรียงเลขที่) — ต้องมาก่อน computed เพราะใช้ตอนจับคู่ด้วยชื่อไทย
  const rosterByRoom = useMemo(() => {
    const m: Record<string, RosterEntry[]> = {}
    roster.forEach(e => { (m[e.room] = m[e.room] || []).push(e) })
    Object.keys(m).forEach(k => m[k].sort((a, b) => a.no - b.no))
    return m
  }, [roster])
  const rosterRooms = useMemo(
    () => Object.keys(rosterByRoom).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [rosterByRoom]
  )
  const rosterRomanByRoom = useMemo(() => {
    const m: Record<string, RosterRoman[]> = {}
    rosterRoman.forEach(e => { (m[e.room] = m[e.room] || []).push(e) })
    return m
  }, [rosterRoman])

  // คำนวณหัวข้อที่ครบ 100% ของแต่ละคน + จับคู่ทะเบียน (ห้อง/เลขที่/ชื่อไทย/ชื่ออังกฤษทับศัพท์) + สถิติย้อนหลังต่อหัวข้อ (จากอีเมล)
  // จับคู่ 4 ชั้น: (1) เลขที่ชัดเจน/หลวม + ห้อง  (2) ชื่อไทยตรงทะเบียนในห้องเดียวกัน  (3) ชื่ออังกฤษเทียบทับศัพท์ในห้องเดียวกัน
  const computed = useMemo(() => {
    return students.filter(s => !EXCLUDED_EMAILS.includes(s.email.toLowerCase())).map(s => {
      // คะแนนดีที่สุดต่อหัวข้อ (จาก setBest ของชุดข้อสอบหัวข้อนั้น) → ผ่านหัวข้อ = ทุกพาร์ท ≥ 3/5
      const bestByTopic: Record<string, number> = {}
      examSetInfo.forEach(set => {
        const ps = (['E', 'S', 'C'] as PartKey[]).reduce((a, k) => a + Math.min(s.setBest?.[`${set.id}:${k}`] ?? 0, set.parts[k]), 0)
        bestByTopic[set.topic] = Math.min(Math.max(s.setBest?.[set.id] ?? 0, ps), set.total)
      })
      const passedTopics = new Set(examSetInfo.filter(set => topicPassed(s.setBest, set)).map(set => set.topic))
      const completed = allTopics.filter(t => passedTopics.has(t))
      const rm = parseRoom(s.name)
      const no = parseNo(s.name)
      let key = rm && no ? `${rm}-${no}` : null
      let officialName = key ? (rosterMap[key] ?? null) : null
      let matchedBy: 'override' | 'form' | 'number' | 'name' | 'name-fuzzy' | 'first-name' | 'roman' | 'name-global' | 'roman-global' | null = officialName ? 'number' : null
      // ชั้นที่ 0 (มั่นใจสุด): เคยยืนยันตัวตนด้วยมือแล้ว (manual-overrides.json) → ใช้ค่านี้เสมอ ไม่สนชื่อที่กรอกตอนนี้
      const ov = overrides[s.email.toLowerCase()]
      if (ov && rosterMap[`${ov.room}-${ov.no}`]) {
        key = `${ov.room}-${ov.no}`
        officialName = rosterMap[key]
        matchedBy = 'override'
      }
      // ชั้นที่ 0.5: นักเรียนกรอก "ห้อง + เลขที่" แยกช่องในแอป (ภาคเรียนที่ 2 เป็นต้นไป) → จับคู่ทะเบียนตรง ๆ
      const pf = s.profile
      if (matchedBy !== 'override' && pf && rosterMap[`${pf.room}-${pf.no}`]) {
        key = `${pf.room}-${pf.no}`
        officialName = rosterMap[key]
        matchedBy = 'form'
      }
      if (!officialName && rm && rosterByRoom[rm]) {
        const nameHit = matchByThaiName(s.name, rosterByRoom[rm])
        if (nameHit) { officialName = nameHit.name; key = `${rm}-${nameHit.no}`; matchedBy = 'name' }
      }
      // ชื่อไทยตรงเป๊ะไม่เจอ → ลองแบบพิมพ์ผิด/สะกดคลาดเคลื่อนได้บ้าง (ในห้องเดียวกัน)
      if (!officialName && rm && rosterByRoom[rm]) {
        const fuzzyHit = matchByThaiNameFuzzy(s.name, rosterByRoom[rm])
        if (fuzzyHit) { officialName = fuzzyHit.name; key = `${rm}-${fuzzyHit.no}`; matchedBy = 'name-fuzzy' }
      }
      // พิมพ์แค่ "ชื่อจริง" ไม่ใส่นามสกุล (ในห้องเดียวกัน — ต้องไม่ซ้ำกับใครในห้องนั้น)
      if (!officialName && rm && rosterByRoom[rm]) {
        const firstNameHit = matchByFirstNameOnly(s.name, rosterByRoom[rm])
        if (firstNameHit) { officialName = firstNameHit.name; key = `${rm}-${firstNameHit.no}`; matchedBy = 'first-name' }
      }
      if (!officialName && rm && rosterRomanByRoom[rm]) {
        const romanHit = matchByRomanName(s.name, rosterRomanByRoom[rm])
        if (romanHit) { officialName = romanHit.name; key = `${rm}-${romanHit.no}`; matchedBy = 'roman' }
      }
      // ชั้นที่ 5: ไม่รู้ห้องเลย (หรือห้องที่พาร์สได้ผิด) → ค้นหาชื่อไทยเต็มข้ามทุกห้องทั้งโรงเรียน
      // ปลอดภัยเพราะต้องเจอ "ชื่อ-นามสกุลเต็ม" ตรงกับแค่ 1 คนเท่านั้นถึงจะยอมจับคู่ (ถ้าซ้ำ/กำกวม จะไม่จับคู่)
      if (!officialName) {
        const globalHit = matchByThaiName(s.name, roster)
        if (globalHit) { officialName = globalHit.name; key = `${globalHit.room}-${globalHit.no}`; matchedBy = 'name-global' }
      }
      // ชั้นที่ 6: ยังไม่เจอ + ชื่อเป็นอังกฤษล้วน → ค้นทับศัพท์ข้ามทุกห้องทั้งโรงเรียน (เกณฑ์เข้มกว่าในห้องเดียว 0.65/0.12 กันชนกันมั่ว)
      if (!officialName) {
        const romanGlobalHit = matchByRomanName(s.name, rosterRoman, 0.65, 0.12)
        if (romanGlobalHit) { officialName = romanGlobalHit.name; key = `${romanGlobalHit.room}-${romanGlobalHit.no}`; matchedBy = 'roman-global' }
      }
      // เริ่มทำในเทอมนี้แล้ว = มีคะแนนชุดของเทอมนี้อย่างน้อย 1 ชุด
      const termActive = Object.keys(s.setBest || {}).length > 0
      // ข้อสอบรายหัวข้อ (สด จาก setBest) — คะแนนดีสุดของแต่ละหัวข้อรวมกัน + จำนวนหัวข้อที่ทำแล้ว
      const examDone = examSetInfo.reduce((sum, set) => sum + Math.min(s.setBest?.[set.id] ?? 0, set.total), 0)
      const examTopicsTried = examSetInfo.filter(set => (s.setBest?.[set.id] ?? 0) > 0).length
      // ชุดรวมทุกหัวข้อ (ฝึกฝนตนเอง)
      const mixedDone = mixedSetInfo.reduce((sum, set) => sum + Math.min(s.setBest?.[set.id] ?? 0, set.total), 0)
      const mixedTried = mixedSetInfo.filter(set => (s.setBest?.[set.id] ?? 0) > 0).length
      return { ...s, completed, completedCount: completed.length, bestByTopic, room: (matchedBy === 'form' && pf) ? pf.room : rm, no: (matchedBy === 'form' && pf) ? pf.no : no, key, officialName, matchedBy, termActive, examDone, examTopicsTried, mixedDone, mixedTried }
    })
  }, [students, allTopics, totalByTopic, roster, rosterMap, rosterByRoom, rosterRomanByRoom, overrides, examSetInfo, mixedSetInfo])

  type Account = (typeof computed)[number]

  // จับคู่ "ห้อง-เลขที่" → บัญชีที่ตรงทะเบียน (ถ้าซ้ำเลือกคนที่ทำครบหัวข้อมากกว่า/ล่าสุดกว่า)
  const accountByKey = useMemo(() => {
    const m: Record<string, Account> = {}
    computed.forEach(c => {
      if (!c.key || !c.officialName) return
      const ex = m[c.key]
      if (!ex || c.completedCount > ex.completedCount ||
          (c.completedCount === ex.completedCount && (c.updatedAt || 0) > (ex.updatedAt || 0))) {
        m[c.key] = c
      }
    })
    return m
  }, [computed])

  // บัญชีที่จับคู่ทะเบียนไม่ได้ (ยังไม่ใส่ห้อง/เลขที่ หรือใส่ไม่ตรง) → ให้ครูเช็กเอง
  const orphanAccounts = useMemo(() => computed.filter(c => !c.officialName), [computed])

  // บัญชีที่กำลังเปิด modal จับคู่มืออยู่ (หา object เต็มจาก email ที่เก็บไว้ใน state)
  const linkingAccount = useMemo(
    () => (linkingEmail ? computed.find(c => c.email.toLowerCase() === linkingEmail) ?? null : null),
    [linkingEmail, computed]
  )

  // รายชื่อทะเบียนที่ค้นหาได้ใน modal จับคู่มือ (ค้นได้ทั้งชื่อไทยและเลขที่/ห้อง)
  const linkCandidates = useMemo(() => {
    const q = linkSearch.trim().toLowerCase()
    if (!q) return roster.slice(0, 30) // ยังไม่พิมพ์ค้นหา → โชว์ 30 คนแรกกันรายการยาวเกิน
    return roster.filter(e =>
      e.name.toLowerCase().includes(q) ||
      `${e.room}`.includes(q) ||
      String(e.no).includes(q)
    ).slice(0, 30)
  }, [roster, linkSearch])

  const handleOpenLink = (email: string) => { setLinkingEmail(email); setLinkSearch(''); setLinkError('') }
  const handleCloseLink = () => { if (!linkSaving) { setLinkingEmail(null); setLinkError('') } }

  const handleConfirmLink = async (entry: RosterEntry) => {
    if (!linkingAccount) return
    setLinkSaving(true); setLinkError('')
    const ok = await saveManualOverride(linkingAccount.email, entry.room, entry.no, entry.name)
    setLinkSaving(false)
    if (!ok) { setLinkError('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); return }
    // อัปเดตหน้าจอทันที ไม่ต้องรอโหลดใหม่
    setOverrides(prev => ({ ...prev, [linkingAccount.email.toLowerCase()]: { room: entry.room, no: entry.no, officialName: entry.name, linkedAt: Date.now() } }))
    setLinkingEmail(null)
  }

  const handleUnlink = async (email: string) => {
    const ok = await removeManualOverride(email)
    if (!ok) return
    setOverrides(prev => { const n = { ...prev }; delete n[email.toLowerCase()]; return n })
  }

  // อีเมล → บัญชี (ใช้กับ "ส่งงานล่าสุด")
  const acctByEmail = useMemo(() => {
    const m: Record<string, Account> = {}
    computed.forEach(c => { m[c.email.toLowerCase()] = c })
    return m
  }, [computed])
  const setNameOf = (id: string): string => {
    const ex = examSetInfo.find(x => x.id === id)
    if (ex) return `คาบ ${TOPIC_SESSION[ex.topic] ?? '–'} · ${topicLabel(ex.topic)}`
    const mx = mixedSetInfo.find(x => x.id === id)
    return mx ? `🎯 ${mx.title || mx.id}` : id
  }
  const setTotalOf = (id: string): number | null =>
    (examSetInfo.find(x => x.id === id) || mixedSetInfo.find(x => x.id === id))?.total ?? null

  // บัญชีที่ยังมีข้อมูลเทอมก่อนค้างอยู่ (ยังไม่ถูกล้าง)
  const legacyCount = useMemo(
    () => students.filter(s => s.legacy && !EXCLUDED_EMAILS.includes(s.email.toLowerCase())).length,
    [students]
  )

  // 🧹 ล้างข้อมูลเทอมก่อนทุกบัญชี — ดาวน์โหลดไฟล์สำรองก่อนเสมอ แล้วจึงลบ (เก็บชื่อ / อีเมล / ห้อง-เลขที่ / คะแนนเทอมนี้)
  const handleCleanup = async () => {
    if (cleanup?.running) return
    setCleanup({ running: true, done: 0, failed: 0, total: 0, msg: 'กำลังดาวน์โหลดไฟล์สำรอง...' })
    let raw: { id: string; data: Record<string, unknown> }[] = []
    try {
      raw = await loadAllGrammarStudentsRaw()
      const blob = new Blob([JSON.stringify(raw, null, 1)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `grammarStudents-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) {
      console.error(e)
      setCleanup({ running: false, done: 0, failed: 0, total: 0, msg: 'สำรองข้อมูลไม่สำเร็จ จึงยังไม่ได้ลบอะไร ลองใหม่อีกครั้ง' })
      return
    }
    const targets = raw.filter(r => r.data.term !== TERM)
    if (targets.length === 0) { setCleanup({ running: false, done: 0, failed: 0, total: 0, msg: 'ไม่มีข้อมูลเทอมก่อนค้างแล้ว' }); return }
    const ok = window.confirm(`ดาวน์โหลดไฟล์สำรองแล้ว\n\nจะล้างข้อมูลเทอมก่อนของ ${targets.length} บัญชี\n(ชื่อ อีเมล ห้อง เลขที่ และคะแนนเทอมนี้ยังอยู่ครบ)\n\nยืนยันหรือไม่?`)
    if (!ok) { setCleanup(null); return }
    const sets = examSetInfo.map(x => ({ id: x.id, topic: x.topic, total: x.total, parts: x.parts }))
    let done = 0, failed = 0
    for (const t of targets) {
      const r = await cleanupLegacyStudent(t.id, t.data, sets)
      if (r === 'denied') {
        setCleanup({ running: false, done, failed, total: targets.length, denied: true,
          msg: 'Firebase ไม่อนุญาตให้บัญชีครูแก้ข้อมูลของนักเรียน — ไม่เป็นไรครับ ข้อมูลเทอมก่อนของแต่ละคนจะถูกล้างเองเมื่อนักเรียนทำแบบฝึกครั้งแรกของเทอม' })
        return
      }
      if (r === 'ok') done++; else failed++
      setCleanup({ running: true, done, failed, total: targets.length, msg: 'กำลังล้างข้อมูล...' })
    }
    setCleanup({ running: false, done, failed, total: targets.length, msg: failed ? `ล้างแล้ว ${done} บัญชี · ไม่สำเร็จ ${failed} บัญชี (กดอีกครั้งเพื่อลองใหม่)` : `ล้างข้อมูลเทอมก่อนเรียบร้อย ${done} บัญชี` })
  }

  // 🔴 ตรวจจับ "ความขัดแย้ง" — หลายบัญชีจับคู่ไปที่ห้อง-เลขที่เดียวกัน (พิมพ์เลขที่ผิดชนกัน หรือสมัครซ้ำ 2 อีเมล)
  // สำคัญ: ถ้าปล่อยไว้ อาจโชว์ข้อมูลของคนหนึ่งไปแปะชื่อของอีกคนโดยไม่รู้ตัว
  const keyConflicts = useMemo(() => {
    const groups: Record<string, Account[]> = {}
    computed.forEach(c => { if (c.key && c.officialName) (groups[c.key] = groups[c.key] || []).push(c) })
    return Object.entries(groups)
      .filter(([, accs]) => accs.length > 1)
      .map(([key, accs]) => {
        // เดาว่าใครคือ "ตัวการพิมพ์ผิด": ชื่อที่กรอกไม่คล้ายกับชื่อทางการเลย มักเป็นตัวการ
        const sameNameGroup = accs.every(a => normalizeThaiOrLatinFirstWord(a.name) === normalizeThaiOrLatinFirstWord(accs[0].name))
        return { key, accounts: accs, likelyDuplicateAccount: sameNameGroup }
      })
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
  }, [computed])

  const isClassView = room !== 'all' && room !== 'none'

  // มุมมองห้อง: รายชื่อทะเบียนทั้งห้อง + บัญชีที่จับคู่ได้
  const classRows = useMemo(() => {
    if (!isClassView) return [] as { entry: RosterEntry; acc: Account | null }[]
    const entries = rosterByRoom[room] || []
    return entries.map(e => ({ entry: e, acc: accountByKey[`${e.room}-${e.no}`] || null }))
  }, [isClassView, room, rosterByRoom, accountByKey])
  const classActive = useMemo(
    () => classRows.filter(r => r.acc).map(r => r.acc as Account),
    [classRows]
  )

  // ชุดบัญชีที่ใช้คำนวณสรุป/ภาพรวมรายหัวข้อ
  const scopeAccounts: Account[] = useMemo(() => {
    if (room === 'all') return computed
    if (room === 'none') return orphanAccounts
    return classActive
  }, [room, computed, orphanAccounts, classActive])

  // ตัวหาร: มุมมองห้อง = จำนวนในทะเบียน, อื่น ๆ = จำนวนบัญชีในมุมมอง
  const denom = isClassView ? (rosterByRoom[room]?.length || 0) : scopeAccounts.length

  const summary = useMemo(() => {
    const active = scopeAccounts.length
    const finishedAll = scopeAccounts.filter(r => totalTopics > 0 && r.completedCount >= totalTopics).length
    const avg = active > 0 ? scopeAccounts.reduce((s, r) => s + r.completedCount, 0) / active : 0
    return { active, finishedAll, avg }
  }, [scopeAccounts, totalTopics])

  // ภาพรวมรายหัวข้อ — กี่คนทำครบ (เทียบ denom)
  const perTopic = useMemo(() => {
    return allTopics.map(t => ({
      topic: t,
      total: totalByTopic[t] || 0,
      done: scopeAccounts.filter(r => r.completed.includes(t)).length,
    }))
  }, [allTopics, scopeAccounts, totalByTopic])

  // รายการบัญชี (มุมมอง ทั้งหมด / ไม่จับคู่) — ค้นหา + เรียง
  const filteredAccounts = useMemo(() => {
    let rows = scopeAccounts
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter(r =>
      (r.officialName || '').toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q)
    )
    return [...rows].sort((a, b) => {
      if (sortBy === 'name') return (a.officialName || a.name).localeCompare(b.officialName || b.name, 'th')
      if (sortBy === 'recent') return (b.updatedAt || 0) - (a.updatedAt || 0)
      return b.completedCount - a.completedCount || (b.updatedAt || 0) - (a.updatedAt || 0)
    })
  }, [scopeAccounts, query, sortBy])

  // รายการทะเบียน (มุมมองห้อง) — ค้นหา + ตัวเลือก "เฉพาะยังไม่เข้าทำ"
  const filteredClassRows = useMemo(() => {
    let rows = classRows
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter(r => r.entry.name.toLowerCase().includes(q) || String(r.entry.no) === q)
    if (onlyNotDone) rows = rows.filter(r => !r.acc?.termActive)
    return rows
  }, [classRows, query, onlyNotDone])

  // ยังไม่เริ่มทำในเทอมนี้ (ไม่มีบัญชี หรือมีบัญชีแต่ยังไม่มีคะแนนเทอมนี้)
  const notDoneList = useMemo(() => classRows.filter(r => !r.acc?.termActive), [classRows])
  const classStarted = classRows.length - notDoneList.length

  // ตัวหารรวมข้อสอบรายหัวข้อ (12 หัวข้อ × 20 ข้อ = 240)
  const examTotal = useMemo(() => examSetInfo.reduce((s, x) => s + x.total, 0), [examSetInfo])
  const mixedTotal = useMemo(() => mixedSetInfo.reduce((s, x) => s + x.total, 0), [mixedSetInfo])

  // สรุปภาพรวมข้อสอบรายหัวข้อ — ตัวเลขสดจาก Firestore
  const examSummary = useMemo(() => {
    const started = scopeAccounts.filter(r => r.examDone > 0).length
    const finishedAll = examTotal > 0 ? scopeAccounts.filter(r => r.examDone >= examTotal).length : 0
    const avgPctLive = scopeAccounts.length > 0 && examTotal > 0
      ? scopeAccounts.reduce((s, r) => s + r.examDone, 0) / (scopeAccounts.length * examTotal) : 0
    // รายหัวข้อ: กี่คนเริ่มทำ + ค่าเฉลี่ยคะแนนดีสุดของคนที่ทำ
    const perSet = examSetInfo.map(set => {
      const scores = scopeAccounts.map(r => Math.min(r.setBest?.[set.id] ?? 0, set.total)).filter(v => v > 0)
      return { ...set, students: scores.length, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0 }
    })
    return { started, finishedAll, avgPctLive, perSet }
  }, [scopeAccounts, examTotal, examSetInfo])

  const pctColor = (done: number, total: number) => {
    if (total === 0) return 'bg-gray-300'
    const p = done / total
    if (p >= 1) return 'bg-green-500'
    if (p >= 0.6) return 'bg-[#003399]'
    if (p >= 0.3) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const roomTabCls = (active: boolean) =>
    `px-3.5 py-1.5 rounded-lg text-xs font-black transition-all ${active ? 'bg-[#003399] text-white shadow' : 'bg-gray-50 border-2 border-gray-200 text-gray-600 hover:border-[#003399]/40'}`

  // ── สถานะก่อนเข้าถึง ──
  if (status === 'loading') return <Centered>⏳ กำลังตรวจสอบสิทธิ์...</Centered>
  if (status !== 'authenticated')
    return <Centered>กรุณาเข้าสู่ระบบก่อน<br /><a href="/login" className="text-[#003399] underline mt-2 inline-block">ไปหน้า Login</a></Centered>
  if (!isAdmin)
    return (
      <Centered>
        <div className="text-4xl mb-3">⛔</div>
        บัญชีนี้ไม่มีสิทธิ์เข้าหน้า Admin
        <div className="text-xs text-gray-400 mt-1 font-medium">{email || '(ไม่พบอีเมล)'}</div>
        <a href="/" className="text-[#003399] underline mt-3 inline-block">← กลับหน้าหลัก</a>
      </Centered>
    )

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-16">
      {/* Header */}
      <div className="bg-[#003399] text-white">
        <div className="max-w-5xl mx-auto px-5 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight">📊 Admin — ความก้าวหน้านักเรียน</h1>
            <p className="text-[11px] text-white/70 font-medium mt-0.5">นับหัวข้อที่ผ่าน = ทุกส่วน (Error 5 · Sentence 5 · Cloze 5) ได้ ≥ 3/5 · ติดตามตามทะเบียนห้อง</p>
            {!loading && !error && (
              <span data-live={live} className={`inline-flex items-center gap-1.5 mt-2 text-[11px] font-black px-2.5 py-1 rounded-full ${live === 'live' ? 'bg-green-500/20 text-green-100' : live === 'offline' ? 'bg-amber-400/25 text-amber-100' : live === 'error' ? 'bg-red-500/30 text-red-100' : 'bg-white/10 text-white/70'}`}>
                <span className={`w-2 h-2 rounded-full ${live === 'live' ? 'bg-green-400 animate-pulse' : live === 'offline' ? 'bg-amber-300' : live === 'error' ? 'bg-red-400' : 'bg-white/50'}`} />
                {live === 'live' ? `Live · อัปเดตเองอัตโนมัติ (ข้อมูลล่าสุด ${lastSync ? clock(lastSync) : '–'})`
                  : live === 'offline' ? 'ออฟไลน์ — แสดงข้อมูลล่าสุด เดี๋ยวต่อใหม่เอง'
                  : live === 'error' ? 'ขาดการเชื่อมต่อ — กดรีเฟรชหน้า'
                  : 'กำลังเชื่อมต่อ...'}
              </span>
            )}
          </div>
          <a href="/" className="text-xs font-black bg-[#FFD700] text-[#003399] px-4 py-2 rounded-xl hover:bg-[#e6c200] transition-all">← กลับแอป</a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 mt-5">
        {loading ? (
          <div className="text-center text-gray-400 font-bold py-20 animate-pulse">⏳ กำลังโหลดข้อมูลนักเรียน...</div>
        ) : error ? (
          <div className="text-center text-red-500 font-bold py-20">{error}</div>
        ) : (
          <>
            {/* เลือกห้อง */}
            <div className="bg-white border-2 border-gray-100 rounded-2xl p-3 mb-4">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">เลือกห้อง (ตามทะเบียน)</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setRoom('all'); setOnlyNotDone(false) }} className={roomTabCls(room === 'all')}>
                  ทั้งหมด ({computed.length})
                </button>
                {rosterRooms.map(r => (
                  <button key={r} onClick={() => { setRoom(r); setQuery('') }} className={roomTabCls(room === r)}>
                    ม.{r} ({rosterByRoom[r]?.length || 0})
                  </button>
                ))}
                {orphanAccounts.length > 0 && (
                  <button onClick={() => { setRoom('none'); setOnlyNotDone(false) }} className={roomTabCls(room === 'none')}>
                    ⚠️ ยังไม่จับคู่ ({orphanAccounts.length})
                  </button>
                )}
              </div>
              {room === 'none' && (
                <p className="text-[11px] text-amber-600 font-medium mt-2 px-1 leading-relaxed">
                  บัญชีเหล่านี้ยังไม่ได้ใส่ "ห้อง + เลขที่" ในชื่อ (หรือใส่ไม่ตรงทะเบียน) จึงจับคู่อัตโนมัติไม่ได้ — ให้นักเรียนแก้ชื่อเป็นรูปแบบ เช่น "No.16 M.6/2"
                </p>
              )}
            </div>

            {/* 🔴 ตรวจพบความขัดแย้ง — หลายบัญชีชนกันที่ห้อง-เลขที่เดียวกัน (สำคัญ ควรแก้ก่อนดูข้อมูลอื่น) */}
            {keyConflicts.length > 0 && (
              <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 mb-5">
                <p className="text-xs font-black text-red-700 uppercase tracking-widest mb-1">
                  🔴 พบความขัดแย้งการจับคู่ {keyConflicts.length} จุด — ควรตรวจสอบ
                </p>
                <p className="text-[11px] text-red-600 font-medium mb-3 leading-relaxed">
                  มีมากกว่า 1 บัญชีอ้างห้อง+เลขที่เดียวกัน อาจทำให้ระบบโชว์คะแนนผิดคน หรือข้อมูลกระจายอยู่คนละบัญชี
                </p>
                <div className="space-y-2.5">
                  {keyConflicts.map(({ key, accounts, likelyDuplicateAccount }) => (
                    <div key={key} className="bg-white border border-red-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-black text-gray-700">ม.{key.split('-')[0]} เลขที่ {key.split('-')[1]} — {accounts[0].officialName}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${likelyDuplicateAccount ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                          {likelyDuplicateAccount ? '🔁 น่าจะสมัครซ้ำ 2 อีเมล' : '⚠️ ชื่อไม่ตรงกัน — เช็กเลขที่ผิด'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {accounts.map(a => (
                          <div key={a.email} className="flex items-center justify-between text-[10px] text-gray-500 font-medium pl-2">
                            <span className="truncate">{a.name} <span className="text-gray-300">·</span> {a.email}</span>
                            <span className="font-black text-gray-600 flex-shrink-0 ml-2">{a.completedCount}/{totalTopics} หัวข้อ</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* สรุปภาพรวม */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {isClassView ? (
                <>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-[#003399]">{denom}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">นักเรียน ม.{room} (ทะเบียน)</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-green-600">{classStarted}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">เริ่มทำแล้ว (เทอมนี้)</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-amber-500">{notDoneList.length}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">ยังไม่เริ่ม</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-[#003399]">{summary.active}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">{room === 'none' ? 'บัญชียังไม่จับคู่' : 'นักเรียนทั้งหมด'}</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-green-600">{summary.finishedAll}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">ครบทุกหัวข้อ ({totalTopics})</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-[#003399]">{summary.avg.toFixed(1)}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">เฉลี่ยหัวข้อที่ครบ/คน</div>
                  </div>
                </>
              )}
            </div>

            {/* 📡 ส่งงานล่าสุด (สด) — ขึ้นเองเมื่อนักเรียนทำจบ 1 ชุด ไม่ต้องรีเฟรช */}
            {(() => {
              const shown = events.filter(ev => !isClassView || (acctByEmail[ev.email]?.key || '').startsWith(`${room}-`)).slice(0, 8)
              return (
                <div className="bg-white border-2 border-green-100 rounded-2xl p-4 mb-5" data-testid="live-feed">
                  <p className="text-xs font-black text-green-700 uppercase tracking-widest mb-2">📡 ส่งงานล่าสุด (สด){isClassView ? ` · ห้อง ${room}` : ''}</p>
                  {shown.length === 0 ? (
                    <p className="text-[11px] text-gray-400 font-medium leading-relaxed">ยังไม่มีใครส่งงานตั้งแต่เปิดหน้านี้ — เปิดหน้านี้ค้างไว้ได้เลย เมื่อนักเรียนทำจบ 1 ชุด ชื่อจะขึ้นที่นี่และในตารางด้านล่างเอง ไม่ต้องกดรีเฟรช</p>
                  ) : (
                    <div className="space-y-1">
                      {shown.map(ev => {
                        const a = acctByEmail[ev.email]
                        const si = examSetInfo.find(x => x.id === ev.setId) || mixedSetInfo.find(x => x.id === ev.setId)
                        const tot = ev.p ? (si?.parts[ev.p] ?? null) : setTotalOf(ev.setId)
                        const full = tot !== null && (ev.p ? ev.score >= passMark(tot) : si && si.topic !== 'MIXED' ? topicPassed(a?.setBest, si) : ev.score >= tot)
                        return (
                          <div key={ev.id} className="flex items-center justify-between gap-2 text-[11px] bg-green-50/70 rounded-lg px-2.5 py-1.5">
                            <span className="min-w-0 truncate">
                              <span className="font-black text-gray-400 mr-1.5">{clock(ev.at)}</span>
                              <span className="font-black text-gray-800">{a?.officialName || a?.name || ev.email}</span>
                              {a?.key && <span className="text-[10px] font-bold text-[#003399] ml-1.5">ม.{a.key.split('-')[0]} เลขที่ {a.key.split('-')[1]}</span>}
                              <span className="text-gray-500 ml-1.5">· {setNameOf(ev.setId)}{ev.p ? ` · ซ่อม ${PART_LABEL[ev.p]}` : ''}</span>
                            </span>
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              {ev.g && <GuardCell g={ev.g} />}
                              <span className={`font-black px-2 py-0.5 rounded ${full ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{ev.score}/{tot ?? '?'}</span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* 📋 ติดตามรายหัวข้อ: ใครทำ Error / Sentence / Cloze แล้วบ้าง (คะแนนดีสุดแยกพาร์ท) */}
            {examSetInfo.length > 0 && (() => {
              const sets = [
                ...TOPIC_ORDER.map(t => examSetInfo.find(x => x.topic === t)).filter((x): x is SetInfo => !!x),
                ...examSetInfo.filter(x => !TOPIC_ORDER.includes(x.topic)),
                ...mixedSetInfo,
              ]
              const set = sets.find(x => x.id === trackSetId) || sets[0]
              if (!set) return null
              const partKeys = (['E', 'S', 'C'] as PartKey[]).filter(p => set.parts[p] > 0)
              const score = (acc: Account | null, p: PartKey): number | null => {
                const v = acc?.setBest?.[`${set.id}:${p}`]
                return typeof v === 'number' ? Math.min(v, set.parts[p]) : null
              }
              // คะแนนรวม = ดีสุดรอบเต็ม หรือผลรวมดีสุดรายพาร์ท (ซ่อมเฉพาะพาร์ทก็นับ) แล้วแต่อย่างไหนมากกว่า · null = ยังไม่เคยทำเลย
              const totalBest = (acc: Account | null): number | null => {
                const v = acc?.setBest?.[set.id]
                const ps = partKeys.map(p => score(acc, p))
                if (typeof v !== 'number' && ps.every(x => x === null)) return null
                return Math.min(Math.max(typeof v === 'number' ? v : 0, ps.reduce<number>((a, x) => a + (x ?? 0), 0)), set.total)
              }
              // มุมมองห้อง = ทุกคนในทะเบียน (รวมคนที่ยังไม่เข้าแอป) · มุมมองอื่น = บัญชีที่มีในมุมมองนั้น
              const rows: { key: string; no: number | null; name: string; acc: Account | null }[] = isClassView
                ? classRows.map(r => ({ key: `${r.entry.room}-${r.entry.no}`, no: r.entry.no, name: r.entry.name, acc: r.acc }))
                : scopeAccounts
                    .map(a => ({ key: a.email, no: a.no ?? null, name: a.officialName || a.name, acc: a as Account | null }))
                    .sort((a, b) => (totalBest(b.acc) ?? -1) - (totalBest(a.acc) ?? -1))
              const doneCount = (p: PartKey) => rows.filter(r => score(r.acc, p) !== null).length
              const fullCount = (p: PartKey) => rows.filter(r => (score(r.acc, p) ?? -1) >= passMark(set.parts[p])).length
              // ส่งแล้ว = ทำอย่างน้อย 1 ส่วน (ทำทั้งชุด หรือทำรายพาร์ท)
              const submitted = rows.filter(r => totalBest(r.acc) !== null).length
              const fullAll = rows.filter(r => topicPassed(r.acc?.setBest, set)).length
              const shownRows = onlyNotSubmitted ? rows.filter(r => totalBest(r.acc) === null) : rows
              const label = set.topic === 'MIXED' ? (set.title || set.id) : `คาบ ${TOPIC_SESSION[set.topic] ?? '–'} · ${topicLabel(set.topic)}`
              return (
                <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 mb-5">
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">
                    📋 ติดตามรายหัวข้อ — ใครทำ Error / Sentence / Cloze แล้วบ้าง {isClassView ? `(ห้อง ${room} · ${denom} คน)` : '(เลือกแท็บห้องด้านบนเพื่อดูรายชื่อทั้งห้อง)'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {sets.map(x => (
                      <button key={x.id} onClick={() => setTrackSetId(x.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${x.id === set.id ? 'bg-[#003399] text-white' : x.topic === 'MIXED' ? 'bg-purple-50 text-purple-700 border border-purple-200 hover:border-purple-400' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:border-gray-400'}`}>
                        {x.topic === 'MIXED' ? `🎯 ${x.title || x.id}` : `${TOPIC_SESSION[x.topic] ?? ''}. ${topicLabel(x.topic)}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm font-black text-[#003399] mb-2">{label}</p>
                  <div className={`grid gap-2 mb-3 ${partKeys.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    {partKeys.map(p => (
                      <div key={p} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-center">
                        <div className="text-[11px] font-black text-gray-600">{PART_LABEL[p]} ({set.parts[p]} ข้อ)</div>
                        <div className="text-lg font-black text-[#003399] leading-tight">{doneCount(p)}<span className="text-xs text-gray-400">/{rows.length} คน</span></div>
                        <div className="text-[10px] font-bold text-green-600">ผ่าน (≥{passMark(set.parts[p])}/{set.parts[p]}) {fullCount(p)} คน</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3" data-testid="submitted-bar">
                    <span className="text-[11px] font-black text-green-700">
                      ✅ ทำแล้ว {submitted}/{rows.length} คน · ผ่านหัวข้อ (ทุกส่วน ≥ 3/5) {fullAll} คน · ยังไม่ทำ {rows.length - submitted} คน
                    </span>
                    <button onClick={() => setOnlyNotSubmitted(v => !v)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${onlyNotSubmitted ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                      {onlyNotSubmitted ? 'แสดงทุกคน' : '⬜ เฉพาะคนที่ยังไม่ส่ง'}
                    </button>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="text-gray-500">
                          <th className="text-left px-2 py-1.5 font-black w-10">ที่</th>
                          <th className="text-left px-2 py-1.5 font-black">ชื่อ - นามสกุล</th>
                          {partKeys.map(p => <th key={p} className="text-center px-1 py-1.5 font-black whitespace-nowrap">{PART_LABEL[p].split(' ')[1]}</th>)}
                          <th className="text-center px-1 py-1.5 font-black">รวม</th>
                          <th className="text-center px-1 py-1.5 font-black whitespace-nowrap" title="ระบบกันการใช้ AI ของรอบล่าสุด">🛡️ กัน AI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownRows.map(r => {
                          const tb = totalBest(r.acc)
                          const isFresh = !!(r.acc && flash[r.acc.email.toLowerCase()])
                          return (
                            <tr key={r.key} className={`border-t border-gray-100 transition-colors duration-700 ${isFresh ? 'bg-green-100' : ''}`}>
                              <td className="px-2 py-1.5 text-gray-400 font-bold">{r.no ?? '–'}</td>
                              <td className={`px-2 py-1.5 font-bold ${r.acc ? 'text-gray-800' : 'text-gray-400'}`}>{r.name}{!r.acc && <span className="ml-1 text-[9px] text-amber-600">(ยังไม่เข้าแอป)</span>}{isFresh && <span className="ml-1 text-[9px] font-black text-green-700">🟢 เพิ่งอัปเดต</span>}</td>
                              {partKeys.map(p => {
                                const v = score(r.acc, p)
                                const full = v !== null && v >= passMark(set.parts[p])
                                return (
                                  <td key={p} className="text-center px-1 py-1.5">
                                    {v === null
                                      ? <span className="text-gray-300 font-black">—</span>
                                      : <span className={`inline-block min-w-[34px] px-1.5 py-0.5 rounded font-black ${full ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{v}/{set.parts[p]}</span>}
                                  </td>
                                )
                              })}
                              <td className="text-center px-1 py-1.5 font-black text-[#003399]">{tb === null ? <span className="text-gray-300">—</span> : `${tb}/${set.total}`}</td>
                              <td className="text-center px-1 py-1.5 text-[10px]"><GuardCell g={r.acc?.guard?.[set.id]} /></td>
                            </tr>
                          )
                        })}
                        {shownRows.length === 0 && (
                          <tr><td colSpan={partKeys.length + 4} className="text-center py-4 text-gray-400 font-bold">{onlyNotSubmitted && rows.length > 0 ? '🎉 ทุกคนส่งชุดนี้แล้ว' : 'ยังไม่มีข้อมูลในมุมมองนี้'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-400 font-medium mt-2">— = ยังไม่เคยทำพาร์ทนี้ · ตัวเลข = คะแนนดีที่สุดของพาร์ทนั้น (เขียว = ผ่าน ≥ 3/5 · เหลือง = ควรซ่อมเฉพาะส่วนนี้) · อัปเดตเองทันทีที่นักเรียนทำจบชุด (ไม่ต้องรีเฟรช)<br />
                    🛡️ กัน AI (รอบล่าสุด): ✓ = ไม่พบ · ↗n = ออกจากหน้า / หน้าต่างบัง / กล้องไม่เห็นหน้า n ครั้ง · 🚩 = ครบ {GUARD_FLAG_AT} ครั้งขึ้นไป · 📷✗ = ไม่ได้เปิดกล้อง · แตะค้าง/ชี้ที่ช่องเพื่อดูรายละเอียด</p>
                </div>
              )
            })()}

            {/* ภาพรวมรายหัวข้อ: มีกี่คนทำครบ */}
            <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 mb-5">
              <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                ภาพรวมรายหัวข้อ — ทำครบกี่คน {isClassView ? `(จาก ${denom} คนในห้อง)` : ''}
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {perTopic.map(pt => (
                  <div key={pt.topic}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-gray-700">{topicLabel(pt.topic)} <span className="text-gray-400 font-medium">({pt.total} ข้อ)</span></span>
                      <span className="font-black text-gray-600">{pt.done}/{denom} คน</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full rounded-full ${pctColor(pt.done, denom)}`} style={{ width: `${denom > 0 ? (pt.done / denom) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ภาพรวมข้อสอบรายหัวข้อ (Error + Sentence) — ตัวเลขสดจาก Firestore */}
            {examTotal > 0 && (
              <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 mb-5">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                  📝 แบบฝึกรายหัวข้อ — Error + Sentence + Cloze {isClassView ? `(จาก ${denom} คนในห้อง)` : ''}
                </p>
                <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-3 mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-black text-red-700 text-xs">รวม {examSetInfo.length} หัวข้อ · {examTotal} ข้อ</span>
                    <span className="font-black text-red-700 text-xs">ครบทุกข้อ {examSummary.finishedAll}/{denom} คน</span>
                  </div>
                  <div className="w-full bg-white rounded-full h-1.5 overflow-hidden mb-1.5">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(examSummary.avgPctLive * 100, 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-red-600 font-bold">
                    เฉลี่ยทำได้ {(examSummary.avgPctLive * 100).toFixed(1)}% ของ {examTotal} ข้อ · {examSummary.started} คนเริ่มทำแล้ว
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
                  {examSummary.perSet.map(ps => (
                    <div key={ps.id} className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-gray-700 truncate mr-2">{topicLabel(ps.topic)}</span>
                      <span className="font-black text-gray-500 flex-shrink-0">{ps.students} คน · เฉลี่ย {ps.avg.toFixed(1)}/{ps.total}</span>
                    </div>
                  ))}
                </div>
                {mixedSetInfo.length > 0 && (() => {
                  // แบบทดสอบรวมทุกหัวข้อ (ฝึกฝนตนเอง) — กี่คนเริ่มทำ + ค่าเฉลี่ยคะแนนดีสุดรายชุด
                  const started = scopeAccounts.filter(r => r.mixedDone > 0).length
                  return (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-[11px] font-black text-purple-700 mb-1.5">🎯 แบบทดสอบรวมทุกหัวข้อ — {started} คนเริ่มทำแล้ว</p>
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {mixedSetInfo.map((set, i) => {
                          const scores = scopeAccounts.map(r => Math.min(r.setBest?.[set.id] ?? 0, set.total)).filter(v => v > 0)
                          const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
                          return (
                            <div key={set.id} className="flex items-center justify-between text-[11px]">
                              <span className="font-bold text-gray-700">ชุดรวมที่ {i + 1}</span>
                              <span className="font-black text-gray-500">{scores.length} คน · เฉลี่ย {avg.toFixed(1)}/{set.total}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ค้นหา + เครื่องมือ */}
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={isClassView ? '🔍 ค้นหาชื่อ / เลขที่...' : '🔍 ค้นหาชื่อ / อีเมลนักเรียน...'}
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-medium focus:border-[#003399] outline-none"
              />
              {isClassView ? (
                <button
                  onClick={() => setOnlyNotDone(v => !v)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap ${onlyNotDone ? 'bg-amber-500 text-white' : 'bg-white border-2 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >⬜ เฉพาะยังไม่เริ่ม</button>
              ) : (
                <div className="flex gap-1.5">
                  {([['completed', 'หัวข้อที่ครบ'], ['recent', 'ล่าสุด'], ['name', 'ชื่อ']] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setSortBy(k)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-black transition-all ${sortBy === k ? 'bg-[#003399] text-white' : 'bg-white border-2 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>

            {/* ───── มุมมองห้อง: รายชื่อทะเบียนทั้งห้อง ───── */}
            {isClassView ? (
              <>
                {notDoneList.length > 0 && !onlyNotDone && (
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 mb-3">
                    <p className="text-xs font-black text-amber-700 mb-1">⬜ ยังไม่เริ่มทำในเทอมนี้ {notDoneList.length} คน</p>
                    <p className="text-[11px] text-amber-600 font-medium leading-relaxed">
                      {notDoneList.map(r => `${r.entry.no}. ${r.entry.name}`).join('  ·  ')}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {filteredClassRows.length === 0 && (
                    <div className="text-center text-gray-400 font-bold py-12 bg-white rounded-2xl border-2 border-gray-100">
                      {onlyNotDone ? '🎉 ทุกคนเริ่มทำแล้ว' : 'ไม่พบนักเรียน'}
                    </div>
                  )}
                  {filteredClassRows.map(({ entry, acc }) => (
                    <div key={entry.no} className={`rounded-xl border-2 p-3 transition-colors duration-700 ${acc && flash[acc.email.toLowerCase()] ? 'bg-green-50 border-green-300' : acc?.termActive ? 'bg-white border-gray-100' : 'bg-gray-50 border-dashed border-gray-200'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${acc?.termActive ? 'bg-[#003399] text-[#FFD700]' : 'bg-gray-200 text-gray-400'}`}>
                            {entry.no}
                          </div>
                          <div className="min-w-0">
                            <div className={`font-black text-sm truncate ${acc?.termActive ? 'text-gray-900' : 'text-gray-400'}`}>
                              {entry.name}
                              {acc?.matchedBy === 'name' && (
                                <span className="ml-1 text-[9px] font-black text-amber-600 bg-amber-50 px-1 py-0.5 rounded" title="จับคู่จากชื่อไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">🔤</span>
                              )}
                              {acc?.matchedBy === 'name-fuzzy' && (
                                <span className="ml-1 text-[9px] font-black text-orange-600 bg-orange-50 px-1 py-0.5 rounded" title="ชื่อไทยไม่ตรงเป๊ะ (อาจพิมพ์ผิด/สะกดคลาดเคลื่อน) จับคู่ด้วยความคล้าย — ควรตรวจทาน">🔤~</span>
                              )}
                              {acc?.matchedBy === 'first-name' && (
                                <span className="ml-1 text-[9px] font-black text-cyan-700 bg-cyan-50 px-1 py-0.5 rounded" title="พิมพ์แค่ชื่อจริง ไม่ใส่นามสกุล — จับคู่เพราะไม่ซ้ำกับใครในห้องนี้ ควรตรวจทาน">✂️</span>
                              )}
                              {acc?.matchedBy === 'roman' && (
                                <span className="ml-1 text-[9px] font-black text-teal-600 bg-teal-50 px-1 py-0.5 rounded" title="จับคู่จากชื่ออังกฤษเทียบทับศัพท์ไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">🌐</span>
                              )}
                              {acc?.matchedBy === 'name-global' && (
                                <span className="ml-1 text-[9px] font-black text-purple-600 bg-purple-50 px-1 py-0.5 rounded" title="ไม่พบห้องในชื่อที่กรอกเลย จึงค้นชื่อไทยข้ามทุกห้องแทน — ควรตรวจทานเป็นพิเศษ">🌏</span>
                              )}
                              {acc?.matchedBy === 'roman-global' && (
                                <span className="ml-1 text-[9px] font-black text-rose-600 bg-rose-50 px-1 py-0.5 rounded" title="ไม่พบห้องเลย + ชื่อเป็นอังกฤษ จึงค้นทับศัพท์ข้ามทุกห้อง (เกณฑ์เข้มสุด) — ควรตรวจทานเป็นพิเศษ">🌐🌏</span>
                              )}
                              {acc?.matchedBy === 'override' && (
                                <span className="ml-1 text-[9px] font-black text-green-700 bg-green-50 px-1 py-0.5 rounded" title="ยืนยันตัวตนด้วยมือแล้ว (จำถาวร ไม่ว่าจะเปลี่ยนชื่อในแอปยังไงก็จับคู่ถูกคนเสมอ)">✅</span>
                              )}
                            </div>
                            {acc ? (
                              <div className="text-[10px] text-gray-400 font-medium truncate">{acc.email} · {acc.termActive ? `🕒 ${timeAgo(acc.updatedAt) || fmtTime(acc.updatedAt)}` : 'ยังไม่เริ่มทำในเทอมนี้'}</div>
                            ) : (
                              <div className="text-[10px] text-gray-400 font-bold">ยังไม่เข้าแอป</div>
                            )}
                          </div>
                        </div>
                        {acc?.termActive ? (
                          <div className={`text-xs font-black px-2.5 py-1 rounded-lg text-white flex-shrink-0 ${pctColor(acc.completedCount, totalTopics)}`}>
                            {acc.completedCount}/{totalTopics}
                          </div>
                        ) : (
                          <div className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-gray-200 text-gray-500 flex-shrink-0">⬜ ยังไม่เริ่ม</div>
                        )}
                      </div>
                      {acc && acc.completed.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2 pl-11">
                          {acc.completed.map(t => (
                            <span key={t} className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">✓ {topicLabel(t)}</span>
                          ))}
                        </div>
                      )}
                      {acc && (acc.examDone > 0 || acc.mixedDone > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1 pl-11">
                          {acc.examDone > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">📝 ข้อสอบรายหัวข้อ {acc.examDone}/{examTotal} ({acc.examTopicsTried} หัวข้อ)</span>}
                          {acc.mixedDone > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200">🎯 ชุดรวม {acc.mixedDone}/{mixedTotal} ({acc.mixedTried} ชุด)</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* ───── มุมมอง ทั้งหมด / ยังไม่จับคู่: การ์ดบัญชี ───── */
              <div className="space-y-3">
                {filteredAccounts.length === 0 && (
                  <div className="text-center text-gray-400 font-bold py-12 bg-white rounded-2xl border-2 border-gray-100">ไม่พบนักเรียน</div>
                )}
                {filteredAccounts.map((s, i) => (
                  <div key={s.email} className="bg-white border-2 border-gray-100 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-[#003399] text-[#FFD700] flex items-center justify-center font-black flex-shrink-0">
                          {sortBy === 'completed' ? i + 1 : ((s.officialName || s.name)[0] || '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-black text-gray-900 text-sm truncate">
                            {s.officialName || s.name}
                            {s.officialName && s.key && (
                              <span className="ml-1.5 text-[10px] font-black text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded">
                                ม.{s.key.split('-')[0]} เลขที่ {s.key.split('-')[1]}
                              </span>
                            )}
                            {s.matchedBy === 'name' && (
                              <span className="ml-1 text-[10px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="จับคู่จากชื่อไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">
                                🔤 จับคู่จากชื่อไทย
                              </span>
                            )}
                            {s.matchedBy === 'name-fuzzy' && (
                              <span className="ml-1 text-[10px] font-black text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded" title="ชื่อไทยไม่ตรงเป๊ะ (อาจพิมพ์ผิด/สะกดคลาดเคลื่อน) จับคู่ด้วยความคล้าย — ควรตรวจทาน">
                                🔤~ ชื่อไทยใกล้เคียง
                              </span>
                            )}
                            {s.matchedBy === 'first-name' && (
                              <span className="ml-1 text-[10px] font-black text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded" title="พิมพ์แค่ชื่อจริง ไม่ใส่นามสกุล — จับคู่เพราะไม่ซ้ำกับใครในห้องนี้ ควรตรวจทาน">
                                ✂️ ชื่อจริงอย่างเดียว
                              </span>
                            )}
                            {s.matchedBy === 'roman' && (
                              <span className="ml-1 text-[10px] font-black text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded" title="จับคู่จากชื่ออังกฤษเทียบทับศัพท์ไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">
                                🌐 จับคู่จากชื่อทับศัพท์
                              </span>
                            )}
                            {s.matchedBy === 'name-global' && (
                              <span className="ml-1 text-[10px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded" title="ไม่พบห้องในชื่อที่กรอกเลย จึงค้นชื่อไทยข้ามทุกห้องแทน — ควรตรวจทานเป็นพิเศษ">
                                🌏 จับคู่ข้ามห้อง
                              </span>
                            )}
                            {s.matchedBy === 'roman-global' && (
                              <span className="ml-1 text-[10px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded" title="ไม่พบห้องเลย + ชื่อเป็นอังกฤษ จึงค้นทับศัพท์ข้ามทุกห้อง (เกณฑ์เข้มสุด) — ควรตรวจทานเป็นพิเศษ">
                                🌐🌏 ทับศัพท์ข้ามห้อง
                              </span>
                            )}
                            {s.matchedBy === 'override' && (
                              <span className="ml-1 text-[10px] font-black text-green-700 bg-green-50 px-1.5 py-0.5 rounded" title="ยืนยันตัวตนด้วยมือแล้ว (จำถาวร ไม่ว่าจะเปลี่ยนชื่อในแอปยังไงก็จับคู่ถูกคนเสมอ)">
                                ✅ ยืนยันแล้ว
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 font-medium truncate">
                            {s.email}{s.officialName ? ` · (${s.name})` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {!s.officialName && (
                          <button
                            onClick={() => handleOpenLink(s.email)}
                            className="text-[10px] font-black px-2.5 py-1.5 rounded-lg bg-[#003399] text-[#FFD700] hover:bg-[#002266] transition-all whitespace-nowrap mb-1"
                          >🔗 จับคู่มือ</button>
                        )}
                        {s.matchedBy === 'override' && (
                          <button
                            onClick={() => handleUnlink(s.email)}
                            className="text-[9px] font-bold text-gray-400 hover:text-red-500 underline block mb-1 ml-auto"
                          >ยกเลิกการจับคู่</button>
                        )}
                        <div className={`text-sm font-black px-3 py-1 rounded-lg text-white ${pctColor(s.completedCount, totalTopics)}`}>
                          {s.completedCount} / {totalTopics} หัวข้อ
                        </div>
                        <div className="text-[10px] text-gray-400 font-bold mt-1" title={fmtTime(s.updatedAt)}>
                          🕒 {timeAgo(s.updatedAt) || fmtTime(s.updatedAt)}
                        </div>
                      </div>
                    </div>

                    {/* แถบสัดส่วน */}
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden mb-2.5">
                      <div className={`h-full rounded-full transition-all ${pctColor(s.completedCount, totalTopics)}`} style={{ width: `${totalTopics > 0 ? (s.completedCount / totalTopics) * 100 : 0}%` }} />
                    </div>

                    {/* เฉพาะหัวข้อที่ครบ 100% เท่านั้น */}
                    {s.completed.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {s.completed.map(t => (
                          <span key={t} className="text-[10px] font-black px-2 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200">
                            ✓ {topicLabel(t)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400 font-bold italic">ยังไม่มีหัวข้อที่ผ่าน (ทุกส่วน ≥ 3/5)</div>
                    )}

                    {/* หัวข้อที่กำลังทำ (มีคะแนนแล้ว แต่ยังไม่ผ่าน) — คะแนนดีสุดรายหัวข้อ */}
                    {allTopics.filter(t => !s.completed.includes(t) && (s.bestByTopic[t] || 0) > 0).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {allTopics
                          .filter(t => !s.completed.includes(t) && (s.bestByTopic[t] || 0) > 0)
                          .sort((a, b) => (s.bestByTopic[b] || 0) - (s.bestByTopic[a] || 0))
                          .map(t => (
                            <span key={t} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                              📝 {topicLabel(t)} · ดีสุด {s.bestByTopic[t]}/{totalByTopic[t]}
                            </span>
                          ))}
                      </div>
                    )}

                    {(s.examDone > 0 || s.mixedDone > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {s.mixedDone > 0 && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200">
                            🎯 ชุดรวมทุกหัวข้อ · {s.mixedDone}/{mixedTotal} ข้อ · ทำแล้ว {s.mixedTried}/{mixedSetInfo.length} ชุด
                          </span>
                        )}
                        {s.examDone > 0 && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200">
                            📝 ข้อสอบรายหัวข้อ · {s.examDone}/{examTotal} ข้อ ({examTotal > 0 ? Math.round(s.examDone / examTotal * 100) : 0}%) · ทำแล้ว {s.examTopicsTried}/{examSetInfo.length} หัวข้อ
                          </span>
                        )}
                      </div>
                    )}

                    <div className="text-[10px] text-gray-400 font-medium mt-2">เข้าทำล่าสุด: {fmtTime(s.updatedAt)} · เทอมนี้ทำจบ {s.totalRounds} รอบ</div>
                  </div>
                ))}
              </div>
            )}

            {/* 🧹 ล้างข้อมูลเทอมก่อน */}
            {(legacyCount > 0 || cleanup) && (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-2xl p-4 mt-6" data-testid="cleanup">
                <p className="text-xs font-black text-gray-600 mb-1">🧹 ข้อมูลเทอมก่อนค้างอยู่ {legacyCount} บัญชี</p>
                <p className="text-[11px] text-gray-500 font-medium leading-relaxed mb-3">
                  ระบบล้างให้เองเมื่อนักเรียนทำแบบฝึกครั้งแรกของเทอม หรือกดปุ่มด้านล่างเพื่อล้างทุกบัญชีตอนนี้ —
                  ระบบจะดาวน์โหลดไฟล์สำรองให้ก่อนเสมอ · ชื่อ อีเมล ห้อง เลขที่ และคะแนนเทอมนี้ยังอยู่ครบ
                </p>
                <button onClick={handleCleanup} disabled={!!cleanup?.running}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-gray-800 text-white hover:bg-black disabled:opacity-50">
                  {cleanup?.running ? `⏳ ${cleanup.msg} ${cleanup.total ? `${cleanup.done + cleanup.failed}/${cleanup.total}` : ''}` : '🧹 สำรองไฟล์ แล้วล้างข้อมูลเทอมก่อน'}
                </button>
                {cleanup && !cleanup.running && (
                  <p className={`text-[11px] font-bold mt-2 ${cleanup.denied || cleanup.failed ? 'text-amber-600' : 'text-green-600'}`}>{cleanup.msg}</p>
                )}
              </div>
            )}

            <p className="text-center text-[10px] text-gray-300 font-medium mt-6">
              ข้อมูลคำนวณสดจากชุดข้อสอบ ({totalTopics} หัวข้อ × 15 ข้อ) · จับคู่ทะเบียนด้วยห้อง+เลขที่ที่นักเรียนกรอก — ✓ = หัวข้อที่ผ่าน (ทุกส่วน ≥ 3/5)
            </p>
          </>
        )}
      </div>

      {/* 🔗 Modal จับคู่มือ — เลือกนักเรียนจากทะเบียนให้บัญชีที่จับคู่อัตโนมัติไม่ได้ */}
      {linkingAccount && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={handleCloseLink}>
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border-t-[10px] border-[#003399] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b-2 border-gray-50 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-[#003399]">🔗 จับคู่มือ</div>
                <div className="text-xs text-gray-500 font-medium truncate mt-0.5">{linkingAccount.name} · {linkingAccount.email}</div>
              </div>
              <button onClick={handleCloseLink} className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-black text-xs flex items-center justify-center">✕</button>
            </div>

            <div className="px-5 py-3 border-b border-gray-50">
              <input
                autoFocus
                value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)}
                placeholder="🔍 ค้นหาชื่อ / ห้อง / เลขที่..."
                className="w-full px-3.5 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-medium focus:border-[#003399] outline-none"
              />
              {linkError && <p className="text-[11px] text-red-500 font-bold mt-2">{linkError}</p>}
            </div>

            <div className="overflow-y-auto px-3 py-2 flex-1">
              {linkCandidates.length === 0 && (
                <p className="text-center text-xs text-gray-400 font-bold py-8">ไม่พบชื่อที่ตรงกับที่ค้นหา</p>
              )}
              {linkCandidates.map(entry => {
                const takenBy = accountByKey[`${entry.room}-${entry.no}`]
                return (
                  <button
                    key={`${entry.room}-${entry.no}`}
                    disabled={linkSaving}
                    onClick={() => handleConfirmLink(entry)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-blue-50 transition-all flex items-center justify-between gap-2 disabled:opacity-50"
                  >
                    <span className="text-sm font-bold text-gray-800 truncate">{entry.name}</span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] font-black text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded">ม.{entry.room} #{entry.no}</span>
                      {takenBy && <span className="text-[9px] font-bold text-amber-600" title={`ตอนนี้จับคู่กับ ${takenBy.email} อยู่`}>⚠️ มีคนแล้ว</span>}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="px-5 py-3 border-t border-gray-50 text-[10px] text-gray-400 font-medium">
              {linkSaving ? '⏳ กำลังบันทึก...' : 'กดเลือกชื่อเพื่อยืนยันจับคู่ทันที — จำถาวร ไม่ต้องทำซ้ำ'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
