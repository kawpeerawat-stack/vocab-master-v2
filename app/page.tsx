"use client";

import React, { useState, useEffect } from 'react';

type WordItem = {
  word: string;
  thai_meaning: string;
  eng_definition: string;
  synonym: string;
  antonym: string;
  example_sentence: string;
  level: string;
};

type QuizQuestion = WordItem & {
  questionType: 'SENTENCE' | 'SYNONYM' | 'ANTONYM';
};

export default function Home() {
  const [gameState, setGameState] = useState<'START' | 'QUIZ' | 'END'>('START');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');
  
  const [masteredWords, setMasteredWords] = useState<string[]>([]);
  const [vocabData, setVocabData] = useState<WordItem[]>([]);
  const [currentQuestions, setCurrentQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  
  const [wrongAnswers, setWrongAnswers] = useState<{question: QuizQuestion, selected: string}[]>([]);
  
  const [score, setScore] = useState(0);
  const QUIZ_TIME_LIMIT = 20; // ปรับเวลาเป็น 20 วินาทีตามที่อาจารย์ต้องการ
  const [timeLeft, setTimeLeft] = useState(QUIZ_TIME_LIMIT);
  
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [cheatWarnings, setCheatWarnings] = useState(0);

  const TOTAL_QUESTIONS_PER_ROUND = 10; 
  
  // 🔗 ใส่ URL ของ Google Apps Script Web App ของอาจารย์ที่นี่
  const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwMmvxMfZZkIFsgeNndqMr7AmQVNADqR0SjywuccdiINPWgK4HafiJZoqmKTssEsCTGuA/exec";

  // โลโก้โรงเรียนอนุกูลนารี
  const SCHOOL_LOGO_URL = "/logo.png";

  useEffect(() => {
    fetch('/api/vocab')
      .then((res) => {
        if (!res.ok) throw new Error("หาไฟล์ vocab.json ไม่เจอ");
        return res.json();
      })
      .then((data) => setVocabData(data))
      .catch((err) => console.error("Error loading vocab.json:", err));

    const savedMastered = localStorage.getItem('vocab_mastered_progress');
    if (savedMastered) {
      try {
        setMasteredWords(JSON.parse(savedMastered));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && gameState === 'QUIZ') {
        alert("⚠️ Warning! ตรวจพบการออกนอกหน้าจอข้อสอบ กรุณาทำข้อสอบให้เสร็จก่อนสลับหน้าต่างครับ");
        setCheatWarnings(prev => prev + 1);
     const blockDevTools = (e: KeyboardEvent) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (e.ctrlKey && e.shiftKey && e.key === 'J') ||
      (e.ctrlKey && e.key === 'u')
    ) {
      e.preventDefault()
    }
  }
  document.addEventListener('keydown', blockDevTools)
  return () => document.removeEventListener('keydown', blockDevTools)
}, [])
   

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'QUIZ' || isAnswered) return;
    if (timeLeft === 0) {
      handleAnswerSelection("Time Out"); 
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, gameState, isAnswered]);

  const handleStudentLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (studentName.trim() && email.trim() && email.includes('@')) {
      setIsLoggedIn(true);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setStudentName('');
    setEmail('');
    setGameState('START');
  };

  const startNewQuizRound = () => {
    if (vocabData.length === 0) {
      alert("⚠️ ระบบยังโหลดคลังคำศัพท์ไม่สำเร็จ กรุณาตรวจสอบไฟล์ vocab.json ในโฟลเดอร์ public");
      return;
    }

    const unmasteredWords = vocabData.filter(w => !masteredWords.includes(w.word));
    const poolToUse = unmasteredWords.length >= 10 ? unmasteredWords : vocabData;

    const b1Words = poolToUse.filter(w => w.level === 'B1');
    const b2Words = poolToUse.filter(w => w.level === 'B2');
    const c1Words = poolToUse.filter(w => w.level === 'C1');

    const shuffleAndPick = (array: WordItem[], count: number) => {
      const shuffled = [...array].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, count);
    };

    let selectedRoundWords = [
      ...shuffleAndPick(b1Words.length > 0 ? b1Words : poolToUse, 4),
      ...shuffleAndPick(b2Words.length > 0 ? b2Words : poolToUse, 4),
      ...shuffleAndPick(c1Words.length > 0 ? c1Words : poolToUse, 2)
    ];

    if (selectedRoundWords.length < 10) {
       const pickedWords = selectedRoundWords.map(w => w.word);
       const leftovers = poolToUse.filter(w => !pickedWords.includes(w.word));
       selectedRoundWords = [...selectedRoundWords, ...shuffleAndPick(leftovers, 10 - selectedRoundWords.length)];
    }

    const formattedQuestions: QuizQuestion[] = selectedRoundWords.map(item => {
      const availableTypes: ('SENTENCE' | 'SYNONYM' | 'ANTONYM')[] = ['SENTENCE'];
      if (item.synonym && item.synonym !== "-" && item.synonym.trim() !== "") availableTypes.push('SYNONYM');
      if (item.antonym && item.antonym !== "-" && item.antonym.trim() !== "") availableTypes.push('ANTONYM');
      
      const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      return { ...item, questionType: randomType };
    });

    setCurrentQuestions(formattedQuestions);
    setCurrentIndex(0);
    setScore(0);
    setCheatWarnings(0); 
    setWrongAnswers([]); 
    generateOptionsForQuestion(formattedQuestions[0], vocabData);
    resetTimerAndQuestionState();
    setGameState('QUIZ');
  };

  const generateOptionsForQuestion = (correctItem: WordItem, allItems: WordItem[]) => {
    let wrongOptionsPool = allItems.filter(item => item.word !== correctItem.word && item.level === correctItem.level);
    if (wrongOptionsPool.length < 3) {
      wrongOptionsPool = allItems.filter(item => item.word !== correctItem.word);
    }
    const shuffledWrong = wrongOptionsPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    const finalChoices = [correctItem.word, ...shuffledWrong.map(item => item.word)];
    setOptions(finalChoices.sort(() => 0.5 - Math.random()));
  };

  const resetTimerAndQuestionState = () => {
    setTimeLeft(QUIZ_TIME_LIMIT);
    setSelectedAnswer(null);
    setIsAnswered(false);
  };

  const handleAnswerSelection = (answer: string) => {
    if (isAnswered) return;
    setSelectedAnswer(answer);
    setIsAnswered(true);

    const currentQ = currentQuestions[currentIndex];
    const correctWord = currentQ.word;
    
    if (answer === correctWord) {
      setScore((prev) => prev + 1);
      setMasteredWords((prev) => {
        if (!prev.includes(correctWord)) {
          const updated = [...prev, correctWord];
          localStorage.setItem('vocab_mastered_progress', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
    } else {
      setWrongAnswers((prev) => [...prev, { question: currentQ, selected: answer }]);
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
    const progressPercentage = ((score / TOTAL_QUESTIONS_PER_ROUND) * 100).toFixed(0) + "%";

    try {
      await fetch(GOOGLE_SHEET_WEBAPP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: studentName,
          email: email, 
          score: score,
          progress: progressPercentage
        }),
      });
    } catch (error) {
      console.error("Error submitting score:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isVocabLoading = vocabData.length === 0;
  const overallPercentage = vocabData.length > 0 
    ? ((masteredWords.length / vocabData.length) * 100).toFixed(1) 
    : "0.0";

  return (
    <div 
      className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center p-4 font-sans text-gray-800 select-none"
      onContextMenu={(e) => e.preventDefault()} 
    >
      <div className="w-full max-w-2xl bg-white shadow-2xl rounded-3xl p-6 md:p-10 border-t-[12px] border-[#003399] relative overflow-hidden">
        
        {/* สีทองตัดขอบบนตามธีมโรงเรียน */}
        <div className="absolute top-0 left-0 w-full h-2 bg-[#FFD700]"></div>

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

        {gameState === 'START' && isLoggedIn && (
          <div className="text-center animate-fadeIn mt-2">
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
                <span>Mastered: <span className="text-[#003399]">{masteredWords.length}</span></span>
                <span>Total: <span className="text-[#003399]">{vocabData.length} Words</span></span>
              </div>
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
              <button
                onClick={startNewQuizRound}
                className="w-full py-5 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-xl uppercase tracking-widest flex items-center justify-center gap-3"
              >
                🚀 Start Training Round
              </button>
              
              <button
                onClick={handleLogout}
                className="w-full py-3 bg-white text-gray-400 font-bold rounded-xl hover:text-[#003399] transition-all duration-150 text-sm uppercase"
              >
                🔄 Switch Student Account
              </button>
            </div>
          </div>
        )}

        {gameState === 'QUIZ' && currentQuestions.length > 0 && (
          <div className="animate-fadeIn">
            <div className="flex justify-between items-center mb-3 pb-3 border-b-2 border-gray-50">
              <span className="text-sm font-black px-4 py-2 bg-[#003399] rounded-xl text-[#FFD700] shadow-sm">
                Q {currentIndex + 1} / {currentQuestions.length}
              </span>
              <span className={`text-base font-black px-5 py-2 rounded-xl border-2 ${timeLeft <= 5 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-blue-50 text-[#003399] border-[#003399]/20'}`}>
                ⏱️ {timeLeft} s
              </span>
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
                currentQuestions[currentIndex].level === 'B2' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                LEVEL: {currentQuestions[currentIndex].level}
              </span>
              <span className="text-[10px] font-black px-3 py-1 rounded-lg bg-[#FFD700]/20 text-[#003399] border border-[#FFD700]/30 uppercase shadow-sm">
                TYPE: {currentQuestions[currentIndex].questionType}
              </span>
            </div>

            <div className="bg-[#fcfcfc] rounded-3xl p-6 border-2 border-gray-50 mb-6 shadow-sm min-h-[140px] flex flex-col justify-center">
              <h2 className="text-xl md:text-2xl font-black mb-4 text-gray-900 leading-relaxed text-center">
                {currentQuestions[currentIndex].questionType === 'SENTENCE' && (
                  currentQuestions[currentIndex].example_sentence
                )}
                {currentQuestions[currentIndex].questionType === 'SYNONYM' && (
                  <span>Select the <span className="text-[#003399] underline decoration-[#FFD700] decoration-4">SYNONYM</span> for: <br/>"{currentQuestions[currentIndex].synonym}"</span>
                )}
                {currentQuestions[currentIndex].questionType === 'ANTONYM' && (
                  <span>Select the <span className="text-red-600 underline decoration-[#FFD700] decoration-4">ANTONYM</span> for: <br/>"{currentQuestions[currentIndex].antonym}"</span>
                )}
              </h2>
              <div className="h-0.5 w-12 bg-[#FFD700] mx-auto mb-3"></div>
              <p className="text-xs text-gray-400 italic text-center font-medium">
                {currentQuestions[currentIndex].eng_definition}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {options.map((option, idx) => {
                const isCorrectChoice = option === currentQuestions[currentIndex].word;
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

        {gameState === 'END' && (
          <div className="text-center animate-fadeIn">
            <div className="w-24 h-24 bg-[#FFD700]/20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
              <img src={SCHOOL_LOGO_URL} alt="Logo" className="w-16 h-16 object-contain" />
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-2">Round Finished!</h2>
            <p className="text-[#003399] font-black mb-6 bg-[#003399]/5 py-2 px-6 rounded-full inline-block">{studentName}</p>
            
            {cheatWarnings > 0 && (
              <div className="bg-red-50 text-red-700 p-4 rounded-2xl text-sm font-black mb-6 border-2 border-red-100 animate-bounce">
                ⚠️ SECURITY ALERT: Switched tabs {cheatWarnings} times.
              </div>
            )}
            
            <div className="bg-[#003399] rounded-[2.5rem] p-8 mb-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16"></div>
              <div className="text-xs font-black text-[#FFD700]/80 uppercase tracking-[0.3em] mb-2">Final Score</div>
              <div className="text-7xl font-black text-white mb-2 drop-shadow-lg">
                {score}<span className="text-2xl text-[#FFD700]/60">/10</span>
              </div>
              <div className="text-sm text-[#FFD700] font-black bg-white/10 py-2 px-6 rounded-full inline-block backdrop-blur-sm">
                ACCURACY: {((score / 10) * 100).toFixed(0)}%
              </div>
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
                      </h4>
                      <div className="text-sm space-y-2 mt-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        <p className="text-red-500 font-bold">❌ Your Pick: <span className="line-through">{item.selected === "Time Out" ? "Time Out" : item.selected}</span></p>
                        <p className="text-green-600 font-black">✅ Correct: {item.question.word}</p>
                        <div className="pt-2 mt-2 border-t border-gray-200">
                          <p className="text-gray-500 text-[11px] leading-relaxed">
                            <span className="font-bold text-gray-700">MEANING:</span> {item.question.thai_meaning}
                          </p>
                        </div>
                      </div>
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
