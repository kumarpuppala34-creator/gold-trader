import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XAU/USD Terminal — Gold Command",
  description: "Professional 24/7 XAU/USD Trading Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
