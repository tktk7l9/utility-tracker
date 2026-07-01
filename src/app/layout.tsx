import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#3a7bd5",
};

export const metadata: Metadata = {
  applicationName: "光熱費トラッカー",
  title: {
    default: "光熱費トラッカー — Utility Tracker",
    template: "%s | 光熱費トラッカー",
  },
  description:
    "電気(TEPCO)・ガス(LPIO)・水道(東京都水道局)の料金と使用量を1か所に集約し、月別推移・使用量/単価・前年同月比をグラフで可視化する個人用ダッシュボード（private）。",
  authors: [{ name: "tktk7l9" }],
  creator: "tktk7l9",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
