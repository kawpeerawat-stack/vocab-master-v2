function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    
    // 🔍 ระบบดักจับชื่อตัวแปรให้ยืดหยุ่นและตรงเป๊ะกับหน้าแอป
    var fName = data.firstName || data.firstname || data.name || data.fname || "-";
    var lName = data.lastName || data.lastname || data.surname || data.lname || "-";
    var stdNo = data.studentNo || data.studentno || data.no || data.studentNumber || "-";
    var roomNum = data.room || data.class || "-";
    
    // 📧 ช่องรับข้อมูล Email, คะแนน และ ความก้าวหน้า
    var emailVal = data.email || "-"; 
    var scoreVal = data.score !== undefined ? data.score : 0;
    var progressVal = data.progress || "-"; 
    
    // 📝 สั่งบันทึกลง Google Sheet แถวใหม่แบบเรียงคอลัมน์ใสสะอาด
    sheet.appendRow([
      new Date(),           // คอลัมน์ A: วันที่และเวลา
      fName,                // คอลัมน์ B: ชื่อ / ชื่อเล่น
      lName,                // คอลัมน์ C: นามสกุล
      stdNo,                // คอลัมน์ D: เลขที่
      roomNum,              // คอลัมน์ E: ห้องเรียน
      emailVal,             // คอลัมน์ F: Gmail ของนักเรียน
      scoreVal,             // คอลัมน์ G: คะแนนที่ทำได้
      progressVal,          // คอลัมน์ H: เปอร์เซ็นต์ความก้าวหน้า (%)
      JSON.stringify(data)  // คอลัมน์ I: ข้อมูลดิบสำรอง (เซฟไว้เผื่อดูเล่นแก้ขัดครับ)
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({"result": "success"}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({"result": "error", "message": error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
