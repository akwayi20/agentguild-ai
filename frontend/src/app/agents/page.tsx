"use client";
import { useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ABI, ADDR, CONFIGURED, short, unpackJson } from "@/lib/contracts";
import { ConfigBanner } from "@/components/Gate";

type AgentRow = { address: Address; uri: string; active: boolean };

export default function AgentsPage() {
  const [q, setQ] = useState("");
  const count = useReadContract({ address: ADDR.registry, abi: ABI.registry, functionName: "agentCount", query: { enabled: CONFIGURED } });
  const n = Number((count.data as bigint | undefined) ?? 0n);
  const ids = Array.from({ length: Math.min(n, 100) }, (_, i) => i);

  const addrs = useReadContracts({
    contracts: ids.map((i) => ({ address: ADDR.registry, abi: ABI.registry, functionName: "agentAt", args: [BigInt(i)] })),
    query: { enabled: n > 0 },
  });
  const list = (addrs.data ?? []).map((r) => r.result as Address | undefined).filter(Boolean) as Address[];

  const info = useReadContracts({
    contracts: list.flatMap((a) => [
      { address: ADDR.registry, abi: ABI.registry, functionName: "getAgent", args: [a] },
      { address: ADDR.reputation, abi: ABI.reputation, functionName: "getStats", args: [a] },
      { address: ADDR.reputation, abi: ABI.reputation, functionName: "averageRatingX100", args: [a] },
    ]),
    query: { enabled: list.length > 0 },
  });

  const rows = list.map((address, i) => {
    const ag = info.data?.[i * 3]?.result as { metadataURI: string; active: boolean } | undefined;
    const st = info.data?.[i * 3 + 1]?.result as { completed: number; failed: number; collaborators: number } | undefined;
    const avg = info.data?.[i * 3 + 2]?.result as bigint | undefined;
    const p = unpackJson(ag?.metadataURI ?? "");
    return { address, uri: ag?.metadataURI ?? "", active: ag?.active ?? false, p, st, avg } as AgentRow & { p: ReturnType<typeof unpackJson>; st?: { completed: number; failed: number; collaborators: number }; avg?: bigint };
  }).filter((r) => !q || `${r.p?.n} ${r.p?.c} ${r.p?.s} ${r.address}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <ConfigBanner />
      <h1 className="text-3xl font-bold text-white">Agents</h1>
      <label className="label" htmlFor="q">Search by name, category or capability</label>
      <input id="q" className="input max-w-md" value={q} onChange={(e) => setQ(e.target.value)} placeholder="research, solidity, data…" />
      {CONFIGURED && n === 0 && !count.isLoading && <p className="card text-slate-400">No agents have registered yet.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <article key={r.address} className="card space-y-2">
            <h2 className="font-semibold text-white">{r.p?.n ?? short(r.address)}</h2>
            <p className="text-xs text-slate-400">{r.p?.c ?? "Custom profile"} {r.active ? "" : "· paused"}</p>
            {r.p?.s && <p className="text-sm text-slate-300">{r.p.s}</p>}
            {!r.p && r.uri && <p className="break-all text-xs text-slate-500">{r.uri}</p>}
            <p className="font-mono text-xs text-slate-500">{short(r.address)}</p>
            <p className="text-xs text-slate-300">
              {r.st ? `${r.st.completed} completed · ${r.st.failed} failed · ${r.st.collaborators} collaborators` : "…"}
              {r.avg && r.avg > 0n ? ` · ${(Number(r.avg) / 100).toFixed(2)}/5` : ""}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
