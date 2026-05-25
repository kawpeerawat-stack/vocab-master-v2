import { NextResponse } from 'next/server'
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

export async function GET() {
  const filePath = join(process.cwd(), 'data', 'vocab.json')
  const raw = readFileSync(filePath, 'utf-8')
  const all: VocabWord[] = JSON.parse(raw)

  // กรอง header entry ออก
  const filtered = all.filter(w => w.word !== 'คำศัพท์ภาษาอังกฤษ')
  return NextResponse.json(filtered)
}
