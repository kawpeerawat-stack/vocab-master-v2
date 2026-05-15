'use client';
import React, { useEffect, useState } from 'react';

interface ScoreEntry {
  firstName: string;
  lastName: string;
  room: string;
  studentNo: string;
  score: number;
}

export default function Leaderboard() {
  const [scores, setScores] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    const data = JSON.parse(localStorage.getItem('vocabLeaderboard') || '[]');
    setScores(data.sort((a: any, b: any) => b.score - a.score).slice(0, 10));
  }, []);

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <h3 className="text-2xl font-bold text-center text-yellow-600 mb-4">🏆 Top 10 Leaderboard</h3>
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-blue-600 text-white">
            <tr>
              <th className="p-4 text-center">อันดับ</th>
              <th className="p-4">ชื่อนักเรียน</th>
              <th className="p-4 text-center">ห้อง</th>
              <th className="p-4 text-center">คะแนน</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s, i) => (
              <tr key={i} className="border-b hover:bg-gray-50">
                <td className="p-4 text-center">{i + 1}</td>
                <td className="p-4 font-medium">{s.firstName} {s.lastName}</td>
                <td className="p-4 text-center">{s.room}/{s.studentNo}</td>
                <td className="p-4 text-center font-bold text-blue-600">{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
