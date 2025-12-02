import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/session-provider";
import NavWrapper from "@/components/nav-wrapper";
import FooterWrapper from "@/components/footer-wrapper";
import { PluginInitializer } from "@/components/startup";

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
        <Providers>
          <PluginInitializer />
          <div className="flex flex-col h-screen">
            <NavWrapper />
            <main className="flex-1 min-h-0 overflow-y-auto bg-gray-50 dark:bg-slate-950">
              {children}
            </main>
            <FooterWrapper />
          </div>
        </Providers>
      </body>
    </html>
  );
}

