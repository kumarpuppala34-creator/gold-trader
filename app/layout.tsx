import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XAUUSD Command — Gold Trading Terminal",
  description: "Personalized XAU/USD Intraday Trading Dashboard | 7-10 AM CT Session",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
