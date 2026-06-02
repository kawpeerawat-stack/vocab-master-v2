import React, { useState } from "react";
import { Sparkles, ArrowRight, RefreshCw, CheckCircle2, AlertCircle, Lightbulb, PenLine, Loader2 } from "lucide-react";

// ── คำศัพท์ตัวอย่าง (ดึงจากคลังจริงของคุณครู) ──
const WORDS = [
  { word: "abandon", level: "B1", thai: "ละทิ้ง, ทิ้งไว้", def: "to leave someone or something behind", syn: "leave behind, give up, forsake" },
  { word: "encourage", level: "B1", thai: "สนับสนุน, ให้กำลังใจ", def: "to give support or confidence", syn: "inspire, motivate, support" },
  { word: "adapt", level: "B2", thai: "ปรับตัว, ดัดแปลง", def: "to change something to suit new conditions", syn: "adjust, modify, alter" },
  { word: "generous", level: "B2", thai: "ใจกว้าง, ใจดี", def: "showing a readiness to give", syn: "charitable, giving, liberal" },
  { word: "fluctuate", level: "B2", thai: "ขึ้นลง, ผันผวน", def: "to change frequently in level or value", syn: "vary, oscillate, shift" },
  { word: "deliberate", level: "C1", thai: "โดยตั้งใจ", def: "done on purpose; intentional", syn: "intentional, planned, conscious" },
  { word: "comprehensive", level: "C1", thai: "ครอบคลุม, ครบถ้วน", def: "including all or nearly all aspects", syn: "complete, thorough, exhaustive" },
  { word: "abundant", level: "C1", thai: "อุดมสมบูรณ์, มากมาย", def: "existing in large quantities", syn: "plentiful, ample, copious" },
];

const NAVY = "#0a2a66";
const GOLD = "#f5b800";

export default function SentencePracticeDemo() {
  const [idx, setIdx] = useState(0);
  const [sentence, setSentence] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const current = WORDS[idx];

  const levelColor = { B1: "#16a34a", B2: "#ea580c", C1: "#7c3aed" }[current.level];

  async function checkSentence() {
    if (!sentence.trim()) return;
    setLoading(true); setResult(null); setError("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `You are a warm, encouraging English teacher for Thai Grade-12 (M.6) students.
The student must write ONE original English sentence that correctly uses the target word.

Target word: "${current.word}" (meaning in Thai: ${current.thai}; definition: ${current.def})
Student's sentence: "${sentence.trim()}"

Evaluate fairly but kindly. Any correctly inflected form of the word counts as "used" (e.g. abandoned, abandoning).
Respond with ONLY a JSON object (no markdown, no backticks, no extra text) in exactly this shape:
{
  "usedWord": true/false,
  "meaningCorrect": true/false,
  "grammarOk": true/false,
  "verdict": "excellent" | "good" | "needs_work",
  "scoreOutOf5": 0-5,
  "feedback_th": "warm, specific feedback in THAI, 1-2 sentences, say what is good and what to fix and WHY",
  "corrected": "an improved/corrected version of the STUDENT'S sentence in English, kept close to theirs; if already perfect, return it unchanged",
  "tip_th": "one short practical learning tip in THAI"
}`
          }],
        }),
      });
      const data = await res.json();
      const text = (data.content || []).map(b => b.type === "text" ? b.text : "").join("").trim();
      const clean = text.replace(/```json|```/g, "").trim();
      setResult(JSON.parse(clean));
    } catch (e) {
      setError("ขออภัย ตรวจไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    } finally {
      setLoading(false);
    }
  }

  function nextWord() {
    setIdx((idx + 1) % WORDS.length);
    setSentence(""); setResult(null); setError("");
  }

  const verdictStyle = {
    excellent: { bg: "#dcfce7", border: "#16a34a", text: "#15803d", label: "ยอดเยี่ยม!", icon: CheckCircle2 },
    good: { bg: "#fef9c3", border: "#ca8a04", text: "#a16207", label: "ดีแล้ว เกือบสมบูรณ์", icon: CheckCircle2 },
    needs_work: { bg: "#fee2e2", border: "#dc2626", text: "#b91c1c", label: "ลองปรับอีกนิด", icon: AlertCircle },
  };

  return (
    <div style={{ background: `linear-gradient(160deg, ${NAVY} 0%, #061a40 60%, #04122e 100%)`, fontFamily: "'Sarabun', sans-serif" }}
         className="min-h-screen w-full flex flex-col items-center px-4 py-8 text-white">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Kanit:wght@500;600;700&family=Sarabun:wght@400;500;600;700&display=swap');
        .kanit{font-family:'Kanit',sans-serif}
        @keyframes pop{0%{transform:scale(.96);opacity:0}100%{transform:scale(1);opacity:1}}
        .pop{animation:pop .35s cubic-bezier(.2,.8,.2,1)}
      `}</style>

      {/* Header */}
      <div className="w-full max-w-xl flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: GOLD }}>
            <PenLine size={20} color={NAVY} />
          </div>
          <div className="leading-tight">
            <div className="kanit font-bold text-lg">Sentence Lab</div>
            <div className="text-[11px] tracking-widest uppercase" style={{ color: GOLD }}>Anukoolnaree · แต่งประโยคกับ AI</div>
          </div>
        </div>
        <span className="text-[11px] px-3 py-1 rounded-full font-semibold" style={{ background: "rgba(255,255,255,.1)" }}>โหมดสาธิต</span>
      </div>

      {/* Word card */}
      <div className="w-full max-w-xl rounded-3xl p-6 mb-4 shadow-2xl" style={{ background: "#ffffff", color: "#1f2937" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white" style={{ background: levelColor }}>{current.level}</span>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: "#f3f4f6", color: "#6b7280" }}>คำที่ {idx + 1}/{WORDS.length}</span>
        </div>
        <div className="kanit font-bold text-4xl mb-1" style={{ color: NAVY }}>{current.word}</div>
        <div className="text-lg font-semibold mb-1" style={{ color: "#374151" }}>{current.thai}</div>
        <div className="text-sm italic mb-3" style={{ color: "#9ca3af" }}>{current.def}</div>
        <div className="text-xs" style={{ color: "#6b7280" }}>คำเหมือน: {current.syn}</div>
      </div>

      {/* Input */}
      <div className="w-full max-w-xl rounded-3xl p-6 shadow-2xl" style={{ background: "#ffffff", color: "#1f2937" }}>
        <label className="kanit font-semibold text-sm mb-2 block" style={{ color: NAVY }}>
          ✍️ แต่งประโยคภาษาอังกฤษ 1 ประโยค โดยใช้คำว่า "<span style={{ color: levelColor }}>{current.word}</span>"
        </label>
        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          placeholder={`เช่น: They had to ${current.word} ...`}
          rows={3}
          className="w-full p-4 rounded-2xl border-2 outline-none resize-none text-base transition-colors"
          style={{ borderColor: "#e5e7eb", background: "#f9fafb" }}
          onFocus={(e) => (e.target.style.borderColor = GOLD)}
          onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
        />
        <div className="flex gap-3 mt-4">
          <button
            onClick={checkSentence}
            disabled={loading || !sentence.trim()}
            className="flex-1 py-3.5 rounded-2xl kanit font-bold text-base flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-40"
            style={{ background: NAVY, color: GOLD }}>
            {loading ? <><Loader2 size={18} className="animate-spin" /> กำลังตรวจ...</> : <><Sparkles size={18} /> ตรวจประโยคด้วย AI</>}
          </button>
          <button onClick={nextWord} title="คำถัดไป"
            className="px-4 rounded-2xl font-bold flex items-center justify-center transition-transform active:scale-95"
            style={{ background: "#f3f4f6", color: NAVY }}>
            <RefreshCw size={18} />
          </button>
        </div>

        {error && <div className="mt-4 p-3 rounded-xl text-sm text-center" style={{ background: "#fee2e2", color: "#b91c1c" }}>{error}</div>}

        {/* Feedback */}
        {result && (() => {
          const v = verdictStyle[result.verdict] || verdictStyle.good;
          const Icon = v.icon;
          return (
            <div className="pop mt-5 space-y-3">
              <div className="flex items-center justify-between p-4 rounded-2xl" style={{ background: v.bg, border: `2px solid ${v.border}` }}>
                <div className="flex items-center gap-2 kanit font-bold" style={{ color: v.text }}>
                  <Icon size={20} /> {v.label}
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <span key={n} className="text-lg" style={{ color: n <= (result.scoreOutOf5 || 0) ? GOLD : "#d1d5db" }}>★</span>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-2xl" style={{ background: "#f9fafb" }}>
                <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{result.feedback_th}</div>
              </div>

              {result.corrected && (
                <div className="p-4 rounded-2xl" style={{ background: "#eef4ff", border: "1px solid #c7d8ff" }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: NAVY }}>ประโยคที่ปรับให้ดีขึ้น</div>
                  <div className="text-base" style={{ color: "#1f2937" }}>"{result.corrected}"</div>
                </div>
              )}

              {result.tip_th && (
                <div className="flex items-start gap-2 p-4 rounded-2xl" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                  <Lightbulb size={18} style={{ color: "#d97706", flexShrink: 0, marginTop: 2 }} />
                  <div className="text-sm" style={{ color: "#92400e" }}>{result.tip_th}</div>
                </div>
              )}

              <button onClick={nextWord}
                className="w-full py-3 rounded-2xl kanit font-bold flex items-center justify-center gap-2 transition-transform active:scale-95"
                style={{ background: GOLD, color: NAVY }}>
                คำถัดไป <ArrowRight size={18} />
              </button>
            </div>
          );
        })()}
      </div>

      <div className="text-[11px] mt-6 opacity-60">© Anukoolnaree School · ต้นแบบโหมดแต่งประโยค</div>
    </div>
  );
}
