"use client";

import React, { useState, useEffect, useRef } from 'react';
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
import { loadCloudProgress, saveCloudProgress, loadLeaderboard, LeaderboardEntry, saveReadingProgress, ReadingByType, saveConversationProgress, ConvByFormat, loadReadingLeaderboard, ReadingLeaderboardEntry } from './lib/cloud';
import {
  ReadingPassage,
  ReadingQuestion,
  RQTYPE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  loadReadingPassages,
} from './lib/reading';
import {
  ConvSet,
  CONV_FORMAT_LABELS,
  CONV_CATEGORY_LABELS,
  CONV_CATEGORY_ORDER,
  loadConversationSets,
} from './lib/conversation';
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
  const [gameState, setGameState] = useState<'START' | 'QUIZ' | 'END'>('START');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // ── ห้องที่กำลังเปิดอยู่หลังล็อกอิน (Dashboard) ──
  // HUB = หน้าเลือกห้อง, VOCAB = ห้องคำศัพท์เดิม, READING/CONVERSATION = ห้องใหม่
  const [section, setSection] = useState<'HUB' | 'VOCAB' | 'READING' | 'CONVERSATION'>('HUB');
  // ── สถานะห้อง Reading ──
  const [readingPassages, setReadingPassages] = useState<ReadingPassage[]>([]);
  const [readingLoading, setReadingLoading] = useState(false);
  const [teacherPreview, setTeacherPreview] = useState(false); // ครูเปิดดูบทที่ยังไม่ตรวจ
  const [readingView, setReadingView] = useState<'LIST' | 'PLAY' | 'RESULT'>('LIST');
  const [readingCat, setReadingCat] = useState<string>('ALL'); // หมวดที่กำลังกรองในหน้ารายการบทอ่าน
  const [readingExam, setReadingExam] = useState<string>('ALL'); // สนามสอบที่กำลังกรอง (ALL/A-LEVEL/TGAT/NETSAT)
  const [activePassage, setActivePassage] = useState<ReadingPassage | null>(null);
  const [rIndex, setRIndex] = useState(0);
  const [rAnswers, setRAnswers] = useState<(number | null)[]>([]); // คำตอบที่เลือกของแต่ละข้อ (โหมดข้อสอบ — เปลี่ยนได้จนกว่าจะส่ง)
  const [rResults, setRResults] = useState<{ qid: string; type: string; selected: number; correct: boolean }[]>([]);
  const [rSaving, setRSaving] = useState(false);
  const [glossWord, setGlossWord] = useState<string | null>(null); // คำใน targetVocab ที่กำลังเปิดดูคำแปล
  const [readingMastered, setReadingMastered] = useState<Set<string>>(new Set()); // บทที่ "พิชิต" แล้ว (ตอบถูกครบทุกข้อ)
  const [readingCompleted, setReadingCompleted] = useState<Set<string>>(new Set()); // บทที่เคยทำจบ
  const [readingBoard, setReadingBoard] = useState<ReadingLeaderboardEntry[] | null>(null); // อันดับนักพิชิตรายสัปดาห์
  const [readingBoardLoading, setReadingBoardLoading] = useState(false);
  // ── ตัวจับเวลาห้อง Reading (เวลาที่ให้ขึ้นกับความยาวบท + จำนวนข้อ) ──
  const [rTimeLimit, setRTimeLimit] = useState(0); // เวลาที่ให้ทั้งหมด (วินาที)
  const [rTimeLeft, setRTimeLeft] = useState(0);   // เวลาที่เหลือ (วินาที; ค่าติดลบ = เกินเวลา)
  const [rLeaveCount, setRLeaveCount] = useState(0); // กันโกง: จำนวนครั้งที่ออกจากหน้าจอระหว่างทำข้อสอบ
  const [rAutoSubmitted, setRAutoSubmitted] = useState(false); // กันโกง: ถูกส่งคำตอบอัตโนมัติเพราะออกจากจอเกินเกณฑ์
  const [rWarnOpen, setRWarnOpen] = useState(false); // กันโกง: ป๊อปอัปเตือนเมื่อกลับเข้าหน้าจอ
  const audioCtxRef = useRef<AudioContext | null>(null); // เสียงเตือน (Web Audio)
  const leaveCountRef = useRef(0); // มิเรอร์ rLeaveCount ไว้ให้ event handler อ่านค่าล่าสุด
  const READING_MAX_LEAVES = 3; // กันโกง: ออกจากจอเกินจำนวนนี้ → ส่งคำตอบอัตโนมัติทันที
  // ── สถานะห้อง Conversation ──
  const [conversationSets, setConversationSets] = useState<ConvSet[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convPreview, setConvPreview] = useState(false); // ครูเปิดดูชุดที่ยังไม่ตรวจ
  const [convView, setConvView] = useState<'LIST' | 'PLAY' | 'RESULT'>('LIST');
  const [convCat, setConvCat] = useState<string>('ALL'); // หมวดที่กำลังกรองในหน้ารายการบทสนทนา
  const [convExam, setConvExam] = useState<string>('ALL'); // สนามสอบที่กำลังกรองในห้องสนทนา (มีแค่ TGAT/A-Level — NETSAT ไม่มีพาร์ตนี้)
  const [activeConv, setActiveConv] = useState<ConvSet | null>(null);
  const [cIndex, setCIndex] = useState(0);
  const [cSelected, setCSelected] = useState<number | null>(null);
  const [cAnswered, setCAnswered] = useState(false);
  const [cResults, setCResults] = useState<{ qid: string; selected: number; correct: boolean }[]>([]);
  const [cSaving, setCSaving] = useState(false);
  const [convGloss, setConvGloss] = useState<string | null>(null);
  const [convMastered, setConvMastered] = useState<Set<string>>(new Set()); // ชุดบทสนทนาที่ "พิชิต" แล้ว (ตอบถูกครบทุกข้อ)
  const [convCompleted, setConvCompleted] = useState<Set<string>>(new Set()); // ชุดบทสนทนาที่เคยทำจบ

  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');

  // ── คลังความก้าวหน้าแบบ SRS (แทนระบบ masteredWords เดิม) ──
  const [srsStore, setSrsStore] = useState<SrsStore>({});
  const [streakState, setStreakState] = useState<StreakState>(emptyStreak());
  // โหมดติว: ทั้งหมด / พื้นฐาน(B1) / ระดับสอบเข้ามหาลัย(B2·C1)
  const [examFocus, setExamFocus] = useState<'all' | 'foundation' | 'exam'>('all');
  // เลือกเจาะพาร์ท: null = ผสมทุกแนว, หรือเจาะประเภทเดียว
  // จัดอันดับคนขยัน
  const [showRanking, setShowRanking] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingTab, setRankingTab] = useState<'week' | 'all'>('week');
  const [vocabData, setVocabData] = useState<WordItem[]>([]);
  const [currentQuestions, setCurrentQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
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
  const WRITE_MODE_QUESTIONS = 1;   // จำนวนข้อ "แต่งประโยค" ต่อรอบ (อยู่ท้ายสุด) — ปรับเลขนี้ได้
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
    if (gameState !== 'QUIZ' || isAnswered) return;
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
  const speakWord = (word: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.error('speak error:', e);
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
    if (studentName.trim() && email.trim() && email.includes('@')) {
      // 1) โหลดจากเครื่อง (เร็ว) ให้เห็นทันที
      let store = loadStore(email);
      store = migrateLegacyIfNeeded(email, store);
      setSrsStore(store);
      setStreakState(loadStreak(email));
      setIsLoggedIn(true);
      setSection('HUB');

      // 2) ดึงจากคลาวด์มาทับถ้ามี (ทำให้ progress ตามข้ามเครื่อง)
      try {
        const cloud = await loadCloudProgress(email);
        if (cloud?.masteredPassages) setReadingMastered(new Set(cloud.masteredPassages));
        if (cloud?.completedPassages) setReadingCompleted(new Set(cloud.completedPassages));
        if (cloud?.masteredConvos) setConvMastered(new Set(cloud.masteredConvos));
        if (cloud?.completedConvos) setConvCompleted(new Set(cloud.completedConvos));
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
    generateOptionsForQuestion(formattedQuestions[0], vocabData);
    resetTimerAndQuestionState();
    setGameState('QUIZ');
  };

  // รายการคำที่เด็ก "ยังอ่อน" (กล่องต่ำ ≤1 หรือเคยลืม) เรียงตามควรทบทวนก่อน
  const getWeakWordList = (): WordItem[] => {
    const wordMap = new Map(vocabData.map((w) => [w.word, w]));
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
        ? [{ level: 'B1', count: 10 }]
        : examFocus === 'exam'
        ? [{ level: 'B2', count: 7 }, { level: 'C1', count: 3 }]
        : [{ level: 'B1', count: 4 }, { level: 'B2', count: 4 }, { level: 'C1', count: 2 }];
    const roundWords = pickRound(srsStore, vocabData, { total: TOTAL_QUESTIONS_PER_ROUND, levelPlan });
    const wordMap = new Map(vocabData.map((w) => [w.word, w]));
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
    const weak = getWeakWordList().slice(0, TOTAL_QUESTIONS_PER_ROUND);
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

  const generateOptionsForQuestion = (correctItem: QuizQuestion, allItems: WordItem[]) => {
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
      setOptions(choices.sort(() => 0.5 - Math.random()));
      return;
    }

    // โหมดอื่น: ตัวเลือกเป็น "คำอังกฤษ" (เลือกตัวลวงที่ชวนสับสน)
    const distractors = pickSmartDistractors(correctItem.word, pool.map(p => p.word), 3);
    const finalChoices = [correctItem.word, ...distractors];
    setOptions(finalChoices.sort(() => 0.5 - Math.random()));
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
      generateOptionsForQuestion(currentQuestions[nextIndex], vocabData);
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
      const stats = computeStats(srsStore, vocabData.map((w) => w.word));
      await saveCloudProgress({ email, name: studentName, srs: srsStore, stats, lastScore: score, streak: updatedStreak });
    } catch (error) {
      console.error("Error syncing progress to cloud:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isVocabLoading = vocabData.length === 0;
  const srsStats = computeStats(srsStore, vocabData.map((w) => w.word));
  // ความก้าวหน้าแบบ "ให้คะแนนบางส่วน" ตามกล่อง SRS (ขยับทุกครั้งที่เลื่อนคำขึ้นกล่อง)
  const overallPercentage = srsStats.weightedProgress.toFixed(1);
  // จำนวนคำที่เด็กยังอ่อน (ไว้โชว์บนปุ่มทบทวนคำที่พลาด)
  const weakCount = Object.values(srsStore).filter((c) => c && (c.box <= 1 || c.lapses > 0)).length;

  // ── โหลดบทอ่านเมื่อเข้าห้อง Reading ครั้งแรก ──
  useEffect(() => {
    if (section === 'READING' && readingPassages.length === 0 && !readingLoading) {
      setReadingLoading(true);
      loadReadingPassages()
        .then((ps) => setReadingPassages(ps))
        .catch((e) => console.error('โหลดบทอ่านไม่สำเร็จ:', e))
        .finally(() => setReadingLoading(false));
    }
  }, [section, readingPassages.length, readingLoading]);

  // ── โหลดอันดับนักพิชิตบทอ่านเมื่อเข้าห้อง Reading ──
  useEffect(() => {
    if (section === 'READING' && readingBoard === null && !readingBoardLoading) {
      setReadingBoardLoading(true);
      loadReadingLeaderboard()
        .then((b) => setReadingBoard(b))
        .catch(() => setReadingBoard([]))
        .finally(() => setReadingBoardLoading(false));
    }
  }, [section, readingBoard, readingBoardLoading]);

  // แผนที่คำศัพท์ (สำหรับแตะดูคำแปลคำใน targetVocab ของบทอ่าน)
  const vocabByWord = React.useMemo(() => {
    const m: Record<string, WordItem> = {};
    for (const w of vocabData) m[w.word.toLowerCase()] = w;
    return m;
  }, [vocabData]);

  // เริ่มทำบทอ่านที่เลือก
  // อ่านออกเสียงคำศัพท์ (Web Speech API ของเบราว์เซอร์ — ไม่ต้องพึ่งบริการภายนอก)
  const speak = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch {
      /* เบราว์เซอร์บางตัวไม่รองรับ — เงียบไว้ */
    }
  };

  // เวลาที่เหมาะสมต่อบท: อ่าน ~120 คำ/นาที + ~45 วินาที/ข้อ ปัดเป็นครึ่งนาที (ขั้นต่ำ 3 นาที)
  const readingTimeLimitSec = (wordCount: number, numQuestions: number) =>
    Math.max(180, Math.round((wordCount * 0.5 + numQuestions * 45) / 30) * 30);

  // จัดรูปแบบเวลา MM:SS (ค่าติดลบ = เกินเวลา แสดงนำหน้าด้วย +)
  const fmtTime = (sec: number) => {
    const s = Math.abs(sec);
    return `${sec < 0 ? '+' : ''}${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // มิเรอร์จำนวนครั้งออกจากจอไว้ให้ event handler อ่านค่าล่าสุด
  useEffect(() => { leaveCountRef.current = rLeaveCount; }, [rLeaveCount]);

  // ปลดล็อกระบบเสียง (ต้องเรียกจาก user gesture เช่นตอนกดเริ่มทำบท)
  const unlockAudio = () => {
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      }
      audioCtxRef.current?.resume?.();
    } catch { /* บางเครื่องไม่รองรับ — เงียบไว้ */ }
  };

  // เสียงเตือนไซเรนสองโทน (ดังเต็มที่เท่าที่เบราว์เซอร์ยอม) + สั่นบนมือถือ
  const playAlarm = (strong = false) => {
    try {
      const ctx = audioCtxRef.current;
      if (ctx) {
        ctx.resume?.();
        const now = ctx.currentTime;
        const beeps = strong ? 6 : 3;
        const master = ctx.createGain();
        master.gain.value = 1; // ดังสุดในแอป (เบราว์เซอร์ปรับระดับเสียงของเครื่องเองไม่ได้)
        master.connect(ctx.destination);
        for (let i = 0; i < beeps; i++) {
          const t = now + i * 0.18;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(i % 2 === 0 ? 1000 : 760, t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          osc.connect(g); g.connect(master);
          osc.start(t); osc.stop(t + 0.17);
        }
      }
    } catch { /* เงียบไว้ */ }
    try { navigator.vibrate?.(strong ? [200, 80, 200, 80, 400] : [150, 80, 150]); } catch { /* ไม่รองรับ */ }
  };

  // เดินเวลาถอยหลังเฉพาะตอนทำข้อสอบ (หยุดเองเมื่อออกจากหน้า PLAY); ปล่อยให้ติดลบเป็น "เกินเวลา"
  useEffect(() => {
    if (readingView !== 'PLAY' || !activePassage) return;
    const id = setInterval(() => setRTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [readingView, activePassage]);

  // กันโกง: นับครั้งที่ออกจากหน้าจอ + เตือนเสียงดัง/ป๊อปอัปเมื่อกลับเข้าหน้าจอ
  useEffect(() => {
    if (readingView !== 'PLAY') return;
    const onVis = () => {
      if (document.hidden) {
        setRLeaveCount((c) => c + 1);
      } else {
        const n = leaveCountRef.current;
        if (n > 0 && n <= READING_MAX_LEAVES) {
          playAlarm(n >= READING_MAX_LEAVES); // ครั้งสุดท้ายก่อนถูกส่ง → ดังกว่า
          setRWarnOpen(true);
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingView]);

  // กันโกง: ออกจากจอเกินเกณฑ์ → ส่งคำตอบอัตโนมัติทันที (ข้อที่ยังไม่ตอบนับว่าผิด)
  useEffect(() => {
    if (readingView !== 'PLAY' || !activePassage) return;
    if (rLeaveCount <= READING_MAX_LEAVES) return;
    const results = activePassage.questions.map((q, i) => ({
      qid: q.id,
      type: q.type,
      selected: rAnswers[i] ?? -1, // ยังไม่ตอบ = -1
      correct: rAnswers[i] === q.answerIndex,
    }));
    setRResults(results);
    setRAutoSubmitted(true);
    setRWarnOpen(false);
    playAlarm(true);
    finishReading(results, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rLeaveCount, readingView, activePassage]);

  // ── กันโกง: สลับตัวเลือก + remap อักษรในคำอธิบาย + สุ่มจำนวนข้อ ──
  const READING_LETTERS = ['A', 'B', 'C', 'D'];

  // remap อักษรอ้างตัวเลือกในคำอธิบาย (เช่น "ตอบข้อ B", "ส่วน A/C/D") ให้ตรงตำแหน่งใหม่
  // remap เฉพาะอักษร A–D ที่ยืนเดี่ยว (เพื่อนบ้านไม่ใช่ตัวอักษร/ตัวเลขอังกฤษ) และไม่ใช่คำอังกฤษ เช่น "A second"
  const remapExplanationLetters = (text: string, newPosOf: number[]) =>
    text.replace(/[ABCD]/g, (ch: string, offset: number, str: string) => {
      const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
      const before = str[offset - 1] ?? ' ';
      const after = str[offset + 1] ?? ' ';
      if (isWord(before) || isWord(after)) return ch; // ส่วนของคำอังกฤษ เช่น AI, ABC, Dear
      if (/\s[a-z]/.test(str.slice(offset + 1, offset + 3)) || /[a-z]\s/.test(str.slice(Math.max(0, offset - 2), offset))) return ch; // อยู่ในประโยคอังกฤษ
      const orig = READING_LETTERS.indexOf(ch);
      return orig >= 0 ? READING_LETTERS[newPosOf[orig]] : ch;
    });

  // สลับตัวเลือกของข้อหนึ่ง แล้วปรับ answerIndex + คำอธิบายให้ตรงกับตำแหน่งใหม่
  const shuffleChoices = (q: ReadingQuestion): ReadingQuestion => {
    const order = [0, 1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const newPosOf: number[] = []; // อักษรเดิม orig → ตำแหน่งใหม่
    order.forEach((orig, pos) => { newPosOf[orig] = pos; });
    return {
      ...q,
      choices: order.map((orig) => q.choices[orig]),
      answerIndex: newPosOf[q.answerIndex],
      explanation_th: remapExplanationLetters(q.explanation_th, newPosOf),
    };
  };

  const startPassage = (p: ReadingPassage) => {
    // กันโกง: สลับตัวเลือก A/B/C/D ใหม่ทุกครั้ง (พร้อม remap คำอธิบาย) → เฉลยที่ถ่ายเก็บไว้ใช้ไม่ได้
    let qs = p.questions.map(shuffleChoices);
    // สลับลำดับข้อ (Fisher–Yates) — ได้บทเดียวกันแต่ข้อไม่เรียงเหมือนกัน
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }
    // กันโกง: สุ่มจำนวนข้อที่แสดง (อย่างน้อย 5 ข้อ และตัดทิ้งอย่างน้อย 1) → ชุดเฉลยเต็มที่เก็บไว้ใช้ได้ไม่ครบ
    if (qs.length > 5) {
      const minKeep = Math.max(5, qs.length - 3);
      const keep = minKeep + Math.floor(Math.random() * (qs.length - minKeep)); // minKeep..(N-1)
      qs = qs.slice(0, keep);
    }
    const passage = { ...p, questions: qs };
    setActivePassage(passage);
    setRIndex(0);
    setRAnswers(new Array(passage.questions.length).fill(null));
    setRResults([]);
    setGlossWord(null);
    const limit = readingTimeLimitSec(passage.wordCount, passage.questions.length);
    setRTimeLimit(limit);
    setRTimeLeft(limit);
    setRLeaveCount(0);
    leaveCountRef.current = 0;
    setRAutoSubmitted(false);
    setRWarnOpen(false);
    unlockAudio();
    setReadingView('PLAY');
  };

  // 🎲 สุ่มบทอ่านจากสนาม/หมวดที่เลือกอยู่ — ให้น้ำหนักบทที่ยังไม่เคยทำก่อน แล้วค่อยบทที่ยังไม่พิชิต
  const startRandomPassage = (pool: ReadingPassage[]) => {
    if (pool.length === 0) return;
    const fresh = pool.filter((p) => !readingCompleted.has(p.id));
    const unmastered = pool.filter((p) => readingCompleted.has(p.id) && !readingMastered.has(p.id));
    const pick = fresh.length > 0 ? fresh : unmastered.length > 0 ? unmastered : pool;
    startPassage(pick[Math.floor(Math.random() * pick.length)]);
  };

  // เลือก/เปลี่ยนคำตอบข้อปัจจุบัน (โหมดข้อสอบ — ยังไม่เฉลยจนกว่าจะกดส่ง)
  const selectReadingAnswer = (choiceIndex: number) => {
    if (!activePassage) return;
    setRAnswers((prev) => {
      const next = [...prev];
      next[rIndex] = choiceIndex;
      return next;
    });
  };

  // ส่งคำตอบทั้งหมด → ตรวจรวมทีเดียว แล้วไปหน้าสรุปผล (พร้อมเฉลย+คำอธิบายทุกข้อ)
  const submitReading = () => {
    if (!activePassage) return;
    if (rAnswers.some((a) => a === null || a === undefined)) return; // ต้องตอบครบก่อนส่ง
    const results = activePassage.questions.map((q, i) => ({
      qid: q.id,
      type: q.type,
      selected: rAnswers[i] as number,
      correct: rAnswers[i] === q.answerIndex,
    }));
    setRResults(results);
    finishReading(results);
  };

  // สรุปผลเมื่อทำครบทุกข้อ
  const finishReading = async (allResults: { qid: string; type: string; selected: number; correct: boolean }[], auto = false) => {
    setReadingView('RESULT');
    if (!activePassage) return;
    const total = allResults.length;
    const correct = allResults.filter((r) => r.correct).length;
    const allCorrect = total > 0 && correct === total; // ถูกครบทุกข้อ = "พิชิตบท"
    // อัปเดตแถบความสำเร็จทันที (เฉพาะบทที่ครูตรวจแล้ว) ให้เห็นผลในรอบนี้เลย แม้ยังไม่ล็อกอินอีเมล
    if (activePassage.verified) {
      const pid = activePassage.id;
      setReadingCompleted((prev) => { const n = new Set(prev); n.add(pid); return n; });
      if (allCorrect) setReadingMastered((prev) => { const n = new Set(prev); n.add(pid); return n; });
    }
    // บันทึกคะแนนเฉพาะบทที่ครูตรวจแล้ว (ไม่บันทึกตอนครูพรีวิวบทที่ยัง verified:false)
    if (activePassage.verified && email) {
      const byType: Record<string, ReadingByType> = {};
      for (const r of allResults) {
        const b = byType[r.type] ?? { answered: 0, correct: 0 };
        b.answered += 1;
        if (r.correct) b.correct += 1;
        byType[r.type] = b;
      }
      const updatedStreak = applyActivity(streakState, total);
      setStreakState(updatedStreak);
      saveStreak(email, updatedStreak);
      setRSaving(true);
      try {
        await saveReadingProgress({ email, name: studentName, correct, total, byType, streak: updatedStreak, passageId: activePassage.id, mastered: allCorrect, leaves: rLeaveCount, passageTitle: activePassage.title, examStyle: activePassage.examStyle, autoSubmitted: auto });
        loadReadingLeaderboard().then(setReadingBoard).catch(() => {}); // รีเฟรชอันดับให้เห็นผลทันที
      } catch (e) {
        console.error('บันทึกผล Reading ไม่สำเร็จ:', e);
      } finally {
        setRSaving(false);
      }
    }
  };

  // บทอ่านที่จะแสดง (เด็กเห็นเฉพาะที่ครูตรวจแล้ว / ครูเปิดสวิตช์เพื่อพรีวิวบทที่ยังไม่ตรวจ)
  const visiblePassages = teacherPreview ? readingPassages : readingPassages.filter((p) => p.verified);
  const hasUnverified = readingPassages.some((p) => !p.verified);
  // หมวดที่มีบทอ่านจริง (เรียงตามลำดับที่กำหนด) + รายการที่กรองตามหมวดที่เลือก
  // ── ชั้นกรองสนามสอบ (แท็บ) — โชว์เฉพาะสนามที่มีบทจริง ──
  const EXAM_ORDER = ['A-LEVEL', 'TGAT', 'NETSAT'];
  const examsPresent = EXAM_ORDER.filter((e) => visiblePassages.some((p) => p.examStyle === e));
  const effectiveExam = readingExam !== 'ALL' && examsPresent.includes(readingExam) ? readingExam : 'ALL';
  const examFiltered = effectiveExam === 'ALL' ? visiblePassages : visiblePassages.filter((p) => p.examStyle === effectiveExam);
  const catsPresent = CATEGORY_ORDER.filter((c) => examFiltered.some((p) => (p.category || 'other') === c));
  const effectiveCat = readingCat !== 'ALL' && catsPresent.includes(readingCat) ? readingCat : 'ALL';
  const shownPassages = effectiveCat === 'ALL' ? examFiltered : examFiltered.filter((p) => (p.category || 'other') === effectiveCat);
  // ── แถบความสำเร็จ (พิชิตบท) — นับเฉพาะบทที่นักเรียนเห็น (ครูตรวจแล้ว) ──
  const masteredCount = visiblePassages.filter((p) => readingMastered.has(p.id)).length;
  const completedCount = visiblePassages.filter((p) => readingCompleted.has(p.id)).length;
  const masteryPct = visiblePassages.length > 0 ? Math.round((masteredCount / visiblePassages.length) * 100) : 0;

  // ── โหลดชุดบทสนทนาเมื่อเข้าห้อง Conversation ครั้งแรก ──
  useEffect(() => {
    if (section === 'CONVERSATION' && conversationSets.length === 0 && !convLoading) {
      setConvLoading(true);
      loadConversationSets()
        .then((cs) => setConversationSets(cs))
        .catch((e) => console.error('โหลดบทสนทนาไม่สำเร็จ:', e))
        .finally(() => setConvLoading(false));
    }
  }, [section, conversationSets.length, convLoading]);

  const startConv = (s: ConvSet) => {
    setActiveConv(s);
    setCIndex(0);
    setCSelected(null);
    setCAnswered(false);
    setCResults([]);
    setConvGloss(null);
    setConvView('PLAY');
  };

  const answerConv = (choiceIndex: number) => {
    if (cAnswered || !activeConv) return;
    const q = activeConv.questions[cIndex];
    const correct = choiceIndex === q.answerIndex;
    setCSelected(choiceIndex);
    setCAnswered(true);
    setCResults((prev) => [...prev, { qid: q.id, selected: choiceIndex, correct }]);
  };

  const finishConv = async (allResults: { qid: string; selected: number; correct: boolean }[]) => {
    setConvView('RESULT');
    if (!activeConv) return;
    const total = allResults.length;
    const correct = allResults.filter((r) => r.correct).length;
    const allCorrect = total > 0 && correct === total; // ถูกครบทุกข้อ = "พิชิตชุด"
    // อัปเดตแถบความสำเร็จทันที (เฉพาะชุดที่ครูตรวจแล้ว) ให้เห็นผลในรอบนี้เลย แม้ยังไม่ล็อกอินอีเมล
    if (activeConv.verified) {
      const cid = activeConv.id;
      setConvCompleted((prev) => { const n = new Set(prev); n.add(cid); return n; });
      if (allCorrect) setConvMastered((prev) => { const n = new Set(prev); n.add(cid); return n; });
    }
    // บันทึกเฉพาะชุดที่ครูตรวจแล้ว (ไม่บันทึกตอนครูพรีวิว)
    if (activeConv.verified && email) {
      const byFormat: Record<string, ConvByFormat> = {};
      const f = activeConv.format;
      const b = byFormat[f] ?? { answered: 0, correct: 0 };
      b.answered += total;
      b.correct += correct;
      byFormat[f] = b;
      const updatedStreak = applyActivity(streakState, total);
      setStreakState(updatedStreak);
      saveStreak(email, updatedStreak);
      setCSaving(true);
      try {
        await saveConversationProgress({ email, name: studentName, correct, total, byFormat, streak: updatedStreak, convId: activeConv.id, mastered: allCorrect });
      } catch (e) {
        console.error('บันทึกผล Conversation ไม่สำเร็จ:', e);
      } finally {
        setCSaving(false);
      }
    }
  };

  const nextConvQuestion = () => {
    if (!activeConv) return;
    if (cIndex + 1 >= activeConv.questions.length) {
      finishConv(cResults);
    } else {
      setCIndex((i) => i + 1);
      setCSelected(null);
      setCAnswered(false);
    }
  };

  const visibleConvSets = convPreview ? conversationSets : conversationSets.filter((s) => s.verified);
  // ── ชั้นกรองสนามสอบห้องสนทนา (โชว์เฉพาะสนามที่มีชุดจริง — NETSAT ไม่มีพาร์ต Conversation ตาม blueprint) ──
  const convExamsPresent = EXAM_ORDER.filter((e) => visibleConvSets.some((s) => s.examStyle === e));
  const convEffectiveExam = convExam !== 'ALL' && convExamsPresent.includes(convExam) ? convExam : 'ALL';
  const convExamFiltered = convEffectiveExam === 'ALL' ? visibleConvSets : visibleConvSets.filter((s) => s.examStyle === convEffectiveExam);
  const convCatsPresent = CONV_CATEGORY_ORDER.filter((c) => convExamFiltered.some((s) => (s.category || 'other') === c));
  const convEffectiveCat = convCat !== 'ALL' && convCatsPresent.includes(convCat) ? convCat : 'ALL';
  const shownConvSets = convEffectiveCat === 'ALL' ? convExamFiltered : convExamFiltered.filter((s) => (s.category || 'other') === convEffectiveCat);
  const hasUnverifiedConv = conversationSets.some((s) => !s.verified);
  // ── แถบความสำเร็จ (พิชิตชุด) — นับเฉพาะชุดที่นักเรียนเห็น (ครูตรวจแล้ว) ──
  const convMasteredCount = visibleConvSets.filter((s) => convMastered.has(s.id)).length;
  const convCompletedCount = visibleConvSets.filter((s) => convCompleted.has(s.id)).length;
  const convMasteryPct = visibleConvSets.length > 0 ? Math.round((convMasteredCount / visibleConvSets.length) * 100) : 0;

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
                  <span className="block text-xs text-white/80 font-bold">ฝึกจำคำศัพท์ {vocabData.length} คำ ด้วยระบบ SRS</span>
                </span>
                <span className="text-[#FFD700] text-xl">→</span>
              </button>

              {/* ปุ่ม Reading */}
              <button
                type="button"
                onClick={() => setSection('READING')}
                className="w-full p-5 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.98] transition-all flex items-center gap-4"
              >
                <span className="text-3xl">📖</span>
                <span className="flex-1">
                  <span className="block font-black text-lg text-[#003399]">การอ่าน (Reading)</span>
                  <span className="block text-xs text-gray-500 font-bold">บทอ่าน + คำถามแนวข้อสอบ A-Level/TGAT/NETSAT</span>
                </span>
                <span className="text-[10px] font-black bg-[#FFD700] text-[#003399] px-2 py-1 rounded-full">ใหม่</span>
              </button>

              {/* ปุ่ม Conversation */}
              <button
                type="button"
                onClick={() => setSection('CONVERSATION')}
                className="w-full p-5 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.98] transition-all flex items-center gap-4"
              >
                <span className="text-3xl">💬</span>
                <span className="flex-1">
                  <span className="block font-black text-lg text-[#003399]">บทสนทนา (Conversation)</span>
                  <span className="block text-xs text-gray-500 font-bold">ฝึกบทสนทนาแนว TGAT / A-Level</span>
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

        {/* ── ห้อง Conversation (จริง) ── */}
        {gameState === 'START' && isLoggedIn && section === 'CONVERSATION' && (
          <div className="animate-fadeIn mt-2">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  if (convView !== 'LIST') { setConvView('LIST'); setActiveConv(null); }
                  else { setSection('HUB'); }
                }}
                className="text-sm font-bold text-[#003399] hover:underline flex items-center gap-1"
              >
                {convView === 'LIST' ? '← เมนูหลัก' : '← รายการบทสนทนา'}
              </button>
              <span className="text-base font-black text-gray-900">💬 บทสนทนา (Conversation)</span>
              <span className="w-14" />
            </div>

            {/* ---- รายการชุดบทสนทนา ---- */}
            {convView === 'LIST' && (
              <div>
                <label className="flex items-center justify-center gap-2 mb-4 text-xs font-bold text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={convPreview}
                    onChange={(e) => setConvPreview(e.target.checked)}
                    className="w-4 h-4 accent-[#003399]"
                  />
                  โหมดครู: แสดงชุดที่ยังไม่ได้ตรวจ (สำหรับทดสอบก่อนเปิดให้นักเรียน)
                </label>

                {/* ── แถบ % ความก้าวหน้าบทสนทนา (ดีไซน์เดียวกับห้องอ่าน) ── */}
                {!convLoading && visibleConvSets.length > 0 && (
                  <div className="bg-[#003399]/5 border-2 border-[#003399]/10 rounded-3xl p-5 mb-4 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-black text-[#003399] uppercase tracking-wider">⭐ แถบความสำเร็จบทสนทนา</span>
                      <span className="text-sm font-black text-[#003399] bg-[#FFD700] px-3 py-1 rounded-full shadow-sm">{convMasteryPct}%</span>
                    </div>
                    <div className="w-full bg-white h-4 rounded-full mb-3 overflow-hidden border border-[#003399]/10">
                      <div
                        className="bg-gradient-to-r from-[#FFD700] to-[#ffb800] h-full transition-all duration-1000 ease-out"
                        style={{ width: `${convMasteryPct}%` }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                        <div className="text-lg font-black text-[#FFB800]">⭐ {convMasteredCount}</div>
                        <div className="text-[10px] font-bold text-gray-500">พิชิตแล้ว (ถูกครบ)</div>
                      </div>
                      <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                        <div className="text-lg font-black text-[#003399]">{convCompletedCount} / {visibleConvSets.length}</div>
                        <div className="text-[10px] font-bold text-gray-500">ชุดที่เคยทำ</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 leading-relaxed text-center">
                      ตอบถูกครบทุกข้อในชุด = พิชิตชุดนั้น ⭐ (ทำซ้ำได้จนกว่าจะพิชิต)
                    </p>
                  </div>
                )}

                {/* ── แท็บสนามสอบห้องสนทนา (TGAT/A-Level เท่านั้น — NETSAT ไม่มีพาร์ตนี้) ── */}
                {!convLoading && convExamsPresent.length > 1 && (
                  <div className="flex flex-wrap gap-2 justify-center mb-2">
                    <button
                      type="button"
                      onClick={() => { setConvExam('ALL'); setConvCat('ALL'); }}
                      className={`text-sm font-black px-4 py-2 rounded-2xl border-2 transition-all ${convEffectiveExam === 'ALL' ? 'bg-[#FFD700] text-[#003399] border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                    >
                      ทั้งหมด ({visibleConvSets.length})
                    </button>
                    {convExamsPresent.map((e) => {
                      const n = visibleConvSets.filter((s) => s.examStyle === e).length;
                      return (
                        <button
                          key={e}
                          type="button"
                          onClick={() => { setConvExam(e); setConvCat('ALL'); }}
                          className={`text-sm font-black px-4 py-2 rounded-2xl border-2 transition-all ${convEffectiveExam === e ? 'bg-[#FFD700] text-[#003399] border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                        >
                          {e} ({n})
                        </button>
                      );
                    })}
                  </div>
                )}

                {!convLoading && convCatsPresent.length > 1 && (
                  <div className="flex flex-wrap gap-2 justify-center mb-4">
                    <button
                      type="button"
                      onClick={() => setConvCat('ALL')}
                      className={`text-xs font-black px-3 py-1.5 rounded-full border-2 transition-all ${convEffectiveCat === 'ALL' ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                    >
                      ทั้งหมด ({convExamFiltered.length})
                    </button>
                    {convCatsPresent.map((c) => {
                      const n = convExamFiltered.filter((s) => (s.category || 'other') === c).length;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setConvCat(c)}
                          className={`text-xs font-black px-3 py-1.5 rounded-full border-2 transition-all ${convEffectiveCat === c ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                        >
                          {CONV_CATEGORY_LABELS[c]} ({n})
                        </button>
                      );
                    })}
                  </div>
                )}

                {convLoading && (
                  <p className="text-center text-gray-400 font-bold py-10">⏳ กำลังโหลดบทสนทนา…</p>
                )}

                {!convLoading && visibleConvSets.length === 0 && (
                  <div className="bg-[#FFD700]/10 border-2 border-[#FFD700]/40 rounded-3xl p-6 text-center text-sm font-bold text-gray-700 leading-relaxed">
                    {hasUnverifiedConv ? (
                      <>ยังไม่มีชุดที่ครูตรวจแล้ว<span className="block text-xs text-gray-500 font-medium mt-1">เปิด &quot;โหมดครู&quot; ด้านบนเพื่อพรีวิว — เมื่อแก้ verified เป็น true ในไฟล์ conversation.json นักเรียนจะเห็นชุดนั้น</span></>
                    ) : (
                      'ยังไม่มีบทสนทนาในระบบ'
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {shownConvSets.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => startConv(s)}
                      className="w-full text-left p-4 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-black bg-[#003399] text-white px-2 py-0.5 rounded-full">{s.level}</span>
                        <span className="text-[10px] font-black bg-[#003399]/10 text-[#003399] px-2 py-0.5 rounded-full">{s.examStyle}</span>
                        <span className="text-[10px] font-black bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{CONV_FORMAT_LABELS[s.format]}</span>
                        {s.category && (
                          <span className="text-[10px] font-black bg-[#FFD700]/30 text-[#003399] px-2 py-0.5 rounded-full">{CONV_CATEGORY_LABELS[s.category] || s.category}</span>
                        )}
                        {s.verified ? (
                          <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ ครูตรวจแล้ว</span>
                        ) : (
                          <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⚠ รอครูตรวจ</span>
                        )}
                        {convMastered.has(s.id) ? (
                          <span className="text-[10px] font-black bg-[#FFD700]/40 text-[#8a6d00] px-2 py-0.5 rounded-full">⭐ พิชิตแล้ว</span>
                        ) : convCompleted.has(s.id) ? (
                          <span className="text-[10px] font-black bg-blue-100 text-[#003399] px-2 py-0.5 rounded-full">↻ ลองอีกครั้ง</span>
                        ) : null}
                      </div>
                      <div className="font-black text-gray-900 text-[15px] leading-snug">{s.title}</div>
                      {s.scenario_th && <div className="text-xs text-gray-500 font-medium mt-0.5">{s.scenario_th}</div>}
                      <div className="text-xs text-gray-400 font-bold mt-1">{s.questions.length} คำถาม</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ---- ทำบทสนทนา ---- */}
            {convView === 'PLAY' && activeConv && (() => {
              const q = activeConv.questions[cIndex];
              return (
                <div>
                  {!activeConv.verified && (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 mb-3 text-[11px] font-bold text-amber-700 text-center">
                      ⚠ ชุดนี้ยังไม่ได้ตรวจ (โหมดครู) — คะแนนจะไม่ถูกบันทึก
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-[10px] font-black bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{CONV_FORMAT_LABELS[activeConv.format]}</span>
                    <span className="font-black text-gray-900 text-[15px]">{activeConv.title}</span>
                  </div>
                  {activeConv.scenario_th && <p className="text-xs text-gray-500 font-medium mb-2">{activeConv.scenario_th}</p>}

                  {/* บทสนทนา (ถ้ามี) */}
                  {activeConv.dialogue.trim() && (
                    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-3">
                      <p className="text-[14px] text-gray-700 leading-relaxed whitespace-pre-line">{activeConv.dialogue}</p>
                    </div>
                  )}

                  {/* คำศัพท์จากคลัง — แตะดูคำแปล */}
                  {activeConv.targetVocab.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[11px] font-black text-[#003399] uppercase tracking-wide mb-1.5">คำศัพท์ในบทสนทนา (แตะดูคำแปล)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeConv.targetVocab.map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => setConvGloss(convGloss === w ? null : w)}
                            className={`text-[12px] font-bold px-2.5 py-1 rounded-full border transition-all ${convGloss === w ? 'bg-[#003399] text-[#FFD700] border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/30 hover:border-[#003399]'}`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                      {convGloss && vocabByWord[convGloss.toLowerCase()] && (
                        <div className="mt-2 bg-[#003399]/5 border border-[#003399]/15 rounded-xl p-3 text-sm">
                          <span className="font-black text-[#003399]">{convGloss}</span>
                          {vocabByWord[convGloss.toLowerCase()].type && vocabByWord[convGloss.toLowerCase()].type !== 'word' && (
                            <span className="ml-1.5 text-[10px] font-black bg-[#FFD700] text-[#003399] px-1.5 py-0.5 rounded-full align-middle">
                              {vocabByWord[convGloss.toLowerCase()].type === 'idiom' ? 'idiom' : 'phrasal verb'}
                            </span>
                          )}
                          <span className="text-gray-700"> — {vocabByWord[convGloss.toLowerCase()].thai_meaning}</span>
                          <div className="text-xs text-gray-500 mt-0.5 italic">{vocabByWord[convGloss.toLowerCase()].eng_definition}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* คำถาม */}
                  <div className="flex items-center justify-end mb-2">
                    <span className="text-xs font-bold text-gray-400">ข้อ {cIndex + 1} / {activeConv.questions.length}</span>
                  </div>
                  <p className="font-black text-gray-900 text-[15px] mb-3 leading-snug whitespace-pre-line">{q.question}</p>

                  <div className="space-y-2">
                    {q.choices.map((c, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      let cls = 'bg-white border-gray-200 text-gray-700 hover:border-[#003399]/40';
                      if (cAnswered) {
                        if (idx === q.answerIndex) cls = 'bg-green-50 border-green-400 text-green-800';
                        else if (idx === cSelected) cls = 'bg-rose-50 border-rose-400 text-rose-700';
                        else cls = 'bg-white border-gray-100 text-gray-400';
                      }
                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={cAnswered}
                          onClick={() => answerConv(idx)}
                          className={`w-full text-left p-3 rounded-xl border-2 font-bold text-[14px] transition-all flex gap-2 ${cls}`}
                        >
                          <span className="font-black">{letter}.</span>
                          <span className="flex-1">{c}</span>
                          {cAnswered && idx === q.answerIndex && <span>✓</span>}
                          {cAnswered && idx === cSelected && idx !== q.answerIndex && <span>✗</span>}
                        </button>
                      );
                    })}
                  </div>

                  {cAnswered && (
                    <div className="mt-3 bg-[#003399]/5 border border-[#003399]/15 rounded-2xl p-4 animate-fadeIn">
                      <div className="text-xs font-black text-[#003399] uppercase tracking-wide mb-1">💡 คำอธิบาย</div>
                      <p className="text-[14px] text-gray-700 leading-relaxed">{q.explanation_th}</p>
                    </div>
                  )}

                  {cAnswered && (
                    <button
                      type="button"
                      onClick={nextConvQuestion}
                      className="w-full mt-4 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] active:scale-[0.98] transition-all uppercase tracking-widest"
                    >
                      {cIndex + 1 >= activeConv.questions.length ? 'ดูผลสรุป' : 'ข้อถัดไป →'}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ---- สรุปผล ---- */}
            {convView === 'RESULT' && activeConv && (() => {
              const total = activeConv.questions.length;
              const correct = cResults.filter((r) => r.correct).length;
              const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
              return (
                <div className="animate-fadeIn">
                  <div className="text-center mb-5">
                    <div className="text-5xl font-black text-[#003399]">{correct}/{total}</div>
                    <div className="text-sm font-bold text-gray-500 mt-1">ตอบถูก {pct}%</div>
                    {cSaving && <div className="text-xs text-gray-400 mt-1">⏳ กำลังบันทึกคะแนน…</div>}
                    {!activeConv.verified && <div className="text-xs text-amber-600 font-bold mt-1">โหมดครู — ไม่บันทึกคะแนน</div>}
                  </div>

                  <div className="space-y-2 mb-5">
                    {activeConv.questions.map((q, i) => {
                      const r = cResults[i];
                      const ok = r?.correct;
                      return (
                        <div key={q.id} className={`p-3 rounded-xl border-2 ${ok ? 'bg-green-50 border-green-200' : 'bg-rose-50 border-rose-200'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-black ${ok ? 'text-green-700' : 'text-rose-600'}`}>{ok ? '✓ ถูก' : '✗ ผิด'}</span>
                          </div>
                          <p className="text-[13px] font-bold text-gray-800 leading-snug whitespace-pre-line">{q.question}</p>
                          {!ok && r && (
                            <p className="text-[12px] text-gray-500 mt-1">คุณตอบ: {String.fromCharCode(65 + r.selected)} · เฉลย: {String.fromCharCode(65 + q.answerIndex)}</p>
                          )}
                          <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">{q.explanation_th}</p>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => { setConvView('LIST'); setActiveConv(null); }}
                    className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] active:scale-[0.98] transition-all uppercase tracking-widest"
                  >
                    ← เลือกชุดอื่น
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── ห้อง Reading (จริง) ── */}
        {gameState === 'START' && isLoggedIn && section === 'READING' && (
          <div className="animate-fadeIn mt-2">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  if (readingView !== 'LIST') { setReadingView('LIST'); setActivePassage(null); }
                  else { setSection('HUB'); }
                }}
                className="text-sm font-bold text-[#003399] hover:underline flex items-center gap-1"
              >
                {readingView === 'LIST' ? '← เมนูหลัก' : '← รายการบทอ่าน'}
              </button>
              <span className="text-base font-black text-gray-900">📖 การอ่าน (Reading)</span>
              <span className="w-14" />
            </div>

            {/* ---- รายการบทอ่าน ---- */}
            {readingView === 'LIST' && (
              <div>
                <label className="flex items-center justify-center gap-2 mb-4 text-xs font-bold text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={teacherPreview}
                    onChange={(e) => setTeacherPreview(e.target.checked)}
                    className="w-4 h-4 accent-[#003399]"
                  />
                  โหมดครู: แสดงบทที่ยังไม่ได้ตรวจ (สำหรับทดสอบก่อนเปิดให้นักเรียน)
                </label>

                {!readingLoading && visiblePassages.length > 0 && (
                  <div className="bg-[#003399]/5 border-2 border-[#003399]/10 rounded-3xl p-5 mb-4 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-black text-[#003399] uppercase tracking-wider">⭐ แถบความสำเร็จการอ่าน</span>
                      <span className="text-sm font-black text-[#003399] bg-[#FFD700] px-3 py-1 rounded-full shadow-sm">{masteryPct}%</span>
                    </div>
                    <div className="w-full bg-white h-4 rounded-full mb-3 overflow-hidden border border-[#003399]/10">
                      <div
                        className="bg-gradient-to-r from-[#FFD700] to-[#ffb800] h-full transition-all duration-1000 ease-out"
                        style={{ width: `${masteryPct}%` }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                        <div className="text-lg font-black text-[#FFB800]">⭐ {masteredCount}</div>
                        <div className="text-[10px] font-bold text-gray-500">พิชิตแล้ว (ถูกครบ)</div>
                      </div>
                      <div className="bg-white rounded-xl py-2 border border-[#003399]/10">
                        <div className="text-lg font-black text-[#003399]">{completedCount} / {visiblePassages.length}</div>
                        <div className="text-[10px] font-bold text-gray-500">บทที่เคยทำ</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 leading-relaxed text-center">
                      ตอบถูกครบทุกข้อในบท = พิชิตบทนั้น ⭐ (ทำซ้ำได้จนกว่าจะพิชิต)
                    </p>
                  </div>
                )}

                {!readingLoading && visiblePassages.length > 0 && (
                  <div className="bg-white border-2 border-[#FFD700]/50 rounded-3xl p-5 mb-4 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black text-[#003399] uppercase tracking-wider">🏆 Top 3 นักพิชิตประจำสัปดาห์</span>
                      <span className="text-[10px] font-bold text-gray-400">รีเซ็ตทุกวันจันทร์</span>
                    </div>
                    {readingBoardLoading ? (
                      <div className="text-center text-gray-400 font-bold py-4 animate-pulse">กำลังโหลดอันดับ…</div>
                    ) : !readingBoard || readingBoard.length === 0 ? (
                      <div className="text-center text-gray-500 font-bold py-3 text-sm">ยังไม่มีใครพิชิตบทสัปดาห์นี้ — เป็นคนแรกเลย! ⭐</div>
                    ) : (() => {
                      const myEmail = email.trim().toLowerCase();
                      const top3 = readingBoard.slice(0, 3);
                      const myIdx = readingBoard.findIndex((e) => e.email === myEmail);
                      return (
                        <>
                          <div className="space-y-1.5 mt-2">
                            {top3.map((e, i) => {
                              const isMe = e.email === myEmail;
                              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
                              return (
                                <div key={e.email} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${isMe ? 'bg-[#FFD700]/20 border-2 border-[#FFD700]' : 'bg-gray-50'}`}>
                                  <span className="w-6 text-center text-lg">{medal}</span>
                                  <span className="flex-1 font-bold text-gray-800 truncate">{e.name}{isMe && ' (คุณ)'}</span>
                                  <span className="font-black text-[#003399]">{e.weeklyMastered}<span className="text-[10px] text-gray-400 font-bold"> บท</span></span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 pt-3 border-t border-gray-100 text-center text-xs font-black text-[#003399]">
                            {myIdx >= 0
                              ? `อันดับของคุณ: #${myIdx + 1} จาก ${readingBoard.length} คน · พิชิต ${readingBoard[myIdx].weeklyMastered} บทสัปดาห์นี้`
                              : 'พิชิตบท (ตอบถูกครบทุกข้อ) เพื่อติดอันดับสัปดาห์นี้! ⭐'}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* ── แท็บสนามสอบ + ปุ่มสุ่มบท (กันลอก: แต่ละคนได้บทต่างกัน ลำดับข้อต่างกัน) ── */}
                {!readingLoading && examsPresent.length > 1 && (
                  <div className="flex flex-wrap gap-2 justify-center mb-2">
                    <button
                      type="button"
                      onClick={() => { setReadingExam('ALL'); setReadingCat('ALL'); }}
                      className={`text-sm font-black px-4 py-2 rounded-2xl border-2 transition-all ${effectiveExam === 'ALL' ? 'bg-[#FFD700] text-[#003399] border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                    >
                      ทั้งหมด ({visiblePassages.length})
                    </button>
                    {examsPresent.map((e) => {
                      const n = visiblePassages.filter((p) => p.examStyle === e).length;
                      return (
                        <button
                          key={e}
                          type="button"
                          onClick={() => { setReadingExam(e); setReadingCat('ALL'); }}
                          className={`text-sm font-black px-4 py-2 rounded-2xl border-2 transition-all ${effectiveExam === e ? 'bg-[#FFD700] text-[#003399] border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                        >
                          {e} ({n})
                        </button>
                      );
                    })}
                  </div>
                )}
                {!readingLoading && shownPassages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => startRandomPassage(shownPassages)}
                    className="w-full mb-4 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] active:scale-[0.98] transition-all tracking-wide"
                  >
                    🎲 สุ่มบทอ่าน{effectiveExam !== 'ALL' ? ` (${effectiveExam})` : ' (ทุกสนาม)'} — เริ่มทำทันที
                  </button>
                )}

                {!readingLoading && catsPresent.length > 1 && (
                  <div className="flex flex-wrap gap-2 justify-center mb-4">
                    <button
                      type="button"
                      onClick={() => setReadingCat('ALL')}
                      className={`text-xs font-black px-3 py-1.5 rounded-full border-2 transition-all ${effectiveCat === 'ALL' ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                    >
                      ทั้งหมด ({examFiltered.length})
                    </button>
                    {catsPresent.map((c) => {
                      const n = examFiltered.filter((p) => (p.category || 'other') === c).length;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setReadingCat(c)}
                          className={`text-xs font-black px-3 py-1.5 rounded-full border-2 transition-all ${effectiveCat === c ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/25 hover:border-[#003399]/50'}`}
                        >
                          {CATEGORY_LABELS[c]} ({n})
                        </button>
                      );
                    })}
                  </div>
                )}

                {readingLoading && (
                  <p className="text-center text-gray-400 font-bold py-10">⏳ กำลังโหลดบทอ่าน…</p>
                )}

                {!readingLoading && visiblePassages.length === 0 && (
                  <div className="bg-[#FFD700]/10 border-2 border-[#FFD700]/40 rounded-3xl p-6 text-center text-sm font-bold text-gray-700 leading-relaxed">
                    {hasUnverified ? (
                      <>ยังไม่มีบทที่ครูตรวจแล้ว<span className="block text-xs text-gray-500 font-medium mt-1">เปิด &quot;โหมดครู&quot; ด้านบนเพื่อพรีวิวบทที่ยังไม่ตรวจ — เมื่อแก้ verified เป็น true ในไฟล์ reading.json นักเรียนจะเห็นบทนั้น</span></>
                    ) : (
                      'ยังไม่มีบทอ่านในระบบ'
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {shownPassages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => startPassage(p)}
                      className="w-full text-left p-4 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-black bg-[#003399] text-white px-2 py-0.5 rounded-full">{p.level}</span>
                        <span className="text-[10px] font-black bg-[#003399]/10 text-[#003399] px-2 py-0.5 rounded-full">{p.examStyle}</span>
                        {p.category && (
                          <span className="text-[10px] font-black bg-[#FFD700]/30 text-[#003399] px-2 py-0.5 rounded-full">{CATEGORY_LABELS[p.category] || p.category}</span>
                        )}
                        {p.verified ? (
                          <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ ครูตรวจแล้ว</span>
                        ) : (
                          <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⚠ รอครูตรวจ</span>
                        )}
                        {readingMastered.has(p.id) ? (
                          <span className="text-[10px] font-black bg-[#FFD700]/40 text-[#8a6d00] px-2 py-0.5 rounded-full">⭐ พิชิตแล้ว</span>
                        ) : readingCompleted.has(p.id) ? (
                          <span className="text-[10px] font-black bg-blue-100 text-[#003399] px-2 py-0.5 rounded-full">↻ ลองอีกครั้ง</span>
                        ) : null}
                      </div>
                      <div className="font-black text-gray-900 text-[15px] leading-snug">{p.title}</div>
                      <div className="text-xs text-gray-500 font-bold mt-1">{p.questions.length} คำถาม · ~{p.wordCount} คำ · ⏱ ~{Math.round(readingTimeLimitSec(p.wordCount, p.questions.length) / 60)} นาที</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ---- ทำบทอ่าน ---- */}
            {readingView === 'PLAY' && activePassage && (() => {
              const q = activePassage.questions[rIndex];
              return (
                <div onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} className="select-none" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}>
                  {/* กันโกง: ป๊อปอัปเตือนเมื่อกลับเข้าหน้าจอ */}
                  {rWarnOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setRWarnOpen(false)}>
                      <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center border-4 border-red-400 shadow-2xl animate-fadeIn" onClick={(e) => e.stopPropagation()}>
                        <div className="text-5xl mb-2">🚨</div>
                        <div className="text-lg font-black text-red-600 mb-1">ห้ามออกจากหน้าจอ!</div>
                        <p className="text-sm font-bold text-gray-700">ระบบตรวจพบว่าคุณออกจากหน้าจอ {rLeaveCount} ครั้ง</p>
                        <p className="text-sm font-black text-red-500 mt-2">ออกอีก {Math.max(0, READING_MAX_LEAVES + 1 - rLeaveCount)} ครั้ง ระบบจะส่งคำตอบอัตโนมัติทันที</p>
                        <button type="button" onClick={() => setRWarnOpen(false)} className="mt-4 w-full py-3 bg-red-500 text-white font-black rounded-2xl active:scale-95 transition-all">เข้าใจแล้ว ทำต่อ</button>
                      </div>
                    </div>
                  )}

                  {!activePassage.verified && (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 mb-3 text-[11px] font-bold text-amber-700 text-center">
                      ⚠ บทนี้ยังไม่ได้ตรวจ (โหมดครู) — คะแนนจะไม่ถูกบันทึก
                    </div>
                  )}

                  {/* ⏱ ตัวจับเวลา — เวลาที่ให้ขึ้นกับความยาวบท + จำนวนข้อ */}
                  {(() => {
                    const overtime = rTimeLeft < 0;
                    const warn = !overtime && rTimeLeft <= 60;
                    const usedFrac = rTimeLimit > 0 ? Math.min(1, (rTimeLimit - rTimeLeft) / rTimeLimit) : 0;
                    const tone = overtime ? 'text-red-600' : warn ? 'text-amber-700' : 'text-[#003399]';
                    return (
                      <div className={`rounded-2xl p-3 mb-3 border-2 ${overtime ? 'bg-red-50 border-red-300' : warn ? 'bg-amber-50 border-amber-300' : 'bg-[#003399]/5 border-[#003399]/20'}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-bold ${tone}`}>{overtime ? '⏰ หมดเวลาแล้ว' : '⏱ เวลาที่เหลือ'}</span>
                          <span className={`text-lg font-black tabular-nums ${tone}`}>{fmtTime(rTimeLeft)}</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${overtime ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-[#003399]'}`} style={{ width: `${usedFrac * 100}%` }} />
                        </div>
                        <div className="mt-1 text-[10px] text-gray-400 font-bold">
                          เวลาที่ให้ {fmtTime(rTimeLimit)} (~{activePassage.wordCount} คำ · {activePassage.questions.length} ข้อ){overtime ? ' — ทำต่อได้ ไม่บังคับส่ง' : ''}
                        </div>
                      </div>
                    );
                  })()}

                  {/* กันโกง: เตือนเมื่อออกจากหน้าจอระหว่างทำข้อสอบ */}
                  {rLeaveCount > 0 && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-3 mb-3 text-[11px] font-bold text-red-600 text-center">
                      ⚠ ตรวจพบการออกจากหน้าจอ {rLeaveCount} ครั้ง — ห้ามเปิดแอปอื่น/แปลภาษาระหว่างทำข้อสอบ
                      <div className="mt-1 text-red-500">ออกจากจออีก {Math.max(0, READING_MAX_LEAVES + 1 - rLeaveCount)} ครั้ง ระบบจะส่งคำตอบอัตโนมัติทันที</div>
                    </div>
                  )}

                  {/* บทอ่าน */}
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-3 max-h-64 overflow-y-auto">
                    <div className="font-black text-gray-900 mb-2 text-[15px]">{activePassage.title}</div>
                    <p className="text-[14px] text-gray-700 leading-relaxed whitespace-pre-line">{activePassage.passage}</p>
                  </div>

                  {/* คำศัพท์จากคลัง — แตะดูคำแปล */}
                  {activePassage.targetVocab.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[11px] font-black text-[#003399] uppercase tracking-wide mb-1.5">คำศัพท์ในบทอ่าน (แตะดูคำแปล)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {activePassage.targetVocab.map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => setGlossWord(glossWord === w ? null : w)}
                            className={`text-[12px] font-bold px-2.5 py-1 rounded-full border transition-all ${glossWord === w ? 'bg-[#003399] text-[#FFD700] border-[#003399]' : 'bg-white text-[#003399] border-[#003399]/30 hover:border-[#003399]'}`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                      {glossWord && (() => {
                        const g = vocabByWord[glossWord.toLowerCase()];
                        return (
                          <div className="mt-2 bg-[#003399]/5 border border-[#003399]/15 rounded-xl p-3 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-[#003399]">{glossWord}</span>
                              {g?.type && g.type !== 'word' && (
                                <span className="text-[10px] font-black bg-[#FFD700] text-[#003399] px-1.5 py-0.5 rounded-full">
                                  {g.type === 'idiom' ? 'idiom' : 'phrasal verb'}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => speak(glossWord)}
                                aria-label="ฟังเสียงอ่าน"
                                title="ฟังเสียงอ่าน"
                                className="ml-auto w-8 h-8 flex items-center justify-center rounded-full bg-[#003399] text-[#FFD700] hover:bg-[#002266] active:scale-95 transition-all"
                              >
                                🔊
                              </button>
                            </div>
                            {g ? (
                              <>
                                <div className="text-gray-700 mt-1">{g.thai_meaning}</div>
                                {g.eng_definition && <div className="text-xs text-gray-500 mt-0.5 italic">{g.eng_definition}</div>}
                              </>
                            ) : (
                              <div className="text-xs text-gray-500 mt-1">ยังไม่มีคำแปลในคลัง — กดปุ่ม 🔊 เพื่อฟังเสียงอ่านได้</div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* คำถาม — โหมดข้อสอบ: เลื่อนดูทุกข้อได้อิสระ เลือกแล้วเปลี่ยนได้ ส่งรวมตอนท้าย */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-0.5 rounded-full">{RQTYPE_LABELS[q.type]}</span>
                    <span className="text-xs font-bold text-gray-400">ข้อ {rIndex + 1} / {activePassage.questions.length}</span>
                  </div>

                  {/* จุดนำทางข้อ — เทคนิคข้อสอบ: กวาดตาดูคำถามทุกข้อก่อนอ่านบท แล้วกดกลับมาตอบทีหลังได้ */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {activePassage.questions.map((qq, i) => {
                      const answered = rAnswers[i] !== null && rAnswers[i] !== undefined;
                      const isCur = i === rIndex;
                      return (
                        <button
                          key={qq.id}
                          type="button"
                          onClick={() => setRIndex(i)}
                          className={`w-8 h-8 rounded-full text-xs font-black border-2 transition-all ${
                            isCur
                              ? 'bg-[#FFD700] border-[#003399] text-[#003399] scale-110'
                              : answered
                              ? 'bg-[#003399] border-[#003399] text-white'
                              : 'bg-white border-gray-300 text-gray-500 hover:border-[#003399]/50'
                          }`}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mb-3">💡 เทคนิค: กวาดตาดู &quot;คำถาม&quot; ทุกข้อก่อนอ่านบท — กดตัวเลขเพื่อข้ามไปดู/ย้อนกลับมาตอบได้ทุกเมื่อ</p>

                  <p className="font-black text-gray-900 text-[15px] mb-3 leading-snug">{q.question}</p>

                  <div className="space-y-2">
                    {q.choices.map((c, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      const isSel = rAnswers[rIndex] === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => selectReadingAnswer(idx)}
                          className={`w-full text-left p-3 rounded-xl border-2 font-bold text-[14px] transition-all flex gap-2 ${
                            isSel
                              ? 'bg-[#003399] border-[#003399] text-[#FFD700] shadow-sm'
                              : 'bg-white border-gray-200 text-gray-700 hover:border-[#003399]/40'
                          }`}
                        >
                          <span className="font-black">{letter}.</span>
                          <span className="flex-1">{c}</span>
                          {isSel && <span>✔</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* นำทาง ไป-กลับ */}
                  <div className="flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setRIndex((i) => Math.max(0, i - 1))}
                      disabled={rIndex === 0}
                      className="flex-1 py-3 rounded-2xl font-black border-2 border-[#003399]/20 text-[#003399] bg-white disabled:opacity-30 hover:border-[#003399]/50 active:scale-[0.98] transition-all"
                    >
                      ← ก่อนหน้า
                    </button>
                    <button
                      type="button"
                      onClick={() => setRIndex((i) => Math.min(activePassage.questions.length - 1, i + 1))}
                      disabled={rIndex + 1 >= activePassage.questions.length}
                      className="flex-1 py-3 rounded-2xl font-black border-2 border-[#003399]/20 text-[#003399] bg-white disabled:opacity-30 hover:border-[#003399]/50 active:scale-[0.98] transition-all"
                    >
                      ถัดไป →
                    </button>
                  </div>

                  {/* ส่งคำตอบ (ต้องครบทุกข้อ) */}
                  {(() => {
                    const answeredCount = rAnswers.filter((a) => a !== null && a !== undefined).length;
                    const totalQ = activePassage.questions.length;
                    const ready = answeredCount === totalQ;
                    return (
                      <button
                        type="button"
                        onClick={submitReading}
                        disabled={!ready}
                        className={`w-full mt-3 py-4 font-black rounded-2xl shadow-lg uppercase tracking-widest transition-all ${
                          ready
                            ? 'bg-[#003399] text-[#FFD700] hover:bg-[#002266] active:scale-[0.98]'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {ready ? '📤 ส่งคำตอบ · ดูผลสรุป' : `ตอบแล้ว ${answeredCount}/${totalQ} ข้อ — ตอบให้ครบก่อนส่ง`}
                      </button>
                    );
                  })()}
                </div>
              );
            })()}

            {/* ---- สรุปผล ---- */}
            {readingView === 'RESULT' && activePassage && (() => {
              const total = activePassage.questions.length;
              const correct = rResults.filter((r) => r.correct).length;
              const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
              return (
                <div className="animate-fadeIn">
                  <div className="text-center mb-5">
                    <div className="text-5xl font-black text-[#003399]">{correct}/{total}</div>
                    <div className="text-sm font-bold text-gray-500 mt-1">ตอบถูก {pct}%</div>
                    {rTimeLimit > 0 && (() => {
                      const used = rTimeLimit - rTimeLeft;
                      const within = used <= rTimeLimit;
                      return (
                        <div className={`text-xs font-bold mt-1 ${within ? 'text-green-600' : 'text-red-500'}`}>
                          ⏱ ใช้เวลา {fmtTime(Math.max(0, used))} / ได้เวลา {fmtTime(rTimeLimit)} {within ? '— อยู่ในเวลา ✓' : '— เกินเวลา'}
                        </div>
                      );
                    })()}
                    {rLeaveCount > 0 && (
                      <div className="text-xs font-bold mt-1 text-red-500">⚠ ออกจากหน้าจอระหว่างทำ {rLeaveCount} ครั้ง</div>
                    )}
                    {rAutoSubmitted && (
                      <div className="mt-2 bg-red-50 border-2 border-red-300 rounded-2xl py-2 px-3 text-xs font-black text-red-600">⛔ ระบบส่งคำตอบอัตโนมัติ เพราะออกจากหน้าจอเกิน {READING_MAX_LEAVES} ครั้ง</div>
                    )}
                    {total > 0 && correct === total ? (
                      <div className="mt-3 bg-[#FFD700]/20 border-2 border-[#FFD700] rounded-2xl py-3 px-4 animate-fadeIn">
                        <div className="text-2xl">⭐🎉</div>
                        <div className="text-sm font-black text-[#8a6d00]">พิชิตบทนี้แล้ว! ตอบถูกครบทุกข้อ</div>
                      </div>
                    ) : (
                      <div className="mt-3 bg-[#003399]/5 border-2 border-[#003399]/15 rounded-2xl py-3 px-4">
                        <div className="text-sm font-black text-[#003399]">เกือบแล้ว! อ่านเฉลยด้านล่าง แล้วลองอีกครั้งเพื่อพิชิตบทนี้ ⭐</div>
                      </div>
                    )}
                    {rSaving && <div className="text-xs text-gray-400 mt-1">⏳ กำลังบันทึกคะแนน…</div>}
                    {!activePassage.verified && <div className="text-xs text-amber-600 font-bold mt-1">โหมดครู — ไม่บันทึกคะแนน</div>}
                  </div>

                  <div className="space-y-2 mb-5">
                    {activePassage.questions.map((q, i) => {
                      const r = rResults[i];
                      const ok = r?.correct;
                      return (
                        <div key={q.id} className={`p-3 rounded-xl border-2 ${ok ? 'bg-green-50 border-green-200' : 'bg-rose-50 border-rose-200'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-black bg-white px-2 py-0.5 rounded-full text-gray-500">{RQTYPE_LABELS[q.type]}</span>
                            <span className={`text-xs font-black ${ok ? 'text-green-700' : 'text-rose-600'}`}>{ok ? '✓ ถูก' : '✗ ผิด'}</span>
                          </div>
                          <p className="text-[13px] font-bold text-gray-800 leading-snug">{q.question}</p>
                          {!ok && r && (
                            <p className="text-[12px] text-gray-500 mt-1">คุณตอบ: {r.selected >= 0 ? String.fromCharCode(65 + r.selected) : 'ไม่ได้ตอบ'} · เฉลย: {String.fromCharCode(65 + q.answerIndex)}</p>
                          )}
                          <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">{q.explanation_th}</p>
                        </div>
                      );
                    })}
                  </div>

                  {!(total > 0 && correct === total) && (
                    <button
                      type="button"
                      onClick={() => startPassage(activePassage)}
                      className="w-full py-4 mb-3 bg-[#FFD700] text-[#003399] font-black rounded-2xl shadow-lg hover:bg-[#ffcc00] active:scale-[0.98] transition-all uppercase tracking-widest"
                    >
                      ↻ ทำบทนี้อีกครั้ง (เพื่อพิชิต ⭐)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setReadingView('LIST'); setActivePassage(null); }}
                    className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] active:scale-[0.98] transition-all uppercase tracking-widest"
                  >
                    ← เลือกบทอ่านอื่น
                  </button>
                </div>
              );
            })()}
          </div>
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
                <span>Mastered: <span className="text-[#003399]">{srsStats.mastered}</span></span>
                <span>Total: <span className="text-[#003399]">{vocabData.length} Words</span></span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                % คิดความคืบหน้าทุกขั้นของการจำ (ยิ่งเลื่อนคำขึ้นกล่อง % ยิ่งเพิ่ม) ส่วน &quot;Mastered&quot; คือคำที่จำได้สมบูรณ์แล้ว
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
              {/* ── เลือกโหมดติว (ใช้บันได CEFR) ── */}
              <div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 text-center">เลือกโหมดติว</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'all', label: 'ทั้งหมด', sub: 'B1·B2·C1' },
                    { key: 'foundation', label: 'พื้นฐาน', sub: 'B1' },
                    { key: 'exam', label: 'ระดับสอบ', sub: 'B2·C1' },
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
                      <div className="text-sm font-black">{opt.label}</div>
                      <div className="text-[9px] font-bold opacity-70">{opt.sub}</div>
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
                  currentQuestions[currentIndex].example_sentence
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
                  return (
                    <button
                      key={idx}
                      onClick={() => handleAnswerSelection(option)}
                      disabled={isAnswered}
                      className={`w-full p-4 border-2 rounded-2xl text-left text-base md:text-lg transition-all duration-200 flex items-center justify-between ${btnStyle}`}
                    >
                      <span>{option}</span>
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
