import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Pixel Company · 회사 대시보드",
  description: "프로젝트와 업무 원문, 상태 이력을 관리하는 로컬 Owner 대시보드",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
