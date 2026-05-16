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
    const pickedWrong = wrongItems.sort(() => 0.5 - Math.rand
