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
  part_of_speech?: string
  type?: 'word' | 'phrasal_verb' | 'idiom'
}

function readJson(file: string): VocabWord[] {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', file), 'utf-8')
    return JSON.parse(raw) as VocabWord[]
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const referer = request.headers.get('referer') || ''
  const host = request.headers.get('host') || ''

  if (host && !referer.includes(host)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // คลังคำศัพท์เดิม + Phrasal verb/Idiom + คำศัพท์เสริม (จากบทอ่าน/บทสนทนา) = คลังเดียว
  const words = readJson('vocab.json')
  const phrases = readJson('phrases.json')
  const extra = readJson('words_extra.json')
  const all = [...words, ...phrases, ...extra].filter((w) => w.word !== 'คำศัพท์ภาษาอังกฤษ')
  return NextResponse.json(all)
}
