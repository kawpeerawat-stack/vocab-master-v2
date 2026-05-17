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
  const QUIZ_TIME_LIMIT = 30; 
  const [timeLeft, setTimeLeft] = useState(QUIZ_TIME_LIMIT);
  
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✨ ตัวแปรเก็บจำนวนครั้งที่แอบออกนอกหน้าจอ
  const [cheatWarnings, setCheatWarnings] = useState(0);

  const TOTAL_QUESTIONS_PER_ROUND = 10; 
  
  // 🔗 ใส่ URL ของ Google Apps Script Web App ที่นี่
  const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwMmvxMfZZkIFsgeNndqMr7AmQVNADqR0SjywuccdiINPWgK4HafiJZoqmKTssEsCTGuA/exec";

  useEffect(() => {
    fetch('/vocab.json')
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

  // ✨ ระบบ Anti-Cheat: ตรวจจับการสลับแท็บ (Tab Switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && gameState === 'QUIZ') {
        alert("⚠️ คำเตือน! ตรวจพบการออกนอกหน้าจอข้อสอบ กรุณาอย่าสลับหน้าต่างขณะทำข้อสอบครับ");
        setCheatWarnings(prev => prev + 1);
      }
    };

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
    setCheatWarnings(0); // รีเซ็ตการแจ้งเตือนเมื่อเริ่มใหม่
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
        headers: {
          'Content-Type': 'application/json',
        },
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
    // ✨ ป้องกันการคลุมดำ (select-none)
    <div 
      className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans text-gray-800 select-none"
      onContextMenu={(e) => e.preventDefault()} // ✨ บล็อกการคลิกขวา
    >
      <div className="w-full max-w-2xl bg-white shadow-xl rounded-2xl p-6 md:p-8 border border-gray-100">
        
        {gameState === 'START' && !isLoggedIn && (
          <form onSubmit={handleStudentLogin} className="text-center animate-fadeIn">
            <h1 className="text-3xl font-extrabold text-blue-600 mb-2">Vocab Master 2.0</h1>
            <p className="text-gray-500 mb-6 text-sm md:text-base">Please enter your information to access the dashboard</p>
            
            <div className="text-left space-y-4 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">ชื่อ - นามสกุล / เลขที่</label>
                <input
                  type="text"
                  placeholder="ตัวอย่าง: นายสมชาย รักเรียน เลขที่ 1"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">ระบุ Gmail ของนักเรียน</label>
                <input
                  type="email"
                  placeholder="ตัวอย่าง: student.name@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isVocabLoading || !studentName.trim() || !email.trim() || !email.includes('@')}
              className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition duration-200 text-lg"
            >
              {isVocabLoading ? "⏳ Loading Vocabulary..." : "Login to Dashboard"}
            </button>
          </form>
        )}

        {gameState === 'START' && isLoggedIn && (
          <div className="text-center animate-fadeIn">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl font-bold border border-blue-100">
              🎓
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-1">Student Dashboard</h1>
            <p className="text-gray-500 text-sm mb-5">Track your holistic language progress</p>
            
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-left mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Holistic Vocab Mastery</span>
                <span className="text-sm font-extrabold text-blue-600">{overallPercentage}%</span>
              </div>
              
              <div className="w-full bg-gray-200 h-3 rounded-full mb-2 overflow-hidden border border-gray-300/30">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full transition-all duration-500 ease-out"
                  style={{ width: `${overallPercentage}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 font-medium">
                You have mastered <span className="text-gray-800 font-bold">{masteredWords.length}</span> out of <span className="text-gray-800 font-bold">{vocabData.length}</span> words in total.
              </div>
            </div>

            <div className="bg-blue-50/40 border border-blue-100 rounded-xl p-3 text-left mb-6 text-sm text-gray-700">
              👤 <strong>Account:</strong> {studentName} ({email})
            </div>

            <div className="space-y-3">
              <button
                onClick={startNewQuizRound}
                className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 transition duration-150 text-lg flex items-center justify-center gap-2"
              >
                🚀 Start New Training Round
              </button>
              
              <button
                onClick={handleLogout}
                className="w-full py-2.5 bg-white text-gray-500 font-medium rounded-xl hover:bg-gray-50 border border-gray-200 transition duration-150 text-sm"
              >
                🔄 Switch Account
              </button>
            </div>
          </div>
        )}

        {gameState === 'QUIZ' && currentQuestions.length > 0 && (
          <div className="animate-fadeIn">
            <div className="flex justify-between items-center mb-2 pb-2">
              <span className="text-sm font-bold px-3 py-1 bg-gray-100 rounded-full text-gray-600">
                Question {currentIndex + 1} / {currentQuestions.length}
              </span>
              <span className={`text-base font-extrabold px-4 py-1 rounded-full ${timeLeft <= 5 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-blue-50 text-blue-600'}`}>
                ⏱️ {timeLeft} s
              </span>
            </div>

            <div className="w-full bg-gray-100 h-2.5 rounded-full mb-4 overflow-hidden border border-gray-200/50">
              <div 
                className="bg-gradient-to-r from-blue-500 to-blue-600 h-full transition-all duration-300 ease-out"
                style={{ width: `${((currentIndex + 1) / currentQuestions.length) * 100}%` }}
              ></div>
            </div>

            <div className="flex gap-2 mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                currentQuestions[currentIndex].level === 'C1' ? 'bg-purple-100 text-purple-700' :
                currentQuestions[currentIndex].level === 'B2' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              }`}>
                Level: {currentQuestions[currentIndex].level}
              </span>
              
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">
                Type: {currentQuestions[currentIndex].questionType}
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold mb-2 text-gray-900 leading-snug">
              {currentQuestions[currentIndex].questionType === 'SENTENCE' && (
                currentQuestions[currentIndex].example_sentence
              )}
              {currentQuestions[currentIndex].questionType === 'SYNONYM' && (
                <span>Which word is a <span className="text-blue-600 underline">SYNONYM</span> for: "{currentQuestions[currentIndex].synonym}"?</span>
              )}
              {currentQuestions[currentIndex].questionType === 'ANTONYM' && (
                <span>Which word is an <span className="text-red-600 underline">ANTONYM</span> for: "{currentQuestions[currentIndex].antonym}"?</span>
              )}
            </h2>
            
            <p className="text-sm text-gray-500 italic mb-6">
              Definition: {currentQuestions[currentIndex].eng_definition}
            </p>

            <div className="grid grid-cols-1 gap-3">
              {options.map((option, idx) => {
                const isCorrectChoice = option === currentQuestions[currentIndex].word;
                let btnStyle = "border-gray-200 hover:border-blue-500 hover:bg-blue-50 text-gray-800";

                if (isAnswered) {
                  if (isCorrectChoice) {
                    btnStyle = "bg-green-500 text-white border-green-500 font-bold";
                  } else if (selectedAnswer === option) {
                    btnStyle = "bg-red-500 text-white border-red-500";
                  } else {
                    btnStyle = "bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed";
                  }
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswerSelection(option)}
                    disabled={isAnswered}
                    className={`w-full p-4 border rounded-xl text-left text-base md:text-lg transition-all duration-150 flex items-center justify-between ${btnStyle}`}
                  >
                    <span className="font-medium">{option}</span>
                  </button>
                );
              })}
            </div>

            {isAnswered && (
              <button
                onClick={handleNextQuestion}
                className="w-full mt-6 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition duration-150 text-center text-lg"
              >
                {currentIndex + 1 === currentQuestions.length ? "View Summary" : "Next Question ➡️"}
              </button>
            )}
          </div>
        )}

        {gameState === 'END' && (
          <div className="text-center animate-fadeIn">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🎉</span>
            </div>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-1">Round Completed!</h2>
            <p className="text-gray-600 font-medium mb-4">{studentName}</p>
            
            {/* ✨ แสดงจำนวนครั้งที่แอบออกนอกหน้าจอ (ถ้ามี) */}
            {cheatWarnings > 0 && (
              <div className="bg-red-100 text-red-700 p-3 rounded-lg text-sm font-bold mb-4 border border-red-200">
                ⚠️ Warning: Switched tabs {cheatWarnings} times during quiz.
              </div>
            )}
            
            <div className="bg-gray-50 rounded-2xl p-6 border mb-6">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Your Round Score</div>
              <div className="text-5xl font-black text-blue-600 mb-2">
                {score} <span className="text-2xl text-gray-400">/ {currentQuestions.length}</span>
              </div>
              <div className="text-sm text-gray-500">
                Round Accuracy: {((score / currentQuestions.length) * 100).toFixed(0)}%
              </div>
            </div>

            <div className="text-left border-t border-gray-200 pt-6 mb-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                📝 Review Mistakes <span className="text-sm font-normal text-gray-500">(เฉลยข้อที่ผิด)</span>
              </h3>
              
              {wrongAnswers.length > 0 ? (
                <div className="space-y-4 max-h-80 overflow-y-auto pr-2 rounded-xl">
                  {wrongAnswers.map((item, idx) => (
                    <div key={idx} className="bg-red-50/50 border border-red-100 rounded-xl p-4">
                      <div className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700 uppercase inline-block mb-2">
                        {item.question.questionType}
                      </div>
                      <h4 className="text-gray-900 font-bold mb-2 leading-snug">
                        {item.question.questionType === 'SENTENCE' && item.question.example_sentence}
                        {item.question.questionType === 'SYNONYM' && `Which word is a SYNONYM for: "${item.question.synonym}"?`}
                        {item.question.questionType === 'ANTONYM' && `Which word is an ANTONYM for: "${item.question.antonym}"?`}
                      </h4>
                      <div className="text-sm space-y-1.5 mt-3">
                        <p className="text-red-500 line-through">❌ Your Answer: {item.selected === "Time Out" ? "Time Out (หมดเวลา)" : item.selected}</p>
                        <p className="text-green-600 font-bold">✅ Correct Answer: {item.question.word}</p>
                        <p className="text-gray-600 text-xs mt-2 bg-white p-2 rounded border border-gray-100">
                          <span className="font-semibold text-gray-700">Definition:</span> {item.question.eng_definition}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-green-700 font-bold text-center">
                  🌟 Perfect Score! You made no mistakes.
                </div>
              )}
            </div>

            {isSubmitting ? (
              <p className="text-orange-600 font-semibold animate-pulse mb-6">⏳ Saving round score to cloud...</p>
            ) : (
              <p className="text-green-600 font-semibold mb-6">✅ Score saved successfully.</p>
            )}

            <button
              onClick={() => setGameState('START')}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition duration-150 text-lg shadow-md"
            >
              Back to Dashboard ⬅️
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
