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
  const [timeLeft, setTimeLeft] = useState(20);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const TIME_LIMIT = 20; 
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

  // ✨ แก้ไขจุดนี้: เปลี่ยนชอยส์ตัวเลือกให้แสดงเป็นคำศัพท์ภาษาอังกฤษ (word)
  const generateOptionsForQuestion = (correctItem: WordItem, allItems: WordItem[]) => {
    let wrongOptionsPool = allItems.filter(item => item.word !== correctItem.word && item.level === correctItem.level);
    if (wrongOptionsPool.length < 3) {
      wrongOptionsPool = allItems.filter(item => item.word !== correctItem.word);
    }
    const shuffledWrong = wrongOptionsPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    
    // ดึงฟิลด์ .word (ภาษาอังกฤษ) มาทำเป็นชอยส์แทนความหมายภาษาไทย
    const finalChoices = [correctItem.word, ...shuffledWrong.map(item => item.word)];
    setOptions(finalChoices.sort(() => 0.5 - Math.random()));
  };

  const resetTimerAndQuestionState = () => {
    setTimeLeft(TIME_LIMIT);
    setSelectedAnswer(null);
    setIsAnswered(false);
  };

  // ✨ แก้ไขจุดนี้: เช็คคำตอบที่ถูกต้องกับฟิลด์คำศัพท์ภาษาอังกฤษ (word)
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
        
        {gameState === 'START' && (
          <div className="text-center animate-fadeIn">
            <h1 className="text-3xl font-extrabold text-blue-600 mb-2">Vocab Master 2.0</h1>
            <p className="text-gray-500 mb-6 text-sm md:text-base">ระบบทดสอบคำศัพท์ ม.6 แบบไต่ระดับความยากอัตโนมัติ</p>
            
            <div className="text-left space-y-4 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">ชื่อ - นามสกุล / เลขที่</label>
                <input
                  type="text"
                  placeholder="ตัวอย่าง: นายสมชาย รักเรียน เลขที่ 1"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">ระบุ Gmail ของนักเรียน (ใช้เพื่อเซฟความก้าวหน้า)</label>
                <input
                  type="email"
                  placeholder="ตัวอย่าง: student.name@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              onClick={startNewQuizRound}
              disabled={isVocabLoading || !studentName.trim() || !email.trim() || !email.includes('@')}
              className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition duration-200 text-lg"
            >
              {isVocabLoading ? "⏳ กำลังโหลดคลังคำศัพท์..." : "เริ่มทำข้อสอบ"}
            </button>
          </div>
        )}

        {gameState === 'QUIZ' && currentQuestions.length > 0 && (
          <div className="animate-fadeIn">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <span className="text-sm font-bold px-3 py-1 bg-gray-100 rounded-full text-gray-600">
                ข้อที่ {currentIndex + 1} / {currentQuestions.length}
              </span>
              <span className={`text-base font-extrabold px-4 py-1 rounded-full ${timeLeft <= 5 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-blue-50 text-blue-600'}`}>
                ⏱️ {timeLeft} วินาที
              </span>
            </div>

            <div className="mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                currentQuestions[currentIndex].level === 'C1' ? 'bg-purple-100 text-purple-700' :
                currentQuestions[currentIndex].level === 'B2' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              }`}>
                ระดับความยาก: {currentQuestions[currentIndex].level}
              </span>
            </div>

            {/* แสดงประโยคโจทย์ภาษาอังกฤษ */}
            <h2 className="text-xl md:text-2xl font-bold mb-2 text-gray-900">
              {currentQuestions[currentIndex].example_sentence}
            </h2>
            
            {/* ✨ เพิ่มการแสดงคำแปลภาษาไทยและคำนิยาม เพื่อช่วยใบ้นักเรียนเพิ่มเติม */}
            <p className="text-sm text-blue-600 font-medium mb-1">
              ความหมาย: {currentQuestions[currentIndex].thai_meaning}
            </p>
            <p className="text-xs text-gray-400 italic mb-6">
              Definition: {currentQuestions[currentIndex].eng_definition}
            </p>

            <div className="grid grid-cols-1 gap-3">
              {options.map((option, idx) => {
                // ✨ แก้ไขจุดนี้: เช็คความถูกต้องด้วย .word ภาษาอังกฤษ
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
                {currentIndex + 1 === currentQuestions.length ? "ดูผลสรุปคะแนน" : "ข้อถัดไป ➡️"}
              </button>
            )}
          </div>
        )}

        {gameState === 'END' && (
          <div className="text-center animate-fadeIn">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🎉</span>
            </div>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-1">ทำข้อสอบเสร็จสิ้น!</h2>
            <p className="text-gray-600 font-medium mb-4">{studentName} ({email})</p>
            
            <div className="bg-gray-50 rounded-2xl p-6 border mb-6">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">คะแนนที่คุณทำได้</div>
              <div className="text-5xl font-black text-blue-600 mb-2">
                {score} <span className="text-2xl text-gray-400">/ {currentQuestions.length}</span>
              </div>
              <div className="text-sm text-gray-500">
                เปอร์เซ็นต์ความก้าวหน้าในรอบนี้: {((score / currentQuestions.length) * 100).toFixed(0)}%
              </div>
            </div>

            {isSubmitting ? (
              <p className="text-orange-600 font-semibold animate-pulse mb-6">⏳ กำลังบันทึกคะแนนเข้าสู่ระบบคลาวด์...</p>
            ) : (
              <p className="text-green-600 font-semibold mb-6">✅ บันทึกคะแนนลงระบบเรียบร้อยแล้ว</p>
            )}

            <button
              onClick={() => setGameState('START')}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition duration-150 text-lg shadow-md"
            >
              กลับหน้าแรกเพื่อทดสอบอีกครั้ง
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
