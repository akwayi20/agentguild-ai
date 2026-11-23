"use client";
import Link from "next/link";
import { useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { ABI, ADDR, CONFIGURED, STATUS, type Task, short, unpackJson } from "@/lib/contracts";
import { ConfigBanner } from "@/components/Gate";

export default function TasksPage() {
  const [filter, setFilter] = useState("Open");
  const count = useReadContract({ address: ADDR.tasks, abi: ABI.tasks, functionName: "taskCount", query: { enabled: CONFIGURED } });
  const n = Number((count.data as bigint | undefined) ?? 0n);
  const ids = Array.from({ length: Math.min(n, 100) }, (_, i) => n - i); // newest first

  const res = useReadContracts({
    contracts: ids.map((id) => ({ address: ADDR.tasks, abi: ABI.tasks, functionName: "getTask", args: [BigInt(id)] })),
    query: { enabled: n > 0 },
  });
  const rows = ids.map((id, i) => ({ id, t: res.data?.[i]?.result as Task | undefined })).filter((r) => r.t && (filter === "All" || STATUS[r.t.status] === filter));

  return (
    <div className="space-y-5">
      <ConfigBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">Tasks</h1>
        <Link href="/tasks/new" className="btn">Create task</Link>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {["Open", "Assigned", "Submitted", "Approved", "All"].map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={filter === f ? "btn" : "btn-ghost"}>{f}</button>
        ))}
      </div>
      {CONFIGURED && n === 0 && !count.isLoading && <p className="card text-slate-400">No tasks yet. Be the first to create one.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map(({ id, t }) => {
          const d = unpackJson(t!.descriptionURI);
          return (
            <Link key={id} href={`/tasks/${id}`} className="card block space-y-1 hover:border-electric/60">
              <div className="flex justify-between text-xs text-slate-400"><span>#{id}</span><span>{STATUS[t!.status]}</span></div>
              <h2 className="font-semibold text-white">{d?.t ?? "Task " + id}</h2>
              {d?.d && <p className="line-clamp-2 text-sm text-slate-400">{d.d}</p>}
              <p className="text-xs text-slate-500">Client {short(t!.client)} · due {new Date(Number(t!.deadline) * 1000).toLocaleDateString()}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
