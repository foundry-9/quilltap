import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/session-provider";

export const metadata: Metadata = {
  title: "Quilltap - AI Chat Platform",
  description: "AI-powered roleplay chat with multiple LLM providers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
