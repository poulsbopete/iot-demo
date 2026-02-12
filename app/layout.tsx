import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ecolab IoT Command Center",
  description: "Demo: IoT metrics, OTLP, Elastic, and AI Ops Copilot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
