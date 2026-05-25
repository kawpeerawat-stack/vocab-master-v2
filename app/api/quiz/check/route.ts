import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

interface VocabWord {
  word: string
  thai_meaning: string
  eng_definition: string
  synonym: string
  antonym: string
  example_sentence: string
  level: string  
}

function loadVocab(): VocabWord[] {
  const filePath = join(process.cwd(), 'data', 'vocab.json')
  const raw = readFileSync(filePath, 'utf-8')
  const all = JSON.parse(raw)   // ← เปลี่ยน return → const all =
  return all.filter((w: VocabWord) =>
    w.word !== 'คำศัพท์ภาษาอังกฤษ'
  )
}
// POST /api/quiz/check
// body: { wordIndex: number, answer: string }
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { wordIndex, answer } = body

  // Validate input
  if (typeof wordIndex !== 'number' || typeof answer !== 'string') {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const words = loadVocab()

  if (wordIndex < 0 || wordIndex >= words.length) {
    return NextResponse.json({ error: 'Invalid word index' }, { status: 400 })
  }

  const correct = words[wordIndex]
  const isCorrect = answer.trim() === correct.thai_meaning.trim()

  return NextResponse.json({
    correct: isCorrect,
    // ส่งเฉลยหลังตอบแล้วเท่านั้น
    correctAnswer: isCorrect ? null : correct.thai_meaning,
    definition: correct.eng_definition,
  })
}
