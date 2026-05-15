'use client';
import React, { useState } from 'react';

export default function Registration({ onStartQuiz }: { onStartQuiz: () => void }) {
  const [info, setInfo] = useState({ firstName: '', lastName: '', studentNo: '', room: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (info.firstName && info.studentNo && info.room) {
      onStartQuiz(info);
    } else {
      alert("กรุณากรอกข้อมูลให้ครบถ้วนนะครับ");
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-xl border border-blue-100 my-10">
      <h2 className="text-2xl font-bold text-center text-blue-800 mb-6">📝 ลงทะเบียนเข้าสอบ</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input 
          type="text" placeholder="ชื่อจริง" required
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          onChange={(e) => setInfo({...info, firstName: e.target.value})}
        />
        <input 
          type="text" placeholder="นามสกุล"
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          onChange={(e) => setInfo({...info, lastName: e.target.value})}
        />
        <div className="flex gap-4">
          <input 
            type="number" placeholder="เลขที่" required
            className="w-1/2 p-3 border border-gray-300 rounded-lg outline-none"
            onChange={(e) => setInfo({...info, studentNo: e.target.value})}
          />
          <input 
            type="text" placeholder="ห้อง (เช่น 1)" required
            className="w-1/2 p-3 border border-gray-300 rounded-lg outline-none"
            onChange={(e) => setInfo({...info, room: e.target.value})}
          />
        </div>
        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition duration-300 shadow-lg">
          🚀 เริ่มทำแบบทดสอบ
        </button>
      </form>
    </div>
  );
}
