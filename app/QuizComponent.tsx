'use client';
import React, { useState, useEffect } from 'react';
import vocabData from './vocab.json';

interface VocabItem {
  word: string;
  thai_meaning: string;
  eng_definition: string;
  example_sentence: string;
  level: string;
  synonym?: string;
  antonym?: string;
}

export default function QuizComponent({ student, onFinish }: { student: any, onFinish: (s: number) => void }) {
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [reviewData, setReviewData] = useState<any[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15);

  const SET_SIZE = 10;
  const TIME_LIMIT = 15;

  const submitScore = async (score: number) => {
    try {
      await fetch('/api/submit-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastName: student.lastName,
          room: student.room,
          studentNo: student.studentNo,
          score: score,
        }),
      });
    } catch (error) {
      console.error('Failed to submit score:', error);
    }
  };

  const generateNewSet = () => {
    const all = vocabData as VocabItem[];
    const wrongQueue = JSON.parse(localStorage.getItem('wrongWordsQueue') || '[]');
    const wrongItems = all.filter(v => wrongQueue.includes(v.word));
    const pickedWrong = wrongItems.sort(() => 0.5 - Math.random()).slice(0, 4);
    const remainingCount = SET_SIZE - pickedWrong.length;
    const unusedWords = all.filter(v => !wrongQueue.includes(v.word));
    const b1 = unusedWords.filter(v => v.level === 'B1').sort(() => 0.5 - Math.random());
    const b2 = unusedWords.filter(v => (v.level === 'B2' || !v.level)).sort(() => 0.5 - Math.random());
    const c1 = unusedWords.filter(v => v.level === 'C1').sort(() => 0.5 - Math.random());
    const pickedNew = [...b1.slice(0, 2), ...b2.slice(0, 2), ...c1.slice(0, 2), ...b2.slice(2)].slice(0, remainingCount);
    const selectedWords = [...pickedWrong, ...pickedNew].sort(() => 0.5 - Math.random());
    const set = selectedWords.map((q, index) => formatQuestion(q, (index % 6) + 1));
    setQuestions(set);
    setCurrentIdx(0);
    setCorrectCount(0);
    setReviewData([]);
    setShowSummary(false);
    setTimeLeft(TIME_LIMIT);
    setSelectedAnswer(null);
    setIsAnswered(false);
  };

  function formatQuestion(item: VocabItem, type: number) {
    let questionText = "";
    let subText = "";
    let correctAnswer = "";
    let options: string[] = [];
    const all = vocabData as VocabItem[];
    switch(type) {
      case 1: questionText = `"${item.word}"`; subText = "Meaning?"; correctAnswer = item.thai_meaning;
              options = [item.thai_meaning, ...all.filter(v => v.thai_meaning !== item.thai_meaning).sort(() => 0.5 - Math.random()).slice(0, 3).map(v => v.thai_meaning)]; break;
      case 2: questionText = `"${item.thai_meaning}"`; subText = "English word?"; correctAnswer = item.word;
              options = [item.word, ...all.filter(v => v.word !== item.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(v => v.word)]; break;
      case 3: questionText = `"${item.word}"`; subText = "Synonym?"; correctAnswer = item.synonym || item.word;
              options = [correctAnswer, ...all.filter(v => v.word !== item.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(v => v.word)]; break;
      case 4: questionText = item.example_sentence.replace(item.word, "_______"); subText = "Fill in context"; correctAnswer = item.word;
              options = [item.word, ...all.filter(v => v.word !== item.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(v => v.word)]; break;
      case 5: questionText = item.eng_definition; subText = "Identify word"; correctAnswer = item.word;
              options = [item.word, ...all.filter(v => v.word !== item.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(v => v.word)]; break;
      case 6: if (item.antonym) { questionText = `"${item.word}"`; subText = "Antonym?"; correctAnswer = item.antonym;
              options = [item.antonym, ...all.filter(v => v.word !== item.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(v => v.word)]; }
              else { return formatQuestion(item, 1); } break;
    }
    return { ...item, type, questionText, subText, correctAnswer, options: options.sort(() => 0.5 - Math.random()), isRepeat: false };
  }

  useEffect(() => { generateNewSet(); }, []);

  useEffect(() => {
    if (showSummary || isAnswered || questions.length === 0) return;
    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else { handleAnswer(null); }
  }, [timeLeft, isAnswered, showSummary, questions]);

  const handleAnswer = (ans: string | null) => {
    if (isAnswered) return;
    const q = questions[currentIdx];
    const isCorrect = ans === q.correctAnswer;
    setSelectedAnswer(ans);
    setIsAnswered(true);

    const mastered = JSON.parse(localStorage.getItem('masteredWords') || '[]');
    const wrongQueue = JSON.parse(localStorage.getItem('wrongWordsQueue') || '[]');

    const thisAnswerCounts = isCorrect && !q.isRepeat && !wrongQueue.includes(q.word);
    const finalScore = thisAnswerCounts ? correctCount + 1 : correctCount;

    if (isCorrect) {
      if (thisAnswerCounts) {
        setCorrectCount(finalScore);
        if (!mastered.includes(q.word)) {
          mastered.push(q.word);
          localStorage.setItem('masteredWords', JSON.stringify(mastered));
        }
      }
      const updatedWrongQueue = wrongQueue.filter((w: string) => w !== q.word);
      localStorage.setItem('wrongWordsQueue', JSON.stringify(updatedWrongQueue));
    } else {
      const updatedMastered = mastered.filter((m: string) => m !== q.word);
      localStorage.setItem('masteredWords', JSON.stringify(updatedMastered));
      if (!wrongQueue.includes(q.word)) {
        wrongQueue.push(q.word);
        localStorage.setItem('wrongWordsQueue', JSON.stringify(wrongQueue));
      }
      setQuestions(prev => [...prev, { ...q, isRepeat: true }]);
    }

    setReviewData(prev => [...prev, { word: q.word, correct: q.correctAnswer, ans: ans || "TIMEOUT", isCorrect, def: q.eng_definition, ex: q.example_sentence }]);

    setTimeout(() => {
      if (currentIdx + 1 < questions.length) {
        setCurrentIdx(currentIdx + 1);
        setSelectedAnswer(null);
        setIsAnswered(false);
        setTimeLeft(TIME_LIMIT);
      } else {
        setShowSummary(true);
        submitScore(finalScore);
      }
    }, 1200);
  };

  if (showSummary) {
    return (
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-[2.5rem] shadow-2xl border-t-8 border-blue-900">
        <h2 className="text-2xl font-black text-center text-blue-900 mb-6 uppercase">Mastery Review</h2>
        <div className="space-y-3 max-h-[50vh] overflow-y-auto px-2 mb-8">
          {reviewData.map((item, i) => (
            <div key={i} className={`p-4 rounded-xl border-2 ${item.isCorrect ? 'border-green-100 bg-green-50' : 'border-red-100 bg-red-50'}`}>
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-gray-800">{item.word}</h4>
                <span className={`text-[10px] font-bold ${item.isCorrect ? 'text-green-600' : 'text-red-600'}`}>{item.isCorrect ? 'PASSED' : 'RETRY ADDED'}</span>
              </div>
              <p className="text-xs text-gray-600 mt-1">Answer: {item.correct}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button onClick={generateNewSet} className="bg-green-500 text-white font-bold py-4 rounded-2xl shadow-lg transition transform hover:scale-105">Next Set</button>
          <button onClick={() => onFinish(correctCount)} className="bg-blue-900 text-white font-bold py-4 rounded-2xl">Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto bg-white p-8 rounded-[2.5rem] shadow-xl border border-blue-50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-2 bg-gray-100">
        <div className={`h-full transition-all duration-1000 linear ${timeLeft <= 5 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${(timeLeft / TIME_LIMIT) * 100}%` }}></div>
      </div>
      <div className="flex justify-between items-center mb-8 mt-4 font-bold text-[10px] text-blue-900 uppercase">
        <span>Cleared: {correctCount}/10</span>
        <span>Time: {timeLeft}s</span>
      </div>
      <div className="text-center mb-8">
        <p className="text-blue-600 font-black text-[10px] uppercase mb-2">{questions[currentIdx]?.subText}</p>
        <div className="flex justify-center gap-2 mb-4">
          <span className="bg-slate-800 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase">Level {questions[currentIdx]?.level}</span>
          {questions[currentIdx]?.isRepeat && <span className="bg-orange-500 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter">Reviewing</span>}
        </div>
        <h3 className={`font-black text-gray-800 tracking-tighter italic ${questions[currentIdx]?.type === 4 || questions[currentIdx]?.type === 5 ? 'text-xl px-4' : 'text-4xl'}`}>{questions[currentIdx]?.questionText}</h3>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {questions[currentIdx]?.options.map((opt: string, i: number) => {
          let s = "w-full text-left p-4 rounded-2xl border-2 transition-all font-bold text-sm ";
          if (isAnswered) {
            if (opt === questions[currentIdx].correctAnswer) s += "bg-green-500 text-white border-green-600 scale-105 shadow-md";
            else if (opt === selectedAnswer) s += "bg-red-500 text-white border-red-600";
            else s += "bg-gray-50 text-gray-200 border-gray-100";
          } else s += "border-blue-50 text-gray-700 hover:border-blue-500 hover:bg-blue-50";
          return <button key={i} onClick={() => handleAnswer(opt)} disabled={isAnswered} className={s}>{opt}</button>;
        })}
      </div>
    </div>
  );
}
