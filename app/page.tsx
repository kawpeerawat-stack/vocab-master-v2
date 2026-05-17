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

export default function Home() {
  // สเตตัสการควบคุมหน้าจอ: 'START' | 'QUIZ' | 'END'
  const [gameState, setGameState] = useState<'START' | 'QUIZ' | 'END'>('START');
  
  // 🔑 ระบบจำสถานะการเข้าสู่ระบบ (ล็อกอินครั้งเดียว)
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // ข้อมูลฟอร์มลงทะเบียนนักเรียน
  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');
  
  // ข้อมูลคลังคำศัพท์และคำถาม
  const [vocabData, setVocabData] = useState<WordItem[]>([]);
  const [currentQuestions, setCurrentQuestions] = useState<WordItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  
  // สเตตัสการเล่นและการจับเวลา
  const [score, setScore] = useState(0);
  
  // ⏱️ ตั้งค่าเวลาทำข้อสอบ (30 วินาที)
  const QUIZ_TIME_LIMIT = 30; 
  const [timeLeft, setTimeLeft] = useState(QUIZ_TIME_LIMIT);
  
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const TOTAL_QUESTIONS_PER_ROUND = 10; 
  
  // 🔗 ใส่ URL ของ Google Apps Script Web App ที่นี่
  const GOOGLE_SHEET_WEBAPP_URL = "URL_GOOGLE_APPS_SCRIPT_ของคุณครู";

  useEffect(() => {
    fetch('/vocab.json')
      .then((res) => {
        if (!res.ok) throw new Error("หาไฟล์ vocab.json ไม่เจอ");
        return res.json();
      })
      .then((data) => setVocabData(data))
      .catch((err) => console.error("Error loading vocab.json:", err));
  }, []);

  useEffect(() => {
    if (gameState !== 'QUIZ' || isAnswered) return;
    if (timeLeft === 0) {
      handleAnswerSelection(""); 
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, gameState, isAnswered]);

  // ฟังก์ชันล็อกอินก้าวเข้าสู่หน้า Dashboard
  const handleStudentLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (studentName.trim() && email.trim() && email.includes('@')) {
      setIsLoggedIn(true);
    }
  };

  // ฟังก์ชันออกจากระบบเพื่อเปลี่ยนบัญชีนักเรียน
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

    const b1Words = vocabData.filter(w => w.level === 'B1');
    const b2Words = vocabData.filter(w => w.level === 'B2');
    const c1Words = vocabData.filter(w => w.level === 'C1');

    const shuffleAndPick = (array: WordItem[], count: number) => {
      const shuffled = [...array].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, count);
    };

    const selectedRoundWords = [
      ...shuffleAndPick(b1Words.length > 0 ? b1Words : vocabData, 4),
      ...shuffleAndPick(b2Words.length > 0 ? b2Words : vocabData, 4),
      ...shuffleAndPick(c1Words.length > 0 ? c1Words : vocabData, 2)
    ];

    setCurrentQuestions(selectedRoundWords);
    setCurrentIndex(0);
    setScore(0);
    generateOptionsForQuestion(selectedRoundWords[0], vocabData);
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
    if (answer === currentQuestions[currentIndex].word) {
      setScore((prev) => prev + 1);
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans text-gray-800">
      <div className="w-full max-w-xl bg-white shadow-xl rounded-2xl p-6 md:p-8 border border-gray-100">
        
        {/* 1. หน้าแรก (กรณีที่ยังไม่ได้ Log In เข้าสู่ระบบ) */}
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

        {/* 2. หน้า Dashboard ส่วนตัว (เมื่อล็อกอินแล้ว และสแตนด์บายรอเริ่มเล่นใหม่) */}
        {gameState === 'START' && isLoggedIn && (
          <div className="text-center animate-fadeIn">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl font-bold border border-blue-100">
              👤
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-1">Student Dashboard</h1>
            <p className="text-gray-500 text-sm mb-4">Welcome back to the training session</p>
            
            {/* กล่องแสดงโปรไฟล์ผู้เข้าสอบปัจจุบัน */}
            <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 text-left mb-6 space-y-1">
              <div className="text-xs font-bold text-blue-500 uppercase tracking-wider">Current Account</div>
              <div className="text-base font-bold text-gray-800">Name: {studentName}</div>
              <div className="text-sm text-gray-600">Email: {email}</div>
            </div>

            <div className="space-y-3">
              <button
                onClick={startNewQuizRound}
                className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 transition duration-150 text-lg flex items-center justify-center gap-2"
              >
                🚀 Start New Quiz Round
              </button>
              
              <button
                onClick={handleLogout}
                className="w-full py-2.5 bg-white text-gray-500 font-medium rounded-xl hover:bg-gray-50 border border-gray-200 transition duration-150 text-sm"
              >
                🔄 Switch Account (สลับบัญชี)
              </button>
            </div>
          </div>
        )}

        {/* 3. หน้าจอทำข้อสอบพร้อมระบบนับถอยหลังและ Progress Bar */}
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

            {/* 📊 แถบความก้าวหน้า (Progress Bar) */}
            <div className="w-full bg-gray-100 h-2.5 rounded-full mb-4 overflow-hidden border border-gray-200/50">
              <div 
                className="bg-gradient-to-r from-blue-500 to-blue-600 h-full transition-all duration-300 ease-out"
                style={{ width: `${((currentIndex + 1) / currentQuestions.length) * 100}%` }}
              ></div>
            </div>

            <div className="mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                currentQuestions[currentIndex].level === 'C1' ? 'bg-purple-100 text-purple-700' :
                currentQuestions[currentIndex].level === 'B2' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              }`}>
                Level: {currentQuestions[currentIndex].level}
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold mb-2 text-gray-900">
              {currentQuestions[currentIndex].example_sentence}
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

        {/* 4. หน้าสรุปคะแนนหลังทำข้อสอบเสร็จ */}
        {gameState === 'END' && (
          <div className="text-center animate-fadeIn">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🎉</span>
            </div>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-1">Completed!</h2>
            <p className="text-gray-600 font-medium mb-4">{studentName}</p>
            
            <div className="bg-gray-50 rounded-2xl p-6 border mb-6">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Your Score</div>
              <div className="text-5xl font-black text-blue-600 mb-2">
                {score} <span className="text-2xl text-gray-400">/ {currentQuestions.length}</span>
              </div>
              <div className="text-sm text-gray-500">
                Progress Rate: {((score / currentQuestions.length) * 100).toFixed(0)}%
              </div>
            </div>

            {isSubmitting ? (
              <p className="text-orange-600 font-semibold animate-pulse mb-6">⏳ Saving your progress to cloud...</p>
            ) : (
              <p className="text-green-600 font-semibold mb-6">✅ Score saved successfully.</p>
            )}

            {/* ✨ สังเกตตรงนี้: เมื่อกดปุ่มนี้ จะพากลับหน้าจอ Dashboard ทันทีโดยไม่ต้องล็อกอินใหม่ */}
            <button
              onClick={() => setGameState('START')}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition duration-150 text-lg shadow-md"
            >
              Back to Dashboard
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
