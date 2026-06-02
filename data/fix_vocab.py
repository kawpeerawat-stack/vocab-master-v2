# -*- coding: utf-8 -*-
"""
fix_vocab.py — แก้ไขข้อผิดพลาดในคลังคำศัพท์ vocab.json (Vocab Master 2.0)
วิธีใช้: วางไฟล์นี้ไว้โฟลเดอร์เดียวกับ vocab.json แล้วรัน  python fix_vocab.py
ผลลัพธ์: สร้างไฟล์ใหม่ vocab_fixed.json (ของเดิมไม่ถูกแตะต้อง)
"""
import json, re, os

SRC = "vocab.json"          # ไฟล์ต้นฉบับ
OUT = "vocab_fixed.json"    # ไฟล์ที่แก้แล้ว

# ── 1) คำแปลไทยที่ต้องแก้ (ภาษาปนเปื้อน / ความหมายผิด / คำว่าง / สะกดผิด) ──
THAI_FIX = {
    # มีอักษร/คำต่างประเทศปนในคำแปล
    "absolute": "สมบูรณ์, เด็ดขาด",
    "balance": "ความสมดุล, สมดุล",
    "belong": "เป็นของ, อยู่ในกลุ่ม",
    "dead": "ตาย, ไร้ชีวิต",
    "deny": "ปฏิเสธ, ไม่ยอมรับ",
    "depart": "ออกเดินทาง, จากไป",
    "grave": "หลุมฝังศพ, ร้ายแรง",
    "boom": "การเติบโตอย่างรวดเร็ว, ความเฟื่องฟู",
    "alarm": "สัญญาณเตือนภัย, ความตกใจ",
    "anyway": "ไม่ว่าอย่างไร, อย่างไรก็ตาม",
    "associate": "เชื่อมโยง, คบหา",
    "beyond": "เกินกว่า, ไกลออกไป",
    "bored": "เบื่อ, เบื่อหน่าย",
    "daily": "ทุกวัน, รายวัน",
    "dear": "ที่รัก, เป็นที่รัก",
    "edge": "ขอบ, คม",
    "eight": "แปด, เลขแปด",
    "enthusiastic": "กระตือรือร้น, มีใจจดจ่อ",
    "exact": "แม่นยำ, ถูกต้องแน่นอน",
    "five": "ห้า, เลขห้า",
    "four": "สี่, เลขสี่",
    "helicopter": "เฮลิคอปเตอร์, เครื่องบินปีกหมุน",
    "jam": "แยม, ของหวานทาขนมปัง",
    # คำแปลว่างเปล่า
    "cheer": "ส่งเสียงเชียร์, โห่ร้องยินดี",
    "formal": "เป็นทางการ, ตามแบบแผน",
    # คำแปลผิดความหมาย
    "amuse": "ให้ความบันเทิง, ทำให้ขบขัน",
    "desperate": "สิ้นหวัง, หมดหนทาง",
    "doll": "ตุ๊กตา, หุ่นจำลอง",
    "habit": "นิสัย, ความเคยชิน",
    "jump": "กระโดด, พุ่งขึ้น",
    "just": "เพียงแค่, เพิ่งจะ",
    "kill": "ฆ่า, สังหาร",
    "defeat": "เอาชนะ, ทำให้พ่ายแพ้",
    "diamond": "เพชร",
    "hell": "นรก, ขุมนรก",
    # สะกดภาษาไทยผิด
    "consume": "บริโภค, กิน",
    "enormous": "มหาศาล, ใหญ่มาก",
    "himself": "ตัวเขาเอง, เขาเอง",
    "day": "วัน, กลางวัน",
    "fair": "ยุติธรรม, ค่อนข้าง",
}

# ── 2) คำเหมือน (synonym) ที่ต้องแก้ ──
SYN_FIX = {
    "amuse": "entertain, make laugh, delight",
    "blade": "edge, cutting part, sharp edge",
    "boil": "simmer, cook in water, bubble",
}

# ── 3) คำตรงข้าม (antonym) ที่ต้องแก้ ──
ANT_FIX = {
    "index": "no list, end, conclusion",
}

# ── 4) ประโยคตัวอย่างที่ต้องกำหนดช่องเติมคำเอง (กรณีที่แก้อัตโนมัติไม่ได้) ──
SENTENCE_FIX = {
    "anyway":  "___, I will finish the task.",
    "however": "___, I disagree with you.",
    "chapter": "Read ___ 3 for tomorrow.",
    "hand":    "Raise your ___.",
}


def fix_blank(sentence: str) -> str:
    """ซ่อมประโยคที่ช่องเติมคำ (___) หายไปหรือกลายเป็นการขึ้นบรรทัดรัวๆ"""
    if "_" in sentence:
        return sentence                      # มีช่องอยู่แล้ว ไม่ต้องแก้
    if "\n" in sentence:                     # ช่องกลายเป็นการขึ้นบรรทัด
        s = re.sub(r"\n+", " ___ ", sentence)
    elif re.match(r"^\s*[,\.]", sentence):   # ช่องอยู่ต้นประโยค (ขึ้นต้นด้วยช่องว่าง/จุลภาค)
        s = "___ " + sentence.lstrip(" ")
    elif sentence.startswith(" "):
        s = "___ " + sentence.lstrip(" ")
    else:
        return sentence                      # รูปแบบอื่น ปล่อยให้ SENTENCE_FIX จัดการ
    s = re.sub(r"\s+", " ", s)               # ยุบช่องว่างซ้ำ
    s = re.sub(r"\s+([.?!,])", r"\1", s)     # ลบช่องว่างหน้าเครื่องหมายวรรคตอน
    return s.strip()


def main():
    if not os.path.exists(SRC):
        print(f"❌ ไม่พบไฟล์ {SRC} กรุณาวางสคริปต์ไว้โฟลเดอร์เดียวกับ {SRC}")
        return

    with open(SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = 0
    for item in data:
        # 4.1 แก้ชื่อฟิลด์ที่สะกดผิด thai_meanig -> thai_meaning
        if "thai_meanig" in item:
            item["thai_meaning"] = item.pop("thai_meanig")
            changed += 1

        word = item.get("word", "")

        # 4.2 ซ่อมช่องเติมคำในประโยค "ก่อน" ตัดช่องว่าง
        #     (ต้องทำก่อน เพราะช่องว่างหน้าประโยคเป็นสัญญาณว่าช่อง ___ อยู่ต้นประโยค)
        sent = item.get("example_sentence", "")
        if word in SENTENCE_FIX:
            new_sent = SENTENCE_FIX[word]
        else:
            new_sent = fix_blank(sent)
        if new_sent != sent:
            item["example_sentence"] = new_sent; changed += 1

        # 4.3 ตัดช่องว่างหัว-ท้ายของทุกฟิลด์ที่เป็นข้อความ
        for k, v in list(item.items()):
            if isinstance(v, str) and v != v.strip():
                item[k] = v.strip()
                changed += 1

        # 4.4 แก้คำแปลไทย / คำเหมือน / คำตรงข้าม ตามตารางด้านบน
        if word in THAI_FIX and item.get("thai_meaning") != THAI_FIX[word]:
            item["thai_meaning"] = THAI_FIX[word]; changed += 1
        if word in SYN_FIX and item.get("synonym") != SYN_FIX[word]:
            item["synonym"] = SYN_FIX[word]; changed += 1
        if word in ANT_FIX and item.get("antonym") != ANT_FIX[word]:
            item["antonym"] = ANT_FIX[word]; changed += 1

        # 4.5 ลบคำศัพท์ตัวเองออกจากช่องคำเหมือน (กันเฉลยรั่ว)
        syn = item.get("synonym", "")
        parts = [p.strip() for p in syn.split(",")]
        kept = [p for p in parts if p and p.lower() != word.lower()]
        if len(kept) != len([p for p in parts if p]):
            item["synonym"] = ", ".join(kept); changed += 1

        # 4.6 เอาคำที่ซ้ำกันทั้งช่องคำเหมือนและคำตรงข้ามออกจากช่องคำตรงข้าม
        syn_set = {p.strip().lower() for p in item.get("synonym", "").split(",") if p.strip()}
        ant_parts = [p.strip() for p in item.get("antonym", "").split(",")]
        ant_kept = [p for p in ant_parts if p and p.lower() not in syn_set]
        if len(ant_kept) != len([p for p in ant_parts if p]):
            item["antonym"] = ", ".join(ant_kept); changed += 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ แก้ไขเสร็จเรียบร้อย! บันทึกเป็นไฟล์ {OUT}")
    print(f"   จำนวนการแก้ไขทั้งหมด: {changed} จุด  (คำศัพท์ทั้งหมด {len(data)} รายการ)")
    print(f"   หากตรวจแล้วถูกต้อง ให้นำ {OUT} ไปแทนที่ {SRC} ได้เลย")


if __name__ == "__main__":
    main()
