import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import DomGuard from "./_components/DomGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vocab Master · โรงเรียนอนุกูลนารี",
  other: { google: "notranslate" },
  description: "ฝึกคำศัพท์ภาษาอังกฤษ ม.4 · ม.6 — คำศัพท์แกน 120 คำ และถอดรหัสคำศัพท์",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // v8.6: ประกาศเป็นภาษาไทย + ห้ามแปลหน้า — Chrome เคยแปลหน้าอัตโนมัติ (lang="en") แล้วทำให้ React พัง (NotFoundError → หน้าขาวในบางเครื่อง)
    <html
      lang="th"
      translate="no"
      className={`notranslate ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <DomGuard />
        {children}
      </body>
    </html>
  );
}
