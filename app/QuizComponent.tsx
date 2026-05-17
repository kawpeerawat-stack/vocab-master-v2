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

export default function QuizComponent() {
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
  const [timeLeft, setTimeLeft] = useState(20); // ⏱️ ตั้งค่าเริ่มต้น 20 วินาทีตามต้องการ
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const TIME_LIMIT = 20; // ⏱️ ขีดจำกัดเวลาสูงสุด 20 วินาที
  const TOTAL_QUESTIONS_PER_ROUND = 10; // จำนวนข้อต่อรอบการเล่น
  
  // 🔗 ใส่ URL ของ Google Apps Script Web App ที่นี่
  const GOOGLE_SHEET_WEBAPP_URL = "URL_GOOGLE_APPS_SCRIPT_ของคุณครู";

  // โหลดข้อมูลจากไฟล์ vocab.json เมื่อเปิดแอปพลิเคชัน
  useEffect(() => {
    fetch('/vocab.json')
      .then((res) => res.json())
      .then((data) => setVocabData(data))
      .catch((err) => console.error("Error loading vocab.json:", err));
  }, []);

  // ตัวจับเวลาถอยหลัง 20 วินาที
  useEffect(() => {
    if (gameState !== 'QUIZ' || isAnswered) return;

    if (timeLeft === 0) {
      handleAnswerSelection(""); // หมดเวลาถือว่าตอบผิด
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, gameState, isAnswered]);

  // ฟังก์ชันสุ่มข้อสอบแบบไต่ระดับ (B1 -> B2 -> C1)
  const startNewQuizRound = () => {
    if (vocabData.length === 0) return;

    // แยกคลังศัพท์ตามระดับความยาก
    const b1Words = vocabData.filter(w => w.level === 'B1');
    const b2Words = vocabData.filter(w => w.level === 'B2');
    const c1Words = vocabData.filter(w => w.level === 'C1');

    // ฟังก์ชันช่วยสุ่มดึงคำศัพท์ตามจำนวนที่ต้องการ
    const shuffleAndPick = (array: WordItem[], count: number) => {
      const shuffled = [...array].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, count);
    };

    // จัดเซ็ต 10 ข้อ: ข้อ 1-4 (B1), ข้อ 5-8 (B2), ข้อ 9-10 (C1)
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

  // สร้างชอยส์ตัวเลือกข้อสอบ (1 ข้อถูก + 3 ข้อลวงที่เป็นระดับเดียวกัน)
  const generateOptionsForQuestion = (correctItem: WordItem, allItems: WordItem[]) => {
    // พยายามหาตัวลวงที่เป็นคำศัพท์ในระดับเดียวกันก่อนเพื่อความเนียน
    let wrongOptionsPool = allItems.filter(item => item.word !== correctItem.word && item.level === correctItem.level);
    if (wrongOptionsPool.length < 3) {
      wrongOptionsPool = allItems.filter(item => item.word !== correctItem.word);
    }

    const shuffledWrong = wrongOptionsPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    const finalChoices = [correctItem.thai_meaning, ...shuffledWrong.map(item => item.thai_meaning)];
    
    // สลับตำแหน่งสุ่มชอยส์ก้อนสุดท้าย
    setOptions(finalChoices.sort(() => 0.5 - Math.random()));
  };

  const resetTimerAndQuestionState = () => {
    setTimeLeft(TIME_LIMIT);
    setSelectedAnswer(null);
    setIsAnswered(false);
  };

  // ตรวจสอบเมื่อกดเลือกคำตอบ
  const handleAnswerSelection = (answer: string) => {
    if (isAnswered) return;
    setSelectedAnswer(answer);
    setIsAnswered(true);

    const currentCorrectAnswer = currentQuestions[currentIndex].thai_meaning;
    if (answer === currentCorrectAnswer) {
      setScore((prev) => prev + 1);
    }
  };

  // ไปยังข้อถัดไป หรือสรุปคะแนนเมื่อทำครบ
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

  // 🚀 ฟังก์ชันยิงคะแนนและข้อมูลความก้าวหน้าผ่านระบบ Email เข้า Google Sheet
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
          email: email, // 📧 ส่งอีเมลตามที่กรอกลงไป
          score: score,
          progress: progressPercentage
        }),
      });
      console.log("Score and Progress sent successfully via Email identification.");
    } catch (error) {
      console.error("Error submitting score to Google Sheet:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans text-gray-800">
      <div className="w-full max-w-xl bg-white shadow-xl rounded-2xl p-6 md:p-8 border border-gray-100">
        
        {/* 1. หน้าแรก: ลงทะเบียนเข้าใช้งานด้วยชื่อและ Gmail */}
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
              disabled={!studentName.trim() || !email.trim() || !email.includes('@')}
              className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition duration-200 text-lg"
            >
              เริ่มทำข้อสอบ
            </button>
          </div>
        )}

        {/* 2. หน้าจอทำข้อสอบพร้อมระบบนับถอยหลัง 20 วินาที */}
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

            {/* แสดงระดับความยากของคำถามปัจจุบันให้นักเรียนทราบ */}
            <div className="mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                currentQuestions[currentIndex].level === 'C1' ? 'bg-purple-100 text-purple-700' :
                currentQuestions[currentIndex].level === 'B2' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              }`}>
                ระดับความยาก: {currentQuestions[currentIndex].level}
              </span>
            </div>

            {/* โจทย์ข้อสอบประเภทเติมคำ */}
            <h2 className="text-xl md:text-2xl font-bold mb-2 text-gray-900">
              {currentQuestions[currentIndex].example_sentence}
            </h2>
            <p className="text-sm text-gray-500 italic mb-6">
              Definition: {currentQuestions[currentIndex].eng_definition}
            </p>

            {/* ชอยส์ปุ่มเลือกคำตอบ */}
            <div className="grid grid-cols-1 gap-3">
              {options.map((option, idx) => {
                const isCorrectChoice = option === currentQuestions[currentIndex].thai_meaning;
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
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>

            {/* ปุ่มนำทางไปข้อถัดไป */}
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

        {/* 3. หน้าสรุปคะแนนและแสดงสถานะความก้าวหน้า */}
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
              <p className="text-green-600 font-semibold mb-6">✅ บันทึกคะแนนและเปอร์เซ็นต์ลง Google Sheet เรียบร้อยแล้ว</p>
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
