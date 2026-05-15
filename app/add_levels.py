import json

# 1. โหลดข้อมูลเดิม
with open('vocab.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 2. ฟังก์ชันวิเคราะห์ระดับ (ตัวอย่างเกณฑ์เบื้องต้น)
def assign_level(word):
    word = word.lower()
    # คำที่เป็น Phrasal Verbs (มีช่องว่าง) มักเป็น B1/B2
    if ' ' in word:
        return "B1"
    # คำที่ยาวและลงท้ายด้วยศัพท์วิชาการ มักเป็น C1
    academic_suffixes = ('ize', 'ate', 'ous', 'ent', 'ant', 'ive')
    if len(word) > 8 or word.endswith(academic_suffixes):
        return "C1"
    # นอกนั้นให้เป็น B2 (ระดับกลาง)
    return "B2"

# 3. อัปเดตข้อมูล
for item in data:
    if "level" not in item: # ถ้ายังไม่มี level ค่อยเพิ่ม
        item["level"] = assign_level(item["word"])

# 4. บันทึกไฟล์ใหม่
with open('vocab.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("✅ เพิ่มระดับคำศัพท์เรียบร้อยแล้ว!")