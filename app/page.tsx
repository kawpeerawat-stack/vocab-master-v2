"use client";

import React, { useState, useEffect, useRef } from 'react';
import TIERS from '../data/tiers.json';
import {
  SrsStore,
  loadStore,
  saveStore,
  migrateLegacyIfNeeded,
  review as srsReview,
  pickRound,
  computeStats,
} from './lib/srs';
import {
  checkTypedAnswer,
  pickSmartDistractors,
  chooseQuestionType,
} from './lib/quiz';
import { loadCloudProgress, saveCloudProgress, loadLeaderboard, LeaderboardEntry } from './lib/cloud';
import CourseRoom from './_components/CourseRoom';
import {
  StreakState,
  emptyStreak,
  loadStreak,
  saveStreak,
  normalize as normalizeStreak,
  applyActivity,
  goalReached,
} from './lib/streak';

type WordItem = {
  word: string;
  thai_meaning: string;
  eng_definition: string;
  synonym: string;
  antonym: string;
  example_sentence: string;
  level: string;
  part_of_speech?: string;
  type?: 'word' | 'phrasal_verb' | 'idiom';
  pronunciation_th?: string; // คำอ่านสัทอักษรไทย เช่น "อะ-แบน-เดิน"
};

// แปลงชนิดคำเป็นป้ายสั้น ๆ สำหรับแสดงผล
const POS_LABELS: Record<string, string> = {
  noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
  preposition: 'prep.', conjunction: 'conj.', pronoun: 'pron.', determiner: 'det.',
};
function posLabel(pos?: string): string {
  if (!pos) return '';
  return POS_LABELS[pos] || pos;
}

// ป้ายชื่อประเภทข้อสอบ(อ่านง่ายขึ้นบน badge)
const QTYPE_LABELS: Record<string, string> = {
  SENTENCE: 'CONTEXT CLUE', SYNONYM: 'SYNONYM', ANTONYM: 'ANTONYM',
  MEANING: 'ENG → THAI', TYPE: 'THAI → ENG', LISTEN: 'LISTENING', WRITE: 'WRITING',
};

type QuizQuestion = WordItem & {
  questionType: 'SENTENCE' | 'SYNONYM' | 'ANTONYM' | 'WRITE' | 'TYPE' | 'LISTEN' | 'MEANING';
};

// คำตอบที่ถูกของแต่ละข้อ: โหมด MEANING ตอบเป็น "ความหมายไทย", โหมดอื่นตอบเป็น "คำอังกฤษ"
function correctAnswerFor(q: QuizQuestion): string {
  return q.questionType === 'MEANING' ? q.thai_meaning : q.word;
}

// คำที่ตอบผิดสะสมถึงจำนวนนี้ (และยังไม่ผ่าน) จะถูกพากลับไป "หน้าเรียนรู้คำศัพท์" อีกครั้ง
const RELEARN_AFTER_WRONG = 2;

// ข้อนี้ต้องผ่าน "ช่วงเรียนรู้คำศัพท์" ก่อนทำแบบฝึกหัดไหม
//   'new'     = คำใหม่ ไม่เคยเจอมาก่อนเลย (ไม่มีการ์ด SRS)
//   'relearn' = เคยตอบผิดสะสม >= RELEARN_AFTER_WRONG ครั้ง และยังไม่ผ่าน
//   null      = ไม่ต้องเรียนรู้ ทำแบบฝึกหัดได้เลย
//   ใช้เฉพาะโหมดเลือกตอบ (บริบท / คำเหมือน / คำตรงข้าม / เลือกความหมาย) ที่มีตัวเลือกให้เรียนรู้คู่กัน
function learningReason(q: QuizQuestion, srsStore: SrsStore): 'new' | 'relearn' | null {
  const isChoiceType =
    q.questionType === 'SENTENCE' ||
    q.questionType === 'SYNONYM' ||
    q.questionType === 'ANTONYM' ||
    q.questionType === 'MEANING';
  if (!isChoiceType) return null;
  const card = srsStore[q.word];
  if (!card) return 'new';
  // การ์ดเก่าที่ยังไม่มี wrongCount: ใช้ lapses แทนชั่วคราว
  const wrongs = card.wrongCount ?? card.lapses ?? 0;
  if (card.box < 5 && wrongs >= RELEARN_AFTER_WRONG) return 'relearn';
  return null;
}

// สลับลำดับตัวเลือกใหม่ — กันกรณีสุ่มได้ลำดับเดิมเป๊ะ (ให้ต้องจำ "คำ" ไม่ใช่ "ตำแหน่ง" จากช่วงเรียนรู้)
function reshuffle(arr: string[]): string[] {
  if (arr.length < 2) return [...arr];
  let next = [...arr].sort(() => 0.5 - Math.random());
  if (next.every((v, i) => v === arr[i])) next = [...arr.slice(1), arr[0]];
  return next;
}

// เจาะช่องว่างในประโยค Context Clue: คืน array ของชิ้นส่วน โดย null = ตำแหน่งช่องว่าง
//  - ถ้าประโยคมี "___" อยู่แล้ว ใช้ตำแหน่งนั้น
//  - ไม่งั้นเจาะคำเป้าหมาย (ทั้งคำตรงเป๊ะก่อน แล้วลองรูปผันของคำ)
//  - เจาะไม่ได้จริง ๆ คืนประโยคเดิม (พบน้อยมาก)
function blankContextSentence(sentence: string, word: string): (string | null)[] {
  const s = (sentence || '').trim();
  if (!s) return [s];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cut = (str: string, idx: number, len: number): (string | null)[] => [
    str.slice(0, idx),
    null,
    str.slice(idx + len),
  ];
  // 1) มีช่องว่างอยู่แล้ว เช่น "___"
  let m = s.match(/_{2,}/);
  if (m && m.index !== undefined) return cut(s, m.index, m[0].length);
  // 2) คำตรงเป๊ะ (ทั้งคำ ไม่สนตัวพิมพ์)
  m = s.match(new RegExp(`\\b${esc(word)}\\b`, 'i'));
  if (m && m.index !== undefined) return cut(s, m.index, m[0].length);
  // 3) รูปผันของคำ (เรียงยาวก่อนสั้น กันแทนซ้อน)
  const w = word.toLowerCase();
  const variants = [w + 's', w + 'es', w + 'ed', w + 'ing', w + 'd'];
  if (w.endsWith('e')) variants.push(w.slice(0, -1) + 'ing', w.slice(0, -1) + 'ed');
  if (w.endsWith('y')) variants.push(w.slice(0, -1) + 'ies', w.slice(0, -1) + 'ied');
  // เบิ้ลตัวสะกด (CVC): grab→grabbed/grabbing, equip→equipped, infer→inferred
  const vowel = (c: string) => 'aeiou'.includes(c);
  if (
    w.length >= 3 &&
    !vowel(w[w.length - 1]) &&
    vowel(w[w.length - 2]) &&
    !vowel(w[w.length - 3]) &&
    !'wxy'.includes(w[w.length - 1])
  ) {
    const d = w + w[w.length - 1];
    variants.push(d + 'ed', d + 'ing');
  }
  variants.sort((a, b) => b.length - a.length);
  for (const v of variants) {
    m = s.match(new RegExp(`\\b${esc(v)}\\b`, 'i'));
    if (m && m.index !== undefined) return cut(s, m.index, m[0].length);
  }
  return [s];
}

// ผลตรวจประโยคจาก AI
type AiResult = {
  verdict: 'excellent' | 'good' | 'needs_work';
  scoreOutOf5: number;
  feedback_th: string;
  corrected: string;
  tip_th: string;
  unavailable?: boolean; // true = AI ตรวจไม่ได้ (เช่นยังไม่ได้ตั้งค่า API key) → ข้อนี้ไม่นับ
};

export default function Home() {
  const [gameState, setGameState] = useState<'START' | 'LEARN' | 'QUIZ' | 'END'>('START');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // ── ห้องที่กำลังเปิดอยู่หลังล็อกอิน (Dashboard) ──
  // HUB = หน้าเลือกห้อง, VOCAB = ห้องคำศัพท์, DECODER = ห้องถอดรหัสคำศัพท์ (บทเรียน Prefix/Root/Suffix)
  const [section, setSection] = useState<'HUB' | 'VOCAB' | 'DECODER'>('HUB');

  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');

  // ── คลังความก้าวหน้าแบบ SRS (แทนระบบ masteredWords เดิม) ──
  const [srsStore, setSrsStore] = useState<SrsStore>({});
  const [streakState, setStreakState] = useState<StreakState>(emptyStreak());
  // โหมดติว: ทั้งหมด / พื้นฐาน(B2) / ระดับสอบเข้ามหาลัย(B2·C1)
  const [examFocus, setExamFocus] = useState<'all' | 'foundation' | 'exam'>('all');
  // เลือกเจาะพาร์ท: null = ผสมทุกแนว, หรือเจาะประเภทเดียว
  // จัดอันดับคนขยัน
  const [showRanking, setShowRanking] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingTab, setRankingTab] = useState<'week' | 'all'>('week');
  const [vocabData, setVocabData] = useState<WordItem[]>([]);

  // ── ชุดคำตามห้อง (auto): ดึงเลขห้องจากชื่อที่นักเรียนกรอก เช่น "M.6/4" ──
  //   6/1–6/3 (LMS/CS) → คลังเต็ม 3,497 คำ | 6/4 → 2,000 คำ | 6/5 (วิทย์พลังสิบ) → 1,000 คำ
  //   ระบุห้องไม่ได้ → ให้คลังเต็มไว้ก่อน (กันเคสบัญชีทดสอบ/ครูโดนจำกัดโดยไม่ตั้งใจ)
  const FULL_BANK_CAP = Infinity;
  const DEFAULT_WORD_CAP = FULL_BANK_CAP; // ห้องที่ระบบอ่านห้องไม่เจอจะได้ชุดนี้
  const tierLookup = TIERS as unknown as Record<string, { tier: number; rank: number }>;
  const roomInfo = React.useMemo(() => {
    const m = studentName.match(/6\s*[\/._-]\s*([1-5])/);
    if (!m) return { cap: DEFAULT_WORD_CAP, room: null as string | null };
    const n = m[1];
    // ใช้ "อันดับ (rank)" เป็นตัวตัดจริง ไม่ใช่ tier bucket — เพราะ tier2000 ตอนนี้ครอบคลุมถึง rank 3497 แล้ว
    //   เทียบ tier bucket เฉย ๆ จะแยก "2,000 คำพอดี" ออกจาก "คลังเต็ม" ไม่ได้อีกต่อไป
    const cap = n === '5' ? 1000 : n === '4' ? 2000 : FULL_BANK_CAP;
    return { cap, room: `6/${n}` };
  }, [studentName]);
  const wordCap = roomInfo.cap;
  // คำที่ใช้จริงสำหรับนักเรียนคนนี้ (ซ่อนคลังเต็ม — เหลือเฉพาะอันดับ 1..wordCap)
  const activeVocab = React.useMemo(
    () =>
      vocabData.filter((w) => {
        const rank = tierLookup[w.word]?.rank ?? Infinity;
        return rank <= wordCap; // rank 1..1000 ทุกห้อง, 1001..2000 เฉพาะ 6/1-6/4, 2001+ เฉพาะ 6/1-6/3
      }),
    [vocabData, wordCap]
  );
  // ชุดคำ "หลัก" สำหรับคำนวณ % ความก้าวหน้า
  //   เดิมจำกัดห้อง 2,000 คำไว้แค่ 800 คำ (เผื่อเวลาไม่พอ) — ตอนนี้เป้าสอบเลื่อนเป็นรอบปี 2570
  //   มีเวลาเพียงพอให้ทุกห้องนับ % จากคลังเต็มที่ตัวเองฝึกได้จริง ไม่ต้องจำกัดอีกต่อไป
  const coreVocab = activeVocab;
  const [currentQuestions, setCurrentQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  // ── ช่วงเรียนรู้คำศัพท์ (ก่อนทำแบบฝึกหัดทั้งชุด) ──
  //   roundOptions: ตัวเลือกของทุกข้อในรอบ สร้างไว้ล่วงหน้า (ช่วงเรียนรู้กับแบบฝึกหัดใช้ชุดเดียวกัน แต่สลับตำแหน่ง)
  //   learnQueue:   ลำดับข้อ (index ใน currentQuestions) ที่ต้องเรียนรู้ก่อน — คำใหม่ + คำที่ตอบผิดบ่อย
  //   learnIndex:   กำลังเรียนรู้คำที่เท่าไหร่ใน learnQueue
  const [roundOptions, setRoundOptions] = useState<string[][]>([]);
  const [learnQueue, setLearnQueue] = useState<{ qIdx: number; reason: 'new' | 'relearn' }[]>([]);
  const [learnIndex, setLearnIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);

  const [wrongAnswers, setWrongAnswers] = useState<{question: QuizQuestion, selected: string, feedback?: AiResult}[]>([]);

  // ── สเตตสำหรับโหมดแต่งประโยค (WRITE) ──
  const [studentSentence, setStudentSentence] = useState('');
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiChecking, setAiChecking] = useState(false);

  // ── สเตตสำหรับโหมดพิมพ์คำเอง / ฟังเสียง (TYPE, LISTEN) ──
  const [typedAnswer, setTypedAnswer] = useState('');

  const [score, setScore] = useState(0);
  const QUIZ_TIME_LIMIT = 50;
  const [timeLeft, setTimeLeft] = useState(QUIZ_TIME_LIMIT);

  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // หมดเวลา: เป็นกลาง (ไม่นับคะแนน ไม่หักกล่อง SRS ไม่นับเป็นข้อผิด)
  const [timedOut, setTimedOut] = useState(false);
  const [timedOutCount, setTimedOutCount] = useState(0);

  const [cheatWarnings, setCheatWarnings] = useState(0);

  const TOTAL_QUESTIONS_PER_ROUND = 10;
  const WRITE_MODE_QUESTIONS = 0;   // จำนวนข้อ "แต่งประโยค" ต่อรอบ — ตั้ง 0 = ปิดโหมดแต่งประโยค (ไม่เรียก AI ตรวจ)
  const WRITE_PASS_SCORE = 3;       // ได้ดาว >= ค่านี้ (จาก 5) ถือว่าตอบถูก

  const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwMmvxMfZZkIFsgeNndqMr7AmQVNADqR0SjywuccdiINPWgK4HafiJZoqmKTssEsCTGuA/exec";
  const SCHOOL_LOGO_URL = "/logo.png";

  // ── useEffect 1: โหลด vocab จาก API ──
  useEffect(() => {
    fetch('/api/vocab')
      .then((res) => {
        if (!res.ok) throw new Error("โหลดคลังคำศัพท์ไม่สำเร็จ");
        return res.json();
      })
      .then((data) => setVocabData(data))
      .catch((err) => console.error("Error loading vocab:", err));
  }, []);

  // ── useEffect 2: นับการออกนอกหน้าจอระหว่างทำข้อสอบ (แบบเงียบ ๆ ไม่เด้งเตือนกลางคัน) ──
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && gameState === 'QUIZ') {
        setCheatWarnings((prev) => prev + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [gameState]);

  // ── useEffect 3: จับเวลาแต่ละข้อ (ข้ามไปถ้าเป็นโหมดนึกเอง: WRITE/TYPE/LISTEN) ──
  useEffect(() => {
    if (gameState !== 'QUIZ' || isAnswered) return; // ช่วงเรียนรู้ (LEARN) ไม่จับเวลา
    const qt = currentQuestions[currentIndex]?.questionType;
    if (qt === 'WRITE' || qt === 'TYPE' || qt === 'LISTEN') return; // โหมดนึกเองไม่จับเวลา
    if (timeLeft === 0) {
      handleTimeOut();
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, gameState, isAnswered, currentIndex]);

  // ── อ่านออกเสียงคำ (ใช้เสียงในเบราว์เซอร์ ฟรี) สำหรับโหมดฟังเสียง ──
  // เล่นเสียงคำ/ประโยคภาษาอังกฤษ (Web Speech API) — ทนทานขึ้น: ถ้ารายชื่อเสียงยังโหลดไม่เสร็จ
  //   (พบบ่อยตอนเพิ่งเปิดหน้าเว็บครั้งแรก โดยเฉพาะมือถือ Android) จะรอให้พร้อมก่อนค่อยเล่น
  //   แทนที่จะเงียบไปเฉย ๆ แบบเดิม — และเลือกเสียงภาษาอังกฤษให้ชัดเจนถ้าเบราว์เซอร์มีให้เลือก
  const speakText = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    let spoken = false;
    const doSpeak = () => {
      if (spoken) return;
      spoken = true;
      try {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 0.9;
        const voices = synth.getVoices();
        const enVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('en'));
        if (enVoice) u.voice = enVoice;
        synth.speak(u);
      } catch (e) {
        console.error('speak error:', e);
      }
    };
    if (synth.getVoices().length === 0) {
      // เสียงยังไม่พร้อม — รอ event 'voiceschanged' หรือ timeout สำรอง (บางเบราว์เซอร์ไม่ยิง event นี้)
      const onVoicesReady = () => {
        synth.removeEventListener('voiceschanged', onVoicesReady);
        doSpeak();
      };
      synth.addEventListener('voiceschanged', onVoicesReady);
      setTimeout(() => {
        synth.removeEventListener('voiceschanged', onVoicesReady);
        doSpeak();
      }, 300);
    } else {
      doSpeak();
    }
  };
  const speakWord = (word: string) => speakText(word);

  // "ปลดล็อก" ระบบเสียงตอนผู้ใช้กดปุ่มจริง (ต้องเรียกจาก event handler ของการคลิกโดยตรง)
  //   เบราว์เซอร์ (โดยเฉพาะมือถือ/Safari) จะบล็อกเสียงที่พยายามเล่น "อัตโนมัติ" แบบเงียบ ๆ
  //   ถ้าไม่ได้มาจากการกดของผู้ใช้โดยตรง — โหมด 🎧 ฟังเสียง เล่นเสียงผ่าน setTimeout ตอนคำถามโหลด
  //   ซึ่งไม่นับเป็นการกดของผู้ใช้ จึงมักโดนบล็อกเงียบ ๆ ทำให้ "เห็นคำถามแต่ไม่มีเสียง"
  //   วิธีแก้: เล่นเสียงเบา ๆ (volume 0) ตอนกดปุ่มเริ่มรอบจริง ๆ เพื่อปลดล็อกไว้ล่วงหน้า
  const unlockSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch {
      /* เงียบไว้ ไม่ต้องแจ้งเตือนผู้ใช้ */
    }
  };

  // ── useEffect: เล่นเสียงอัตโนมัติเมื่อถึงข้อแบบฟังเสียง ──
  useEffect(() => {
    if (gameState !== 'QUIZ') return;
    const q = currentQuestions[currentIndex];
    if (q?.questionType === 'LISTEN' && !isAnswered) {
      const t = setTimeout(() => speakWord(q.word), 350);
      return () => clearTimeout(t);
    }
  }, [gameState, currentIndex, currentQuestions, isAnswered]);

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockSpeech(); // ปลดล็อกเสียงไว้ตั้งแต่จุดแรกที่ผู้ใช้กด (บางเบราว์เซอร์ต้องการแค่ครั้งเดียวต่อหน้าเว็บ)
    if (studentName.trim() && email.trim() && email.includes('@')) {
      // 1) โหลดจากเครื่อง (เร็ว) ให้เห็นทันที
      let store = loadStore(email);
      store = migrateLegacyIfNeeded(email, store);
      setSrsStore(store);
      setStreakState(loadStreak(email));
      setIsLoggedIn(true);
      setSection('HUB');

      // 2) ดึงจากคลาวด์มาทับถ้ามี (ทำให้ progress ตามข้ามเครื่อง) — สำเร็จค่อยอัปเดต cache เครื่องให้ตรงกัน
      try {
        const cloud = await loadCloudProgress(email);
        if (cloud && cloud.srs && Object.keys(cloud.srs).length > 0) {
          setSrsStore(cloud.srs);
          saveStore(email, cloud.srs); // เก็บลงเครื่องเป็น cache ด้วย
        }
        if (cloud && cloud.lastStudyDate) {
          const cloudStreak = normalizeStreak({
            ...emptyStreak(),
            streak: cloud.streak ?? 0,
            bestStreak: cloud.bestStreak ?? 0,
            lastStudyDate: cloud.lastStudyDate ?? '',
            todayCount: cloud.todayCount ?? 0,
            dailyGoal: cloud.dailyGoal ?? emptyStreak().dailyGoal,
          });
          setStreakState(cloudStreak);
          saveStreak(email, cloudStreak);
        }
      } catch (err) {
        console.error('cloud load failed:', err);
      }
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setSection('HUB');
    setStudentName('');
    setEmail('');
    setSrsStore({});
    setStreakState(emptyStreak());
    setGameState('START');
  };

  // ── บันทึกผลการตอบ 1 ข้อ ลง SRS แล้วเซฟ (ใช้ทั้งข้อเลือกตอบและข้อแต่งประโยค) ──
  const recordSrsResult = (word: string, correct: boolean) => {
    setSrsStore((prev) => {
      const updated = { ...prev, [word]: srsReview(prev[word], correct) };
      saveStore(email, updated);
      return updated;
    });
  };

  // สร้างรอบจากรายการคำที่กำหนด (ใช้ร่วมกันทั้งรอบปกติและรอบทบทวนคำที่พลาด)
  // forcedType: ถ้ากำหนด ทุกข้อจะเป็นประเภทเดียวกัน (โหมดเจาะพาร์ท ไม่มีข้อแต่งประโยค)
  const beginRoundWithWords = (words: WordItem[], forcedType?: QuizQuestion['questionType']) => {
    unlockSpeech(); // เรียกตอนนี้ (มาจากการกดปุ่มของผู้ใช้โดยตรง) เพื่อปลดล็อกเสียงไว้ล่วงหน้า
    const formattedQuestions: QuizQuestion[] = words.map((item, i) => {
      // วลี/สำนวนหลายคำ ไม่เหมาะกับโหมดพิมพ์เป๊ะ ๆ (TYPE) → ใช้โหมดความหมายแทน
      const isMultiWord = item.word.includes(' ');
      const guard = (t: QuizQuestion['questionType']): QuizQuestion['questionType'] =>
        t === 'TYPE' && isMultiWord ? 'MEANING' : t;
      if (forcedType) {
        return { ...item, questionType: guard(forcedType) };
      }
      // ข้อท้ายสุด WRITE_MODE_QUESTIONS ข้อ ให้เป็นโหมดแต่งประโยค
      if (i >= words.length - WRITE_MODE_QUESTIONS) {
        return { ...item, questionType: 'WRITE' as const };
      }
      const box = srsStore[item.word] ? srsStore[item.word].box : -1;
      const hasSynonym = Boolean(item.synonym && item.synonym !== "-" && item.synonym.trim() !== "");
      const hasAntonym = Boolean(item.antonym && item.antonym !== "-" && item.antonym.trim() !== "");
      const qType = chooseQuestionType(box, { hasSynonym, hasAntonym });
      return { ...item, questionType: guard(qType) };
    });

    setCurrentQuestions(formattedQuestions);
    setCurrentIndex(0);
    setScore(0);
    setCheatWarnings(0);
    setWrongAnswers([]);
    setTimedOutCount(0);
    // สร้างตัวเลือกของทุกข้อไว้ล่วงหน้า (ช่วงเรียนรู้และแบบฝึกหัดใช้ชุดเดียวกัน)
    const opts = formattedQuestions.map((q) => buildOptionsForQuestion(q, vocabData));
    setRoundOptions(opts);
    resetTimerAndQuestionState();
    // คำที่ต้องเรียนรู้ก่อน (คำใหม่ + คำที่ตอบผิดบ่อย) → เรียนรู้ให้ครบทั้งชุดก่อน แล้วค่อยทำแบบฝึกหัด 10 ข้อรวดเดียว
    const queue = formattedQuestions
      .map((q, qIdx) => ({ qIdx, reason: learningReason(q, srsStore) }))
      .filter((x): x is { qIdx: number; reason: 'new' | 'relearn' } => x.reason !== null);
    setLearnQueue(queue);
    setLearnIndex(0);
    if (queue.length > 0) {
      setOptions(opts[0]);
      setGameState('LEARN');
    } else {
      setOptions(opts[0]);
      setGameState('QUIZ');
    }
  };

  // รายการคำที่เด็ก "ยังอ่อน" (กล่องต่ำ ≤1 หรือเคยลืม) เรียงตามควรทบทวนก่อน
  const getWeakWordList = (): WordItem[] => {
    const wordMap = new Map(activeVocab.map((w) => [w.word, w]));
    return Object.entries(srsStore)
      .filter(([, c]) => c && (c.box <= 1 || c.lapses > 0))
      .sort((a, b) => (b[1].lapses || 0) - (a[1].lapses || 0) || a[1].box - b[1].box)
      .map(([word]) => wordMap.get(word))
      .filter((w): w is WordItem => Boolean(w));
  };

  const startNewQuizRound = () => {
    if (vocabData.length === 0) {
      alert("⚠️ ระบบยังโหลดคลังคำศัพท์ไม่สำเร็จ กรุณารีเฟรชหน้าเว็บแล้วลองใหม่ครับ");
      return;
    }

    // เลือกคำมาออกข้อสอบด้วย SRS: ผสมคำที่ "ถึงกำหนดทบทวน" + คำใหม่
    // ปรับสัดส่วนระดับตามโหมดติวที่เลือก (ใช้บันได CEFR ที่มีอยู่)
    const levelPlan =
      examFocus === 'foundation'
        ? [{ level: 'B2', count: 10 }]
        : examFocus === 'exam'
        ? [{ level: 'B2', count: 5 }, { level: 'C1', count: 5 }]
        : [{ level: 'B2', count: 6 }, { level: 'C1', count: 4 }];
    const roundWords = pickRound(srsStore, activeVocab, { total: TOTAL_QUESTIONS_PER_ROUND, levelPlan });
    const wordMap = new Map(activeVocab.map((w) => [w.word, w]));
    const selectedRoundWords: WordItem[] = roundWords
      .map((w) => wordMap.get(w))
      .filter((w): w is WordItem => Boolean(w));

    beginRoundWithWords(selectedRoundWords);
  };

  // รอบทบทวนเฉพาะคำที่เด็กยังอ่อน
  const startReviewRound = () => {
    if (vocabData.length === 0) {
      alert("⚠️ ระบบยังโหลดคลังคำศัพท์ไม่สำเร็จ กรุณารีเฟรชหน้าเว็บแล้วลองใหม่ครับ");
      return;
    }
    const weak = getWeakWordList().slice(0, TOTAL_QUESTIONS_PER_ROUND); // getWeakWordList กรองด้วย activeVocab แล้ว
    if (weak.length === 0) {
      alert("เยี่ยมมาก! ตอนนี้ยังไม่มีคำที่ต้องทบทวนเป็นพิเศษ ลองเล่นรอบปกติเพื่อเก็บคำใหม่ได้เลย 👍");
      return;
    }
    beginRoundWithWords(weak);
  };

  // ปุ่ม Start: เล่นแบบผสมเสมอ (คละทุกแนวคำถาม — ใกล้เคียงข้อสอบจริงที่สุด)
  const handleStart = () => {
    startNewQuizRound();
  };

  const buildOptionsForQuestion = (correctItem: QuizQuestion, allItems: WordItem[]): string[] => {
    // หา pool คำระดับเดียวกันก่อน (ถ้าไม่พอค่อยใช้ทั้งคลัง)
    let pool = allItems.filter(item => item.word !== correctItem.word && item.level === correctItem.level);
    if (pool.length < 3) {
      pool = allItems.filter(item => item.word !== correctItem.word);
    }

    // โหมด MEANING (อังกฤษ→ไทย): ตัวเลือกเป็น "ความหมายภาษาไทย"
    if (correctItem.questionType === 'MEANING') {
      const seen = new Set<string>([correctItem.thai_meaning]);
      const distractorMeanings: string[] = [];
      for (const w of [...pool].sort(() => 0.5 - Math.random())) {
        const m = (w.thai_meaning || '').trim();
        if (m && !seen.has(m)) { seen.add(m); distractorMeanings.push(m); }
        if (distractorMeanings.length === 3) break;
      }
      const choices = [correctItem.thai_meaning, ...distractorMeanings];
      return choices.sort(() => 0.5 - Math.random());
    }

    // โหมดอื่น: ตัวเลือกเป็น "คำอังกฤษ" (เลือกตัวลวงที่ชวนสับสน)
    const distractors = pickSmartDistractors(correctItem.word, pool.map(p => p.word), 3);
    const finalChoices = [correctItem.word, ...distractors];
    return finalChoices.sort(() => 0.5 - Math.random());
  };

  const resetTimerAndQuestionState = () => {
    setTimeLeft(QUIZ_TIME_LIMIT);
    setSelectedAnswer(null);
    setIsAnswered(false);
    setStudentSentence('');
    setAiResult(null);
    setAiChecking(false);
    setTypedAnswer('');
    setTimedOut(false);
  };

  // กด "เรียนรู้คำศัพท์ครบแล้ว" → เริ่มทำแบบฝึกหัดข้อ 1 ของชุด
  //   - เริ่มจับเวลาเต็มจำนวน (เวลาที่ใช้ในช่วงเรียนรู้ไม่ถูกนับ)
  //   - ตัวเลือกสลับตำแหน่งใหม่จากช่วงเรียนรู้
  const startExercisesAfterLearning = () => {
    setCurrentIndex(0);
    setOptions(reshuffle(roundOptions[0] ?? []));
    resetTimerAndQuestionState();
    setGameState('QUIZ');
  };

  const handleAnswerSelection = (answer: string) => {
    if (isAnswered) return;
    setSelectedAnswer(answer);
    setIsAnswered(true);

    const currentQ = currentQuestions[currentIndex];
    const correct = correctAnswerFor(currentQ);

    if (answer === correct) {
      setScore((prev) => prev + 1);
      recordSrsResult(currentQ.word, true);
    } else {
      // ตอบผิด/หมดเวลา → SRS จะพาคำนี้กลับมาทบทวนเร็ว ๆ
      recordSrsResult(currentQ.word, false);
      setWrongAnswers((prev) => [...prev, { question: currentQ, selected: answer }]);
    }
  };

  // ── หมดเวลา: เป็นกลาง — เฉลยให้ดู แต่ไม่นับคะแนน ไม่หักกล่อง SRS ไม่นับเป็นข้อผิด ──
  const handleTimeOut = () => {
    if (isAnswered) return;
    setSelectedAnswer('');
    setIsAnswered(true);
    setTimedOut(true);
    setTimedOutCount((prev) => prev + 1);
    // ตั้งใจไม่เรียก recordSrsResult และไม่เพิ่มเข้า wrongAnswers — คงตารางทบทวนเดิมไว้
  };

  // ── ตรวจคำที่นักเรียนพิมพ์เอง (โหมด TYPE / LISTEN) ──
  const handleSubmitTyped = () => {
    if (isAnswered || !typedAnswer.trim()) return;
    const currentQ = currentQuestions[currentIndex];
    const { correct } = checkTypedAnswer(typedAnswer, currentQ.word);
    setSelectedAnswer(typedAnswer.trim());
    setIsAnswered(true);
    if (correct) {
      setScore((prev) => prev + 1);
      recordSrsResult(currentQ.word, true);
    } else {
      recordSrsResult(currentQ.word, false);
      setWrongAnswers((prev) => [...prev, { question: currentQ, selected: typedAnswer.trim() }]);
    }
  };

  // ── ส่งประโยคให้ AI ตรวจ (โหมด WRITE) ──
  const handleSubmitSentence = async () => {
    if (isAnswered || aiChecking || !studentSentence.trim()) return;
    setAiChecking(true);
    const currentQ = currentQuestions[currentIndex];
    try {
      const res = await fetch('/api/check-sentence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: currentQ.word,
          thai: currentQ.thai_meaning,
          definition: currentQ.eng_definition,
          sentence: studentSentence.trim(),
        }),
      });
      // ถ้า AI ตรวจไม่ได้ (เช่น 500 เพราะยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY)
      // → ไม่นับคะแนน ไม่ลดกล่อง SRS ไม่นับเป็นข้อผิด
      if (!res.ok) {
        setAiResult({
          verdict: 'needs_work',
          scoreOutOf5: 0,
          feedback_th: 'ระบบ AI ตรวจประโยคยังไม่พร้อมใช้งานตอนนี้ ข้อนี้จึงไม่ถูกนับคะแนนและไม่กระทบความก้าวหน้าของคุณ',
          corrected: '',
          tip_th: '',
          unavailable: true,
        });
        setIsAnswered(true);
        return;
      }
      const result: AiResult = await res.json();
      setAiResult(result);
      setIsAnswered(true);

      const passed = (result.scoreOutOf5 || 0) >= WRITE_PASS_SCORE;
      if (passed) {
        setScore((prev) => prev + 1);
        recordSrsResult(currentQ.word, true);
      } else {
        recordSrsResult(currentQ.word, false);
        setWrongAnswers((prev) => [...prev, { question: currentQ, selected: studentSentence.trim(), feedback: result }]);
      }
    } catch (e) {
      console.error('check-sentence error:', e);
      alert('⚠️ ตรวจประโยคไม่สำเร็จ กรุณาลองกดส่งใหม่อีกครั้งครับ');
    } finally {
      setAiChecking(false);
    }
  };

  // เปิด/โหลดอันดับคนขยัน (โหลดครั้งแรกที่กดดู)
  const toggleRanking = async () => {
    const next = !showRanking;
    setShowRanking(next);
    if (next && leaderboard === null && !rankingLoading) {
      setRankingLoading(true);
      try {
        const board = await loadLeaderboard();
        setLeaderboard(board);
      } catch (e) {
        console.error('load leaderboard error:', e);
        setLeaderboard([]);
      } finally {
        setRankingLoading(false);
      }
    }
  };

  const handleNextQuestion = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < currentQuestions.length) {
      setCurrentIndex(nextIndex);
      // ใช้ตัวเลือกชุดเดิมที่สร้างไว้ตอนเริ่มรอบ แต่สลับตำแหน่งใหม่ (คำที่เพิ่งเรียนรู้จะไม่อยู่ตำแหน่งเดิม)
      setOptions(reshuffle(roundOptions[nextIndex] ?? buildOptionsForQuestion(currentQuestions[nextIndex], vocabData)));
      resetTimerAndQuestionState();
    } else {
      setGameState('END');
      submitScoreToGoogleSheet();
    }
  };

  const submitScoreToGoogleSheet = async () => {
    setIsSubmitting(true);
    const progressPercentage = ((score / Math.max(1, TOTAL_QUESTIONS_PER_ROUND - timedOutCount)) * 100).toFixed(0) + "%";
    try {
      await fetch(GOOGLE_SHEET_WEBAPP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: studentName,
          email: email,
          score: score,
          progress: progressPercentage,
        }),
      });
    } catch (error) {
      console.error("Error submitting score:", error);
    }

    // อัปเดต streak + เป้าหมายรายวัน (จบรอบ = ทบทวนไป 1 ชุด)
    const updatedStreak = applyActivity(streakState, TOTAL_QUESTIONS_PER_ROUND);
    setStreakState(updatedStreak);
    saveStreak(email, updatedStreak);

    // ซิงก์ความก้าวหน้า (SRS + สถิติ + streak) ขึ้น Firestore — ข้ามเครื่อง + ให้ครูเห็นรายคน
    try {
      const stats = computeStats(srsStore, coreVocab.map((w) => w.word));
      await saveCloudProgress({ email, name: studentName, srs: srsStore, stats, lastScore: score, streak: updatedStreak });
    } catch (error) {
      console.error("Error syncing progress to cloud:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isVocabLoading = vocabData.length === 0;
  const srsStats = computeStats(srsStore, coreVocab.map((w) => w.word));
  // ความก้าวหน้าแบบ "ให้คะแนนบางส่วน" ตามกล่อง SRS (ขยับทุกครั้งที่เลื่อนคำขึ้นกล่อง)
  const overallPercentage = srsStats.weightedProgress.toFixed(1);
  // จำนวนคำที่เด็กยังอ่อน (ไว้โชว์บนปุ่มทบทวนคำที่พลาด)
  const weakCount = Object.values(srsStore).filter((c) => c && (c.box <= 1 || c.lapses > 0)).length;


  // แผนที่คำศัพท์ (สำหรับแตะดูคำแปลคำใน targetVocab ของบทอ่าน)
  const vocabByWord = React.useMemo(() => {
    const m: Record<string, WordItem> = {};
    for (const w of vocabData) m[w.word.toLowerCase()] = w;
    return m;
  }, [vocabData]);
  // แผนที่ย้อนกลับ ความหมายไทย → คำศัพท์ (ใช้ในหน้าเรียนรู้ของโหมด MEANING ที่ตัวเลือกเป็นภาษาไทย)
  const vocabByThai = React.useMemo(() => {
    const m: Record<string, WordItem> = {};
    for (const w of vocabData) if (w.thai_meaning && !m[w.thai_meaning]) m[w.thai_meaning] = w;
    return m;
  }, [vocabData]);


  // อ่านออกเสียงคำศัพท์ (Web Speech API ของเบราว์เซอร์ — ไม่ต้องพึ่งบริการภายนอก)
  const speak = (text: string) => speakText(text);



  return (
    <div
      className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center p-4 font-sans text-gray-800 select-none"
    >
      <div className="w-full max-w-2xl bg-white shadow-2xl rounded-3xl p-6 md:p-10 border-t-[12px] border-[#003399] relative overflow-hidden">

        <div className="absolute top-0 left-0 w-full h-2 bg-[#FFD700]"></div>

        {/* ── หน้า Login ── */}
        {gameState === 'START' && !isLoggedIn && (
          <form onSubmit={handleStudentLogin} className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-8">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-32 h-32 mb-4 object-contain" />
              <h2 className="text-sm md:text-base font-bold text-[#003399] uppercase tracking-widest mb-1">Anukoolnaree School</h2>
              <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">Vocabulary Essential</h1>
              <div className="h-1 w-20 bg-[#FFD700] mt-2 rounded-full"></div>
            </div>

            <p className="text-gray-500 mb-8 text-sm md:text-base italic">"Anukoolnaree students, let's master English for your future."</p>

            <div className="text-left space-y-5 mb-8">
              <div>
                <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">Full Name & Student ID</label>
                <input
                  type="text"
                  placeholder="Example: Somchai Rakdee No.1 M.6/1"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] focus:ring-2 focus:ring-[#FFD700]/20 bg-gray-50/50 transition-all font-medium"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">Email (Gmail Only)</label>
                <input
                  type="email"
                  placeholder="Example: anukoolnaree.student@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] focus:ring-2 focus:ring-[#FFD700]/20 bg-gray-50/50 transition-all font-medium"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isVocabLoading || !studentName.trim() || !email.trim() || !email.includes('@')}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 transition-all duration-300 text-xl uppercase tracking-widest"
            >
              {isVocabLoading ? "⏳ Loading..." : "Enter Dashboard"}
            </button>
          </form>
        )}

        {/* ── หน้า Hub หลัก: เลือกห้องฝึก ── */}
        {gameState === 'START' && isLoggedIn && section === 'HUB' && (
          <div className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-6">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-20 h-20 mb-3 object-contain" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">Grade 12 Mastery Hub</h1>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">Choose your practice room</p>
              <p className="text-gray-500 text-xs mt-1">เลือกห้องที่อยากฝึกวันนี้{studentName ? ` · สวัสดี ${studentName.split(' ')[0]}` : ''}</p>
            </div>

            <div className="space-y-3 text-left mb-6">
              {/* ปุ่ม Vocab — เปิดเมนูคำศัพท์เดิม */}
              <button
                type="button"
                onClick={() => setSection('VOCAB')}
                className="w-full p-5 bg-[#003399] text-white rounded-2xl shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-4"
              >
                <span className="text-3xl">📚</span>
                <span className="flex-1">
                  <span className="block font-black text-lg text-[#FFD700]">คำศัพท์ (Vocabulary)</span>
                  <span className="block text-xs text-white/80 font-bold">ฝึกจำคำศัพท์ {activeVocab.length.toLocaleString()} คำ ด้วยระบบ SRS</span>
                </span>
                <span className="text-[#FFD700] text-xl">→</span>
              </button>

              {/* ปุ่มถอดรหัสคำศัพท์ — บทเรียน Prefix / Root / Suffix */}
              <button
                type="button"
                onClick={() => setSection('DECODER')}
                className="w-full p-5 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.98] transition-all flex items-center gap-4 text-left"
              >
                <span className="text-3xl">🧩</span>
                <span className="flex-1">
                  <span className="block font-black text-lg text-[#003399]">ถอดรหัสคำศัพท์</span>
                  <span className="block text-xs text-gray-500 font-bold">Root Words Decoder · Prefix • Root • Suffix · 18 บท</span>
                </span>
                <span className="text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">ใหม่</span>
              </button>
            </div>

            <button
              onClick={handleLogout}
              className="w-full py-3 bg-white text-gray-400 font-bold rounded-xl hover:text-[#003399] transition-all duration-150 text-sm uppercase"
            >
              🔄 Switch Student Account
            </button>
          </div>
        )}

        {/* ── ห้องถอดรหัสคำศัพท์ (Root Words Decoder) — บทเรียน + แบบฝึกหัด 20 ข้อ/บท ── */}
        {gameState === 'START' && isLoggedIn && section === 'DECODER' && (
          <CourseRoom courseId="decoder" email={email} name={studentName} onExit={() => setSection('HUB')} />
        )}

        {/* ── ห้อง Vocabulary (เมนูเดิม) ── */}
        {gameState === 'START' && isLoggedIn && section === 'VOCAB' && (
          <div className="text-center animate-fadeIn mt-2">
            <button
              type="button"
              onClick={() => setSection('HUB')}
              className="mb-4 text-sm font-bold text-[#003399] hover:underline flex items-center gap-1"
            >
              ← เมนูหลัก
            </button>
            <div className="flex flex-col items-center justify-center mb-6">
              <img src={SCHOOL_LOGO_URL} alt="Anukoolnaree Logo" className="w-20 h-20 mb-3 object-contain" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">Grade 12 Mastery Hub</h1>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">Anukoolnaree Vocabulary Essential</p>
              <div className="mt-3 inline-flex items-center gap-2 bg-[#FFD700]/20 border-2 border-[#FFD700] rounded-full px-4 py-1.5">
                <span className="text-base">🎯</span>
                <span className="text-sm font-black text-[#003399]">
                  {roomInfo.room ? `ห้อง ${roomInfo.room}` : 'ห้องพิเศษ'} · ชุดคำเป้าหมาย {coreVocab.length.toLocaleString()} คำ
                </span>
              </div>
            </div>

            <div className="bg-[#003399]/5 border-2 border-[#003399]/10 rounded-3xl p-6 text-left mb-6 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-black text-[#003399] uppercase tracking-wider">Overall Lexical Progress</span>
                <span className="text-sm font-black text-[#003399] bg-[#FFD700] px-3 py-1 rounded-full shadow-sm">{overallPercentage}%</span>
              </div>
              <div className="w-full bg-white h-4 rounded-full mb-3 overflow-hidden border border-[#003399]/10">
                <div
                  className="bg-gradient-to-r from-[#003399] to-[#0055ff] h-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(0,51,153,0.3)]"
                  style={{ width: `${overallPercentage}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-600 font-bold flex justify-between">
                <span>เรียนแล้ว: <span className="text-[#003399]">{srsStats.seen}</span></span>
                <span>จำได้: <span className="text-[#003399]">{srsStats.mastered}</span></span>
                <span>เป้าหมาย: <span className="text-[#003399]">{coreVocab.length.toLocaleString()} คำ</span></span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                % รวม = ครึ่งหนึ่งจากจำนวนคำที่เรียนแล้ว + อีกครึ่งจากระดับความจำ (ยิ่งทบทวนจนคำขึ้นกล่อง % ยิ่งเพิ่ม จนเต็ม 100% เมื่อจำแม่นครบทุกคำ) ส่วน &quot;จำได้&quot; คือคำที่จำได้สมบูรณ์
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                  <div className="text-lg font-black text-green-600">{srsStats.mastered}</div>
                  <div className="text-[10px] font-bold text-gray-500 uppercase">จำได้แล้ว</div>
                </div>
                <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                  <div className="text-lg font-black text-orange-500">{srsStats.learning}</div>
                  <div className="text-[10px] font-bold text-gray-500 uppercase">กำลังเรียน</div>
                </div>
                <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                  <div className="text-lg font-black text-[#003399]">{srsStats.dueNow}</div>
                  <div className="text-[10px] font-bold text-gray-500 uppercase">ถึงกำหนดทวน</div>
                </div>
              </div>
            </div>

            {/* ── Streak + เป้าหมายรายวัน ── */}
            <div className="bg-gradient-to-r from-[#003399] to-[#0044bb] rounded-2xl p-4 mb-4 text-white shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🔥</span>
                  <div>
                    <div className="text-2xl font-black leading-none">{streakState.streak} <span className="text-sm font-bold">วันติด</span></div>
                    {streakState.bestStreak > streakState.streak && (
                      <div className="text-[10px] text-[#FFD700]/90 font-bold mt-1">สถิติสูงสุด {streakState.bestStreak} วัน</div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase text-white/60">เป้าหมายวันนี้</div>
                  <div className="text-sm font-black text-[#FFD700]">
                    {goalReached(streakState) ? '🎯 สำเร็จแล้ว!' : `${streakState.todayCount}/${streakState.dailyGoal} คำ`}
                  </div>
                </div>
              </div>
              <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#FFD700] h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (streakState.todayCount / Math.max(1, streakState.dailyGoal)) * 100)}%` }}
                ></div>
              </div>
            </div>

            {/* ── อันดับคนขยัน ── */}
            <div className="mb-4">
              <button
                type="button"
                onClick={toggleRanking}
                className="w-full py-3 rounded-2xl border-2 border-[#003399]/15 bg-white text-[#003399] font-black flex items-center justify-center gap-2 hover:bg-[#003399]/5 transition-all active:scale-[0.99]"
              >
                🏆 อันดับคนขยัน {showRanking ? '▲' : '▼'}
              </button>

              {showRanking && (
                <div className="mt-3 bg-white border-2 border-gray-100 rounded-2xl p-4 shadow-sm">
                  {rankingLoading ? (
                    <div className="text-center text-gray-400 font-bold py-4 animate-pulse">กำลังโหลดอันดับ...</div>
                  ) : !leaderboard || leaderboard.length === 0 ? (
                    <div className="text-center text-gray-400 font-bold py-4">ยังไม่มีข้อมูลอันดับ</div>
                  ) : (() => {
                    // จัดเรียงตามแท็บที่เลือก
                    const ranked = [...leaderboard].sort((a, b) =>
                      rankingTab === 'week'
                        ? b.weeklyXp - a.weeklyXp || b.points - a.points
                        : b.points - a.points || b.weeklyXp - a.weeklyXp
                    );
                    const valueOf = (e: LeaderboardEntry) => (rankingTab === 'week' ? e.weeklyXp : e.points);
                    const myRank = ranked.findIndex((e) => e.email === email.trim().toLowerCase());
                    return (
                      <>
                        {/* สลับ สัปดาห์นี้ / ตลอดกาล */}
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <button
                            type="button"
                            onClick={() => setRankingTab('week')}
                            className={`py-2 rounded-xl text-sm font-black transition-all ${rankingTab === 'week' ? 'bg-[#003399] text-[#FFD700]' : 'bg-gray-100 text-gray-500'}`}
                          >📅 สัปดาห์นี้</button>
                          <button
                            type="button"
                            onClick={() => setRankingTab('all')}
                            className={`py-2 rounded-xl text-sm font-black transition-all ${rankingTab === 'all' ? 'bg-[#003399] text-[#FFD700]' : 'bg-gray-100 text-gray-500'}`}
                          >🏅 ตลอดกาล</button>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center mb-3">
                          {rankingTab === 'week'
                            ? 'แต้มจากการตอบถูกในสัปดาห์นี้ — รีเซ็ตทุกวันจันทร์ ทุกคนมีโอกาสลุ้นใหม่'
                            : 'แต้มสะสมตลอดกาลจากความขยัน (ผลรวมระดับกล่องของทุกคำ)'}
                        </p>
                        <div className="space-y-1.5">
                          {ranked.slice(0, 10).map((e, i) => {
                            const isMe = e.email === email.trim().toLowerCase();
                            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
                            return (
                              <div
                                key={e.email}
                                className={`flex items-center gap-3 px-3 py-2 rounded-xl ${isMe ? 'bg-[#FFD700]/20 border-2 border-[#FFD700]' : 'bg-gray-50'}`}
                              >
                                <span className="w-7 text-center font-black text-[#003399]">{medal}</span>
                                <span className="flex-1 font-bold text-gray-800 truncate">{e.name}{isMe && ' (คุณ)'}</span>
                                {e.streak > 0 && <span className="text-[11px] text-orange-500 font-bold">🔥{e.streak}</span>}
                                <span className="font-black text-[#003399]">{valueOf(e)}<span className="text-[10px] text-gray-400 font-bold"> แต้ม</span></span>
                              </div>
                            );
                          })}
                        </div>
                        {myRank >= 10 && (
                          <div className="mt-3 pt-3 border-t border-gray-100 text-center text-sm font-black text-[#003399]">
                            คุณอยู่อันดับที่ {myRank + 1} จาก {ranked.length} คน — สู้ ๆ ขยันต่อไปนะ! 💪
                          </div>
                        )}
                        {myRank === -1 && (
                          <div className="mt-3 pt-3 border-t border-gray-100 text-center text-xs text-gray-400">เล่นจบ 1 รอบเพื่อเก็บแต้มเข้าอันดับ</div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-left mb-8 flex items-center gap-4 shadow-sm">
              <div className="w-12 h-12 bg-[#003399] text-[#FFD700] rounded-full flex items-center justify-center text-xl font-black">
                {studentName.charAt(0)}
              </div>
              <div>
                <div className="text-sm font-black text-gray-800">{studentName}</div>
                <div className="text-xs text-blue-600 font-bold">{email}</div>
              </div>
            </div>

            <div className="space-y-4">
              {/* ── เลือกโหมดติว (สัดส่วน B2/C1 ต่างกันตามโหมด) ── */}
              <div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 text-center">เลือกโหมดติว</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'all', icon: '🔀', label: 'ทั้งหมด', sub: 'B2 60% · C1 40%' },
                    { key: 'foundation', icon: '🌱', label: 'พื้นฐาน', sub: 'B2 ล้วน 100%' },
                    { key: 'exam', icon: '🎯', label: 'ระดับสอบ', sub: 'B2 : C1 = 50 : 50' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setExamFocus(opt.key)}
                      className={`py-2.5 rounded-xl border-2 text-center transition-all ${
                        examFocus === opt.key
                          ? 'bg-[#003399] border-[#003399] text-[#FFD700] shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-[#003399]/40'
                      }`}
                    >
                      <div className="text-base leading-none mb-0.5">{opt.icon}</div>
                      <div className="text-sm font-black">{opt.label}</div>
                      <div className="text-[9px] font-bold opacity-70 leading-tight">{opt.sub}</div>
                    </button>
                  ))}
                </div>
                {examFocus === 'exam' && (
                  <div className="text-[10px] text-gray-400 text-center mt-2">เน้นคำระดับ B2–C1 สำหรับ TGAT / A-Level / NETSAT</div>
                )}
              </div>

              <button
                onClick={handleStart}
                className="w-full py-5 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-xl uppercase tracking-widest flex flex-col items-center justify-center gap-1"
              >
                <span className="flex items-center gap-3">🚀 Start Training Round</span>
                {srsStats.dueNow > 0 && (
                  <span className="text-[11px] font-bold text-[#FFD700]/80 normal-case tracking-normal">
                    🔁 มี {srsStats.dueNow} คำถึงกำหนดทบทวนวันนี้
                  </span>
                )}
              </button>
              {weakCount > 0 && (
                <button
                  onClick={startReviewRound}
                  className="w-full py-4 bg-rose-50 text-rose-600 font-black rounded-2xl border-2 border-rose-200 hover:bg-rose-100 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="flex items-center gap-2">🔁 ทบทวนคำที่ฉันพลาด</span>
                  <span className="text-[11px] font-bold text-rose-400 normal-case">มี {weakCount} คำที่ยังอ่อน — ฝึกซ้ำเฉพาะคำพวกนี้</span>
                </button>
              )}
              <button
                onClick={handleLogout}
                className="w-full py-3 bg-white text-gray-400 font-bold rounded-xl hover:text-[#003399] transition-all duration-150 text-sm uppercase"
              >
                🔄 Switch Student Account
              </button>
            </div>
          </div>
        )}

        {/* ── หน้า Quiz ── */}
        {/* ── ช่วงเรียนรู้คำศัพท์: เรียนให้ครบทุกคำของชุดก่อน แล้วค่อยทำแบบฝึกหัด 10 ข้อรวดเดียว ── */}
        {gameState === 'LEARN' && learnQueue.length > 0 && currentQuestions.length > 0 && (() => {
          const item = learnQueue[Math.min(learnIndex, learnQueue.length - 1)];
          const lq = currentQuestions[item.qIdx];
          const lopts = roundOptions[item.qIdx] ?? [];
          const isLast = learnIndex >= learnQueue.length - 1;
          const isMeaningMode = lq.questionType === 'MEANING';
          const cardInfo = srsStore[lq.word];
          const wrongs = cardInfo ? (cardInfo.wrongCount ?? cardInfo.lapses ?? 0) : 0;
          const glossList = (raw: string) =>
            raw.split(',').map((w) => w.trim()).filter(Boolean).map((w) => {
              const m = vocabByWord[w.toLowerCase()]?.thai_meaning;
              return m ? `${w} (${m})` : w;
            }).join(', ');
          return (
            <div className="animate-fadeIn">
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => setGameState('START')}
                  className="text-sm font-bold text-[#003399] hover:underline flex items-center gap-1"
                >
                  ← เมนูคำศัพท์
                </button>
              </div>

              {/* หัว: ความคืบหน้าช่วงเรียนรู้ */}
              <div className="flex justify-between items-center mb-2 pb-3 border-b-2 border-gray-50">
                <span className="text-xs font-black px-3 py-1.5 bg-[#FFD700]/25 text-[#003399] rounded-full">
                  📖 ขั้นที่ 1 · เรียนรู้คำศัพท์
                </span>
                <span className="text-sm font-black px-4 py-2 bg-[#003399] rounded-xl text-[#FFD700] shadow-sm">
                  คำที่ {learnIndex + 1} / {learnQueue.length}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-2 overflow-hidden">
                <div
                  className="bg-[#FFD700] h-full rounded-full transition-all duration-300"
                  style={{ width: `${((learnIndex + 1) / learnQueue.length) * 100}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-400 text-center mb-4">
                เรียนรู้ให้ครบ {learnQueue.length} คำก่อน แล้วจึงทำแบบฝึกหัดทั้ง {currentQuestions.length} ข้อ (ไม่มีคำแปล)
              </p>

              {/* การ์ดคำศัพท์หลัก */}
              <div className="bg-white border-2 border-[#003399]/15 rounded-3xl p-6 mb-5 shadow-sm text-center">
                {item.reason === 'relearn' ? (
                  <span className="inline-block text-[11px] font-black px-3 py-1 rounded-full bg-rose-100 text-rose-700 mb-2">
                    🔁 ทบทวนอีกครั้ง · เคยตอบผิด {wrongs} ครั้ง
                  </span>
                ) : (
                  <span className="inline-block text-[11px] font-black px-3 py-1 rounded-full bg-[#FFD700]/30 text-[#003399] mb-2">
                    🆕 คำศัพท์ใหม่
                  </span>
                )}
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span className="text-3xl md:text-4xl font-black text-[#003399]">{lq.word}</span>
                  {lq.part_of_speech && (
                    <span className="text-sm font-bold text-gray-400">({posLabel(lq.part_of_speech)})</span>
                  )}
                  <button
                    type="button"
                    onClick={() => speakWord(lq.word)}
                    className="text-lg bg-[#003399]/10 text-[#003399] w-10 h-10 rounded-full inline-flex items-center justify-center hover:bg-[#003399]/20 transition-all active:scale-95"
                    aria-label="ฟังเสียงคำ"
                  >🔊</button>
                </div>
                {lq.pronunciation_th && (
                  <p className="text-sm font-bold text-gray-400 mt-1">/{lq.pronunciation_th}/</p>
                )}
                <p className="text-xl md:text-2xl font-black text-gray-900 mt-3">{lq.thai_meaning}</p>
                {lq.eng_definition && (
                  <p className="text-sm text-gray-500 italic mt-1">{lq.eng_definition}</p>
                )}
                {lq.example_sentence && lq.questionType !== 'SENTENCE' && (
                  <div className="bg-gray-50 rounded-2xl p-3 mt-4 text-left">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">ตัวอย่างประโยค</p>
                    <p className="text-sm text-gray-700">{lq.example_sentence.replace(/_{2,}/g, lq.word)}</p>
                  </div>
                )}
              </div>

              {/* โจทย์ของข้อนี้ (พร้อมคำแปล) */}
              <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2 text-center">โจทย์และตัวเลือก (พร้อมคำแปล)</p>
              <div className="bg-[#fcfcfc] rounded-3xl p-6 border-2 border-gray-50 mb-4 shadow-sm min-h-[90px] flex flex-col justify-center">
                <h2 className="text-lg md:text-xl font-black text-gray-900 leading-relaxed text-center">
                  {lq.questionType === 'SENTENCE' && (
                    <span>{lq.example_sentence.replace(/_{2,}/g, lq.word)}</span>
                  )}
                  {lq.questionType === 'MEANING' && (
                    <span>
                      คำว่า <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">{lq.word}</span> แปลว่า
                      <br />
                      <span className="text-[#003399]">{lq.thai_meaning}</span>
                    </span>
                  )}
                  {lq.questionType === 'SYNONYM' && (
                    <span>
                      Select the <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">SYNONYM</span> for: <br />
                      &quot;{glossList(lq.synonym)}&quot;
                    </span>
                  )}
                  {lq.questionType === 'ANTONYM' && (
                    <span>
                      Select the <span className="text-red-600 underline decoration-[#FFD700] decoration-4">ANTONYM</span> for: <br />
                      &quot;{glossList(lq.antonym)}&quot;
                    </span>
                  )}
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-3 mb-6">
                {lopts.map((option, idx) => {
                  // โหมด MEANING ตัวเลือกเป็นภาษาไทย → แสดงคำอังกฤษเจ้าของความหมายคู่กัน
                  // โหมดอื่น ตัวเลือกเป็นคำอังกฤษ → แสดงคำอ่าน + ความหมายไทยคู่กัน
                  const entry = isMeaningMode ? vocabByThai[option] : vocabByWord[option.toLowerCase()];
                  const isAnswerChoice = option === correctAnswerFor(lq);
                  return (
                    <div
                      key={idx}
                      className={`w-full p-4 border-2 rounded-2xl text-left bg-white ${isAnswerChoice ? 'border-green-500/60' : 'border-gray-100'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-base md:text-lg font-bold text-gray-800">{option}</span>
                          {isMeaningMode ? (
                            entry && (
                              <span className="block text-sm font-bold text-[#003399] mt-0.5">
                                = {entry.word}
                                {entry.pronunciation_th && <span className="font-normal text-gray-400"> /{entry.pronunciation_th}/</span>}
                              </span>
                            )
                          ) : (
                            <>
                              {entry?.pronunciation_th && <span className="block text-xs font-bold text-gray-400">/{entry.pronunciation_th}/</span>}
                              {entry?.thai_meaning && <span className="block text-sm font-bold text-[#003399] mt-0.5">{entry.thai_meaning}</span>}
                            </>
                          )}
                        </div>
                        {isAnswerChoice && (
                          <span className="shrink-0 text-[10px] font-black px-2 py-1 rounded-full bg-green-100 text-green-700">✓ คำตอบ</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ปุ่มเลื่อนคำ */}
              <div className="flex gap-3">
                {learnIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setLearnIndex((i) => Math.max(0, i - 1))}
                    className="px-5 py-4 rounded-2xl border-2 border-[#003399]/20 text-[#003399] font-black hover:bg-[#003399]/5 transition-all"
                  >
                    ← ก่อนหน้า
                  </button>
                )}
                {!isLast ? (
                  <button
                    type="button"
                    onClick={() => setLearnIndex((i) => Math.min(learnQueue.length - 1, i + 1))}
                    className="flex-1 bg-[#003399] hover:bg-[#002266] text-[#FFD700] font-black text-lg py-4 rounded-2xl shadow-lg transition-all active:scale-[0.98]"
                  >
                    คำถัดไป →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startExercisesAfterLearning}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black text-lg py-4 rounded-2xl shadow-lg transition-all active:scale-[0.98]"
                  >
                    ✅ เรียนรู้คำศัพท์ครบแล้ว พร้อมทำแบบฝึกหัด →
                  </button>
                )}
              </div>
              {isLast && (
                <p className="text-xs text-gray-400 text-center mt-3">
                  แบบฝึกหัดเป็นภาษาอังกฤษล้วน ไม่มีคำแปล · ตัวเลือกจะสลับตำแหน่งใหม่ · เริ่มจับเวลาเมื่อกดปุ่ม
                </p>
              )}
            </div>
          );
        })()}

        {gameState === 'QUIZ' && currentQuestions.length > 0 && (
          <div className="animate-fadeIn">
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setGameState('START')}
                className="text-sm font-bold text-[#003399] hover:underline flex items-center gap-1"
              >
                ← เมนูคำศัพท์
              </button>
            </div>
            <div className="flex justify-between items-center mb-3 pb-3 border-b-2 border-gray-50">
              <span className="text-sm font-black px-4 py-2 bg-[#003399] rounded-xl text-[#FFD700] shadow-sm">
                Q {currentIndex + 1} / {currentQuestions.length}
              </span>
              {(() => {
                const qt = currentQuestions[currentIndex].questionType;
                if (qt === 'WRITE') return (
                  <span className="text-base font-black px-5 py-2 rounded-xl border-2 bg-[#FFD700]/20 text-[#003399] border-[#FFD700]/40">✍️ แต่งประโยค</span>
                );
                if (qt === 'TYPE') return (
                  <span className="text-base font-black px-5 py-2 rounded-xl border-2 bg-[#FFD700]/20 text-[#003399] border-[#FFD700]/40">⌨️ พิมพ์คำ</span>
                );
                if (qt === 'LISTEN') return (
                  <span className="text-base font-black px-5 py-2 rounded-xl border-2 bg-[#FFD700]/20 text-[#003399] border-[#FFD700]/40">🎧 ฟังเสียง</span>
                );
                return (
                  <span className={`text-base font-black px-5 py-2 rounded-xl border-2 ${timeLeft <= 5 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-blue-50 text-[#003399] border-[#003399]/20'}`}>
                    ⏱️ {timeLeft} s
                  </span>
                );
              })()}
            </div>

            <div className="w-full bg-gray-100 h-2.5 rounded-full mb-6 overflow-hidden">
              <div
                className="bg-[#003399] h-full transition-all duration-300 ease-out"
                style={{ width: `${((currentIndex + 1) / currentQuestions.length) * 100}%` }}
              ></div>
            </div>

            <div className="flex gap-2 mb-4">
              <span className={`text-[10px] font-black px-3 py-1 rounded-lg shadow-sm border ${
                currentQuestions[currentIndex].level === 'C1' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                currentQuestions[currentIndex].level === 'B2' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                'bg-green-50 text-green-700 border-green-200'
              }`}>
                LEVEL: {currentQuestions[currentIndex].level}
              </span>
              <span className="text-[10px] font-black px-3 py-1 rounded-lg bg-[#FFD700]/20 text-[#003399] border border-[#FFD700]/30 uppercase shadow-sm">
                {QTYPE_LABELS[currentQuestions[currentIndex].questionType] || currentQuestions[currentIndex].questionType}
              </span>
            </div>

            <div className="bg-[#fcfcfc] rounded-3xl p-6 border-2 border-gray-50 mb-6 shadow-sm min-h-[140px] flex flex-col justify-center">
              <h2 className="text-xl md:text-2xl font-black mb-4 text-gray-900 leading-relaxed text-center">
                {currentQuestions[currentIndex].questionType === 'SENTENCE' && (
                  <span>
                    {blankContextSentence(
                      currentQuestions[currentIndex].example_sentence,
                      currentQuestions[currentIndex].word
                    ).map((p, i) =>
                      p === null ? (
                        <span
                          key={i}
                          className="inline-block align-middle mx-1 px-6 border-b-4 border-[#FFD700]"
                          aria-label="ช่องว่าง"
                        >&nbsp;</span>
                      ) : (
                        <span key={i}>{p}</span>
                      )
                    )}
                  </span>
                )}
                {currentQuestions[currentIndex].questionType === 'SYNONYM' && (
                  <span>Select the <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">SYNONYM</span> for: <br/>&quot;{currentQuestions[currentIndex].synonym}&quot;</span>
                )}
                {currentQuestions[currentIndex].questionType === 'ANTONYM' && (
                  <span>Select the <span className="text-red-600 underline decoration-[#FFD700] decoration-4">ANTONYM</span> for: <br/>&quot;{currentQuestions[currentIndex].antonym}&quot;</span>
                )}
                {currentQuestions[currentIndex].questionType === 'MEANING' && (
                  <span>เลือกความหมายภาษาไทยของคำว่า <br/>
                    <span className="inline-flex items-center gap-2 mt-1">
                      <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">{currentQuestions[currentIndex].word}</span>
                      {currentQuestions[currentIndex].part_of_speech && (
                        <span className="text-xs font-bold text-gray-400">({posLabel(currentQuestions[currentIndex].part_of_speech)})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => speakWord(currentQuestions[currentIndex].word)}
                        className="text-base bg-[#003399]/10 text-[#003399] w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-[#003399]/20 transition-all active:scale-95 align-middle"
                        aria-label="ฟังเสียงคำ"
                      >🔊</button>
                    </span>
                    {currentQuestions[currentIndex].pronunciation_th && (
                      <div className="text-sm font-bold text-gray-400 normal-case mt-0.5">/{currentQuestions[currentIndex].pronunciation_th}/</div>
                    )}
                  </span>
                )}
                {currentQuestions[currentIndex].questionType === 'WRITE' && (
                  <span>แต่งประโยคภาษาอังกฤษ 1 ประโยค โดยใช้คำว่า <br/>
                    <span className="inline-flex items-center gap-2 mt-1">
                      <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">{currentQuestions[currentIndex].word}</span>
                      {currentQuestions[currentIndex].part_of_speech && (
                        <span className="text-xs font-bold text-gray-400">({posLabel(currentQuestions[currentIndex].part_of_speech)})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => speakWord(currentQuestions[currentIndex].word)}
                        className="text-base bg-[#003399]/10 text-[#003399] w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-[#003399]/20 transition-all active:scale-95 align-middle"
                        aria-label="ฟังเสียงคำ"
                      >🔊</button>
                    </span>
                  </span>
                )}
                {currentQuestions[currentIndex].questionType === 'TYPE' && (
                  <span>พิมพ์คำศัพท์ภาษาอังกฤษที่แปลว่า <br/>
                    {currentQuestions[currentIndex].part_of_speech && (
                      <span className="text-xs font-bold text-gray-400 align-middle mr-1">({posLabel(currentQuestions[currentIndex].part_of_speech)})</span>
                    )}
                    <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">{currentQuestions[currentIndex].thai_meaning}</span>
                  </span>
                )}
                {currentQuestions[currentIndex].questionType === 'LISTEN' && (
                  <span className="flex flex-col items-center gap-3">
                    <span>ฟังเสียงแล้วพิมพ์คำที่ได้ยิน</span>
                    <button
                      type="button"
                      onClick={() => speakWord(currentQuestions[currentIndex].word)}
                      className="text-3xl bg-[#003399] text-[#FFD700] w-16 h-16 rounded-full flex items-center justify-center hover:bg-[#002266] transition-all shadow-lg active:scale-95"
                      aria-label="เล่นเสียงอีกครั้ง"
                    >🔊</button>
                    <span className="text-[11px] text-gray-400 font-medium normal-case">กดเพื่อฟังอีกครั้ง</span>
                  </span>
                )}
              </h2>
              {/* แสดงคำใบ้ความหมายเฉพาะโหมดพิมพ์คำ (โหมดเลือกตอบ/ฟังเสียงซ่อนไว้กันเฉลย) */}
              {currentQuestions[currentIndex].questionType === 'TYPE' && (
                <>
                  <div className="h-0.5 w-12 bg-[#FFD700] mx-auto mb-3"></div>
                  <p className="text-xs text-gray-400 italic text-center font-medium">
                    {currentQuestions[currentIndex].eng_definition}
                  </p>
                </>
              )}
            </div>

            {currentQuestions[currentIndex].questionType === 'WRITE' ? (
              <div>
                {/* ช่วยจำ: คำแปลไทย */}
                <div className="text-center text-sm font-bold text-gray-500 mb-3">
                  ความหมาย: <span className="text-[#003399]">{currentQuestions[currentIndex].thai_meaning}</span>
                </div>
                <textarea
                  value={studentSentence}
                  onChange={(e) => setStudentSentence(e.target.value)}
                  disabled={isAnswered}
                  rows={3}
                  maxLength={300}
                  placeholder={`เช่น: They had to ${currentQuestions[currentIndex].word} ...`}
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] focus:ring-2 focus:ring-[#FFD700]/20 bg-gray-50/50 transition-all text-base resize-none disabled:opacity-70"
                />
                {!isAnswered && (
                  <button
                    onClick={handleSubmitSentence}
                    disabled={aiChecking || !studentSentence.trim()}
                    className="w-full mt-3 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 transition-all duration-150 text-lg uppercase tracking-widest"
                  >
                    {aiChecking ? "⏳ AI กำลังตรวจ..." : "✨ ส่งให้ AI ตรวจ"}
                  </button>
                )}

                {/* ผลตรวจจาก AI */}
                {aiResult && aiResult.unavailable && (
                  <div className="mt-4 p-4 rounded-2xl border-2 bg-gray-50 border-gray-200 text-gray-600 text-sm animate-fadeIn">
                    ⚠️ {aiResult.feedback_th}
                  </div>
                )}
                {aiResult && !aiResult.unavailable && (
                  <div className="mt-4 space-y-3 animate-fadeIn">
                    <div className={`flex items-center justify-between p-4 rounded-2xl border-2 ${
                      aiResult.verdict === 'excellent' ? 'bg-green-50 border-green-300 text-green-700' :
                      aiResult.verdict === 'good' ? 'bg-yellow-50 border-yellow-300 text-yellow-700' :
                      'bg-red-50 border-red-300 text-red-700'
                    }`}>
                      <span className="font-black">
                        {aiResult.verdict === 'excellent' ? '🌟 ยอดเยี่ยม!' : aiResult.verdict === 'good' ? '👍 ดีแล้ว เกือบสมบูรณ์' : '📝 ลองปรับอีกนิด'}
                      </span>
                      <span className="text-lg tracking-tight">
                        {[1,2,3,4,5].map(n => (
                          <span key={n} style={{ color: n <= (aiResult.scoreOutOf5 || 0) ? '#FFD700' : '#d1d5db' }}>★</span>
                        ))}
                      </span>
                    </div>
                    <div className="p-4 rounded-2xl bg-gray-50 text-sm text-gray-700 leading-relaxed">
                      {aiResult.feedback_th}
                    </div>
                    {aiResult.corrected && (
                      <div className="p-4 rounded-2xl bg-[#003399]/5 border border-[#003399]/10">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[#003399] mb-1">ประโยคที่ปรับให้ดีขึ้น</div>
                        <div className="text-base text-gray-800">&quot;{aiResult.corrected}&quot;</div>
                      </div>
                    )}
                    {aiResult.tip_th && (
                      <div className="p-4 rounded-2xl bg-[#FFD700]/15 border border-[#FFD700]/40 text-sm text-[#92400e]">
                        💡 {aiResult.tip_th}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (currentQuestions[currentIndex].questionType === 'TYPE' || currentQuestions[currentIndex].questionType === 'LISTEN') ? (
              <div>
                <input
                  type="text"
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitTyped(); }}
                  disabled={isAnswered}
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="พิมพ์คำภาษาอังกฤษ..."
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl text-center text-2xl font-black tracking-wide focus:outline-none focus:border-[#FFD700] focus:ring-2 focus:ring-[#FFD700]/20 bg-gray-50/50 transition-all disabled:opacity-70"
                />
                {!isAnswered && (
                  <button
                    onClick={handleSubmitTyped}
                    disabled={!typedAnswer.trim()}
                    className="w-full mt-3 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 transition-all duration-150 text-lg uppercase tracking-widest"
                  >
                    ✅ ส่งคำตอบ
                  </button>
                )}
                {isAnswered && (() => {
                  const isOk = checkTypedAnswer(selectedAnswer || '', currentQuestions[currentIndex].word).correct;
                  return (
                    <div className={`mt-4 p-4 rounded-2xl border-2 animate-fadeIn ${isOk ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                      <div className="font-black mb-2">{isOk ? '✅ ถูกต้อง!' : '❌ ยังไม่ถูก'}</div>
                      <div className="text-sm text-gray-700 flex items-center gap-2">
                        คำที่ถูกต้องคือ: <span className="font-black text-[#003399]">{currentQuestions[currentIndex].word}</span>
                        {currentQuestions[currentIndex].part_of_speech && (
                          <span className="text-xs font-bold text-gray-400">({posLabel(currentQuestions[currentIndex].part_of_speech)})</span>
                        )}
                        <button
                          type="button"
                          onClick={() => speakWord(currentQuestions[currentIndex].word)}
                          className="text-sm bg-[#003399]/10 text-[#003399] w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-[#003399]/20 transition-all active:scale-95"
                          aria-label="ฟังเสียงคำ"
                        >🔊</button>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 italic">{currentQuestions[currentIndex].thai_meaning} — {currentQuestions[currentIndex].eng_definition}</div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <>
              <div className="grid grid-cols-1 gap-3">
                {options.map((option, idx) => {
                  const isCorrectChoice = option === correctAnswerFor(currentQuestions[currentIndex]);
                  let btnStyle = "border-gray-100 hover:border-[#003399] hover:bg-[#003399]/5 text-gray-800 bg-white font-bold shadow-sm";
                  if (isAnswered) {
                    if (isCorrectChoice) {
                      btnStyle = "bg-green-600 text-white border-green-600 font-black shadow-lg scale-[1.02]";
                    } else if (selectedAnswer === option) {
                      btnStyle = "bg-red-600 text-white border-red-600 shadow-lg opacity-90";
                    } else {
                      btnStyle = "bg-gray-50 text-gray-300 border-gray-100 opacity-50 cursor-not-allowed";
                    }
                  }
                  // ช้อยที่เป็นคำอังกฤษ (ไม่ใช่โหมด MEANING ที่ช้อยเป็นความหมายไทย) แสดงคำอ่านกำกับด้วย
                  // (หน้านี้คือ "ข้อสอบจริง" เป็นอังกฤษล้วน ไม่มีคำแปล — คำแปลอยู่ในหน้าพรีวิวก่อนหน้านี้แล้ว)
                  const optionPron =
                    currentQuestions[currentIndex].questionType !== 'MEANING'
                      ? vocabByWord[option.toLowerCase()]?.pronunciation_th
                      : undefined;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleAnswerSelection(option)}
                      disabled={isAnswered}
                      className={`w-full p-4 border-2 rounded-2xl text-left text-base md:text-lg transition-all duration-200 flex items-center justify-between ${btnStyle}`}
                    >
                      <span>
                        {option}
                        {optionPron && (
                          <span className="block text-xs font-bold opacity-60 normal-case">/{optionPron}/</span>
                        )}
                      </span>
                      {isAnswered && isCorrectChoice && <span className="text-[#FFD700]">✓</span>}
                    </button>
                  );
                })}
              </div>
              {timedOut && (
                <div className="mt-4 p-3 rounded-2xl bg-amber-50 border-2 border-amber-200 text-amber-700 text-sm text-center font-bold">
                  ⏱️ หมดเวลา — ข้อนี้ไม่นับคะแนนและไม่กระทบความก้าวหน้า ลองดูเฉลยด้านล่างได้เลย
                </div>
              )}
              </>
            )}

            {/* ── การ์ดเฉลย & คำอธิบาย (ข้อต่อข้อ) ── */}
            {isAnswered && (() => {
              const cq = currentQuestions[currentIndex];
              const isCorrect = selectedAnswer === correctAnswerFor(cq);
              // ความหมาย/คำที่เลือกผิด (MEANING: เลือกเป็นความหมาย → หาคำที่เป็นเจ้าของความหมายนั้น)
              const chosen = (!isCorrect && !timedOut && selectedAnswer)
                ? (cq.questionType === 'MEANING'
                    ? vocabData.find((w) => w.thai_meaning === selectedAnswer)
                    : vocabData.find((w) => w.word === selectedAnswer))
                : null;
              return (
                <div className="mt-5 p-5 rounded-2xl border-2 border-[#003399]/15 bg-[#003399]/[0.03] text-left animate-fadeIn">
                  <div className="text-sm font-black text-[#003399] mb-3">📖 เฉลย &amp; คำอธิบาย</div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xl font-black text-gray-900">{cq.word}</span>
                    {cq.part_of_speech && (
                      <span className="text-xs font-bold text-gray-400">({posLabel(cq.part_of_speech)})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => speakWord(cq.word)}
                      className="bg-[#003399]/10 text-[#003399] w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-[#003399]/20 transition-all active:scale-95"
                      aria-label="ฟังเสียงคำ"
                    >🔊</button>
                  </div>
                  {cq.pronunciation_th && (
                    <p className="text-sm font-bold text-gray-400 mb-1">/{cq.pronunciation_th}/</p>
                  )}
                  <p className="text-base font-bold text-[#003399] mb-1">{cq.thai_meaning}</p>
                  {cq.eng_definition && (
                    <p className="text-sm text-gray-600 mb-2">{cq.eng_definition}</p>
                  )}
                  {cq.example_sentence && cq.example_sentence.trim() && (
                    <p className="text-sm text-gray-700 italic border-l-4 border-[#FFD700] pl-3 py-1 mb-1">
                      &ldquo;{cq.example_sentence}&rdquo;
                    </p>
                  )}
                  {chosen && (
                    <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm">
                      <span className="font-bold text-red-700">{cq.questionType === 'MEANING' ? 'ความหมายที่คุณเลือกเป็นของคำว่า ' : 'คุณเลือก '}&ldquo;{chosen.word}&rdquo;</span>
                      <span className="text-red-600"> = {chosen.thai_meaning}</span>
                      {chosen.part_of_speech && (
                        <span className="text-xs text-red-400 font-bold"> ({posLabel(chosen.part_of_speech)})</span>
                      )}
                      <div className="text-xs text-red-500 mt-1">คนละความหมายกับคำที่ถาม ลองจำให้แม่นนะ</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {isAnswered && (
              <button
                onClick={handleNextQuestion}
                className="w-full mt-8 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl hover:bg-[#002266] transition-all duration-150 text-center text-lg shadow-xl uppercase tracking-widest"
              >
                {currentIndex + 1 === currentQuestions.length ? "Finish & Review" : "Next Question ➡️"}
              </button>
            )}
          </div>
        )}

        {/* ── หน้า สรุปผล ── */}
        {gameState === 'END' && (
          <div className="text-center animate-fadeIn">
            <div className="w-24 h-24 bg-[#FFD700]/20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
              <img src={SCHOOL_LOGO_URL} alt="Logo" className="w-16 h-16 object-contain" />
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-2">Round Finished!</h2>
            <p className="text-[#003399] font-black mb-6 bg-[#003399]/5 py-2 px-6 rounded-full inline-block">{studentName}</p>

            {cheatWarnings >= 3 && (
              <div className="bg-amber-50 text-amber-700 p-4 rounded-2xl text-sm font-bold mb-6 border-2 border-amber-100">
                ℹ️ ออกจากหน้าจอข้อสอบ {cheatWarnings} ครั้งระหว่างทำรอบนี้ — โฟกัสอยู่ในจอเดียวจะช่วยให้ทำได้ดีขึ้นนะ
              </div>
            )}

            <div className="bg-[#003399] rounded-[2.5rem] p-8 mb-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16"></div>
              <div className="text-xs font-black text-[#FFD700]/80 uppercase tracking-[0.3em] mb-2">Final Score</div>
              <div className="text-7xl font-black text-white mb-2 drop-shadow-lg">
                {score}<span className="text-2xl text-[#FFD700]/60">/{TOTAL_QUESTIONS_PER_ROUND - timedOutCount}</span>
              </div>
              <div className="text-sm text-[#FFD700] font-black bg-white/10 py-2 px-6 rounded-full inline-block backdrop-blur-sm">
                ACCURACY: {((score / Math.max(1, TOTAL_QUESTIONS_PER_ROUND - timedOutCount)) * 100).toFixed(0)}%
              </div>
              {timedOutCount > 0 && (
                <div className="text-[11px] text-white/60 font-bold mt-3">
                  ⏱️ มี {timedOutCount} ข้อหมดเวลา (ไม่นำมาคิดคะแนน)
                </div>
              )}
            </div>

            <div className="text-left border-t-4 border-double border-gray-100 pt-8 mb-8">
              <h3 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-3">
                <span className="bg-[#FFD700] text-[#003399] p-2 rounded-xl text-lg">📝</span> MISTAKE ANALYSIS
              </h3>

              {wrongAnswers.length > 0 ? (
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {wrongAnswers.map((item, idx) => (
                    <div key={idx} className="bg-white border-2 border-red-50 rounded-3xl p-5 shadow-sm">
                      <div className="text-[10px] font-black px-3 py-1 rounded bg-red-50 text-red-600 uppercase inline-block mb-3 tracking-widest">
                        {item.question.questionType}
                      </div>
                      <h4 className="text-gray-900 font-bold mb-3 leading-snug">
                        {item.question.questionType === 'SENTENCE' && item.question.example_sentence}
                        {item.question.questionType === 'SYNONYM' && `Synonym for: "${item.question.synonym}"`}
                        {item.question.questionType === 'ANTONYM' && `Antonym for: "${item.question.antonym}"`}
                        {item.question.questionType === 'WRITE' && `แต่งประโยคด้วยคำว่า "${item.question.word}"`}
                        {item.question.questionType === 'TYPE' && `พิมพ์คำที่แปลว่า "${item.question.thai_meaning}"`}
                        {item.question.questionType === 'LISTEN' && `ฟังเสียงแล้วพิมพ์คำ`}
                      </h4>
                      {item.question.questionType === 'WRITE' ? (
                        <div className="text-sm space-y-2 mt-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                          <p className="text-red-500 font-bold">📝 ประโยคของคุณ: <span className="font-normal text-gray-700">&quot;{item.selected}&quot;</span></p>
                          {item.feedback?.corrected && (
                            <p className="text-green-600 font-black">✅ ปรับเป็น: <span className="font-normal">&quot;{item.feedback.corrected}&quot;</span></p>
                          )}
                          {item.feedback?.feedback_th && (
                            <div className="pt-2 mt-2 border-t border-gray-200">
                              <p className="text-gray-500 text-[11px] leading-relaxed">{item.feedback.feedback_th}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm space-y-2 mt-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                          <p className="text-red-500 font-bold">❌ Your Pick: <span className="line-through">{item.selected === "Time Out" ? "Time Out" : item.selected}</span></p>
                          <p className="text-green-600 font-black flex items-center gap-2">✅ Correct: {item.question.word}
                            {item.question.part_of_speech && (
                              <span className="text-xs font-bold text-gray-400">({posLabel(item.question.part_of_speech)})</span>
                            )}
                            <button
                              type="button"
                              onClick={() => speakWord(item.question.word)}
                              className="bg-[#003399]/10 text-[#003399] w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-[#003399]/20 transition-all active:scale-95"
                              aria-label="ฟังเสียงคำ"
                            >🔊</button>
                          </p>
                          <div className="pt-2 mt-2 border-t border-gray-200">
                            <p className="text-gray-500 text-[11px] leading-relaxed">
                              <span className="font-bold text-gray-700">MEANING:</span> {item.question.thai_meaning}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-green-50 border-2 border-green-200 rounded-3xl p-8 text-green-700 font-black text-center shadow-sm">
                  🌟 AMAZING! PERFECT SCORE!<br/>ANUKOOLNAREE PRIDE!
                </div>
              )}
            </div>

            {isSubmitting ? (
              <p className="text-[#003399] font-black animate-pulse mb-6 bg-blue-50 py-3 rounded-2xl">⏳ SYNCING DATA TO CLOUD...</p>
            ) : (
              <p className="text-green-600 font-black mb-6 bg-green-50 py-3 rounded-2xl">✅ DATA SECURED SUCCESSFULLY</p>
            )}

            <button
              onClick={() => setGameState('START')}
              className="w-full py-5 bg-[#FFD700] text-[#003399] font-black rounded-2xl hover:bg-[#e6c200] transition-all duration-300 text-xl shadow-xl uppercase tracking-widest"
            >
              Back to Dashboard ⬅️
            </button>
          </div>
        )}

      </div>
      <p className="mt-8 text-[10px] text-gray-400 font-bold tracking-[0.3em] uppercase">© Anukoolnaree School | Vocabulary Essential M.6</p>
    </div>
  );
}
