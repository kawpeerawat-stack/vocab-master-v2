"use client";

import React, { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import type { SrsCard } from "../lib/srs";
import { RQTYPE_LABELS } from "../lib/reading";
import { CONV_FORMAT_LABELS } from "../lib/conversation";

type ReadingStatRow = {
  attempts?: number;
  totalAnswered?: number;
  totalCorrect?: number;
  bestPct?: number;
  byType?: Record<string, { answered: number; correct: number }>;
  totalLeaves?: number;
  autoSubmits?: number;
};
type ReadingLeaveRow = { title?: string; examStyle?: string; leaves: number; attempts: number; lastLeaves?: number; autoSubmits?: number };
type ConversationStatRow = {
  attempts?: number;
  totalAnswered?: number;
  totalCorrect?: number;
  bestPct?: number;
  byFormat?: Record<string, { answered: number; correct: number }>;
};

type StudentDoc = {
  id: string;
  name?: string;
  email?: string;
  mastered?: number;
  learning?: number;
  seen?: number;
  total?: number;
  bestScore?: number;
  lastScore?: number;
  score?: number;
  streak?: number;
  srs?: Record<string, SrsCard>;
  reading?: ReadingStatRow;
  conversation?: ConversationStatRow;
  readingLeaves?: Record<string, ReadingLeaveRow>;
};

type VocabMeaning = { thai: string; level: string };

// คำถือว่า "ยังอ่อน" เมื่ออยู่กล่องต่ำ หรือเคยลืม (lapses > 0)
function isWeak(card: SrsCard): boolean {
  return card.box <= 1 || card.lapses > 0;
}

export default function AdminDashboard() {
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [vocabMap, setVocabMap] = useState<Record<string, VocabMeaning>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        // 1) แผนที่ความหมายคำศัพท์ (ไว้แสดงภาษาไทย)
        try {
          const res = await fetch("/api/vocab");
          if (res.ok) {
            const words = (await res.json()) as { word: string; thai_meaning: string; level: string }[];
            const map: Record<string, VocabMeaning> = {};
            for (const w of words) map[w.word] = { thai: w.thai_meaning, level: w.level };
            setVocabMap(map);
          }
        } catch (e) {
          console.error("load vocab error:", e);
        }

        // 2) ข้อมูลนักเรียนจาก Firestore
        const snap = await getDocs(collection(db, "students"));
        const data: StudentDoc[] = [];
        snap.forEach((d) => data.push({ id: d.id, ...(d.data() as object) } as StudentDoc));
        data.sort((a, b) => (b.mastered ?? 0) - (a.mastered ?? 0));
        setStudents(data);
      } catch (error) {
        console.error("Error fetching students:", error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // คำที่ทั้งห้องพลาดบ่อย: รวมจำนวนคนที่ยังอ่อน + lapses รวม ของแต่ละคำ
  const classHardWords = (() => {
    const agg: Record<string, { strugglers: number; lapses: number }> = {};
    for (const s of students) {
      if (!s.srs) continue;
      for (const [word, card] of Object.entries(s.srs)) {
        if (!card) continue;
        if (isWeak(card)) {
          if (!agg[word]) agg[word] = { strugglers: 0, lapses: 0 };
          agg[word].strugglers += 1;
          agg[word].lapses += card.lapses || 0;
        }
      }
    }
    return Object.entries(agg)
      .map(([word, v]) => ({ word, ...v }))
      .sort((a, b) => b.strugglers - a.strugglers || b.lapses - a.lapses)
      .slice(0, 20);
  })();

  // คำที่อ่อนของนักเรียนแต่ละคน (เรียงตามเคยลืมบ่อย → กล่องต่ำ)
  const weakWordsOf = (s: StudentDoc) => {
    if (!s.srs) return [];
    return Object.entries(s.srs)
      .filter(([, c]) => c && isWeak(c))
      .sort((a, b) => (b[1].lapses || 0) - (a[1].lapses || 0) || a[1].box - b[1].box)
      .slice(0, 15)
      .map(([word, c]) => ({ word, box: c.box, lapses: c.lapses }));
  };

  // นักเรียนที่ออกจากหน้าจอระหว่างทำ Reading (กันโกง) — โดนส่งอัตโนมัติขึ้นก่อน แล้วเรียงตามจำนวนครั้ง
  const flaggedStudents = students
    .map((s) => ({ s, leaves: s.reading?.totalLeaves ?? 0, autos: s.reading?.autoSubmits ?? 0 }))
    .filter((x) => x.leaves > 0 || x.autos > 0)
    .sort((a, b) => b.autos - a.autos || b.leaves - a.leaves);

  // ── ดาวน์โหลดข้อมูลนักเรียนทั้งห้องเป็นไฟล์ CSV (เปิดใน Excel ได้) ──
  const escapeCsv = (val: string | number) => {
    const s = String(val ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const downloadCsv = () => {
    const headers = ["ชื่อ", "อีเมล", "จำได้", "กำลังเรียน", "เคยเจอ", "คะแนนสูงสุด", "วันติด(streak)", "ออกจากจอรวม", "ส่งอัตโนมัติ", "บทที่ออกจากจอ", "คำที่ยังอ่อน"];
    const rows = students.map((s) => {
      const weak = weakWordsOf(s)
        .map((w) => (vocabMap[w.word] ? `${w.word}(${vocabMap[w.word].thai})` : w.word))
        .join("; ");
      const leaveDetail = Object.values(s.readingLeaves || {})
        .sort((a, b) => b.leaves - a.leaves)
        .map((lv) => `${lv.title || "(บท)"}(${lv.leaves}×${(lv.autoSubmits ?? 0) > 0 ? `, ส่งอัตโนมัติ ${lv.autoSubmits}` : ""})`)
        .join("; ");
      return [
        s.name || "",
        s.email || s.id,
        s.mastered ?? 0,
        s.learning ?? 0,
        s.seen ?? 0,
        s.bestScore ?? s.score ?? 0,
        s.streak ?? 0,
        s.reading?.totalLeaves ?? 0,
        s.reading?.autoSubmits ?? 0,
        leaveDetail,
        weak,
      ].map(escapeCsv).join(",");
    });
    // ใส่ BOM (\uFEFF) เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `vocab-master-students-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-amber-400 font-bold text-xl animate-pulse">
        กำลังโหลดข้อมูลนักเรียน...
      </div>
    );
  }

  const totalStudents = students.length;
  const avgMastered = totalStudents
    ? Math.round(students.reduce((sum, s) => sum + (s.mastered ?? 0), 0) / totalStudents)
    : 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-200 mb-1 tracking-tight">
              📊 แดชบอร์ดครู — Vocab Master
            </h1>
            <p className="text-neutral-500 font-bold tracking-widest uppercase text-xs">
              Student Progress · Live from Cloud
            </p>
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={students.length === 0}
            className="bg-amber-400 text-neutral-950 font-black px-5 py-3 rounded-2xl hover:bg-amber-300 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
          >
            📥 ดาวน์โหลด CSV
          </button>
        </div>

        {/* สรุปภาพรวม */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-3xl font-black text-amber-400">{totalStudents}</div>
            <div className="text-xs font-bold text-neutral-500 uppercase mt-1">นักเรียนที่มีข้อมูล</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-3xl font-black text-green-400">{avgMastered}</div>
            <div className="text-xs font-bold text-neutral-500 uppercase mt-1">เฉลี่ยคำที่จำได้/คน</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 col-span-2 md:col-span-1">
            <div className="text-3xl font-black text-rose-400">{classHardWords.length}</div>
            <div className="text-xs font-bold text-neutral-500 uppercase mt-1">คำที่ห้องยังอ่อน</div>
          </div>
        </div>

        {/* คำที่ทั้งห้องพลาดบ่อย */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 mb-8">
          <h2 className="text-lg font-black text-rose-300 mb-1">🔥 คำที่ทั้งห้องยังอ่อน (ควรสอนซ้ำ)</h2>
          <p className="text-xs text-neutral-500 mb-4">เรียงตามจำนวนนักเรียนที่ยังไม่แม่น</p>
          {classHardWords.length === 0 ? (
            <p className="text-neutral-600 text-sm">ยังไม่มีข้อมูล — เมื่อเด็กเล่นจบรอบ ข้อมูลจะขึ้นที่นี่</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classHardWords.map((w) => (
                <span key={w.word} className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2 text-sm">
                  <span className="font-bold text-rose-200">{w.word}</span>
                  {vocabMap[w.word] && <span className="text-neutral-400"> · {vocabMap[w.word].thai}</span>}
                  <span className="text-neutral-500 text-xs"> ({w.strugglers} คน)</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 🚨 กันโกง: ออกจากหน้าจอระหว่างทำ Reading */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 mb-8">
          <h2 className="text-lg font-black text-rose-300 mb-1">🚨 ออกจากหน้าจอระหว่างทำ Reading (กันโกง)</h2>
          <p className="text-xs text-neutral-500 mb-4">นับเฉพาะตอนทำข้อสอบจริง — สลับแอป/สลับแท็บ เช่น เปิดแอปแปลภาษาหรือค้นเน็ต · คลิกชื่อเพื่อดูรายบท</p>
          {flaggedStudents.length === 0 ? (
            <p className="text-neutral-600 text-sm">ยังไม่พบใครออกจากหน้าจอ 👍</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {flaggedStudents.map(({ s, leaves, autos }) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setExpanded(s.id)}
                  className={`rounded-xl px-3 py-2 text-sm transition-colors border ${autos > 0 ? "bg-red-500/15 border-red-500/50 hover:bg-red-500/25" : "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20"}`}
                >
                  <span className={`font-bold ${autos > 0 ? "text-red-200" : "text-rose-200"}`}>{s.name || "(ไม่มีชื่อ)"}</span>
                  <span className="text-neutral-400"> · ออกจากจอ {leaves} ครั้ง</span>
                  {autos > 0 && <span className="ml-1 font-black text-red-300">· ⛔ ส่งอัตโนมัติ {autos}×</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* รายชื่อนักเรียน */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-neutral-800">
            <h2 className="text-lg font-black text-amber-200">นักเรียนรายคน</h2>
            <p className="text-xs text-neutral-500">คลิกที่แถวเพื่อดูคำที่นักเรียนคนนั้นยังอ่อน</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-neutral-950/60 border-b border-neutral-800 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="p-4">ชื่อ</th>
                  <th className="p-4 hidden md:table-cell">อีเมล</th>
                  <th className="p-4 text-center">จำได้</th>
                  <th className="p-4 text-center">กำลังเรียน</th>
                  <th className="p-4 text-center">คะแนนสูงสุด</th>
                  <th className="p-4 text-center hidden sm:table-cell">อ่าน %</th>
                  <th className="p-4 text-center hidden sm:table-cell">สนทนา %</th>
                  <th className="p-4 text-center">ออกจากจอ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {students.map((s) => {
                  const weak = weakWordsOf(s);
                  const isOpen = expanded === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <tr
                        className="hover:bg-neutral-800/30 transition-colors cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : s.id)}
                      >
                        <td className="p-4 font-bold text-white">{s.name || "(ไม่มีชื่อ)"}</td>
                        <td className="p-4 text-neutral-500 text-sm font-mono hidden md:table-cell">{s.email}</td>
                        <td className="p-4 text-center font-black text-green-400">{s.mastered ?? 0}</td>
                        <td className="p-4 text-center font-bold text-amber-400">{s.learning ?? 0}</td>
                        <td className="p-4 text-center font-bold text-neutral-200">{s.bestScore ?? s.score ?? 0}</td>
                        <td className="p-4 text-center font-bold text-sky-400 hidden sm:table-cell">{s.reading?.bestPct != null ? `${s.reading.bestPct}%` : "–"}</td>
                        <td className="p-4 text-center font-bold text-purple-400 hidden sm:table-cell">{s.conversation?.bestPct != null ? `${s.conversation.bestPct}%` : "–"}</td>
                        <td className="p-4 text-center font-black">{(s.reading?.totalLeaves ?? 0) > 0 || (s.reading?.autoSubmits ?? 0) > 0 ? <span className="text-rose-400">{s.reading?.totalLeaves ?? 0}×{(s.reading?.autoSubmits ?? 0) > 0 ? <span className="text-red-300"> ⛔{s.reading?.autoSubmits}</span> : null}</span> : <span className="text-neutral-600">0</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-neutral-950/40">
                          <td colSpan={8} className="p-4">
                            <div className="text-xs font-bold text-neutral-400 mb-2">คำที่ {s.name} ยังอ่อน:</div>
                            {weak.length === 0 ? (
                              <span className="text-neutral-600 text-sm">ยังไม่มีคำที่อ่อน หรือยังไม่มีข้อมูล</span>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {weak.map((w) => (
                                  <span key={w.word} className="bg-neutral-800 rounded-lg px-2.5 py-1.5 text-xs">
                                    <span className="font-bold text-neutral-100">{w.word}</span>
                                    {vocabMap[w.word] && <span className="text-neutral-500"> · {vocabMap[w.word].thai}</span>}
                                    {w.lapses > 0 && <span className="text-rose-400"> · ลืม {w.lapses}×</span>}
                                  </span>
                                ))}
                              </div>
                            )}

                            {s.readingLeaves && Object.keys(s.readingLeaves).length > 0 && (
                              <div className="mt-4 border-t border-neutral-800 pt-3">
                                <div className="text-xs font-bold text-rose-300 mb-2">🚨 ออกจากหน้าจอราย​บท (กันโกง) — รวม {s.reading?.totalLeaves ?? 0} ครั้ง{(s.reading?.autoSubmits ?? 0) > 0 ? ` · ⛔ ส่งอัตโนมัติ ${s.reading?.autoSubmits} ครั้ง` : ""}</div>
                                <div className="flex flex-wrap gap-2">
                                  {Object.values(s.readingLeaves)
                                    .sort((a, b) => b.leaves - a.leaves)
                                    .map((lv, i) => (
                                      <span key={i} className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5 text-xs">
                                        <span className="font-bold text-rose-200">{lv.title || "(บท)"}</span>
                                        {lv.examStyle && <span className="text-neutral-500"> · {lv.examStyle}</span>}
                                        <span className="text-rose-300"> · ออก {lv.leaves}× ใน {lv.attempts} รอบ</span>
                                        {(lv.autoSubmits ?? 0) > 0 && <span className="ml-1 font-black text-red-300">· ⛔ ส่งอัตโนมัติ {lv.autoSubmits}×</span>}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            )}

                            <div className="mt-4 grid sm:grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                              <div>
                                <div className="text-xs font-bold text-sky-300 mb-1">📖 การอ่าน (Reading)</div>
                                {s.reading ? (
                                  <div className="text-xs text-neutral-400 space-y-0.5">
                                    <div>ทำไป {s.reading.attempts ?? 0} รอบ · ดีสุด {s.reading.bestPct ?? 0}% · สะสม {s.reading.totalCorrect ?? 0}/{s.reading.totalAnswered ?? 0}</div>
                                    {s.reading.byType &&
                                      Object.entries(s.reading.byType).map(([t, v]) => (
                                        <div key={t} className="text-neutral-500">
                                          • {(RQTYPE_LABELS as Record<string, string>)[t] ?? t}: {v.correct}/{v.answered}
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <span className="text-neutral-600 text-xs">ยังไม่มีข้อมูล</span>
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-bold text-purple-300 mb-1">💬 บทสนทนา (Conversation)</div>
                                {s.conversation ? (
                                  <div className="text-xs text-neutral-400 space-y-0.5">
                                    <div>ทำไป {s.conversation.attempts ?? 0} รอบ · ดีสุด {s.conversation.bestPct ?? 0}% · สะสม {s.conversation.totalCorrect ?? 0}/{s.conversation.totalAnswered ?? 0}</div>
                                    {s.conversation.byFormat &&
                                      Object.entries(s.conversation.byFormat).map(([t, v]) => (
                                        <div key={t} className="text-neutral-500">
                                          • {(CONV_FORMAT_LABELS as Record<string, string>)[t] ?? t}: {v.correct}/{v.answered}
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <span className="text-neutral-600 text-xs">ยังไม่มีข้อมูล</span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-neutral-600 font-bold">
                      ยังไม่มีข้อมูลนักเรียน — เมื่อเด็กเล่นจบรอบและซิงก์ขึ้นคลาวด์ จะปรากฏที่นี่
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-neutral-700 text-xs mt-8">
          ข้อมูลนี้เป็นความลับของนักเรียน — อย่าเปิดเผยลิงก์หน้านี้ให้คนนอก
        </p>
      </div>
    </div>
  );
}
