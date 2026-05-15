"use client";

import React, { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

type Student = {
  id: string;
  name: string;
  email: string;
  score: number;
};

export default function AdminDashboard() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScores = async () => {
      try {
        const q = query(collection(db, "users"), orderBy("score", "desc"));
        const querySnapshot = await getDocs(q);
        const data: Student[] = [];
        querySnapshot.forEach((doc) => {
          data.push({ id: doc.id, ...doc.data() } as Student);
        });
        setStudents(data);
      } catch (error) {
        console.error("Error fetching scores: ", error);
      } finally {
        setLoading(false);
      }
    };
    fetchScores();
  }, []);

  if (loading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-pink-500 font-bold text-xl animate-pulse">LOADING DASHBOARD...</div>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-8 font-sans selection:bg-pink-500/30">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-rose-400 mb-2 tracking-tight">
          🏆 LEADERBOARD
        </h1>
        <p className="text-neutral-500 font-bold tracking-widest uppercase text-sm mb-10">Vocab Master 2.0 - Live Scores</p>
        
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-neutral-950/80 border-b border-neutral-800">
                <tr>
                  <th className="p-5 font-bold text-neutral-400 w-20 text-center">Rank</th>
                  <th className="p-5 font-bold text-neutral-400">Student Name</th>
                  <th className="p-5 font-bold text-neutral-400">Email</th>
                  <th className="p-5 font-bold text-neutral-400 text-center w-32">Top Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {students.map((student, index) => (
                  <tr key={student.id} className="hover:bg-neutral-800/30 transition-colors group">
                    <td className="p-5 font-mono text-pink-500 font-bold text-center">
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}
                    </td>
                    <td className="p-5 font-bold text-white group-hover:text-pink-100 transition-colors">{student.name}</td>
                    <td className="p-5 text-neutral-500 text-sm font-mono">{student.email}</td>
                    <td className="p-5 font-black text-2xl text-center text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-500">
                      {student.score}
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-10 text-center text-neutral-600 font-bold">
                      Waiting for challengers...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}