"use client";

import React, { useState, useEffect } from 'react';

// โครงสร้างข้อมูล Grammar ที่ปรับให้เข้ากับฐานข้อมูลใหม่
type GrammarItem = {
  id: string;
  exam_type: string;
  grammar_topic: string;
  question_format: string;
  question: string;
  options: string[];
  correct_answer: string;
  trap_explanation: string;
};

export default function Home() {
  // สเตตัสการควบคุมหน้าจอ: 'START' | 'DASHBOARD' | 'QUIZ' | 'END'
  const [gameState, setGameState] = useState<'START' | 'DASHBOARD' | 'QUIZ' | 'END'>('START');
  
  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');
  
  const [grammarData, setGrammarData] = useState<GrammarItem[]>([]);
  const [currentQuestions, setCurrentQuestions] = useState<GrammarItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const [selectedTopic, setSelectedTopic] = useState<string>('Mix');
  const [wrongAnswers, setWrongAnswers] = useState<{question: GrammarItem, selected: string}[]>([]);
  
  const [score, setScore] = useState(0);
  const QUIZ_TIME_LIMIT = 30; 
  const [timeLeft, setTimeLeft] = useState(QUIZ_TIME_LIMIT);
  
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cheatWarnings, setCheatWarnings] = useState(0);

  const TOTAL_QUESTIONS_PER_ROUND = 10; 
  
  // 🔗 ใส่ URL ของ Google Apps Script (ไฟล์ใหม่สำหรับ Grammar) ที่นี่
  const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxicdDloyqLpks5v2zu_Lg4bm-v5zjgD1gdZmJCAxOvpqbweyosvfwQSNFlRb7ImKSaGw/exec";

  useEffect(() => {
    fetch('/grammar.json')
      .then((res) => {
        if (!res.ok) throw new Error("หาไฟล์ grammar.json ไม่เจอ");
        return res.json();
      })
      .then((data) => setGrammarData(data))
      .catch((err) => console.error("Error loading grammar.json:", err));
  }, []);

  // ระบบ Anti-Cheat จับตาการสลับแท็บ
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && gameState === 'QUIZ') {
        alert("⚠️ คำเตือน! ตรวจพบการออกนอกหน้าจอข้อสอบ กรุณาอย่าสลับหน้าต่างขณะทำข้อสอบครับ");
        setCheatWarnings(prev => prev + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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
      setGameState('DASHBOARD');
    }
  };

  const handleLogout = () => {
    setStudentName('');
    setEmail('');
    setGameState('START');
  };

  // ฟังก์ชันเริ่มทำข้อสอบโดยกรองตามหมวดหมู่ที่เลือก
  const startNewQuizRound = (topic: string) => {
    if (grammarData.length === 0) {
      alert("⚠️ ระบบยังโหลดคลังข้อสอบไม่สำเร็จ กรุณาตรวจสอบไฟล์ grammar.json ในโฟลเดอร์ public");
      return;
    }

    let poolToUse = grammarData;
    if (topic !== 'Mix') {
      poolToUse = grammarData.filter(q => q.grammar_topic === topic);
    }

    if (poolToUse.length === 0) {
      alert(`ยังไม่มีข้อสอบในหมวด ${topic} ครับ ระบบจะสุ่มหมวดหมู่รวมให้แทน`);
      poolToUse = grammarData;
    }

    const shuffled = [...poolToUse].sort(() => 0.5 - Math.random());
    const selectedRoundQuestions = shuffled.slice(0, Math.min(TOTAL_QUESTIONS_PER_ROUND, shuffled.length));

    // สุ่มสลับตำแหน่งตัวเลือก (Options) ในแต่ละข้อ
    const questionsWithOptionsShuffled = selectedRoundQuestions.map(q => ({
      ...q,
      options: [...q.options].sort(() => 0.5 - Math.random())
    }));

    setSelectedTopic(topic);
    setCurrentQuestions(questionsWithOptionsShuffled);
    setCurrentIndex(0);
    setScore(0);
    setCheatWarnings(0);
    setWrongAnswers([]); 
    resetTimerAndQuestionState();
    setGameState('QUIZ');
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
    
    if (answer === currentQ.correct_answer) {
      setScore((prev) => prev + 1);
    } else {
      setWrongAnswers((prev) => [...prev, { question: currentQ, selected: answer }]);
    }
  };

  const handleNextQuestion = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < currentQuestions.length) {
      setCurrentIndex(nextIndex);
      resetTimerAndQuestionState();
    } else {
      setGameState('END');
      submitScoreToGoogleSheet();
    }
  };

  const submitScoreToGoogleSheet = async () => {
    setIsSubmitting(true);
    const progressPercentage = ((score / currentQuestions.length) * 100).toFixed(0) + "%";

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
          topic: selectedTopic,
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

  // ดึงรายการ Topic ทั้งหมดที่มีในระบบเพื่อมาสร้างปุ่มในหน้า Dashboard อัตโนมัติ
  const availableTopics = Array.from(new Set(grammarData.map(q => q.grammar_topic)));

  return (
    <div 
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans text-gray-800 select-none"
      onContextMenu={(e) => e.preventDefault()} 
    >
      <div className="w-full max-w-2xl bg-white shadow-xl rounded-2xl p-6 md:p-8 border border-gray-100">
        
        {/* 1. หน้าแรกล็อกอิน */}
        {gameState === 'START' && (
          <form onSubmit={handleStudentLogin} className="text-center animate-fadeIn">
            <h1 className="text-3xl font-extrabold text-indigo-600 mb-2">Grammar Master</h1>
            <p className="text-gray-500 mb-6 text-sm md:text-base">Advanced English Grammar & Syntax Analysis</p>
            
            <div className="text-left space-y-4 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">ชื่อ - นามสกุล / เลขที่</label>
                <input
                  type="text"
                  placeholder="ตัวอย่าง: นายสมชาย รักเรียน เลขที่ 1"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={grammarData.length === 0 || !studentName.trim() || !email.trim() || !email.includes('@')}
              className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition duration-200 text-lg"
            >
              {grammarData.length === 0 ? "⏳ Loading Grammar Database..." : "Login to Dashboard"}
            </button>
          </form>
        )}

        {/* 2. หน้า Dashboard เลือกหมวดหมู่ไวยากรณ์ */}
        {gameState === 'DASHBOARD' && (
          <div className="text-center animate-fadeIn">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl font-bold border border-indigo-100">
              🎯
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-1">Select Topic</h1>
            <p className="text-gray-500 text-sm mb-5">Choose a grammar topic to practice</p>
            
            <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-3 text-left mb-6 text-sm text-gray-700 flex justify-between items-center">
              <span>👤 <strong>{studentName}</strong></span>
              <button onClick={handleLogout} className="text-indigo-600 hover:underline text-xs font-bold">Switch Account</button>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => startNewQuizRound('Mix')}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition duration-150 text-lg flex items-center justify-center gap-2"
              >
                🌟 Mixed Topics (จำลองสอบจริง)
              </button>
              
              <div className="pt-2 pb-1 border-b border-gray-100 text-left text-sm font-bold text-gray-400">TARGETED DRILLS</div>
              
              <div className="grid grid-cols-1 gap-2">
                {availableTopics.map(topic => (
                  <button
                    key={topic}
                    onClick={() => startNewQuizRound(topic)}
                    className="w-full py-3 bg-white text-indigo-700 font-bold rounded-xl border border-indigo-200 hover:bg-indigo-50 transition duration-150 text-md text-left px-4 flex justify-between items-center"
                  >
                    <span>📘 {topic}</span>
                    <span className="text-xs font-normal text-indigo-400">Drill</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3. หน้าทำข้อสอบ */}
        {gameState === 'QUIZ' && currentQuestions.length > 0 && (
          <div className="animate-fadeIn">
            <div className="flex justify-between items-center mb-2 pb-2">
              <span className="text-sm font-bold px-3 py-1 bg-gray-100 rounded-full text-gray-600">
                Question {currentIndex + 1} / {currentQuestions.length}
              </span>
              <span className={`text-base font-extrabold px-4 py-1 rounded-full ${timeLeft <= 5 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-indigo-50 text-indigo-600'}`}>
                ⏱️ {timeLeft} s
              </span>
            </div>

            <div className="w-full bg-gray-100 h-2.5 rounded-full mb-4 overflow-hidden border border-gray-200/50">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-purple-600 h-full transition-all duration-300 ease-out"
                style={{ width: `${((currentIndex + 1) / currentQuestions.length) * 100}%` }}
              ></div>
            </div>

            <div className="flex gap-2 mb-4">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase">
                {currentQuestions[currentIndex].grammar_topic}
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                {currentQuestions[currentIndex].exam_type} Style
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold mb-6 text-gray-900 leading-relaxed">
              {currentQuestions[currentIndex].question}
            </h2>

            <div className="grid grid-cols-1 gap-3">
              {currentQuestions[currentIndex].options.map((option, idx) => {
                const isCorrectChoice = option === currentQuestions[currentIndex].correct_answer;
                let btnStyle = "border-gray-200 hover:border-indigo-500 hover:bg-indigo-50 text-gray-800";

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

        {/* 4. หน้าสรุปคะแนน พร้อมเฉลยกลลวง (Trap Explanation) */}
        {gameState === 'END' && (
          <div className="text-center animate-fadeIn">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🎉</span>
            </div>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-1">Round Completed!</h2>
            <p className="text-gray-600 font-medium mb-4">Topic: {selectedTopic}</p>
            
            {cheatWarnings > 0 && (
              <div className="bg-red-100 text-red-700 p-3 rounded-lg text-sm font-bold mb-4 border border-red-200">
                ⚠️ Warning: Switched tabs {cheatWarnings} times during quiz.
              </div>
            )}
            
            <div className="bg-slate-50 rounded-2xl p-6 border mb-6">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Your Score</div>
              <div className="text-5xl font-black text-indigo-600 mb-2">
                {score} <span className="text-2xl text-gray-400">/ {currentQuestions.length}</span>
              </div>
            </div>

            {/* ส่วนแสดงเฉลยข้อที่ผิด พร้อมคำอธิบายจุดหลอก! */}
            <div className="text-left border-t border-gray-200 pt-6 mb-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                📝 Analysis & Feedback <span className="text-sm font-normal text-gray-500">(วิเคราะห์ข้อที่พลาด)</span>
              </h3>
              
              {wrongAnswers.length > 0 ? (
                <div className="space-y-4 max-h-80 overflow-y-auto pr-2 rounded-xl">
                  {wrongAnswers.map((item, idx) => (
                    <div key={idx} className="bg-red-50/50 border border-red-100 rounded-xl p-4">
                      <div className="flex gap-2 mb-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase">
                          {item.question.grammar_topic}
                        </span>
                      </div>
                      <h4 className="text-gray-900 font-bold mb-3 leading-snug">
                        {item.question.question}
                      </h4>
                      <div className="text-sm space-y-1.5">
                        <p className="text-red-500 line-through">❌ You answered: {item.selected === "Time Out" ? "Time Out" : item.selected}</p>
                        <p className="text-green-600 font-bold">✅ Correct Answer: {item.question.correct_answer}</p>
                        
                        {/* ไฮไลต์ฟีเจอร์: แสดงคำอธิบายกลลวงของข้อสอบ */}
                        <div className="mt-3 bg-white p-3 rounded-lg border border-orange-200 shadow-sm">
                          <p className="text-orange-700 text-xs font-bold uppercase mb-1">💡 Teacher's Note (จุดหลอก)</p>
                          <p className="text-gray-700 text-sm leading-relaxed">{item.question.trap_explanation}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-green-700 font-bold text-center">
                  🌟 Flawless Mastery! You understood the traps perfectly.
                </div>
              )}
            </div>

            {isSubmitting ? (
              <p className="text-orange-600 font-semibold animate-pulse mb-6">⏳ Saving score...</p>
            ) : (
              <p className="text-green-600 font-semibold mb-6">✅ Score saved.</p>
            )}

            <button
              onClick={() => setGameState('DASHBOARD')}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition duration-150 text-lg shadow-md"
            >
              Back to Dashboard ⬅️
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
