'use client';
import React, { useState, useEffect } from 'react';
import vocabData from './vocab.json'; 
import Registration from './Registration';
import QuizComponent from './QuizComponent';
import Leaderboard from './Leaderboard';

export default function AnukoolnareeApp() {
  const [student, setStudent] = useState<any>(null);
  const [isQuizzing, setIsQuizzing] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [masteredCount, setMasteredCount] = useState(0);

  const totalWords = vocabData.length;

  useEffect(() => {
    const savedStudent = localStorage.getItem('currentStudent');
    if (savedStudent) setStudent(JSON.parse(savedStudent));
    
    const mastered = JSON.parse(localStorage.getItem('masteredWords') || '[]');
    setMasteredCount(mastered.length);
  }, [isQuizzing, isFinished]);

  const totalProgress = ((masteredCount / totalWords) * 100).toFixed(2);

  const handleLogin = (info: any) => {
    setStudent(info);
    localStorage.setItem('currentStudent', JSON.stringify(info));
  };

  const handleLogout = () => {
    localStorage.removeItem('currentStudent');
    setStudent(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white shadow-sm border-b-4 border-blue-900 p-6 sticky top-0 z-50">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/school-logo.png" alt="Anukoolnaree Logo" className="w-16 h-16 object-contain" />
            <div>
              <h1 className="text-2xl font-bold text-blue-900 uppercase">Anukoolnaree School</h1>
              <p className="text-xs font-bold text-blue-600 tracking-widest">VOCAB MASTER 2.0 (ม.6)</p>
            </div>
          </div>
          {student && (
            <div className="mt-4 md:mt-0 flex items-center gap-4 bg-blue-50 p-2 rounded-2xl border border-blue-100">
              <div className="text-right px-2">
                <p className="text-sm font-bold">{student.firstName} {student.lastName}</p>
                <p className="text-[10px] text-gray-500">ม.6/{student.room} • เลขที่ {student.studentNo}</p>
              </div>
              <button onClick={handleLogout} className="text-[10px] bg-white hover:bg-red-500 hover:text-white px-3 py-1 rounded-xl border border-red-200 transition font-bold uppercase">Logout</button>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto py-8 px-4">
        {!student ? (
          <Registration onStartQuiz={handleLogin} />
        ) : isQuizzing ? (
          <QuizComponent student={student} onFinish={() => { setIsQuizzing(false); setIsFinished(true); }} />
        ) : (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border-b-8 border-blue-900">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h3 className="text-xl font-black text-gray-800 uppercase italic">Overall Mastery</h3>
                  <p className="text-sm text-gray-500">พิชิตคำศัพท์สะสม <span className="font-bold text-blue-600">{masteredCount}</span> จาก {totalWords} คำ</p>
                </div>
                <div className="text-right">
                  <span className="text-4xl font-black text-blue-900">{totalProgress}%</span>
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-5 p-1 shadow-inner">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 h-3 rounded-full transition-all duration-1000" style={{ width: `${totalProgress}%` }}></div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-blue-800 to-indigo-900 p-8 rounded-[2.5rem] text-white shadow-2xl flex flex-col justify-between transform hover:scale-[1.02] transition cursor-pointer" onClick={() => setIsQuizzing(true)}>
                <div>
                  <h3 className="text-2xl font-bold mb-2">READY TO TRAIN?</h3>
                  <p className="text-blue-100 text-sm opacity-70">สุ่ม 10 ข้อ (คละรูปแบบ B1-C1) วนซ่อมจนกว่าจะจำได้</p>
                </div>
                <button className="mt-8 bg-yellow-400 text-blue-900 font-black py-4 px-6 rounded-2xl uppercase shadow-lg">🚀 เริ่มทำแบบทดสอบ</button>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-gray-100">
                <h3 className="font-bold text-gray-800 mb-6 uppercase text-sm tracking-widest border-b pb-2">Student Profile</h3>
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">ระดับชั้น</span><span className="font-bold text-gray-700">มัธยมศึกษาปีที่ 6/{student.room}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">เลขที่ประจำตัว</span><span className="font-bold text-gray-700">{student.studentNo}</span></div>
                </div>
              </div>
            </div>
            <Leaderboard />
          </div>
        )}
      </main>
    </div>
  );
}