"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { signIn, useSession } from '@/components/AuthProvider';
import { saveGrammarProgress, loadGrammarProgress, topicPassed, passMark } from '@/lib/cloud';
import { useLeaveGuard, guardMode, thaiToday, noticeText, noCopyProps, GUARD_ENFORCE_FROM, type LeaveKind, type GuardStats } from '@/lib/guard';
import { useFaceCheck, FACE_LIMIT_MS } from '@/lib/faceCheck';

// คำตอบที่ระบบใส่ให้เมื่อข้อถูกตัดคะแนนเพราะระบบกัน AI (ไม่ตรงกับตัวเลือกใด ๆ → นับผิด)
const LEFT_ANSWER: Record<LeaveKind, string> = {
  leave: '⛔ ออกจากหน้าแอประหว่างทำข้อนี้',
  cover: '⛔ มีหน้าต่างอื่นบังหน้าแอปนานเกิน 3 วินาที',
  face: '⛔ กล้องไม่เห็นใบหน้า / มีวัตถุบังหน้า',
  phone: '⛔ กล้องเห็นมือถืออีกเครื่อง',
};
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_MONTH[m - 1]} ${y + 543}`; };
const isLeftAnswer = (a: string | null | undefined) => !!a && a.startsWith('⛔');
const shortAnswer = (a: string) => (a === 'Time Out' ? '⏰' : isLeftAnswer(a) ? '⛔' : a);

// ─────────────────────────────────────────────────────────────
//  Grammar Master — 12 หัวข้อที่ออกสอบ NETSAT
//  แต่ละหัวข้อ = 📖 เนื้อหาเฉพาะจุดที่ออกสอบ + 📝 แบบฝึก 15 ข้อ (จบในคาบ 45 นาที)
//    Part 1 Error Identification 5 ข้อ → Part 2 Sentence Completion 5 ข้อ → Part 3 Cloze Test 5 ช่อง
//  ความก้าวหน้า = คะแนนดีที่สุดของแต่ละหัวข้อ (setBest คีย์ T-…, รายพาร์ท T-…:E/:S/:C) — ทำได้ 15/15 = พิชิตหัวข้อ  → เปลี่ยนเป็น: ผ่านหัวข้อ = ทุกพาร์ทได้ ≥ 3/5 (แยกทำรายพาร์ทได้)
// ─────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────
type ExamPart = 'error' | 'sc' | 'cloze';
type ExamItem = {
  id: string; exam_type: string; grammar_topic: string;
  question_format: string; // 'Error Identification' | 'Sentence Completion' | 'Cloze Test'
  question: string; options: string[];
  correct_answer: string; explanation: string;
  number?: number;         // เลขช่องว่างใน passage (เฉพาะ Cloze Test)
};
type ExamSet = { id: string; topic: string; title?: string; items: ExamItem[]; cloze?: { title: string; passage: string } }; // topic 'MIXED' = ชุดรวมทุกหัวข้อ
type TopicMeta = {
  key: string; label: string; subtitle?: string; icon: string;
  share: number;          // % ที่ออกในแนวข้อสอบ NETSAT (สถิติจาก 5 ชุด 113 ข้อ)
  alevel: number;         // % ของข้อแกรมมาร์ใน A-Level ENG พาร์ท Writing/Text Completion (20 ข้อ: ข้อสอบจริง 15 + A-Level 69 2 + ตัวอย่าง ทปอ. 3) · 0 = ไม่พบ
  tgat: number | null;    // % ใน TGAT1 — null = ยังไม่มีข้อมูลรายข้อพอคำนวณ (TGAT ไม่มีพาร์ทแกรมมาร์แยก แทรกใน Text Completion)
  tier: 'A' | 'B';        // A = แกนหลัก (ออกบ่อย) · B = เฉพาะจุด
  isNew?: boolean;        // หัวข้อใหม่ที่เพิ่มเข้ามาตามสถิติ NETSAT
  session: number;        // คาบที่สอน (อ33206 ภาคเรียนที่ 2/2569 — 14 คาบ: คาบ 7 และ 14 เป็นคาบทบทวน)
};
type GrammarNote = {
  focus: string;                                          // ออกสอบในรูปแบบไหน (1 บรรทัด)
  points: { rule: string; right: string; wrong?: string }[];
  trap: string;
  tip?: string;                                           // เทคนิคทำข้อสอบ
};

// ── TOPIC META — เรียงตามลำดับคาบสอน อ33206 (คาบ 1–6 → ทบทวนกลางภาค คาบ 7 → คาบ 8–13 → ทบทวนปลายภาค คาบ 14) ──
// key ของหัวข้อเดิมคงไว้ (เช่น 'Gerund Infinitive') เพื่อให้ข้อมูลเดิมต่อเนื่อง — เปลี่ยนแค่ชื่อที่แสดง
const TOPIC_META: TopicMeta[] = [
  { key: 'Sentence Structure', label: 'Sentence Structure', subtitle: 'S + V แท้ · Dangling · Appositive', icon: '🏗️', share: 9.7, tier: 'A', alevel: 0, tgat: null, session: 1 },
  { key: 'Relative Clauses', label: 'Relative Clauses', subtitle: 'which / who / that · prep + whom · Reduced', icon: '🔍', share: 8.8, tier: 'A', alevel: 5, tgat: null, session: 2 },
  { key: 'Noun Clauses', label: 'Noun Clauses', subtitle: 'How / What / Whether + S + V (ไม่สลับ)', icon: '💬', share: 6.2, tier: 'A', alevel: 10, tgat: null, isNew: true, session: 3 },
  { key: 'Connectors', label: 'Connectors', subtitle: 'Although vs Despite · so that · whereas', icon: '🔀', share: 6.2, tier: 'A', alevel: 10, tgat: null, session: 4 },
  { key: 'Parallel Structure', label: 'Parallel Structure', subtitle: 'A, B, and C · both/and · neither/nor · not only/but also', icon: '🟰', share: 8.8, tier: 'A', alevel: 5, tgat: null, isNew: true, session: 5 },
  { key: 'Non-finite Verbs', label: 'Participles (Non-finite)', subtitle: 'V-ing / V3 / Having V3 / with + N + V-ing', icon: '🎯', share: 6.2, tier: 'A', alevel: 5, tgat: null, session: 6 },
  { key: 'Comparison', label: 'Comparison', subtitle: 'the + -est · more…, greater… · as…as', icon: '📊', share: 6.2, tier: 'A', alevel: 0, tgat: null, session: 8 },
  { key: 'Word Order', label: 'Word Order', subtitle: 'ลำดับคุณศัพท์ · ตำแหน่ง adverb · Inversion', icon: '📐', share: 6.2, tier: 'A', alevel: 15, tgat: null, session: 9 },
  { key: 'Word Form', label: 'Word Form & Determiners', subtitle: 'ชนิดคำ · -ing/-ed adj · some/any · amount/number · a/the', icon: '🔤', share: 12.4, tier: 'A', alevel: 10, tgat: null, session: 10 },
  { key: 'Subject-Verb Agreement', label: 'Agreement (SVA + Pronoun)', subtitle: 'Each of… · police/deer · everyone · its/their', icon: '🔗', share: 8.0, tier: 'B', alevel: 0, tgat: null, session: 11 },
  { key: 'Gerund Infinitive', label: 'Verb Patterns & If-Clause', subtitle: 'V + O + to V · Had + S + V3 · be + V3', icon: '📝', share: 13.3, tier: 'B', alevel: 30, tgat: null, session: 12 },
  { key: 'Prepositions', label: 'Prepositions & Collocations', subtitle: 'under pressure · take part in · need for', icon: '📍', share: 7.1, tier: 'A', alevel: 10, tgat: null, isNew: true, session: 13 },
];

// ── GRAMMAR NOTES (ภาคเรียนที่ 2: ตัดส่วนเกริ่นนำพื้นฐานออก — เหลือเฉพาะ "จุดที่ออกสอบ" จากสถิติ NETSAT / A-Level) ──
//    แต่ละจุด: rule = แพทเทิร์นที่ต้องจำ · right = ✓ ประโยคถูก · wrong = ✗ แบบที่ข้อสอบชอบหลอก
const GRAMMAR_NOTES: Record<string, GrammarNote> = {
  "Sentence Structure": {
    focus: "โจทย์มักเป็นประโยคยาวที่มีวลีขยายเยอะ แล้วให้หาว่า \"ขาดกริยาแท้\" ตรงไหน หรือเลือกส่วนที่ทำให้ประโยคครบ",
    points: [
      { rule: "ทุกประโยคต้องมีกริยาแท้ · V-ing / to V / V3 / which… ไม่ใช่กริยาแท้", right: "The students, having finished their exams, were excited to travel.", wrong: "The students, having finished their exams, excited to travel." },
      { rule: "วลี V-ing / V3 นำหน้า → ประธานหลังจุลภาคต้องเป็น \"ผู้ทำ\" (Dangling)", right: "After upgrading the system, the company noticed faster performance.", wrong: "After upgrading the system, faster performance was noticed." },
      { rule: "Although / When / As + S + V, → ตามด้วยประโยคหลักทันที (ห้ามมี but / and)", right: "Although many fishermen were worried, most now support the project.", wrong: "Although many fishermen were worried, but most now support the project." },
      { rule: "that / the fact that ต้องตามด้วย S + V ครบ", right: "Doctors warn that the new virus spreads very quickly.", wrong: "Doctors warn that unusually severe symptoms." },
      { rule: "Appositive = นามวลีล้วนคั่นด้วยจุลภาค (ไม่มีกริยา)", right: "Tesla, a leading electric car company, was founded in 2003.", wrong: "Tesla, which a leading electric car company, was founded in 2003." },
    ],
    trap: "ห้ามเชื่อม 2 ประโยคสมบูรณ์ด้วยจุลภาคอย่างเดียว (comma splice) — ระวังวลีที่ \"หน้าตาเหมือนกริยา\" เช่น having completed…, located in…",
    tip: "เจอประโยคยาว → หาประธานหลักแล้วถามว่า \"กริยาแท้อยู่ไหน?\" ถ้าไม่มี = จุดผิด",
  },
  "Relative Clauses": {
    focus: "วัด 3 จุด: เลือกคำเชื่อมให้ถูก · ห้ามมีคำซ้ำ · รูปย่อ (reduced)",
    points: [
      { rule: "หลังจุลภาคใช้ which / who เท่านั้น ห้ามใช้ that", right: "The new app, which was launched in May, has two million users.", wrong: "The new app, that was launched in May, has two million users." },
      { rule: "ห้ามมีประธาน/กรรมซ้ำใน relative clause", right: "The software which was developed in the 1970s is still used.", wrong: "The software which it was developed in the 1970s is still used." },
      { rule: "กริยามี preposition → prep + whom / which", right: "The professor to whom I sent my essay replied quickly.", wrong: "The professor who I sent my essay replied quickly." },
      { rule: "จำนวน + of which / of whom (ห้ามใช้ of them หลังจุลภาค)", right: "The flood hit 900 homes, most of which were near the river.", wrong: "The flood hit 900 homes, most of them were near the river." },
      { rule: "Reduced: N + V-ing (ทำเอง) / N + V3 (ถูกทำ)", right: "Gamesa, founded in 1921, is a famous Mexican company.", wrong: "Gamesa, founding in 1921, is a famous Mexican company." },
      { rule: "where / when + S + V ครบ", right: "Uganda, where most people use firewood, faces deforestation.", wrong: "Uganda, where is used firewood by most people, faces deforestation." },
    ],
    trap: "มี who… แล้วต้องมีกริยาหลักอีกตัว: \"The applicant who won the prize she was happy\" ✗ → \"…the prize was happy\"",
    tip: "เห็นจุลภาค + that = ผิดทันที · เห็น which/who แล้วตามด้วย it/he/she ซ้ำ = ผิดทันที",
  },
  "Noun Clauses": {
    focus: "จุดที่ออกบ่อยที่สุดคือ \"คำถามซ้อน ห้ามสลับ\" — ทั้ง NETSAT และ A-Level",
    points: [
      { rule: "Wh- + S + V (เรียงแบบประโยคบอกเล่า ไม่มี do/does/did)", right: "Nobody knows how the algorithm works.", wrong: "Nobody knows how does the algorithm work." },
      { rule: "ask / wonder / know + what time it was", right: "He asked the seller what time it was.", wrong: "He asked the seller what was the time." },
      { rule: "Noun clause เป็นประธาน → กริยาเอกพจน์", right: "How screen time affects sleep is still being studied.", wrong: "How does screen time affect sleep is still being studied." },
      { rule: "หลัง preposition / ก่อน to V ใช้ whether (ไม่ใช้ if)", right: "They argued about whether the law should change.", wrong: "They argued about if the law should change." },
      { rule: "what = สิ่งที่ (ข้างหลังขาด) · that = ว่า (ข้างหลังครบ)", right: "What she said surprised everyone.", wrong: "That she said surprised everyone." },
    ],
    trap: "\"Whether or not they are effective\" ✓ แต่ \"Whether or not are they effective\" ✗ — เรียงเหมือนบอกเล่าเสมอ",
    tip: "ตัวเลือกที่มี does/did หรือกริยาช่วยมาก่อนประธานหลังคำ Wh- = ตัดทิ้งได้เลย",
  },
  "Connectors": {
    focus: "ดู 2 อย่าง: ความหมาย (ขัดแย้ง/เหตุผล/จุดประสงค์) + สิ่งที่ตามหลัง (ประโยค หรือ คำนาม)",
    points: [
      { rule: "Although / Even though + S + V · Despite / In spite of + N หรือ V-ing", right: "Despite the heavy rain, the event continued.", wrong: "Despite the orders had been issued, many stayed home." },
      { rule: "Because + S + V · Because of / Due to + N", right: "Due to heavy traffic, we arrived late.", wrong: "Due to the traffic was heavy, we arrived late." },
      { rule: "so that + S + can/could (เพื่อที่จะ)", right: "He practised hard so that he could win the contest.", wrong: "He practised hard so as could to win the contest." },
      { rule: "whereas = แต่ในทางกลับกัน (เทียบ 2 อย่างที่ต่างกัน)", right: "The north is dry, whereas the south is humid.", wrong: "The north is dry, despite the south is humid." },
      { rule: "In addition to + N / V-ing · unless = if … not", right: "In addition to Thailand, the flu was found in Laos.", wrong: "In addition Thailand, the flu was found in Laos." },
    ],
    trap: "Although … but ✗ ใช้คู่กันไม่ได้ · Despite + S + V ✗ ผิดเสมอ",
    tip: "ช่องว่างหน้าคำนามเปล่า ๆ → Despite / Because of / Due to · หน้า S + V → Although / Because",
  },
  "Parallel Structure": {
    focus: "ของที่เชื่อมด้วย and / or / but หรือคู่เชื่อม ต้อง \"รูปเดียวกัน\" — หัวข้อที่ออกบ่อยอันดับต้น ๆ",
    points: [
      { rule: "A, B, and C ต้องรูปเดียวกัน (V-ing, V-ing, and V-ing)", right: "The workshop aims at improving communication, building teamwork, and developing leadership.", wrong: "The workshop aims at improving communication, building teamwork, and leadership development." },
      { rule: "กริยาที่เชื่อมด้วย and ต้อง tense เดียวกัน", right: "The wildfire destroyed homes and prompted evacuation alerts.", wrong: "The wildfire destroyed homes and prompts evacuation alerts." },
      { rule: "คู่เชื่อมต้องครบคู่: both…and / either…or / neither…nor", right: "Neither the players nor the coach knew why they lost.", wrong: "Neither the players or the coach knew why they lost." },
      { rule: "not only … but also: ของ 2 ฝั่งรูปเดียวกัน", right: "You need not only to exercise but also to get enough sleep.", wrong: "You need not only to exercise but also getting enough sleep." },
      { rule: "หลัง preposition ตัวเดียวกัน ทุกตัวเป็น V-ing", right: "The bridge is capable of withstanding earthquakes and remaining open.", wrong: "The bridge is capable of withstanding earthquakes and remains open." },
    ],
    trap: "neither ต้องคู่ nor · not only ต้องคู่ but also — เห็นคู่ผิดคือจุดผิดทันที",
    tip: "หาคำเชื่อม (and/or/but/nor) ก่อน แล้วเทียบรูปคำซ้าย–ขวาให้ตรงกัน",
  },
  "Non-finite Verbs": {
    focus: "ย่อประโยคด้วย V-ing / V3 / Having V3 — ถามตัวเองว่าคำนามนั้น \"ทำเอง\" หรือ \"ถูกทำ\"",
    points: [
      { rule: "Having + V3 = ทำเสร็จก่อนอีกเหตุการณ์", right: "Having finished the meeting early, she went home.", wrong: "Having finishing the meeting early, she went home." },
      { rule: "Having been + V3 = ถูกกระทำก่อน", right: "Having been delayed by the storm, we postponed the trip.", wrong: "Having delayed by the storm, we postponed the trip." },
      { rule: "N + V-ing (ทำเอง) / N + V3 (ถูกทำ)", right: "Fish caught in the river feed many families.", wrong: "Fish catching in the river feed many families." },
      { rule: "with + N + V-ing / V3 ท้ายประโยค", right: "Smog returned to Bangkok, with PM2.5 levels rising every day.", wrong: "Smog returned to Bangkok, with PM2.5 levels rose every day." },
      { rule: "วลีนำหน้า → ประธานหลังจุลภาคต้องเป็นผู้ทำ/ผู้ถูกทำจริง", right: "Written in simple language, the manual is easy to follow.", wrong: "Writing in simple language, the manual is easy to follow." },
    ],
    trap: "with + N + กริยาแท้ (rose / is) ✗ — หลัง with ต้องเป็น V-ing หรือ V3 เท่านั้น",
    tip: "แปลง่าย ๆ: คำนามนี้ \"ทำ\" → V-ing · \"ถูกทำ\" → V3 · \"ทำเสร็จแล้ว\" → Having V3",
  },
  "Comparison": {
    focus: "วัด the ของขั้นสุด · พหูพจน์หลัง one of the · คู่ more…, greater… · adverb ขั้นกว่า",
    points: [
      { rule: "ขั้นสุดต้องมี the · one of the + ขั้นสุด + N พหูพจน์", right: "It is one of the world's largest meat processors.", wrong: "It is one of the world's largest meat processor." },
      { rule: "more + N …, greater + N …", right: "Eating more vegetables brings greater health benefits.", wrong: "Eating much vegetables brings very health benefits." },
      { rule: "ขยายกริยาใช้ adverb: more easily than", right: "Omicron spreads more easily than Delta.", wrong: "Omicron spreads easier more than Delta." },
      { rule: "not as … as / twice as … as / ten times less than", right: "Her new song is not as popular as her first one.", wrong: "Her new song is as not popular as her first one." },
      { rule: "the + ขั้นกว่า …, the + ขั้นกว่า …", right: "The more you practise, the better you become.", wrong: "The more you practise, you become better." },
    ],
    trap: "\"it's best movie\" ✗ → the best · \"more easier\" ✗ ใช้ more ซ้อน -er ไม่ได้",
    tip: "เห็น than → ต้องเป็นขั้นกว่า · เห็น of all / in the world → ขั้นสุด + the",
  },
  "Word Order": {
    focus: "วัดลำดับคุณศัพท์ · ตำแหน่ง adverb · การสลับ (inversion) หลังคำปฏิเสธที่ขึ้นต้นประโยค",
    points: [
      { rule: "ลำดับคุณศัพท์: ความเห็น-ขนาด-อายุ-รูปร่าง-สี-ที่มา-วัสดุ + นาม", right: "a small ancient white Greek stone cottage", wrong: "a small ancient Greek stone white cottage" },
      { rule: "คำนามที่ขยายคำนาม วางติดหน้านามหลัก", right: "an immersive movie experience", wrong: "a movie immersive experience" },
      { rule: "adverb ห้ามแทรกระหว่างกริยากับกรรม หรือ prep กับนาม", right: "She recorded the results carefully in her notebook.", wrong: "She recorded the results in carefully her notebook." },
      { rule: "Not only / Never / Rarely / Only after … ขึ้นต้น → กริยาช่วย + S", right: "Not only did they win, but they also broke a record.", wrong: "Not only they did win, but they also broke a record." },
      { rule: "Not until … + กริยาช่วย + S", right: "Not until the water cools does it turn to ice.", wrong: "Not until the water cools it does turn to ice." },
    ],
    trap: "สลับเฉพาะตอน Not only / Never ขึ้นต้นประโยค — อยู่กลางประโยคไม่ต้องสลับ",
    tip: "A-Level ชอบให้เรียงคุณศัพท์หลายตัว: จำ \"ความเห็น-ขนาด-อายุ-สี-ชาติ-วัสดุ\"",
  },
  "Word Form": {
    focus: "ดูตำแหน่งแล้วเลือกชนิดคำ + คำบอกปริมาณ (some/any, amount/number, a/the)",
    points: [
      { rule: "หลัง 's / article / possessive → คำนาม", right: "Doctors explained the pet's suffering.", wrong: "Doctors explained the pet's suffer." },
      { rule: "ขยายคำนามใช้ adj · ขยายกริยา/คุณศัพท์ใช้ adv", right: "The heat was truly unusual.", wrong: "The heat was true unusual." },
      { rule: "-ing adj = ทำให้รู้สึก · -ed adj = รู้สึก / ถูกทำ", right: "The researchers presented shocking evidence.", wrong: "The researchers presented shocked evidence." },
      { rule: "คำปฏิเสธ (rarely, hardly, never) + any · ห้ามปฏิเสธซ้อน", right: "The team has rarely had any problems.", wrong: "The team has rarely had some problems." },
      { rule: "number + นามนับได้ · amount + นับไม่ได้ · 3.2 million (ไม่เติม s)", right: "WhatsApp removed 3.2 million accounts.", wrong: "WhatsApp removed 3.2 millions accounts." },
      { rule: "a = สิ่งที่พูดถึงครั้งแรก · the = รู้กันแล้วว่าอันไหน", right: "The company is developing a new feature.", wrong: "The company is developing the new feature. (พูดถึงครั้งแรก)" },
    ],
    trap: "maybe (adv. บางที) ≠ may be (อาจจะเป็น) · \"hasn't never\" ✗ ปฏิเสธซ้อน",
    tip: "ช่องว่างหน้าคำนาม = adj · หลัง the / 's = นาม · ขยาย adj = adv (-ly)",
  },
  "Subject-Verb Agreement": {
    focus: "ประธาน–กริยา และ สรรพนาม–คำนามที่แทน ต้องจำนวนตรงกัน · ข้อ Each of… ออกซ้ำมากที่สุด",
    points: [
      { rule: "Each of / One of + N พหูพจน์ → กริยาเอกพจน์", right: "Each of the applicants is expected to submit a report.", wrong: "Each of the applicants are expected to submit a report." },
      { rule: "everyone / a group of / the number of → เอกพจน์ · a number of → พหูพจน์", right: "Everyone in the seminar was given an outline.", wrong: "Everyone in the seminar were given an outline." },
      { rule: "police / people / cattle → พหูพจน์ · deer หลายตัว → พหูพจน์", right: "The police have arrested two men.", wrong: "The police has arrested two men." },
      { rule: "ประธานยาวมีวลีคั่น → ดูคำนามหลัก", right: "The list of approved items is on the website.", wrong: "The list of approved items are on the website." },
      { rule: "สรรพนามต้องตรงกับนามที่แทน · \"her friend and I\"", right: "People travel outside their usual environment.", wrong: "People travel outside its usual environment." },
    ],
    trap: "neither … nor / either … or → กริยาตามประธานตัวที่อยู่ใกล้: Neither the coach nor the players were ready.",
    tip: "ขีดฆ่าวลีที่คั่นกลาง (of…, with…, who…) แล้วจับคู่ประธานหลักกับกริยา",
  },
  "Gerund Infinitive": {
    focus: "รวมเรื่องกริยาที่ออกเฉพาะจุด — A-Level ออกหัวข้อนี้มากที่สุด (~30%)",
    points: [
      { rule: "advise / urge / ask / allow + O + to V", right: "Residents were urged to evacuate immediately.", wrong: "Residents were urged evacuating immediately." },
      { rule: "ban / prevent + O + from V-ing · have + O + V3 (causative)", right: "The school banned students from having phones in class.", wrong: "The school banned students to have phones in class." },
      { rule: "Had + S + V3 = If + S + had V3 (Type 3)", right: "Had the company invested more, it would have avoided the attack.", wrong: "If had the company invested more, it would have avoided the attack." },
      { rule: "Mixed: If + had V3 (อดีต), would + V (ปัจจุบัน)", right: "If they had built the dam, the town would be safer today.", wrong: "If they had built the dam, the town will be safer today." },
      { rule: "Passive = be + V3 · since / for → have been V-ing", right: "The project was regarded as a major success.", wrong: "The project was regarding as a major success." },
    ],
    trap: "Type 3 ต้องเป็น would have + V3: \"she would pass\" ✗ → would have passed",
    tip: "ดูกริยาตัวหน้าก่อน (urge / avoid / ban …) แล้วจำว่าต้องตามด้วย to V / V-ing / from V-ing",
  },
  "Prepositions": {
    focus: "ใช้กฎไม่ได้ ต้องจำเป็นชุด — ข้อสอบชอบใส่ preposition ผิดตัว (of / for / to / in / on / with)",
    points: [
      { rule: "under pressure · with the support of · in favor of · on behalf of", right: "She stayed calm under pressure.", wrong: "She stayed calm with pressure." },
      { rule: "take part in · rely on · consist of · contribute to", right: "About 3,000 people took part in the talks.", wrong: "About 3,000 people took part of the talks." },
      { rule: "the need for · demand for · access to · impact on · understanding of", right: "There is a growing need for data analysts.", wrong: "There is a growing need of data analysts." },
      { rule: "result in (ทำให้เกิด) / result from (เกิดจาก) · turn down (ปฏิเสธ)", right: "She politely turned down the job offer.", wrong: "She politely turned over the job offer." },
      { rule: "หลัง preposition ใช้ V-ing (committed to / look forward to + V-ing)", right: "She is committed to improving her English.", wrong: "She is committed to improve her English." },
    ],
    trap: "to ใน look forward to / be used to / committed to เป็น preposition → ตามด้วย V-ing",
    tip: "ท่องเป็นวลีทั้งชุดจากข้อที่ผิดในแบบฝึก แล้วจดลงสมุด",
  },
};

const SCHOOL_LOGO_URL = "/logo.png";
const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw6eP_NwYrbfKd3qou-sh_iG7Yu3eZNnONPWly709VbGu_D339rr_mQla5qbMrnbPM_aw/exec";
// ── ปฏิทินเปิดบทเรียน อ33206 ภาคเรียนที่ 2/2569 ──
//    ตารางสอน: จ. 6/2 (คาบ 3) · อ. 6/1 (คาบ 2) · พ. 6/3 (คาบ 2) → เปิดหัวข้อ "วันจันทร์ 00:00 น." ของสัปดาห์ที่สอนคาบนั้น
//    เปิดแล้วไม่ปิด (ทำย้อนหลังได้) · ถ้างด/เลื่อนสัปดาห์ไหน แก้วันที่ในตารางนี้จุดเดียว (รูปแบบ ปปปป-ดด-วว ค.ศ.)
const SESSION_OPEN: Record<number, string> = {
  1: '2026-11-02', 2: '2026-11-09', 3: '2026-11-16', 4: '2026-11-23', 5: '2026-11-30', 6: '2026-12-07',
  7: '2026-12-14', 8: '2026-12-21', 9: '2026-12-28', 10: '2027-01-04', 11: '2027-01-11', 12: '2027-01-18',
  13: '2027-01-25', 14: '2027-02-01',
};
const ADMIN_EMAILS = ['kawpeerawat@gmail.com']; // บัญชีครู: เห็น/ทำได้ทุกหัวข้อ และทดลองโดยไม่เปิดกล้องได้
// เปิดรายห้องตามตารางสอน: หัวข้อของคาบนั้นเปิด "ตอนเริ่มคาบ" ของห้องตัวเอง (เวลาไทย)
//   6/2 = จันทร์ 10:10 (คาบ 3) · 6/1 = อังคาร 09:20 (คาบ 2) · 6/3 = พุธ 09:20 (คาบ 2)
//   ห้องอื่น / ไม่ระบุห้อง → เปิดพร้อมห้องสุดท้ายของสัปดาห์ (พุธ 09:20)
const ROOM_SLOT: Record<string, { day: number; time: string }> = {
  '6/2': { day: 0, time: '10:10' }, '6/1': { day: 1, time: '09:20' }, '6/3': { day: 2, time: '09:20' },
};
const normRoom = (room?: string) => {
  const m = String(room || '').replace(/\s/g, '').match(/(\d+)\/(\d+)/);
  return m ? `${m[1]}/${m[2]}` : '';
};
const slotOf = (room?: string) => ROOM_SLOT[normRoom(room)] || ROOM_SLOT['6/3'];
// วัน-เวลาที่เปิด (รูปแบบ YYYY-MM-DDTHH:MM เวลาไทย)
const sessionOpenAt = (n: number, room?: string) => {
  const monday = SESSION_OPEN[n]; if (!monday) return '9999-12-31T00:00';
  const { day, time } = slotOf(room);
  const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + day);
  return `${d.toISOString().slice(0, 10)}T${time}`;
};
const thaiNowStr = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16);
const isSessionOpen = (n: number, room?: string) => thaiNowStr() >= sessionOpenAt(n, room);
const openDateText = (n: number, room?: string) => {
  const at = sessionOpenAt(n, room); if (at.startsWith('9999')) return '';
  const [y, m, dd] = at.slice(0, 10).split('-').map(Number);
  const wd = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][new Date(`${at.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  return `${wd} ${dd} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]} ${(y + 543) % 100} · ${at.slice(11)} น.`;
};
// เวลาต่อข้อเมื่อไม่เปิดกล้อง: 20 วิ/ข้อ ทุกส่วน — สั้นพอไม่ให้แคปจอไปถาม AI ทัน (แรงจูงใจให้เปิดกล้อง)
const TIME_LIMIT: Record<ExamPart, number> = { error: 20, sc: 20, cloze: 20 };
// เปิดกล้องตรวจใบหน้า = ได้เวลาเพิ่ม (แรงจูงใจให้เปิดกล้องเอง · Grammar ต้องใช้สมาธิคิด)
const TIME_LIMIT_CAM: Record<ExamPart, number> = { error: 75, sc: 75, cloze: 90 };
const timeFor = (p: ExamPart, withCam: boolean) => (withCam ? TIME_LIMIT_CAM : TIME_LIMIT)[p];
const PART_INFO: Record<ExamPart, { label: string; short: string; icon: string; badge: string; bar: string; box: string; text: string }> = {
  error: { label: 'Part 1: Error ID', short: 'Error ID', icon: '🔍', badge: 'bg-orange-600', bar: 'bg-orange-500', box: 'bg-orange-50 border-orange-100', text: 'text-orange-700' },
  sc: { label: 'Part 2: Sentence', short: 'Sentence', icon: '🧩', badge: 'bg-purple-600', bar: 'bg-purple-500', box: 'bg-purple-50 border-purple-100', text: 'text-purple-700' },
  cloze: { label: 'Part 3: Cloze Test', short: 'Cloze', icon: '📄', badge: 'bg-[#003399]', bar: 'bg-[#003399]', box: 'bg-blue-50 border-blue-100', text: 'text-[#003399]' },
};

// ── Helpers ───────────────────────────────────────────────────
function getProgressColor(pct: number) {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 60) return 'bg-yellow-400';
  if (pct >= 40) return 'bg-orange-400';
  return 'bg-red-500';
}
function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => 0.5 - Math.random());
}
function partOf(q: { question_format: string }): ExamPart {
  if (q.question_format === 'Error Identification') return 'error';
  if (q.question_format === 'Cloze Test') return 'cloze';
  return 'sc';
}
// "Error 5 · Sentence 5 · Cloze 5" ตามจำนวนข้อจริงในชุด
function partCounts(set?: { items: { question_format: string }[] }): Record<ExamPart, number> {
  const c: Record<ExamPart, number> = { error: 0, sc: 0, cloze: 0 };
  (set?.items || []).forEach(q => { c[partOf(q)]++; });
  return c;
}
function partLabel(set?: { items: { question_format: string }[] }): string {
  const c = partCounts(set);
  return `Error ${c.error} · Sentence ${c.sc} · Cloze ${c.cloze}`;
}
// เวลาสูงสุดที่ใช้ทำทั้งชุด (นาที) — ไว้บอกนักเรียนว่าจบในคาบแน่นอน
function maxMinutes(set?: { items: { question_format: string }[] }, withCam = false): number {
  const c = partCounts(set);
  const T = withCam ? TIME_LIMIT_CAM : TIME_LIMIT;
  return Math.ceil((c.error * T.error + c.sc * T.sc + c.cloze * T.cloze) / 60);
}
// คีย์คะแนนดีสุดรายพาร์ท เช่น T-SS:E / T-SS:S / T-SS:C (ให้หน้า Admin ดูได้ว่าใครทำพาร์ทไหนแล้ว)
const PART_KEY: Record<ExamPart, string> = { error: 'E', sc: 'S', cloze: 'C' };
const partBestKey = (setId: string, p: ExamPart) => `${setId}:${PART_KEY[p]}`;

// ห้องเรียน (ตามทะเบียน) สำหรับช่องเลือกห้อง
const ROOMS = ['6/1', '6/2', '6/3', '6/4', '6/5'];

// ประโยคใน passage ที่มีช่องว่างข้อนั้น (ใช้แสดงตอนเฉลย)
function clozeSentence(passage: string, n: number): string {
  const marker = `(${n})________`; // รองรับเลขช่อง 2 หลัก (ชุดรวมมี 10 ช่อง)
  const sentences = passage.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["”’)]*\s*/g) || [passage];
  const hit = sentences.find(s => s.includes(marker)) || '';
  return hit.trim().replace(/\((\d+)\)_{8}/g, (_m, d) => (Number(d) === n ? `(${d}) ______` : '…'));
}

// ── Passage renderer (Cloze) ─────────────────────────────────
function renderClozePassage(
  passage: string,
  currentBlank: number | null,
  answers: Record<number, string>,
  correct: Record<number, string>,
) {
  const parts = passage.split(/(\(\d+\)_{8})/g);
  return parts.map((part, i) => {
    const m = part.match(/^\((\d+)\)_{8}$/);
    if (!m) {
      // คงการขึ้นย่อหน้าใหม่ของ passage
      return <span key={i}>{part.split('\n').map((line, j, arr) => (
        <React.Fragment key={j}>{line}{j < arr.length - 1 && <br />}</React.Fragment>
      ))}</span>;
    }
    const n = parseInt(m[1]);
    const ans = answers[n];
    if (n === currentBlank && ans === undefined) {
      return <span key={i} id="cloze-current" className="inline-block mx-0.5 px-2 py-0.5 bg-[#FFD700] text-[#003399] font-black rounded-lg text-sm border-2 border-[#003399] animate-pulse">({n}) ????</span>;
    }
    if (ans !== undefined) {
      const ok = ans === correct[n];
      return (
        <span key={i} id={n === currentBlank ? 'cloze-current' : undefined} className={`inline-block mx-0.5 px-2 py-0.5 font-black rounded-lg text-sm border-2 ${ok ? 'bg-green-100 text-green-700 border-green-400' : 'bg-red-100 text-red-700 border-red-400'}`}>
          ({n}) {shortAnswer(ans)}
        </span>
      );
    }
    return <span key={i} className="inline-block mx-0.5 px-2 py-0.5 bg-gray-100 text-gray-500 font-bold rounded-lg text-sm border border-gray-300">({n}) ________</span>;
  });
}

// ══════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { data: session } = useSession();
  const [cloudRoom, setCloudRoom] = useState('');
  const [, setClockTick] = useState(0); // อัปเดตทุก 30 วิ → หัวข้อปลดล็อกเองเมื่อถึงเวลาเริ่มคาบ
  useEffect(() => { const t = setInterval(() => setClockTick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const isTeacherAcct = ADMIN_EMAILS.includes((session?.user?.email || '').toLowerCase());
  const [asStudent, setAsStudent] = useState(false); // ครูกด "ดูแบบนักเรียน" → เห็นล็อก/กล้องบังคับเหมือนนักเรียน
  const isTeacher = isTeacherAcct && !asStudent;

  // ── Auth / name state ──────────────────────────────────────
  const [gameState, setGameState] = useState<'START' | 'DASHBOARD' | 'CAM_CHECK' | 'EXAM_QUIZ' | 'EXAM_RESULT'>('START');
  const [studentName, setStudentName] = useState('');
  // ข้อมูลนักเรียนแยกช่อง (ชื่อ-นามสกุล / ห้อง / เลขที่) → ครูค้นหา/จับคู่ทะเบียนได้แม่นยำ
  const [fullName, setFullName] = useState('');
  const [room, setRoom] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const profileOk = fullName.trim().length >= 2 && ROOMS.includes(room) && /^\d{1,2}$/.test(studentNo) && parseInt(studentNo) >= 1 && parseInt(studentNo) <= 60;
  const profile = profileOk ? { fullName: fullName.trim(), room, no: parseInt(studentNo) } : undefined;
  const schedRoom = cloudRoom || profile?.room || room; // ห้องที่ใช้คำนวณวันเปิดหัวข้อ
  const [email, setEmail] = useState('');
  const [deviceFingerprint, setDeviceFingerprint] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notesTopic, setNotesTopic] = useState<string | null>(null); // หัวข้อที่กำลังเปิดดู "เนื้อหา" (modal ทบทวน)
  const [loginError, setLoginError] = useState<string | null>(null);   // ข้อความเมื่อล็อกอิน Google ไม่สำเร็จ
  const [signingIn, setSigningIn] = useState(false);
  const [examLoadError, setExamLoadError] = useState(false);            // โหลด examSets.json ไม่สำเร็จ

  // ── ชุดข้อสอบรายหัวข้อ + คะแนนดีที่สุด ─────────────────────
  const [examSets, setExamSets] = useState<ExamSet[]>([]);
  const [mixedSets, setMixedSets] = useState<ExamSet[]>([]); // แบบทดสอบรวมทุกหัวข้อ 5 ชุด (ฝึกฝนตนเอง — ไม่นับรวมการพิชิตหัวข้อ)
  const [setBest, setSetBest] = useState<Record<string, number>>({});
  const [cloudSetBest, setCloudSetBest] = useState<Record<string, number> | null>(null); // null = ยังโหลดจากคลาวด์ไม่เสร็จ

  // ── สถานะการทำข้อสอบ ───────────────────────────────────────
  const [selectedTopic, setSelectedTopic] = useState('');
  const [currentExamSetId, setCurrentExamSetId] = useState<string | null>(null);
  const [examQuestions, setExamQuestions] = useState<ExamItem[]>([]);
  const [examIndex, setExamIndex] = useState(0);
  const [examSelected, setExamSelected] = useState<string | null>(null);
  const [examAnswered, setExamAnswered] = useState(false);
  const [examResults, setExamResults] = useState<{ q: ExamItem; correct: boolean; selected: string }[]>([]);
  const [examTimeLeft, setExamTimeLeft] = useState(TIME_LIMIT.error);

  // ── ระบบกันการใช้ AI (กติกาเดียวกับ Vocab Master) ─────────────
  //  ออกจากหน้าแอป / หน้าต่างอื่นบังนานเกิน 3 วิ / กล้องไม่เห็นใบหน้า ระหว่างข้อที่ยังไม่ตอบ
  //  → ช่วงหักคะแนน: ข้อนั้นไม่ได้คะแนน · ช่วงทดลอง: บันทึกให้ครูเห็นอย่างเดียว
  const [pendingPart, setPendingPart] = useState<ExamPart | null>(null);   // ทำเฉพาะพาร์ทนี้ (5 ข้อ) — null = ทั้งชุด 15 ข้อ
  const [currentPart, setCurrentPart] = useState<ExamPart | null>(null);
  const [pendingSet, setPendingSet] = useState<ExamSet | null>(null); // ชุดที่รอเริ่ม (หน้าตรวจกล้อง)
  const [gMode, setGMode] = useState(guardMode());
  const voidedRef = useRef(0);       // ข้อที่ไม่ได้คะแนนเพราะระบบกัน AI
  const camUsedRef = useRef(false);  // รอบนี้เปิดกล้องตรวจใบหน้า
  const watching = gameState === 'EXAM_QUIZ' && !examAnswered;
  const [autoSkip, setAutoSkip] = useState(false); // กล้อง: ข้ามไปข้อถัดไปทันทีหลังบันทึกว่าได้ 0
  const penalize = (kind: LeaveKind): boolean => {
    if (gameState !== 'EXAM_QUIZ' || examAnswered) return false;
    // กล้องไม่เห็นใบหน้าเกิน 0.8 วิ / เห็นมือถือในกล้อง → ข้ามข้อทันทีตั้งแต่วันนี้ · ออกจากหน้าแอป/หน้าต่างบัง → ตัดข้อเมื่อถึงช่วงหักคะแนน
    const camKind = kind === 'face' || kind === 'phone';
    if (!camKind && gMode !== 'enforce') return false;
    voidedRef.current++;
    handleExamAnswer(LEFT_ANSWER[kind]);
    if (camKind) setAutoSkip(true);
    return true;
  };
  const penalizeRef = useRef(penalize);
  useEffect(() => { penalizeRef.current = penalize; });
  const guard = useLeaveGuard(gameState === 'EXAM_QUIZ', watching, (kind) => penalizeRef.current(kind));
  const cam = useFaceCheck(watching && camUsedRef.current, () => guard.record('face', true), () => guard.record('phone', true));
  // หลังข้อถูกข้ามเพราะกล้อง → ไปข้อถัดไปทันที (รอให้คำตอบ 0 คะแนนถูกบันทึกก่อน)
  useEffect(() => {
    if (!autoSkip || !examAnswered || gameState !== 'EXAM_QUIZ') return;
    setAutoSkip(false);
    handleExamNext(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSkip, examAnswered, gameState]);
  // ออกจากหน้าตรวจกล้อง/หน้าทำแบบฝึก → ปิดกล้องทันที
  useEffect(() => {
    if (gameState !== 'CAM_CHECK' && gameState !== 'EXAM_QUIZ' && cam.status !== 'off') cam.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  // ── แจ้งเตือนเมื่อบันทึกความก้าวหน้าขึ้นคลาวด์ไม่สำเร็จ ─────────
  const [saveFailed, setSaveFailed] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);
  const lastSavePayloadRef = useRef<Parameters<typeof saveGrammarProgress>[0] | null>(null);

  // ห่อ saveGrammarProgress ทุกจุดด้วยฟังก์ชันนี้ → ถ้าล้มเหลวจะโชว์แบนเนอร์เตือน + เก็บ payload ไว้กดลองใหม่ได้
  const attemptSave = useCallback(async (payload: Parameters<typeof saveGrammarProgress>[0]) => {
    lastSavePayloadRef.current = payload;
    const ok = await saveGrammarProgress(payload);
    if (ok) {
      setSaveFailed(false);
      lastSavePayloadRef.current = null;
    } else {
      setSaveFailed(true);
    }
    return ok;
  }, []);

  const handleRetrySave = async () => {
    if (!lastSavePayloadRef.current || retryingSave) return;
    setRetryingSave(true);
    await attemptSave(lastSavePayloadRef.current);
    setRetryingSave(false);
  };

  useEffect(() => {
    if (session?.user?.email) setEmail(session.user.email);
  }, [session]);

  // ── Device Fingerprint ────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = [
        navigator.userAgent,
        screen.width + 'x' + screen.height,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.language,
        screen.colorDepth,
      ].join('|');
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
      setDeviceFingerprint(Math.abs(h).toString(16));
    } catch {}
  }, []);

  // ── จำข้อมูลนักเรียนไว้ในเครื่อง (ไม่ต้องพิมพ์ใหม่ทุกครั้ง) ──
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('gm_profile') || 'null');
      if (saved && typeof saved === 'object') {
        if (saved.fullName) setFullName(String(saved.fullName));
        if (saved.room) setRoom(String(saved.room));
        if (saved.no) setStudentNo(String(saved.no));
      }
    } catch {}
  }, []);

  // ── โหลดชุดข้อสอบ ──
  useEffect(() => {
    fetch('/mixedSets.json')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: ExamSet[]) => setMixedSets(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch('/examSets.json')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: ExamSet[]) => { setExamSets(Array.isArray(d) ? d : []); setExamLoadError(!Array.isArray(d) || d.length === 0); })
      .catch(() => setExamLoadError(true));
  }, []);

  // ดึงคะแนนดีที่สุดของแต่ละชุด (set_best_*) จากเครื่อง — คะแนนชุดของเทอมก่อน (ไม่ขึ้นต้น T-) ลบทิ้ง
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const old: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('set_best_') && !k.startsWith('set_best_T-')) old.push(k);
      }
      old.forEach(k => localStorage.removeItem(k));
    } catch {}
    const m: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('set_best_')) {
        const v = parseInt(localStorage.getItem(k) || '0');
        if (v > 0) m[k.slice('set_best_'.length)] = v;
      }
    }
    if (Object.keys(m).length) setSetBest(prev => {
      const n = { ...prev };
      Object.entries(m).forEach(([id, v]) => { n[id] = Math.max(n[id] ?? 0, v); });
      return n;
    });
  }, []);

  // โหลดคะแนนจากคลาวด์ตอนล็อกอิน (ใช้ได้ทุกเครื่องที่ใช้อีเมลเดียวกัน)
  useEffect(() => {
    const cloudEmail = (session?.user?.email || email || '').trim().toLowerCase();
    if (!cloudEmail || !cloudEmail.includes('@')) return;
    let alive = true;
    loadGrammarProgress(cloudEmail).then(p => {
      if (!alive) return;
      const cloud = p?.setBest || {};
      setCloudSetBest(cloud);
      // เคยกรอกข้อมูลไว้บนคลาวด์ (เครื่องอื่น) → เติมให้อัตโนมัติถ้าช่องยังว่าง
      const cp = p?.profile;
      if (cp?.room) setCloudRoom(String(cp.room)); // ห้องที่บันทึกไว้ครั้งแรก → ใช้ล็อกตารางเรียน (เปลี่ยนห้องในฟอร์มไม่ช่วยให้เปิดก่อน)
      if (cp) {
        setFullName(prev => prev || cp.fullName || '');
        setRoom(prev => prev || cp.room || '');
        setStudentNo(prev => prev || (cp.no ? String(cp.no) : ''));
      }
      if (Object.keys(cloud).length) setSetBest(prev => {
        const m = { ...prev };
        Object.entries(cloud).forEach(([k, v]) => { m[k] = Math.max(m[k] ?? 0, v ?? 0); });
        return m;
      });
    });
    return () => { alive = false; };
  }, [session?.user?.email, email]);

  // ข้อมูลชุดข้อสอบแบบย่อ (ส่งให้คลาวด์คำนวณหัวข้อที่พิชิต)
  const examSetInfo = React.useMemo(
    () => examSets.map(s => { const c = partCounts(s); return { id: s.id, topic: s.topic, total: s.items?.length || 0, parts: { E: c.error, S: c.sc, C: c.cloze } }; }),
    [examSets]
  );
  // id ชุดของเทอมนี้ทั้งหมด (หัวข้อ + ชุดรวม) — ใช้กรองคะแนนในเครื่องก่อนส่งขึ้นคลาวด์
  const currentSetIds = React.useMemo(
    () => new Set([...examSets.map(s => s.id), ...mixedSets.map(s => s.id)]),
    [examSets, mixedSets]
  );

  const getBestScore = (setId: string): number => {
    let best = setBest[setId] ?? 0;
    try { best = Math.max(best, parseInt(localStorage.getItem(`set_best_${setId}`) || '0')); } catch {}
    return best;
  };

  // คะแนนดิบ (undefined = ไม่เคยทำ) รวมคลาวด์ + ในเครื่อง — ใช้ตัดสินผ่านรายพาร์ท
  const rawBest = (k: string): number | undefined => {
    let v: number | undefined = setBest[k];
    try { const l = localStorage.getItem(`set_best_${k}`); if (l !== null) v = Math.max(v ?? 0, parseInt(l) || 0); } catch {}
    return v;
  };
  const bestRecOf = (set: ExamSet): Record<string, number> => {
    const r: Record<string, number> = {};
    [set.id, ...(['error', 'sc', 'cloze'] as ExamPart[]).map(p => partBestKey(set.id, p))].forEach(k => { const v = rawBest(k); if (v !== undefined) r[k] = v; });
    return r;
  };
  const setMeta = (set: ExamSet) => { const c = partCounts(set); return { id: set.id, topic: set.topic, total: set.items?.length || 0, parts: { E: c.error, S: c.sc, C: c.cloze } }; };
  const isSetPassed = (set?: ExamSet) => !!set && topicPassed(bestRecOf(set), setMeta(set));
  // คะแนนรวมที่แสดง = ดีสุดแต่ละพาร์ทรวมกัน (ซ่อมพาร์ทไหนก็นับ) หรือคะแนนรวมรอบเต็ม แล้วแต่อย่างไหนมากกว่า
  const topicBest = (set: ExamSet): number => {
    const sum = (['error', 'sc', 'cloze'] as ExamPart[]).reduce((a, p) => a + Math.min(getBestScore(partBestKey(set.id, p)), partCounts(set)[p]), 0);
    return Math.min(Math.max(getBestScore(set.id), sum), set.items?.length || 0);
  };
  // หัวข้อที่ผ่าน = ทุกพาร์ทได้ ≥ 3/5
  const masteredFrom = (best: Record<string, number>) =>
    examSetInfo.filter(s => topicPassed(best, s)).map(s => s.topic);

  // ดันคะแนนในเครื่องขึ้นคลาวด์เมื่ออยู่หน้าหลัก (เผื่อเคยบันทึกไม่สำเร็จ) — ไม่นับเป็นรอบ
  useEffect(() => {
    if (gameState !== 'DASHBOARD' || cloudSetBest === null || examSetInfo.length === 0) return;
    const syncEmail = (session?.user?.email || email || '').trim().toLowerCase();
    if (!syncEmail || !syncEmail.includes('@')) return;
    const localSetBest: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('set_best_')) {
        const id = k.slice('set_best_'.length);
        if (!currentSetIds.has(id.split(':')[0])) continue; // คะแนนชุดของเทอมก่อน → ไม่ส่งขึ้นคลาวด์
        const v = parseInt(localStorage.getItem(k) || '0');
        if (v > 0) localSetBest[id] = v;
      }
    }
    const needsPush = Object.keys(localSetBest).some(id => (localSetBest[id] || 0) > (cloudSetBest[id] || 0));
    if (!needsPush) return;
    attemptSave({
      name: studentName || syncEmail, email: syncEmail,
      masteredTopics: masteredFrom({ ...cloudSetBest, ...localSetBest }),
      setScores: localSetBest, countRound: false, examSets: examSetInfo, profile,
    }).then(ok => {
      if (ok) setCloudSetBest(prev => {
        const n = { ...(prev || {}) };
        Object.entries(localSetBest).forEach(([k, v]) => { n[k] = Math.max(n[k] ?? 0, v); });
        return n;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, cloudSetBest, examSetInfo, currentSetIds, session?.user?.email, email, studentName, attemptSave]);

  // ── จับเวลาต่อข้อ (หมดเวลา = นับผิด) — รีเซ็ตเวลาทำใน handler (start/next) ──
  useEffect(() => {
    if (gameState !== 'EXAM_QUIZ' || examAnswered) return;
    if (examTimeLeft === 0) { handleExamAnswer("Time Out"); return; }
    const t = setInterval(() => setExamTimeLeft(prev => prev - 1), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examTimeLeft, gameState, examAnswered]);

  // Cloze: เลื่อนกรอบบทความให้ช่องที่กำลังทำอยู่กลางกรอบเสมอ (บทความยาว ไม่ต้องเลื่อนหาเอง)
  useEffect(() => {
    if (gameState !== 'EXAM_QUIZ') return;
    const box = document.getElementById('cloze-box');
    const el = document.getElementById('cloze-current');
    if (box && el) box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 2);
  }, [gameState, examIndex, examAnswered]);

  const overallStats = React.useMemo(() => {
    const partSum = (x: ExamSet) => { const c = partCounts(x); return (['error', 'sc', 'cloze'] as ExamPart[]).reduce((a, p) => a + Math.min(setBest[partBestKey(x.id, p)] ?? 0, c[p]), 0); };
    const examBest = examSets.reduce((s, x) => s + Math.min(Math.max(setBest[x.id] ?? 0, partSum(x)), x.items?.length || 0), 0);
    const examTotal = examSets.reduce((s, x) => s + (x.items?.length || 0), 0);
    const pctExact = examTotal > 0 ? Math.min((examBest / examTotal) * 100, 100) : 0;
    const mastered = examSets.filter(x => topicPassed(setBest, { id: x.id, topic: x.topic, total: x.items?.length || 0, parts: { E: partCounts(x).error, S: partCounts(x).sc, C: partCounts(x).cloze } })).length;
    return { examBest, examTotal, pctExact, mastered };
  }, [setBest, examSets]);

  // ── Auth handlers ──────────────────────────────────────────
  const handleStudentLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !email.trim() || !email.includes('@')) return;
    // ชื่อรวม (ใช้กับ Google Sheet / หน้า Admin) เช่น "สมหญิง ใจดี ม.6/1 เลขที่ 12"
    setStudentName(`${profile.fullName} ม.${profile.room} เลขที่ ${profile.no}`);
    try { localStorage.setItem('gm_profile', JSON.stringify(profile)); } catch {}
    setGameState('DASHBOARD');
  };
  const handleLogout = () => { setStudentName(''); setEmail(''); setGameState('START'); };

  const submitToSheet = (payload: Record<string, string>): Promise<void> => {
    const params = new URLSearchParams({ name: studentName, email, ...payload });
    return fetch(`${GOOGLE_SHEET_WEBAPP_URL}?${params}`, { mode: 'no-cors' })
      .then(() => {})
      .catch(err => { console.error('Sheet sync error:', err); });
  };

  // ── บันทึกคะแนนดีสุดของชุด + ซิงก์ขึ้นคลาวด์ (นับเป็น 1 รอบ) ──
  // parts = คะแนนรอบนี้แยกพาร์ท → เก็บคะแนนดีสุดรายพาร์ทด้วย (T-SS:E / T-SS:S / T-SS:C)
  const syncSetScore = (setId: string, score: number, parts?: Partial<Record<ExamPart, number>>, g?: GuardStats, onlyPart?: ExamPart | null) => {
    const scores: Record<string, number> = onlyPart ? {} : { [setId]: Math.max(getBestScore(setId), score) }; // ทำเฉพาะพาร์ท → ไม่แตะคะแนนรวมรอบเต็ม
    (Object.keys(parts || {}) as ExamPart[]).filter(p => !onlyPart || p === onlyPart).forEach(p => {
      const k = partBestKey(setId, p);
      scores[k] = Math.max(getBestScore(k), parts?.[p] ?? 0);
    });
    try { Object.entries(scores).forEach(([k, v]) => localStorage.setItem(`set_best_${k}`, String(v))); } catch {}
    const merged = { ...setBest, ...scores };
    setSetBest(merged);
    attemptSave({
      name: studentName, email, masteredTopics: masteredFrom(merged),
      setScores: scores, examSets: examSetInfo, profile, lastSet: { id: setId, score, ...(onlyPart ? { p: PART_KEY[onlyPart] as 'E' | 'S' | 'C' } : {}) }, guard: g,
    }).then(ok => {
      if (ok) setCloudSetBest(prev => {
        const n = { ...(prev || {}) };
        Object.entries(scores).forEach(([k, v]) => { n[k] = Math.max(n[k] ?? 0, v); });
        return n;
      });
    });
  };

  // ── ข้อสอบรายหัวข้อ: Error 5 → Sentence 5 → Cloze 5 (15 ข้อ จบในคาบ) ──
  const getExamSet = (topicKey: string) => examSets.find(s => s.topic === topicKey);
  const currentSet = examSets.find(s => s.id === currentExamSetId) || mixedSets.find(s => s.id === currentExamSetId);
  const isMixed = currentSet?.topic === 'MIXED';

  const startExam = (topicKey: string, part: ExamPart | null = null) => {
    const set = getExamSet(topicKey);
    if (!set || !set.items?.length) { alert("⚠️ ยังโหลดข้อสอบหัวข้อนี้ไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
    startExamSet(set, part);
  };

  // เริ่มทำชุดใดก็ได้ → ผ่านหน้าตรวจกล้องก่อน (ชุดรายหัวข้อ 15 ข้อ หรือ ชุดรวม 30 ข้อ)
  const startExamSet = (set: ExamSet, part: ExamPart | null = null) => {
    if (!set.items?.length) { alert("⚠️ ยังโหลดข้อสอบชุดนี้ไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
    const sn = set.topic === 'MIXED' ? 14 : (TOPIC_META.find(t => t.key === set.topic)?.session ?? 1);
    if (!isTeacher && !isSessionOpen(sn, schedRoom)) { alert(`🔒 หัวข้อนี้ยังไม่ถึงคาบเรียนของห้อง ม.${normRoom(schedRoom) || '-'} — เปิดให้ทำ ${openDateText(sn, schedRoom)}`); return; }
    setPendingSet(set);
    setPendingPart(part);
    setGMode(guardMode());
    setGameState('CAM_CHECK');
  };

  // เริ่มทำจริง (หลังหน้าตรวจกล้อง) — withCam = เปิดกล้องตรวจใบหน้าระหว่างรอบนี้
  const beginExamSet = (set: ExamSet, withCam: boolean, part: ExamPart | null = null) => {
    if (!withCam && !isTeacher) return; // นักเรียนต้องเปิดกล้องทุกครั้ง
    camUsedRef.current = withCam;
    if (!withCam) cam.stop();
    voidedRef.current = 0;
    guard.reset();
    cam.resetMiss();
    setPendingSet(null);
    setPendingPart(null);
    setCurrentPart(part);
    const errs = shuffle(set.items.filter(q => partOf(q) === 'error'));                                   // Error: คงลำดับตัวเลือก A–D
    const scs = shuffle(set.items.filter(q => partOf(q) === 'sc')).map(q => ({ ...q, options: shuffle(q.options) }));
    const cloze = set.items.filter(q => partOf(q) === 'cloze').sort((a, b) => (a.number || 0) - (b.number || 0)); // Cloze: เรียงตามช่อง 1→n
    const qs = [...errs, ...scs, ...cloze].filter(q => !part || partOf(q) === part);
    setSelectedTopic(set.topic);
    setCurrentExamSetId(set.id);
    setExamQuestions(qs);
    setExamIndex(0); setExamSelected(null); setExamAnswered(false);
    setExamResults([]); setExamTimeLeft(timeFor(partOf(qs[0]), withCam));
    setGameState('EXAM_QUIZ');
  };

  const handleExamAnswer = (answer: string) => {
    if (examAnswered) return;
    const q = examQuestions[examIndex];
    if (!q) return;
    setExamSelected(answer);
    setExamAnswered(true);
    setExamResults(prev => [...prev, { q, correct: answer === q.correct_answer, selected: answer }]);
  };

  const handleExamNext = (keepNotice = false) => {
    const nextIdx = examIndex + 1;
    if (nextIdx < examQuestions.length) {
      setExamIndex(nextIdx);
      setExamTimeLeft(timeFor(partOf(examQuestions[nextIdx]), camUsedRef.current));
      setExamSelected(null); setExamAnswered(false);
      if (!keepNotice) guard.clearNotice();
      cam.resetMiss();
      return;
    }
    const correctCount = examResults.filter(r => r.correct).length;
    const totalCount = examQuestions.length;
    const g = guard.stats(voidedRef.current, camUsedRef.current, gMode);
    const partScore = (p: ExamPart) => `${examResults.filter(r => partOf(r.q) === p && r.correct).length}/${examResults.filter(r => partOf(r.q) === p).length}`;
    setIsSubmitting(true);
    submitToSheet({
      part: currentPart ? PART_INFO[currentPart].short : 'ทั้งชุด',
      type: isMixed ? 'Mixed Practice' : 'Topic Exam', topic: isMixed ? (currentSet?.title || 'MIXED') : selectedTopic,
      score: String(correctCount), total: String(totalCount),
      progress: Math.round((correctCount / Math.max(totalCount, 1)) * 100) + "%",
      error: partScore('error'), sentence: partScore('sc'), cloze: partScore('cloze'),
      fingerprint: deviceFingerprint,
      guard: `ออก ${g.gl} · ไม่เห็นหน้า ${g.gf} · มือถือ ${g.gp ?? 0} · ไม่นับ ${g.gv} · กล้อง ${g.cam ? 'เปิด' : 'ปิด'} · ${g.gm}`,
    }).finally(() => setIsSubmitting(false));
    const partCorrect = (p: ExamPart) => examResults.filter(r => partOf(r.q) === p && r.correct).length;
    if (currentExamSetId) syncSetScore(currentExamSetId, correctCount, { error: partCorrect('error'), sc: partCorrect('sc'), cloze: partCorrect('cloze') }, g, currentPart);
    cam.stop();
    setGameState('EXAM_RESULT');
  };

  const topicLabel = (key: string) => TOPIC_META.find(t => t.key === key)?.label || key;
  const setLabel = isMixed ? `🎯 ${currentSet?.title || 'ชุดรวม'}` : topicLabel(selectedTopic);

  // ══════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center p-4 font-sans text-gray-800 select-none" onContextMenu={e => e.preventDefault()}>
      {/* ⚠️ แบนเนอร์เตือน: บันทึกความก้าวหน้าขึ้นคลาวด์ไม่สำเร็จ (ลอยอยู่บนสุด เห็นได้ทุกหน้าจอ) */}
      {saveFailed && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white px-4 py-3 shadow-lg">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs md:text-sm font-bold leading-snug">
              <span className="text-lg flex-shrink-0">⚠️</span>
              <span>บันทึกความก้าวหน้าไม่สำเร็จ! คะแนนรอบนี้อาจไม่ถูกบันทึก กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดลองใหม่</span>
            </div>
            <button
              onClick={handleRetrySave}
              disabled={retryingSave}
              className="flex-shrink-0 bg-white text-red-600 font-black text-xs px-3 py-2 rounded-lg hover:bg-red-50 disabled:opacity-60 whitespace-nowrap"
            >
              {retryingSave ? '⏳ กำลังลอง...' : '🔄 ลองอีกครั้ง'}
            </button>
          </div>
        </div>
      )}

      {/* 📖 Modal เนื้อหาทบทวนไวยากรณ์ต่อหัวข้อ */}
      {notesTopic && GRAMMAR_NOTES[notesTopic] && (() => {
        const meta = TOPIC_META.find(t => t.key === notesTopic);
        const note = GRAMMAR_NOTES[notesTopic];
        return (
          <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setNotesTopic(null)}>
            <div
              className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border-t-[10px] border-[#003399] max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b-2 border-gray-50 px-6 py-4 flex items-start justify-between gap-3 rounded-t-2xl">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{meta?.icon}</span>
                  <div>
                    <div className="text-base font-black text-[#003399] leading-tight">{meta?.label}</div>
                    {meta?.subtitle && <div className="text-[11px] text-gray-400 font-medium mt-0.5">{meta.subtitle}</div>}
                  </div>
                </div>
                <button onClick={() => setNotesTopic(null)} className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-black text-sm flex items-center justify-center transition-all">✕</button>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* สถิติการออกสอบ + ออกสอบในรูปแบบไหน */}
                <div className="flex flex-wrap gap-1.5">
                  {meta && <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200">NETSAT ~{meta.share}%</span>}
                  {meta && <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${meta.alevel > 0 ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>A-Level {meta.alevel > 0 ? `~${meta.alevel}%` : '–'}</span>}
                  {meta && <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-[#003399]/10 text-[#003399] border border-[#003399]/20">คาบที่ {meta.session}</span>}
                </div>
                <p className="text-xs text-gray-700 font-bold leading-relaxed bg-blue-50 border border-blue-100 rounded-xl px-3.5 py-2.5">🎯 {note.focus}</p>

                <div className="space-y-3">
                  {note.points.map((p, i) => (
                    <div key={i} className="border-l-4 border-[#FFD700] pl-3 py-0.5">
                      <div className="text-xs font-black text-gray-800 leading-snug">{i + 1}. {p.rule}</div>
                      <div className="text-[11px] text-green-700 font-medium mt-1">✓ {p.right}</div>
                      {p.wrong && <div className="text-[11px] text-red-500 font-medium mt-0.5 line-through decoration-red-300">✗ {p.wrong}</div>}
                    </div>
                  ))}
                </div>

                <div className="bg-red-50 border-2 border-red-100 rounded-xl px-3.5 py-3">
                  <div className="text-[10px] font-black text-red-600 uppercase tracking-wider mb-1">⚠️ กับดักที่พบบ่อย</div>
                  <div className="text-xs text-red-700 font-medium leading-relaxed">{note.trap}</div>
                </div>
                {note.tip && (
                  <div className="bg-green-50 border-2 border-green-100 rounded-xl px-3.5 py-3">
                    <div className="text-[10px] font-black text-green-700 uppercase tracking-wider mb-1">💡 เทคนิคทำข้อสอบ</div>
                    <div className="text-xs text-green-800 font-medium leading-relaxed">{note.tip}</div>
                  </div>
                )}

                <button
                  onClick={() => { const t = notesTopic; setNotesTopic(null); startExam(t); }}
                  className="w-full py-3 bg-red-600 text-white rounded-xl text-xs font-black hover:bg-red-700 transition-all"
                >
                  📝 อ่านจบแล้ว ไปทำแบบฝึกหัวข้อนี้ ({partLabel(getExamSet(notesTopic))})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="w-full max-w-2xl bg-white shadow-2xl rounded-3xl p-6 md:p-10 border-t-[12px] border-[#003399] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-[#FFD700]"></div>

        {/* ══ START (หน้า Login) ══ */}
        {gameState === 'START' && (
          <form onSubmit={handleStudentLogin} className="text-center animate-fadeIn mt-2">
            <div className="flex flex-col items-center mb-8">
              <img src={SCHOOL_LOGO_URL} alt="Logo" className="w-28 h-28 mb-4 object-contain" onError={e => { e.currentTarget.src = 'https://cdn-icons-png.flaticon.com/512/167/167707.png'; }} />
              <h2 className="text-sm font-bold text-[#003399] uppercase tracking-widest mb-1">Anukoolnaree School</h2>
              <h1 className="text-3xl md:text-4xl font-black text-gray-900">Grammar Master</h1>
              <div className="h-1 w-20 bg-[#FFD700] mt-3 rounded-full"></div>
            </div>
            <p className="text-gray-500 mb-8 text-sm italic">Advanced English Syntax Analysis for Grade 12</p>
            <div className="text-left space-y-5 mb-8">
              <div>
                <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">ชื่อ - นามสกุล (ภาษาไทย)</label>
                <input type="text" placeholder="เช่น สมหญิง ใจดี" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] bg-gray-50/50 font-medium" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">ห้อง</label>
                  <select value={room} onChange={e => setRoom(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] bg-gray-50/50 font-medium" required>
                    <option value="">เลือกห้อง</option>
                    {ROOMS.map(r => <option key={r} value={r}>ม.{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">เลขที่</label>
                  <input type="number" inputMode="numeric" min={1} max={60} placeholder="เช่น 12" value={studentNo} onChange={e => setStudentNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] bg-gray-50/50 font-medium" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-[#003399] mb-2 uppercase tracking-wide">Email (Gmail Only)</label>
                {session?.user?.email ? (
                  <div className="w-full p-4 border-2 border-green-200 rounded-2xl bg-green-50 flex items-center gap-3">
                    {session.user.image && <img src={session.user.image} alt="avatar" className="w-7 h-7 rounded-full" />}
                    <span className="flex-grow text-gray-700 font-medium">{session.user.email}</span>
                    <span className="text-xs text-green-600 font-black bg-green-100 px-2 py-1 rounded-lg">✓ Google</span>
                  </div>
                ) : (
                  <input type="email" placeholder="Example: student@gmail.com" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:outline-none focus:border-[#FFD700] bg-gray-50/50 font-medium" required />
                )}
              </div>
            </div>
            {!session ? (
              <button type="button" disabled={signingIn}
                onClick={async () => { setLoginError(null); setSigningIn(true); const err = await signIn('google'); setSigningIn(false); if (err) setLoginError(err); }}
                className="w-full py-4 bg-white border-2 border-gray-200 rounded-2xl shadow-md hover:bg-gray-50 disabled:opacity-60 font-black flex items-center justify-center gap-3">
                <svg className="w-6 h-6" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                <span className="text-gray-700">{signingIn ? 'กำลังเปิดหน้าต่าง Google...' : 'Sign in with Google'}</span>
              </button>
            ) : (
              <button type="submit" disabled={examSets.length === 0 || !profileOk} className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl hover:bg-[#002266] disabled:bg-gray-300 disabled:text-gray-500 text-xl uppercase tracking-widest">
                {examSets.length === 0 ? (examLoadError ? "⚠️ โหลดข้อสอบไม่สำเร็จ" : "⏳ Loading Data...") : "Enter Dashboard →"}
              </button>
            )}
            {session && !profileOk && examSets.length > 0 && (
              <p className="mt-3 text-xs font-bold text-amber-600">กรอกชื่อ-นามสกุล เลือกห้อง และใส่เลขที่ให้ครบก่อนเข้าใช้งาน</p>
            )}
            {loginError && (
              <div className="mt-4 bg-red-50 border-2 border-red-200 rounded-2xl px-4 py-3 text-left">
                <p className="text-sm font-black text-red-600">⚠️ {loginError}</p>
              </div>
            )}
            {examLoadError && session && (
              <p className="mt-3 text-xs font-bold text-red-500">โหลดชุดข้อสอบไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า (ถ้ายังไม่ได้ให้แจ้งครู)</p>
            )}
          </form>
        )}

        {/* ══ DASHBOARD (หน้าหลักหลัง Login) ══ */}
        {gameState === 'DASHBOARD' && (
          <div className="animate-fadeIn mt-2">
            <div className="flex flex-col items-center mb-6">
              <img src={SCHOOL_LOGO_URL} alt="Logo" className="w-16 h-16 mb-3 object-contain" onError={e => { e.currentTarget.src = 'https://cdn-icons-png.flaticon.com/512/167/167707.png'; }} />
              <h1 className="text-2xl font-black text-gray-900 mb-1">Targeted Drills</h1>
              <p className="text-[#003399] font-bold text-sm tracking-widest uppercase">12 หัวข้อที่ออกสอบ · 14 คาบ</p>
            </div>

            {/* Profile */}
            <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 mb-5 flex items-center gap-4 shadow-sm">
              <div className="w-12 h-12 bg-[#003399] text-[#FFD700] rounded-full flex items-center justify-center text-xl font-black overflow-hidden">
                {session?.user?.image ? <img src={session.user.image} alt="avatar" className="w-full h-full object-cover" /> : (profile?.fullName || studentName).charAt(0)}
              </div>
              <div className="flex-grow min-w-0">
                <div className="text-sm font-black text-gray-800 truncate">{profile?.fullName || studentName}</div>
                {profile && <div className="text-xs font-bold text-gray-500">ม.{profile.room} · เลขที่ {profile.no}</div>}
                <div className="text-xs text-blue-600 font-bold truncate">{email}</div>
              </div>
              <button onClick={handleLogout} className="text-xs font-bold text-gray-400 hover:text-red-500 uppercase underline">Logout</button>
            </div>

            {isTeacherAcct && (
              <div className={`rounded-xl border-2 px-3 py-2 text-[11px] font-bold flex items-center justify-between gap-2 ${asStudent ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-blue-200 bg-blue-50 text-[#003399]'}`} data-testid="teacher-mode">
                <span>{asStudent ? `👁️ กำลังดูแบบนักเรียน ม.${normRoom(schedRoom) || '-'} — ล็อกหัวข้อ + บังคับกล้องเหมือนนักเรียน` : '👩‍🏫 บัญชีครู: เห็นและทำได้ทุกหัวข้อ (นักเรียนจะเห็นหัวข้อที่ยังไม่ถึงคาบเป็น 🔒)'}</span>
                <button onClick={() => setAsStudent(v => !v)} className="shrink-0 rounded-lg bg-white border px-2 py-1 font-black">{asStudent ? 'กลับโหมดครู' : 'ดูแบบนักเรียน'}</button>
              </div>
            )}
            {/* Focus Areas (เจาะแต่ละหัวข้อ) */}
            <div className="space-y-3">
              <div className="pt-4 pb-2 border-b-2 border-gray-50 text-xs font-black text-gray-400 tracking-widest uppercase flex items-center justify-between">
                <span>Focus Areas</span>
                <span className="flex items-center gap-2 normal-case font-bold text-[10px]">
                  <span className="text-red-600">●</span>แกนหลัก
                  <span className="text-yellow-600">●</span>เฉพาะจุด
                </span>
              </div>

              {/* ความก้าวหน้ารวม — ผลรวมคะแนนดีที่สุดทุกหัวข้อ (ทศนิยม 3 ตำแหน่ง) */}
              <div className="bg-gradient-to-br from-[#003399]/5 to-[#FFD700]/10 border-2 border-[#003399]/10 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-black text-[#003399] uppercase tracking-widest">ความก้าวหน้ารวม (12 หัวข้อ)</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {overallStats.examBest}/{overallStats.examTotal} ข้อ · ผ่านแล้ว {overallStats.mastered}/{examSets.length} หัวข้อ
                    </p>
                  </div>
                  <div className={`text-2xl md:text-3xl font-black px-4 py-2 rounded-xl text-white ${getProgressColor(overallStats.pctExact)}`}>
                    {overallStats.pctExact.toFixed(3)}%
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ease-out ${getProgressColor(overallStats.pctExact)}`} style={{ width: `${overallStats.pctExact}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 font-bold mt-1">
                  <span>0%</span>
                  <span>100%</span>
                </div>
                <p className="text-[10px] text-gray-500 font-medium mt-2 leading-relaxed">
                  แต่ละหัวข้อมีแบบฝึก 15 ข้อ (🔍 Error 5 · 🧩 Sentence 5 · 📄 Cloze 5) ผ่านหัวข้อ = ทุกส่วนได้ตั้งแต่ <b>3/5</b> ขึ้นไป 🏅 — ส่วนไหนยังไม่ถึง แตะที่กล่อง Error / Sentence / Cloze เพื่อซ่อมเฉพาะส่วนนั้นได้เลย (5 ข้อ ไม่ต้องทำใหม่ทั้งชุด)
                </p>
              </div>

              {/* อธิบายป้าย % แต่ละสนามสอบ */}
              <div className="bg-white border-2 border-gray-100 rounded-2xl px-4 py-3 text-[10px] text-gray-500 font-medium leading-relaxed">
                <p className="font-black text-gray-600 mb-1">📊 ป้าย % = โอกาสเจอหัวข้อนี้ในข้อแกรมมาร์ของแต่ละสนาม</p>
                <p><span className="font-black text-red-600">NETSAT</span> จากแนวข้อสอบ 5 ชุด 113 ข้อ (Error + Sentence Completion)</p>
                <p><span className="font-black text-indigo-600">A-Level</span> จากพาร์ท Writing (Text Completion) 20 ข้อ · “–” = ไม่พบในข้อสอบที่เก็บสถิติ</p>
                <p><span className="font-black text-teal-600">TGAT</span> ไม่มีพาร์ทแกรมมาร์แยก — แกรมมาร์แทรกอยู่ใน Text Completion 15 จาก 60 ข้อ (ปนกับคำศัพท์)</p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {TOPIC_META.map(topic => {
                  const exSet = getExamSet(topic.key);
                  const total = exSet?.items?.length || 0;
                  const ready = total > 0;
                  const best = exSet ? topicBest(exSet) : 0;
                  const pct = ready ? Math.round((best / total) * 100) : 0;
                  const mastered = ready && isSetPassed(exSet);
                  const pc = partCounts(exSet);
                  const locked = !isTeacher && !isSessionOpen(topic.session, schedRoom);
                  return (
                    <React.Fragment key={topic.key}>
                    {/* คาบที่ 7 = ทบทวนก่อนสอบกลางภาค (ต่อจากหัวข้อคาบ 1–6) */}
                    {topic.session === 8 && (
                      <div className="rounded-xl border-2 border-dashed border-[#003399]/30 bg-[#003399]/5 px-4 py-3">
                        <div className="text-xs font-black text-[#003399]">📌 คาบที่ 7 · ทบทวนก่อนสอบกลางภาค</div>
                        <div className="text-[10px] text-gray-600 font-medium mt-0.5 leading-relaxed">ซ่อมเฉพาะพาร์ทที่ยังไม่ผ่าน (ต่ำกว่า 3/5) — แตะกล่อง Error / Sentence / Cloze ในแต่ละหัวข้อ</div>
                      </div>
                    )}
                    <div className={`w-full rounded-xl border-2 px-4 py-3 shadow-sm text-left ${locked ? 'bg-gray-50 text-gray-400 border-gray-200 opacity-70' : mastered ? 'bg-green-50/40 border-green-200' : ready ? 'bg-white border-gray-100' : 'bg-gray-50 text-gray-400 border-gray-100 opacity-60'}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{topic.icon}</span>
                          <div>
                            <div className="text-sm font-black leading-tight">
                              <span className="mr-1.5 align-middle text-[9px] font-black px-1.5 py-0.5 rounded-md bg-[#003399] text-[#FFD700]">คาบ {topic.session}</span>
                              {topic.label}
                              {topic.isNew && <span className="ml-1.5 align-middle text-[9px] font-black px-1.5 py-0.5 rounded-md bg-green-100 text-green-700 border border-green-200">NEW</span>}
                            </div>
                            {topic.subtitle && <div className="text-[10px] text-gray-400 font-medium mt-0.5">{topic.subtitle}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2 mt-0.5">
                          {ready && <span className={`text-xs font-black px-2 py-0.5 rounded-lg text-white ${getProgressColor(pct)}`}>{pct}%</span>}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${ready ? 'bg-[#FFD700]/20 text-[#003399]' : 'bg-gray-100 text-gray-400'}`}>{locked ? '🔒' : ready ? `${best}/${total}` : '🔒'}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {/* % ที่จะเจอหัวข้อนี้ในแต่ละสนามสอบ (สัดส่วนของข้อแกรมมาร์ในสนามนั้น) */}
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${topic.tier === 'A' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'}`}>
                          ● NETSAT ~{topic.share}% · {topic.tier === 'A' ? 'แกนหลัก' : 'เฉพาะจุด'}
                        </span>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border ${topic.alevel > 0 ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                          ● A-Level {topic.alevel > 0 ? `~${topic.alevel}%` : '–'}
                        </span>
                        {topic.tgat !== null && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border ${topic.tgat > 0 ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                            ● TGAT {topic.tgat > 0 ? `~${topic.tgat}%` : '–'}
                          </span>
                        )}
                        {mastered && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-green-100 text-green-700 border border-green-200">🏅 ผ่านแล้ว</span>}
                      </div>
                      {ready && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden mt-1 mb-2">
                          <div className={`h-full rounded-full transition-all duration-500 ${getProgressColor(pct)}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {/* แถบรายพาร์ท: แตะเพื่อทำเฉพาะพาร์ทนั้น (5 ข้อ) — ผ่านเมื่อได้ ≥ 3/5 */}
                      {ready && exSet && (
                        <div className="grid grid-cols-3 gap-1.5 mb-1" data-testid="part-tabs">
                          {(['error', 'sc', 'cloze'] as ExamPart[]).map(p => {
                            const pb = Math.min(getBestScore(partBestKey(exSet.id, p)), pc[p]);
                            const done = rawBest(partBestKey(exSet.id, p)) !== undefined;
                            const pass = pc[p] > 0 && pb >= passMark(pc[p]);
                            const cls = pass ? 'bg-green-50 border-green-200 text-green-700' : done ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500';
                            const inner = (
                              <>
                                <div className="text-[9px] font-black">{PART_INFO[p].icon} {PART_INFO[p].short}</div>
                                <div className="text-[11px] font-black leading-tight">{done ? `${pb}/${pc[p]}` : `–/${pc[p]}`}</div>
                                <div className="text-[8px] font-black leading-tight">{pass ? '✓ ผ่าน' : done ? '🔧 ซ่อม' : 'ยังไม่ทำ'}</div>
                              </>
                            );
                            return locked || pc[p] === 0
                              ? <div key={p} className={`text-center rounded-lg border px-1 py-1 ${cls}`}>{inner}</div>
                              : <button key={p} data-testid={`part-${PART_KEY[p]}`} onClick={() => startExam(topic.key, p)} className={`text-center rounded-lg border-2 px-1 py-1 transition-all hover:shadow-md active:scale-95 ${cls}`}>{inner}</button>;
                          })}
                        </div>
                      )}
                      {locked ? (
                        <div className="mt-2 pt-2 border-t border-gray-200 text-center text-[11px] font-black text-gray-500">🔒 ยังไม่ถึงคาบเรียน ม.{normRoom(schedRoom)} · เปิด {openDateText(topic.session, schedRoom)}</div>
                      ) : ready ? (
                        <div className="mt-2 pt-2 border-t border-gray-100 flex gap-1.5">
                          <button onClick={() => setNotesTopic(topic.key)} className="flex-shrink-0 px-3.5 py-2.5 bg-amber-50 text-amber-700 border-2 border-amber-200 rounded-xl text-[10px] font-black hover:bg-amber-100 transition-all whitespace-nowrap">📖 เนื้อหา</button>
                          <button onClick={() => startExam(topic.key)} className="flex-1 py-2 bg-[#003399] text-[#FFD700] rounded-xl text-[10px] font-black hover:bg-[#002266] transition-all leading-tight">
                            📝 {best > 0 ? 'ทำทั้งชุดอีกครั้ง' : 'เริ่มทำแบบฝึก'}
                            <span className="block text-[9px] font-bold text-[#FFD700]/80">{partLabel(exSet)} · 📷 เปิดกล้อง · ไม่เกิน ~{maxMinutes(exSet, true)} นาที</span>
                          </button>
                        </div>
                      ) : (
                        <div className="text-[10px] text-gray-400 font-bold mt-1 text-center">⏳ กำลังโหลดข้อสอบ...</div>
                      )}
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* ══ แบบทดสอบรวมทุกหัวข้อ (ฝึกฝนตนเอง) — ต่อจาก Verb Patterns & If-Clause ══ */}
              {mixedSets.length > 0 && (
                <div className="mt-4 bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-2xl p-4">
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl">🎯</span>
                    <div>
                      <div className="text-sm font-black text-gray-900 leading-tight"><span className="mr-1.5 align-middle text-[9px] font-black px-1.5 py-0.5 rounded-md bg-purple-600 text-white">คาบ 14</span>แบบทดสอบรวมทุกหัวข้อ · ทบทวนก่อนสอบปลายภาค</div>
                      <div className="text-[10px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                        คละครบ 12 หัวข้อเหมือนสนามจริง · ชุดละ 30 ข้อ (🔍 Error 10 · 🧩 Sentence 10 · 📄 Cloze 10) — จบแล้วบอกหัวข้อที่ควรทบทวน
                      </div>
                    </div>
                  </div>
                  {!isTeacher && !isSessionOpen(14, schedRoom) ? (
                    <div className="mt-3 rounded-xl border-2 border-gray-200 bg-white/70 px-4 py-3 text-center text-[11px] font-black text-gray-500">🔒 ยังไม่ถึงคาบเรียน ม.{normRoom(schedRoom)} · เปิด {openDateText(14, schedRoom)}</div>
                  ) : (
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    {mixedSets.map(set => {
                      const total = set.items?.length || 0;
                      const best = Math.min(getBestScore(set.id), total);
                      const pct = total > 0 ? Math.round((best / total) * 100) : 0;
                      return (
                        <button key={set.id} onClick={() => startExamSet(set)}
                          className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all shadow-sm hover:scale-[1.01] ${best > 0 ? 'bg-white border-green-200 hover:border-green-400' : 'bg-white border-purple-100 hover:border-purple-400'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-black text-gray-800">{set.title}</div>
                              <div className="text-[10px] text-gray-400 font-bold mt-0.5 truncate">📄 Cloze: {set.cloze?.title} · {total} ข้อ</div>
                            </div>
                            <div className="text-right shrink-0">
                              {best > 0 ? (
                                <>
                                  <div className="text-lg font-black text-green-600 leading-none">{best}<span className="text-xs text-gray-400">/{total}</span></div>
                                  <div className="text-[9px] text-green-500 font-bold">ดีที่สุด {pct}%</div>
                                </>
                              ) : (
                                <span className="text-[10px] font-black text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg">เริ่มทำ ▶</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ กล้องตรวจใบหน้า (ใช้ element เดียวทั้งหน้าตรวจกล้องและระหว่างทำ — ไม่ต้องเปิดกล้องใหม่) ══ */}
        {(gameState === 'CAM_CHECK' || gameState === 'EXAM_QUIZ') && (
          <div className={gameState === 'EXAM_QUIZ'
            ? `fixed bottom-3 right-3 z-40 w-24 ${camUsedRef.current && cam.status === 'ready' ? '' : 'hidden'}`
            : 'w-56 mx-auto mb-4'}>
            <div className="relative rounded-2xl overflow-hidden border-4 bg-black" style={{ borderColor: cam.status === 'ready' ? (cam.face && !cam.phone ? '#10b981' : '#f43f5e') : '#9ca3af' }}>
              <video ref={cam.videoRef} playsInline muted autoPlay className="w-full block bg-black" style={{ transform: 'scaleX(-1)', minHeight: 120 }} />
              {gameState === 'CAM_CHECK' && cam.status !== 'ready' && cam.status !== 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white/70 text-center px-2">📷 กล้องยังไม่เปิด</div>
              )}
            </div>
            {gameState === 'EXAM_QUIZ' && (
              <p className={`text-[9px] font-black text-center mt-1 rounded bg-white/90 ${cam.face && !cam.phone ? 'text-green-700' : 'text-red-600'}`}>
                {cam.phone ? '📱 เห็นมือถือ' : cam.face ? '● เห็นใบหน้า' : `● ไม่เห็นใบหน้า ${(cam.missMs / 1000).toFixed(1)} วิ`}
              </p>
            )}
          </div>
        )}

        {/* ══ หน้าตรวจกล้องก่อนเริ่มทำ ══ */}
        {gameState === 'CAM_CHECK' && pendingSet && (() => {
          const label = (pendingSet.topic === 'MIXED' ? `🎯 ${pendingSet.title || 'ชุดรวม'}` : topicLabel(pendingSet.topic)) + (pendingPart ? ` · ${PART_INFO[pendingPart].icon} ${PART_INFO[pendingPart].short} (ซ่อมเฉพาะส่วนนี้)` : '');
          const pview = pendingPart ? { items: pendingSet.items.filter(q => partOf(q) === pendingPart) } : pendingSet;
          const canStart = cam.status === 'ready' && cam.seenFrames >= 4 && !cam.phone;
          return (
            <div className="animate-fadeIn space-y-4">
              <div className="text-center">
                <p className="text-xs font-black text-[#003399] uppercase tracking-widest">ก่อนเริ่มทำ</p>
                <h2 className="text-xl font-black text-gray-900">{label}</h2>
                <p className="text-xs text-gray-500">{partLabel(pview)}</p>
              </div>
              <div className={`grid ${isTeacher ? 'grid-cols-2' : 'grid-cols-1'} gap-2 text-center`} data-testid="time-choice">
                <div className="rounded-2xl border-2 border-[#003399] bg-[#003399]/5 p-3">
                  <p className="text-[11px] font-black text-[#003399]">📷 ต้องเปิดกล้องทุกครั้ง</p>
                  <p className="text-lg font-black text-[#003399] leading-tight">{TIME_LIMIT_CAM.error} / {TIME_LIMIT_CAM.cloze} วิ</p>
                  <p className="text-[10px] text-gray-500 font-bold">ต่อข้อ (Error·Sentence / Cloze) · ~{maxMinutes(pview, true)} นาที</p>
                </div>
                {isTeacher && <div className="rounded-2xl border-2 border-gray-200 bg-white p-3">
                  <p className="text-[11px] font-black text-gray-500">ไม่เปิดกล้อง (เฉพาะครูทดลอง)</p>
                  <p className="text-lg font-black text-gray-600 leading-tight">{TIME_LIMIT.error} วิ</p>
                  <p className="text-[10px] text-gray-400 font-bold">ต่อข้อ ทุกส่วน · ~{maxMinutes(pview)} นาที</p>
                </div>}
              </div>
              <div className={`rounded-2xl border-2 p-4 text-sm leading-relaxed ${gMode === 'enforce' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="font-black mb-1">{gMode === 'enforce' ? '🛡️ กติกากันการใช้ AI (หักคะแนนจริง)' : `🛡️ กติกากันการใช้ AI (ช่วงทดลอง · หักคะแนนจริงตั้งแต่ ${thDate(GUARD_ENFORCE_FROM)})`}</p>
                <ul className="list-disc pl-5 space-y-0.5 text-gray-700">
                  <li>ออกจากหน้าแอป (สลับแอป / แท็บ / กลับหน้าโฮม) ระหว่างข้อที่ยังไม่ตอบ → {gMode === 'enforce' ? <b>ข้อนั้นไม่ได้คะแนน</b> : 'บันทึกให้ครูเห็น'}</li>
                  <li>มีหน้าต่างอื่นบังหน้าแอปนานเกิน 3 วินาที (เช่น Gemini / วงกลมค้นหา) → นับเหมือนออกจากหน้า</li>
                  <li><b>ต้องเปิดกล้องทุกครั้ง</b> จึงจะเริ่มทำได้ · ถ้ามีวัตถุบังหน้า (ตา / จมูก / หน้าผาก) หรือกล้องไม่เห็นใบหน้า <b>เกิน {FACE_LIMIT_MS / 1000} วินาที</b> → <b>ข้ามไปข้อถัดไปทันที ข้อนั้นได้ 0</b> (ไม่หักคะแนนเพิ่ม) · กรอบกล้องเป็นสีแดงเมื่อหน้าหลุด ให้เงยหน้ามองจอทันที</li>
                  <li>ถ้ากล้องเห็น <b>มือถืออีกเครื่อง</b> (เช่น ยกมือถือถ่ายจอ) → <b>ข้ามไปข้อถัดไปทันที ข้อนั้นได้ 0</b> แม้ไม่ได้บังหน้า · วางมือถือเครื่องอื่นให้พ้นกล้อง</li>
                  <li>คลุม / คัดลอกโจทย์ไม่ได้ · ครบ 3 ครั้งในรอบเดียว ครูจะเห็น 🚩</li>
                </ul>
              </div>
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-900">
                <p className="font-black mb-1">🔒 ความเป็นส่วนตัวของกล้อง</p>
                ระบบตรวจแค่ว่า &quot;ยังเห็นใบหน้าอยู่ไหม&quot; และ &quot;มีมือถืออีกเครื่องในภาพไหม&quot; โดยประมวลผลในเครื่องนี้เท่านั้น <b>ไม่บันทึกภาพ ไม่ส่งภาพหรือวิดีโอออกไป</b> ไม่ใช้ไมโครโฟน และปิดกล้องทันทีเมื่อทำจบ
              </div>
              {cam.status === 'ready' && (
                <p className={`text-center font-black ${cam.face && !cam.phone ? 'text-green-600' : 'text-red-500'}`}>
                  {cam.phone ? '📱 กล้องเห็นมือถืออีกเครื่อง — วางให้พ้นกล้องก่อนเริ่ม' : cam.face ? '✓ เห็นใบหน้าแล้ว พร้อมเริ่มทำ' : 'มองหน้าจอให้กล้องเห็นใบหน้า'}
                  {cam.phoneStatus === 'loading' && <span className="block text-[10px] font-bold text-gray-400">⏳ กำลังโหลดตัวตรวจมือถือ…</span>}
                  {cam.phoneStatus === 'unavailable' && <span className="block text-[10px] font-bold text-gray-400">เครื่องนี้ใช้ตัวตรวจมือถือไม่ได้ — ตรวจเฉพาะใบหน้า</span>}
                  {cam.phoneStatus === 'ready' && <span className="block text-[10px] font-bold text-gray-400">✓ ตัวตรวจมือถือพร้อม</span>}
                </p>
              )}
              {cam.status === 'loading' && <p className="text-center text-sm font-bold text-gray-500">⏳ กำลังเปิดกล้อง (ครั้งแรกอาจใช้ 5–10 วินาที)…</p>}
              {cam.status === 'denied' && <p className="bg-red-50 text-red-700 font-bold rounded-xl p-3 text-sm">ไม่ได้รับอนุญาตให้ใช้กล้อง — iPhone/iPad: ตั้งค่า → Safari → กล้อง → อนุญาต แล้วลองใหม่ แล้วกดเปิดกล้องอีกครั้ง (ต้องเปิดกล้องจึงจะทำแบบฝึกได้){cam.errorDetail && <span className="block mt-1 text-[10px] font-medium text-red-500">สาเหตุ: {cam.errorDetail}</span>}</p>}
              {cam.status === 'error' && <p className="bg-red-50 text-red-700 font-bold rounded-xl p-3 text-sm">เปิดตัวตรวจใบหน้าในเครื่องนี้ไม่ได้ — กด &quot;เปิดกล้อง&quot; อีกครั้ง · ถ้ายังไม่ได้ ให้ปิดแล้วเปิดแอป/เบราว์เซอร์ใหม่ หรือเปลี่ยนเครื่อง แล้วแจ้งครูพร้อมภาพหน้าจอ{cam.errorDetail && <span className="block mt-1 text-[10px] font-medium text-red-500 break-words">สาเหตุ: {cam.errorDetail}</span>}</p>}
              {cam.status === 'ready' ? (
                <button disabled={!canStart} onClick={() => beginExamSet(pendingSet, true, pendingPart)}
                  className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg disabled:opacity-40">
                  เริ่มทำแบบฝึก (เวลา {TIME_LIMIT_CAM.error}/{TIME_LIMIT_CAM.cloze} วิ) →
                </button>
              ) : (
                <button disabled={cam.status === 'loading'} onClick={() => { void cam.start(); }}
                  className="w-full py-4 bg-[#003399] text-[#FFD700] font-black rounded-2xl shadow-xl text-lg disabled:opacity-40">
                  📷 เปิดกล้องเพื่อเริ่มทำ
                </button>
              )}
              {isTeacher && <button onClick={() => beginExamSet(pendingSet, false, pendingPart)}
                className="w-full py-3 bg-white border-2 border-gray-200 text-gray-600 font-black rounded-2xl text-sm">
                ทำโดยไม่เปิดกล้อง <span className="font-bold text-gray-400">(เฉพาะบัญชีครู · ทดลองระบบ)</span>
              </button>}
              <button onClick={() => { cam.stop(); setPendingSet(null); setGameState('DASHBOARD'); }}
                className="w-full py-2 text-gray-400 text-xs font-bold hover:text-red-500">← กลับหน้าหลัก</button>
            </div>
          );
        })()}

        {/* ══ EXAM QUIZ (Error → Sentence → Cloze) ══ */}
        {gameState === 'EXAM_QUIZ' && examQuestions[examIndex] && (() => {
          const q = examQuestions[examIndex];
          const part = partOf(q);
          const info = PART_INFO[part];
          const partItems = examQuestions.filter(x => partOf(x) === part);
          const posInPart = partItems.indexOf(q) + 1;
          const renderErrorSentence = () => {
            // รูปแบบ (A)[คำสั้น ๆ] = ขีดเส้นใต้เฉพาะคำในวงเล็บเหลี่ยม (เหมือนข้อสอบจริง)
            const parts = (q.question || '').split(/(\([ABCD]\)\[[^\]]+\])/g).filter(Boolean);
            return parts.map((pt, i) => {
              const match = pt.match(/^\(([ABCD])\)\[([^\]]+)\]$/);
              if (!match) return <span key={i}>{pt}</span>;
              const label = match[1];
              const color = label === 'A' ? '#2563eb' : label === 'B' ? '#16a34a' : label === 'C' ? '#7c3aed' : '#ea580c';
              // ขีดเส้นใต้คำที่ให้เลือก + ตัวอักษรกำกับเล็ก ๆ ท้ายคำ (อ่านต่อเนื่องเป็นประโยคเดียวเหมือนกระดาษข้อสอบ)
              return (
                <span key={i} className="whitespace-nowrap">
                  <span className="underline decoration-2 underline-offset-[6px] font-semibold text-gray-900" style={{ textDecorationColor: color }}>{match[2].trim()}</span>
                  <sup className="text-[10px] font-black ml-0.5" style={{ color }}>({label})</sup>
                </span>
              );
            });
          };
          const renderScSentence = () => (q.question || '').split(/(_{3,})/g).map((pt, i) =>
            /^_{3,}$/.test(pt)
              ? <span key={i} className="inline-block align-middle mx-1 px-6 py-0.5 border-b-2 border-purple-400 bg-purple-50 rounded text-purple-400 font-black">?</span>
              : <span key={i}>{pt}</span>
          );
          // คำตอบของช่อง Cloze ที่ตอบไปแล้ว (โชว์ใน passage)
          const clozeAnswers: Record<number, string> = {};
          const clozeCorrect: Record<number, string> = {};
          examQuestions.filter(x => partOf(x) === 'cloze').forEach(x => { if (x.number) clozeCorrect[x.number] = x.correct_answer; });
          examResults.filter(r => partOf(r.q) === 'cloze').forEach(r => { if (r.q.number) clozeAnswers[r.q.number] = r.selected; });
          return (
            <div className="animate-fadeIn">
              <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-gray-50">
                <span className={`text-xs font-black px-3 py-1.5 rounded-xl text-white ${info.badge}`}>{info.icon} {info.label}</span>
                <span className="text-xs font-bold text-gray-400 text-center px-2">{setLabel}</span>
                <span className="text-sm font-black text-[#003399]">{examIndex + 1} / {examQuestions.length}</span>
              </div>
              <div className="flex justify-between items-center mb-3">
                <div className="flex gap-1">
                  {(['error', 'sc', 'cloze'] as ExamPart[]).map(p => (
                    <span key={p} className={`text-[9px] font-black px-2 py-1 rounded-md ${p === part ? `${PART_INFO[p].badge} text-white` : 'bg-gray-100 text-gray-400'}`}>
                      {PART_INFO[p].short} {examQuestions.filter(x => partOf(x) === p).length}
                    </span>
                  ))}
                </div>
                <span className={`text-base font-black px-5 py-2 rounded-xl border-2 ${examTimeLeft <= 10 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-blue-50 text-[#003399] border-[#003399]/20'}`}>⏱️ {examTimeLeft} s</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full mb-5 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${info.bar}`} style={{ width: `${(examIndex / examQuestions.length) * 100}%` }}></div>
              </div>
              {guard.notice && (
                <div data-testid="guard-notice" className="rounded-xl p-3 mb-4 text-xs font-bold bg-orange-100 text-orange-900 border-2 border-orange-300 flex gap-2">
                  <span className="flex-1">{noticeText(guard.notice, gMode)}</span>
                  <button onClick={guard.clearNotice} className="shrink-0 underline">รับทราบ</button>
                </div>
              )}
              <div {...noCopyProps}>

              {part === 'error' && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 mb-4">
                  <p className="text-xs font-bold text-orange-700">📌 จงเลือกส่วนที่ <u>ผิดหลักไวยากรณ์</u> จาก A, B, C หรือ D (ข้อ {posInPart}/{partItems.length})</p>
                </div>
              )}
              {part === 'sc' && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-2 mb-4">
                  <p className="text-xs font-bold text-purple-700">📌 เลือกตัวเลือกที่เติมในช่องว่างแล้ว <u>ถูกหลักไวยากรณ์และสมเหตุสมผล</u> ที่สุด (ข้อ {posInPart}/{partItems.length})</p>
                </div>
              )}
              {part === 'cloze' && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 mb-4">
                  <p className="text-xs font-bold text-[#003399]">📌 อ่านบทความ แล้วเลือกคำตอบที่เติมใน <u>ช่อง ({q.number})</u> ได้ถูกต้องที่สุด (ช่อง {posInPart}/{partItems.length})</p>
                </div>
              )}

              {part === 'cloze' ? (
                <div id="cloze-box" className="relative bg-[#f8faff] border-2 border-blue-100 rounded-2xl p-5 mb-5 text-gray-800 text-sm md:text-base max-h-[50vh] overflow-y-auto">
                  <p className="font-black text-[11px] text-[#003399] uppercase tracking-widest mb-2">📄 {currentSet?.cloze?.title || 'Passage'}</p>
                  <p className="leading-8">
                    {renderClozePassage(currentSet?.cloze?.passage || '', q.number ?? null, clozeAnswers, clozeCorrect)}
                  </p>
                </div>
              ) : (
                <div className="bg-white border-2 border-gray-100 rounded-2xl p-6 mb-5 shadow-sm min-h-[120px] flex items-center justify-center">
                  <p className="text-base md:text-lg text-gray-900 leading-10 text-center font-serif">
                    {part === 'error' ? renderErrorSentence() : renderScSentence()}
                  </p>
                </div>
              )}

              {part === 'cloze' && (
                <div className="bg-[#FFD700]/10 border-2 border-[#FFD700]/30 rounded-2xl px-5 py-2 mb-3">
                  <p className="text-sm font-black text-[#003399]">Blank <span className="text-xl">({q.number})</span> = ?</p>
                </div>
              )}

              <div className={`grid gap-3 mb-4 ${part === 'sc' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {q.options.map((opt, idx) => {
                  const label = ['A', 'B', 'C', 'D'][idx];
                  const isCorrect = opt === q.correct_answer;
                  const isSelected = examSelected === opt;
                  let style = 'border-gray-100 bg-white hover:border-[#003399] hover:bg-[#003399]/5 text-gray-800 font-bold shadow-sm';
                  if (examAnswered) {
                    if (isCorrect) style = "bg-green-500 text-white border-green-500 font-black shadow-lg scale-[1.01]";
                    else if (isSelected) style = "bg-red-500 text-white border-red-500 shadow-lg";
                    else style = "bg-gray-50 text-gray-300 border-gray-100 opacity-50 cursor-not-allowed";
                  }
                  return (
                    <button key={idx} onClick={() => handleExamAnswer(opt)} disabled={examAnswered}
                      className={`p-3 border-2 rounded-xl text-left text-sm transition-all flex items-center gap-2 ${style}`}>
                      <span className="font-black text-[11px] px-1.5 py-0.5 rounded bg-black/10 shrink-0">{label}</span>
                      <span className={part === 'error' ? 'text-xs' : 'text-sm'}>{part === 'error' ? opt.replace(/^\([ABCD]\)\s*/, '') : opt}</span>
                    </button>
                  );
                })}
              </div>
              </div>
              {examAnswered && (
                <div className={`rounded-2xl p-4 mb-4 border-2 ${examSelected === q.correct_answer ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-xs font-black text-gray-500 uppercase mb-1">{examSelected === 'Time Out' ? '⏰ หมดเวลา — ' : isLeftAnswer(examSelected) ? `${examSelected} — ` : ''}🔍 Teacher&apos;s Note</p>
                  <p className="text-sm text-gray-700 mb-2">✅ <span className="font-black">{q.correct_answer}</span></p>
                  <p className="text-sm text-gray-700">{q.explanation}</p>
                </div>
              )}
              {examAnswered && (() => {
                const isLast = examIndex + 1 === examQuestions.length;
                const nextPart = !isLast ? partOf(examQuestions[examIndex + 1]) : part;
                return (
                  <button onClick={() => handleExamNext()} className={`w-full py-4 font-black rounded-2xl text-lg shadow-xl uppercase tracking-widest ${isLast ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-[#003399] text-[#FFD700] hover:bg-[#002266]'}`}>
                    {isLast ? "สรุปผล ✅" : nextPart !== part ? `ไป ${PART_INFO[nextPart].label} ➡️` : "ถัดไป ➡️"}
                  </button>
                );
              })()}
              <button onClick={() => setGameState('DASHBOARD')} className="w-full mt-3 py-2 text-gray-400 text-xs font-bold hover:text-red-500 transition-all">← กลับหน้าหลัก (รอบนี้จะไม่ถูกบันทึก)</button>
            </div>
          );
        })()}

        {/* ══ EXAM RESULT ══ */}
        {gameState === 'EXAM_RESULT' && (() => {
          const correct = examResults.filter(r => r.correct).length;
          const wrong = examResults.filter(r => !r.correct);
          const total = examQuestions.length;
          const best = currentPart && currentSet
            ? Math.min(Math.max(getBestScore(partBestKey(currentSet.id, currentPart)), correct), partCounts(currentSet)[currentPart])
            : (currentSet && !isMixed ? topicBest(currentSet) : (currentExamSetId ? Math.max(getBestScore(currentExamSetId), correct) : correct));
          const bestTotal = currentPart && currentSet ? partCounts(currentSet)[currentPart] : (currentSet?.items?.length || total);
          const passedTopic = !isMixed && isSetPassed(currentSet);
          // พาร์ทที่ยังไม่ผ่าน (ดูจากคะแนนดีสุดสะสม) → ปุ่มซ่อมเฉพาะส่วน
          const failedParts = !isMixed && currentSet
            ? (['error', 'sc', 'cloze'] as ExamPart[]).filter(p => partCounts(currentSet)[p] > 0 && getBestScore(partBestKey(currentSet.id, p)) < passMark(partCounts(currentSet)[p]))
            : [];
          return (
            <div className="text-center animate-fadeIn mt-2">
              <span className="text-5xl">{wrong.length === 0 ? '🏆' : '📝'}</span>
              <h2 className="text-2xl font-black text-gray-900 mt-3 mb-1">{correct} / {examResults.length} ถูก</h2>
              <p className="text-xs text-gray-400 mb-4">{setLabel} · {currentPart ? `ส่วน ${PART_INFO[currentPart].short} · ` : ''}คะแนนดีที่สุด {Math.min(best, bestTotal)}/{bestTotal}{passedTopic ? ' · 🏅 ผ่านหัวข้อนี้แล้ว!' : ''}</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {(['error', 'sc', 'cloze'] as ExamPart[]).map(p => {
                  const rs = examResults.filter(r => partOf(r.q) === p);
                  const ok = rs.filter(r => r.correct).length;
                  return (
                    <div key={p} className={`border-2 rounded-2xl py-3 ${rs.length === 0 ? 'bg-gray-50 border-gray-100 opacity-50' : PART_INFO[p].box}`}>
                      <div className={`text-[10px] font-black uppercase ${PART_INFO[p].text}`}>{PART_INFO[p].icon} {PART_INFO[p].short}</div>
                      <div className={`text-xl font-black ${PART_INFO[p].text}`}>{rs.length ? `${ok}/${rs.length}` : '–'}</div>
                      {!isMixed && rs.length > 0 && <div className={`text-[10px] font-black ${ok >= passMark(rs.length) ? 'text-green-600' : 'text-amber-600'}`}>{ok >= passMark(rs.length) ? '✓ ผ่าน' : `ต้อง ${passMark(rs.length)}/${rs.length}`}</div>}
                    </div>
                  );
                })}
              </div>
              {/* ชุดรวม: สรุปหัวข้อที่ตอบผิด → แตะเพื่อเปิดเนื้อหาหัวข้อนั้น */}
              {isMixed && wrong.length > 0 && (() => {
                const cnt: Record<string, number> = {};
                wrong.forEach(r => { cnt[r.q.grammar_topic] = (cnt[r.q.grammar_topic] || 0) + 1; });
                const list = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
                return (
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 mb-5 text-left">
                    <p className="text-xs font-black text-amber-700 mb-2">📌 หัวข้อที่ควรทบทวน (แตะเพื่อเปิดเนื้อหา)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map(([t, n]) => (
                        <button key={t} onClick={() => setNotesTopic(t)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-amber-800 hover:bg-amber-100">
                          {TOPIC_META.find(x => x.key === t)?.icon} {topicLabel(t)} · ผิด {n}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {wrong.length === 0 ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-5">
                  <p className="text-green-700 font-black">✅ Perfect! ทำถูกทุกข้อ!</p>
                </div>
              ) : (
                <div className="text-left mb-5 space-y-3">
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest">ทบทวน {wrong.length} ข้อที่ตอบผิด</p>
                  {wrong.map((r, i) => {
                    const p = partOf(r.q);
                    const shown = p === 'cloze'
                      ? clozeSentence(currentSet?.cloze?.passage || '', r.q.number || 0)
                      : r.q.question.replace(/\(([ABCD])\)\[([^\]]+)\]/g, '($1) $2');
                    return (
                      <div key={i} className="bg-white border-2 border-red-100 rounded-2xl p-4">
                        <p className="text-xs font-black text-[#003399] mb-2">{PART_INFO[p].icon} {PART_INFO[p].short}{p === 'cloze' ? ` · ช่อง (${r.q.number})` : ''} | {isMixed ? topicLabel(r.q.grammar_topic) : r.q.exam_type}</p>
                        <p className="text-sm text-gray-700 mb-2 leading-6">{shown}</p>
                        <p className="text-sm text-red-400 mb-1">❌ คุณตอบ: {r.selected === 'Time Out' ? 'หมดเวลา' : isLeftAnswer(r.selected) ? r.selected : <span className="line-through">{r.selected}</span>}</p>
                        <p className="text-sm text-green-600 font-black">✅ เฉลย: {r.q.correct_answer}</p>
                        <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded-xl mt-2">{r.q.explanation}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              {isSubmitting
                ? <p className="text-[#003399] font-black animate-pulse mb-4 bg-blue-50 py-3 rounded-2xl text-center text-sm">⏳ บันทึกคะแนน...</p>
                : <p className="text-green-600 font-black mb-4 bg-green-50 py-3 rounded-2xl text-center text-sm">✅ บันทึกคะแนนแล้ว</p>
              }
              <div className="space-y-3">
                {!isMixed && (
                  <button onClick={() => setNotesTopic(selectedTopic)} className="w-full py-3 bg-amber-50 text-amber-700 border-2 border-amber-200 font-black rounded-2xl hover:bg-amber-100 text-sm">
                    📖 ทบทวนเนื้อหาหัวข้อนี้
                  </button>
                )}
                {failedParts.map(p => (
                  <button key={p} data-testid={`repair-${PART_KEY[p]}`} onClick={() => { if (currentSet) startExamSet(currentSet, p); }} className="w-full py-3.5 bg-amber-500 text-white font-black rounded-2xl hover:bg-amber-600 text-sm shadow">
                    🔧 ซ่อมเฉพาะ {PART_INFO[p].icon} {PART_INFO[p].short} (ดีสุด {Math.min(getBestScore(partBestKey(currentSet!.id, p)), partCounts(currentSet)[p])}/{partCounts(currentSet)[p]} · ต้อง {passMark(partCounts(currentSet)[p])})
                  </button>
                ))}
                <button onClick={() => { if (currentSet) startExamSet(currentSet, currentPart); }} className={`w-full py-4 font-black rounded-2xl text-base shadow-lg ${failedParts.length ? 'bg-white text-red-600 border-2 border-red-200 hover:bg-red-50' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                  🔄 {isMixed ? 'ทำชุดนี้อีกครั้ง' : currentPart ? `ทำส่วน ${PART_INFO[currentPart].short} อีกครั้ง` : 'ทำทั้งชุดอีกครั้ง'}
                </button>
                <button onClick={() => setGameState('DASHBOARD')} className="w-full py-3 bg-[#FFD700] text-[#003399] font-black rounded-2xl hover:bg-[#e6c200] shadow-md">
                  ⬅️ กลับ Dashboard
                </button>
              </div>
            </div>
          );
        })()}
      </div>
      <p className="mt-8 text-[10px] text-gray-400 font-bold tracking-[0.3em] uppercase">© Anukoolnaree School | Grammar Master</p>
    </div>
  );
}
