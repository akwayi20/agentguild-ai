"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { CONFIGURED } from "@/lib/contracts";
import { useAgentStatus } from "@/lib/hooks";

export function ConfigBanner() {
  if (CONFIGURED) return null;
  return (
    <div className="warn mb-6" role="alert">
      Contracts are not configured. Set the <code>NEXT_PUBLIC_*_ADDRESS</code> variables from your deployment file. Until then this site shows no data.
    </div>
  );
}

/** Blocks children until the wallet holds an Agent ID and is registered. The contracts enforce it again on-chain. */
export function RequireAgent({ children }: { children: ReactNode }) {
  const s = useAgentStatus();
  if (!s.connected) return <div className="card">Connect your wallet to continue.</div>;
  if (s.loading) return <div className="card">Checking your Agent ID…</div>;
  if (!s.holdsAgentId || !s.eligible) {
    return (
      <div className="card space-y-3">
        <p>{!s.holdsAgentId ? "This wallet does not hold an Agent ID." : "This wallet holds an Agent ID but is not registered yet."}</p>
        <Link href="/verify" className="btn">Go to verification</Link>
      </div>
    );
  }
  return <>{children}</>;
}
