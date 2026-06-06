"use client";

import React, { useState, useEffect } from 'react';
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
import { loadCloudProgress, saveCloudProgress, loadLeaderboard, LeaderboardEntry, saveReadingProgress, ReadingByType } from './lib/cloud';
import {
  ReadingPassage,
  RQTYPE_LABELS,
  loadReadingPassages,
} from './lib/reading';
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
  const [activePassage, setActivePassage] = useState<ReadingPassage | null>(null);
  const [rIndex, setRIndex] = useState(0);
  const [rSelected, setRSelected] = useState<number | null>(null);
  const [rAnswered, setRAnswered] = useState(false);
  const [rResults, setRResults] = useState<{ qid: string; type: string; selected: number; correct: boolean }[]>([]);
  const [rSaving, setRSaving] = useState(false);
  const [glossWord, setGlossWord] = useState<string | null>(null); // คำใน targetVocab ที่กำลังเปิดดูคำแปล

  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');

  // ── คลังความก้าวหน้าแบบ SRS (แทนระบบ masteredWords เดิม) ──
  const [srsStore, setSrsStore] = useState<SrsStore>({});
  const [streakState, setStreakState] = useState<StreakState>(emptyStreak());
  // โหมดติว: ทั้งหมด / พื้นฐาน(B1) / ระดับสอบเข้ามหาลัย(B2·C1)
  const [examFocus, setExamFocus] = useState<'all' | 'foundation' | 'exam'>('all');
  // เลือกเจาะพาร์ท: null = ผสมทุกแนว, หรือเจาะประเภทเดียว
  const [focusType, setFocusType] = useState<'SYNONYM' | 'ANTONYM' | 'SENTENCE' | 'MEANING' | 'TYPE' | null>(null);
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
  const WRITE_MODE_QUESTIONS = 2;   // จำนวนข้อ "แต่งประโยค" ต่อรอบ (อยู่ท้ายสุด) — ปรับเลขนี้ได้
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
      if (forcedType) {
        return { ...item, questionType: forcedType };
      }
      // ข้อท้ายสุด WRITE_MODE_QUESTIONS ข้อ ให้เป็นโหมดแต่งประโยค
      if (i >= words.length - WRITE_MODE_QUESTIONS) {
        return { ...item, questionType: 'WRITE' as const };
      }
      const box = srsStore[item.word] ? srsStore[item.word].box : -1;
      const hasSynonym = Boolean(item.synonym && item.synonym !== "-" && item.synonym.trim() !== "");
      const hasAntonym = Boolean(item.antonym && item.antonym !== "-" && item.antonym.trim() !== "");
      const qType = chooseQuestionType(box, { hasSynonym, hasAntonym });
      return { ...item, questionType: qType };
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

  // ── รอบเจาะพาร์ทเดียว (เช่น Synonym ล้วน / อังกฤษ→ไทย ล้วน) ──
  const startFocusRound = (type: 'SYNONYM' | 'ANTONYM' | 'SENTENCE' | 'MEANING' | 'TYPE') => {
    if (vocabData.length === 0) {
      alert("⚠️ ระบบยังโหลดคลังคำศัพท์ไม่สำเร็จ กรุณารีเฟรชหน้าเว็บแล้วลองใหม่ครับ");
      return;
    }
    // คัดเฉพาะคำที่ใช้กับประเภทนี้ได้
    const eligible = vocabData.filter((w) => {
      if (type === 'SYNONYM') return Boolean(w.synonym && w.synonym !== '-' && w.synonym.trim());
      if (type === 'ANTONYM') return Boolean(w.antonym && w.antonym !== '-' && w.antonym.trim());
      if (type === 'SENTENCE') return Boolean(w.example_sentence && w.example_sentence.trim());
      return Boolean(w.thai_meaning && w.thai_meaning.trim()); // MEANING / TYPE
    });
    if (eligible.length === 0) {
      alert("ยังไม่มีคำในคลังที่ใช้กับแนวนี้ได้ ลองเลือกแนวอื่นหรือโหมดผสมดูครับ");
      return;
    }
    const levelPlan =
      examFocus === 'foundation'
        ? [{ level: 'B1', count: 10 }]
        : examFocus === 'exam'
        ? [{ level: 'B2', count: 7 }, { level: 'C1', count: 3 }]
        : [{ level: 'B1', count: 4 }, { level: 'B2', count: 4 }, { level: 'C1', count: 2 }];
    const picked = pickRound(srsStore, eligible, { total: TOTAL_QUESTIONS_PER_ROUND, levelPlan });
    const wordMap = new Map(eligible.map((w) => [w.word, w]));
    const words: WordItem[] = picked.map((w) => wordMap.get(w)).filter((w): w is WordItem => Boolean(w));
    if (words.length === 0) {
      alert("ยังไม่มีคำที่เหมาะกับแนวนี้ในระดับที่เลือก ลองเปลี่ยนโหมดติวเป็น 'ทั้งหมด' ดูครับ");
      return;
    }
    beginRoundWithWords(words, type);
  };

  // ปุ่ม Start: ถ้าเลือกเจาะพาร์ทก็เล่นแนวนั้นล้วน, ไม่งั้นเล่นแบบผสม
  const handleStart = () => {
    if (focusType) startFocusRound(focusType);
    else startNewQuizRound();
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

  // แผนที่คำศัพท์ (สำหรับแตะดูคำแปลคำใน targetVocab ของบทอ่าน)
  const vocabByWord = React.useMemo(() => {
    const m: Record<string, WordItem> = {};
    for (const w of vocabData) m[w.word.toLowerCase()] = w;
    return m;
  }, [vocabData]);

  // เริ่มทำบทอ่านที่เลือก
  const startPassage = (p: ReadingPassage) => {
    setActivePassage(p);
    setRIndex(0);
    setRSelected(null);
    setRAnswered(false);
    setRResults([]);
    setGlossWord(null);
    setReadingView('PLAY');
  };

  // ตอบคำถามข้อปัจจุบัน
  const answerReading = (choiceIndex: number) => {
    if (rAnswered || !activePassage) return;
    const q = activePassage.questions[rIndex];
    const correct = choiceIndex === q.answerIndex;
    setRSelected(choiceIndex);
    setRAnswered(true);
    setRResults((prev) => [...prev, { qid: q.id, type: q.type, selected: choiceIndex, correct }]);
  };

  // สรุปผลเมื่อทำครบทุกข้อ
  const finishReading = async (allResults: { qid: string; type: string; selected: number; correct: boolean }[]) => {
    setReadingView('RESULT');
    if (!activePassage) return;
    const total = allResults.length;
    const correct = allResults.filter((r) => r.correct).length;
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
        await saveReadingProgress({ email, name: studentName, correct, total, byType, streak: updatedStreak });
      } catch (e) {
        console.error('บันทึกผล Reading ไม่สำเร็จ:', e);
      } finally {
        setRSaving(false);
      }
    }
  };

  // ไปข้อถัดไป หรือจบรอบถ้าหมดแล้ว
  const nextReadingQuestion = () => {
    if (!activePassage) return;
    if (rIndex + 1 >= activePassage.questions.length) {
      finishReading(rResults);
    } else {
      setRIndex((i) => i + 1);
      setRSelected(null);
      setRAnswered(false);
    }
  };

  // บทอ่านที่จะแสดง (เด็กเห็นเฉพาะที่ครูตรวจแล้ว / ครูเปิดสวิตช์เพื่อพรีวิวบทที่ยังไม่ตรวจ)
  const visiblePassages = teacherPreview ? readingPassages : readingPassages.filter((p) => p.verified);
  const hasUnverified = readingPassages.some((p) => !p.verified);

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

        {/* ── ห้อง Conversation (placeholder — จะสร้างจริงในขั้นถัดไป) ── */}
        {gameState === 'START' && isLoggedIn && section === 'CONVERSATION' && (
          <div className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center justify-center mb-6">
              <span className="text-5xl mb-3">💬</span>
              <h1 className="text-2xl font-black text-gray-900 mb-1">บทสนทนา (Conversation)</h1>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">Coming next step</p>
            </div>
            <div className="bg-[#FFD700]/10 border-2 border-[#FFD700]/40 rounded-3xl p-6 mb-6">
              <p className="text-gray-700 font-bold text-sm leading-relaxed">
                🚧 ห้องนี้กำลังสร้างในขั้นถัดไปครับ
                <span className="block text-xs text-gray-500 font-medium mt-1">เมื่อห้อง Reading เรียบร้อย ผมจะก๊อปแพทเทิร์นเดียวกันมาทำ Conversation</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSection('HUB')}
              className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] active:scale-[0.98] transition-all uppercase tracking-widest"
            >
              ← กลับเมนูหลัก
            </button>
          </div>
        )}

        {/* ── ห้อง Reading (จริง) ── */}
        {gameState === 'START' && isLoggedIn && section === 'READING' && (
          <div className="animate-fadeIn mt-2">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => { setSection('HUB'); setReadingView('LIST'); }}
                className="text-sm font-bold text-[#003399] hover:underline flex items-center gap-1"
              >
                ← เมนูหลัก
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
                  {visiblePassages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => startPassage(p)}
                      className="w-full text-left p-4 bg-white border-2 border-[#003399]/15 rounded-2xl shadow-sm hover:border-[#003399]/40 active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-black bg-[#003399] text-white px-2 py-0.5 rounded-full">{p.level}</span>
                        <span className="text-[10px] font-black bg-[#003399]/10 text-[#003399] px-2 py-0.5 rounded-full">{p.examStyle}</span>
                        {p.verified ? (
                          <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ ครูตรวจแล้ว</span>
                        ) : (
                          <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⚠ รอครูตรวจ</span>
                        )}
                      </div>
                      <div className="font-black text-gray-900 text-[15px] leading-snug">{p.title}</div>
                      <div className="text-xs text-gray-500 font-bold mt-1">{p.questions.length} คำถาม · ~{p.wordCount} คำ</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ---- ทำบทอ่าน ---- */}
            {readingView === 'PLAY' && activePassage && (() => {
              const q = activePassage.questions[rIndex];
              return (
                <div>
                  {!activePassage.verified && (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 mb-3 text-[11px] font-bold text-amber-700 text-center">
                      ⚠ บทนี้ยังไม่ได้ตรวจ (โหมดครู) — คะแนนจะไม่ถูกบันทึก
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
                      {glossWord && vocabByWord[glossWord.toLowerCase()] && (
                        <div className="mt-2 bg-[#003399]/5 border border-[#003399]/15 rounded-xl p-3 text-sm">
                          <span className="font-black text-[#003399]">{glossWord}</span>
                          <span className="text-gray-700"> — {vocabByWord[glossWord.toLowerCase()].thai_meaning}</span>
                          <div className="text-xs text-gray-500 mt-0.5 italic">{vocabByWord[glossWord.toLowerCase()].eng_definition}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* คำถาม */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black bg-[#FFD700] text-[#003399] px-2 py-0.5 rounded-full">{RQTYPE_LABELS[q.type]}</span>
                    <span className="text-xs font-bold text-gray-400">ข้อ {rIndex + 1} / {activePassage.questions.length}</span>
                  </div>
                  <p className="font-black text-gray-900 text-[15px] mb-3 leading-snug">{q.question}</p>

                  <div className="space-y-2">
                    {q.choices.map((c, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      let cls = 'bg-white border-gray-200 text-gray-700 hover:border-[#003399]/40';
                      if (rAnswered) {
                        if (idx === q.answerIndex) cls = 'bg-green-50 border-green-400 text-green-800';
                        else if (idx === rSelected) cls = 'bg-rose-50 border-rose-400 text-rose-700';
                        else cls = 'bg-white border-gray-100 text-gray-400';
                      }
                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={rAnswered}
                          onClick={() => answerReading(idx)}
                          className={`w-full text-left p-3 rounded-xl border-2 font-bold text-[14px] transition-all flex gap-2 ${cls}`}
                        >
                          <span className="font-black">{letter}.</span>
                          <span className="flex-1">{c}</span>
                          {rAnswered && idx === q.answerIndex && <span>✓</span>}
                          {rAnswered && idx === rSelected && idx !== q.answerIndex && <span>✗</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* เฉลย + คำอธิบาย */}
                  {rAnswered && (
                    <div className="mt-3 bg-[#003399]/5 border border-[#003399]/15 rounded-2xl p-4 animate-fadeIn">
                      <div className="text-xs font-black text-[#003399] uppercase tracking-wide mb-1">💡 คำอธิบาย</div>
                      <p className="text-[14px] text-gray-700 leading-relaxed">{q.explanation_th}</p>
                    </div>
                  )}

                  {rAnswered && (
                    <button
                      type="button"
                      onClick={nextReadingQuestion}
                      className="w-full mt-4 py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:bg-[#002266] active:scale-[0.98] transition-all uppercase tracking-widest"
                    >
                      {rIndex + 1 >= activePassage.questions.length ? 'ดูผลสรุป' : 'ข้อถัดไป →'}
                    </button>
                  )}
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
                            <p className="text-[12px] text-gray-500 mt-1">คุณตอบ: {String.fromCharCode(65 + r.selected)} · เฉลย: {String.fromCharCode(65 + q.answerIndex)}</p>
                          )}
                          <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">{q.explanation_th}</p>
                        </div>
                      );
                    })}
                  </div>

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

              {/* ── เลือกแนวข้อสอบ: ผสม หรือ เจาะพาร์ทเดียว ── */}
              <div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 text-center">เลือกแนวข้อสอบ</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: null, label: 'ผสม', sub: 'แนะนำ' },
                    { key: 'SYNONYM', label: 'Synonym', sub: 'คำเหมือน' },
                    { key: 'ANTONYM', label: 'Antonym', sub: 'คำตรงข้าม' },
                    { key: 'SENTENCE', label: 'Context', sub: 'เดาจากบริบท' },
                    { key: 'MEANING', label: 'Eng→Thai', sub: 'เลือกความหมาย' },
                    { key: 'TYPE', label: 'Thai→Eng', sub: 'พิมพ์คำ' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setFocusType(opt.key)}
                      className={`py-2 rounded-xl border-2 text-center transition-all ${
                        focusType === opt.key
                          ? 'bg-[#003399] border-[#003399] text-[#FFD700] shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-[#003399]/40'
                      }`}
                    >
                      <div className="text-[13px] font-black">{opt.label}</div>
                      <div className="text-[9px] font-bold opacity-70">{opt.sub}</div>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-gray-400 text-center mt-2">
                  {focusType
                    ? 'ฝึกเจาะแนวนี้ล้วน 10 ข้อ — เหมาะกับการซ้อมจุดอ่อน'
                    : 'คละทุกแนวใน 1 ชุด — จำได้แม่นและใกล้เคียงข้อสอบจริงที่สุด'}
                </div>
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
