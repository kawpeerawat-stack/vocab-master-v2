import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// โครงสร้างคำศัพท์
interface VocabWord {
  word: string
  thai_meaning: string
  eng_definition: string
  synonym: string
  antonym: string
  example_sentence: string
  level: string
}

// โหลด vocab จาก data/ (ฝั่ง server เท่านั้น)
function loadVocab(): VocabWord[] {
  const filePath = join(process.cwd(), 'data', 'vocab.json')
  const raw = readFileSync(filePath, 'utf-8')
  const all = JSON.parse(raw)   // ← เปลี่ยน return → const all =
  return all.filter((w: VocabWord) =>
    w.word !== 'คำศัพท์ภาษาอังกฤษ'
  )
}

// สร้างตัวเลือก 4 ข้อ (ไม่ส่งเฉลย)
function buildQuizQuestion(words: VocabWord[], index: number) {
  const correct = words[index]

  // สุ่มตัวลวง 3 ข้อจากคำอื่น
  const distractors = words
    .filter((_, i) => i !== index)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(w => w.thai_meaning)

  // รวมเฉลย + ตัวลวง แล้วสับไพ่
  const options = [...distractors, correct.thai_meaning]
    .sort(() => Math.random() - 0.5)

  return {
    id: index,
    word: correct.word,
    example_sentence: correct.example_sentence,
    options,
    // ❌ ไม่มี correctAnswer ในนี้เลย
  }
}

// GET /api/quiz?count=10
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const count = Math.min(parseInt(searchParams.get('count') || '10'), 20)

  const words = loadVocab()

  // สุ่มเลือกคำ
  const indices = Array.from({ length: words.length }, (_, i) => i)
    .sort(() => Math.random() - 0.5)
    .slice(0, count)

  const questions = indices.map(i => buildQuizQuestion(words, i))

  return NextResponse.json({ questions })
}
