import type { Metadata } from "next";
import "./globals.css";
// KaTeX styles for rendered math ($$…$$ / \(...\) / \[...\]) in chat messages,
// help docs, and Scriptorium file previews. Loaded globally because server
// pre-rendered messages arrive as HTML that already contains KaTeX markup.
import "katex/dist/katex.min.css";
import { Providers } from "@/components/providers/session-provider";
import { AutoLockProvider } from "@/components/providers/auto-lock-provider";
import { PluginInitializer, PluginUpgradeNotifier, MigrationWarningNotifier } from "@/components/startup";
import { PepperVaultGate } from "@/components/startup/pepper-vault-gate";
import { InstanceLockGate } from "@/components/startup/instance-lock-gate";
import { VersionGuardGate } from "@/components/startup/version-guard-gate";
import { AppLayout } from "@/components/layout/app-layout";

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
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="font-sans" suppressHydrationWarning>
        <PepperVaultGate />
        <InstanceLockGate />
        <VersionGuardGate />
        <Providers>
          <AutoLockProvider />
          <PluginInitializer />
          <PluginUpgradeNotifier />
          <MigrationWarningNotifier />
          <AppLayout>
            {children}
          </AppLayout>
        </Providers>
      </body>
    </html>
  );
}

