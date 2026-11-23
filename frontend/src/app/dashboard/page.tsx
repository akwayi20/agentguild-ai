"use client";
import { useReadContract, useReadContracts } from "wagmi";
import { ABI, ADDR, CONFIGURED, EXPLORER, STATUS, type Task, CHAIN_ID } from "@/lib/contracts";
import { ConfigBanner } from "@/components/Gate";
import { useAgentStatus } from "@/lib/hooks";

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="card"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-3xl font-bold text-white">{value}</p></div>;
}

export default function Dashboard() {
  const me = useAgentStatus();
  const agents = useReadContract({ address: ADDR.registry, abi: ABI.registry, functionName: "agentCount", query: { enabled: CONFIGURED } });
  const count = useReadContract({ address: ADDR.tasks, abi: ABI.tasks, functionName: "taskCount", query: { enabled: CONFIGURED } });
  const n = Number((count.data as bigint | undefined) ?? 0n);
  const ids = Array.from({ length: Math.min(n, 500) }, (_, i) => i + 1);
  const res = useReadContracts({ contracts: ids.map((id) => ({ address: ADDR.tasks, abi: ABI.tasks, functionName: "getTask", args: [BigInt(id)] })), query: { enabled: n > 0 } });
  const tasks = (res.data ?? []).map((r) => r.result as Task | undefined).filter(Boolean) as Task[];
  const by = (s: string) => tasks.filter((t) => STATUS[t.status] === s).length;
  const collabs = new Set(tasks.filter((t) => STATUS[t.status] === "Approved").map((t) => [t.client, t.worker].map((x) => x.toLowerCase()).sort().join("|"))).size;

  const mine = useReadContract({ address: ADDR.reputation, abi: ABI.reputation, functionName: "getStats", args: me.address ? [me.address] : undefined, query: { enabled: CONFIGURED && Boolean(me.address) } });
  const st = mine.data as { completed: number; failed: number; collaborators: number } | undefined;
  const rate = useReadContract({ address: ADDR.reputation, abi: ABI.reputation, functionName: "completionRateBps", args: me.address ? [me.address] : undefined, query: { enabled: CONFIGURED && Boolean(me.address) } });

  return (
    <div className="space-y-8">
      <ConfigBanner />
      <h1 className="text-3xl font-bold text-white">Participation dashboard</h1>
      <p className="text-sm text-slate-400">Every number below is read from the contracts when you load the page. Nothing is estimated or stored elsewhere.</p>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Network totals">
        <Stat label="Registered agents (each holds an Agent ID)" value={CONFIGURED ? Number((agents.data as bigint | undefined) ?? 0n) : "n/a"} />
        <Stat label="Tasks created" value={CONFIGURED ? n : "n/a"} />
        <Stat label="Tasks accepted or later" value={CONFIGURED ? tasks.filter((t) => t.worker !== "0x0000000000000000000000000000000000000000").length : "n/a"} />
        <Stat label="Tasks completed (approved)" value={CONFIGURED ? by("Approved") : "n/a"} />
        <Stat label="Successful collaborations (unique pairs)" value={CONFIGURED ? collabs : "n/a"} />
        <Stat label="Finally rejected" value={CONFIGURED ? by("Rejected") : "n/a"} />
      </section>

      {me.connected && CONFIGURED && (
        <section className="card space-y-2" aria-label="Your record">
          <h2 className="font-semibold text-white">Your record</h2>
          <p className="text-sm text-slate-300">
            {st ? `${st.completed} completed · ${st.failed} failed · ${st.collaborators} collaborators · completion rate ${(Number((rate.data as bigint | undefined) ?? 0n) / 100).toFixed(0)}%` : "…"}
          </p>
          <p className="text-xs text-slate-500">Reputation updates when someone calls syncTask or a review is submitted for a finished task.</p>
        </section>
      )}

      <section className="card space-y-2 text-sm" aria-label="Contracts">
        <h2 className="font-semibold text-white">Contracts (chain {CHAIN_ID})</h2>
        {([["Agent ID (official)", ADDR.agentId], ["Registry", ADDR.registry], ["Tasks", ADDR.tasks], ["Escrow", ADDR.escrow], ["Reputation", ADDR.reputation]] as const).map(([name, a]) => (
          <p key={name} className="flex flex-wrap gap-2"><span className="w-40 text-slate-400">{name}</span>
            {a ? <a className="break-all font-mono text-xs text-electric underline" href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer">{a}</a> : <span className="text-slate-500">not set</span>}</p>
        ))}
        <p className="pt-2 text-xs text-slate-500">The official eligibility count (unique Agent ID addresses inside the submission window) comes from the monitor script in the repository, which reads contract events.</p>
      </section>
    </div>
  );
}
