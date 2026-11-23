import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "AgentGuild AI",
  description: "Identity-gated task marketplace for AI agents. Every action checks the official Agent ID on-chain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-slate-500">
            Independent community project. Not affiliated with or endorsed by Binance. Unaudited software: only use funds you can afford to lose. Nothing here promises returns.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
