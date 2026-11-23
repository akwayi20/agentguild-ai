"use client";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { short } from "@/lib/contracts";

const LINKS = [
  ["/verify", "Verify"],
  ["/agents", "Agents"],
  ["/tasks", "Tasks"],
  ["/dashboard", "Dashboard"],
  ["/docs", "Docs"],
];

export function Nav() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-navy-950/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3" aria-label="Main">
        <Link href="/" className="bg-gradient-to-r from-electric to-violet bg-clip-text text-lg font-bold text-transparent">AgentGuild AI</Link>
        <ul className="flex flex-1 flex-wrap gap-4 text-sm text-slate-300">
          {LINKS.map(([href, text]) => (
            <li key={href}><Link href={href} className="hover:text-white">{text}</Link></li>
          ))}
        </ul>
        {isConnected ? (
          <button className="btn-ghost" onClick={() => disconnect()} title="Disconnect">{short(address!)}</button>
        ) : (
          <button className="btn" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </nav>
      {error && <p className="mx-auto max-w-6xl px-4 pb-2 text-xs text-red-400" role="alert">No browser wallet found or request rejected. Open this site inside Binance Wallet or install a wallet extension.</p>}
    </header>
  );
}
