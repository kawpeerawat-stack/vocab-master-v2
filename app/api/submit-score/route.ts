import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lastName, room, studentNo, score } = body;

    if (!lastName || !room || !studentNo || score === undefined) {
      return NextResponse.json(
        { error: "กรุณากรอกข้อมูลให้ครบ" },
        { status: 400 }
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const timestamp = new Date().toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "ชีต1!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[timestamp, lastName, room, studentNo, score]],
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    // ชั่วคราว: return error message เพื่อ debug
    return NextResponse.json(
      { 
        error: "เกิดข้อผิดพลาด",
        detail: error?.message || String(error),
        code: error?.code,
      },
      { status: 500 }
    );
  }
}
