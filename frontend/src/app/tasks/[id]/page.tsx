"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { formatEther, parseEther } from "viem";
import { ABI, ADDR, CONFIGURED, GRACE_SECONDS, STATUS, type Task, ZERO, short, unpackJson } from "@/lib/contracts";
import { useAgentStatus } from "@/lib/hooks";
import { ConfigBanner } from "@/components/Gate";
import { TxButton } from "@/components/TxButton";

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = BigInt(id);
  const { address } = useAccount();
  const me = useAgentStatus();

  const [uri, setUri] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [rating, setRating] = useState(5);

  const taskQ = useReadContract({ address: ADDR.tasks, abi: ABI.tasks, functionName: "getTask", args: [taskId], query: { enabled: CONFIGURED } });
  const locked = useReadContract({ address: ADDR.escrow, abi: ABI.escrow, functionName: "lockedAmount", args: [taskId], query: { enabled: CONFIGURED } });
  const funded = useReadContract({ address: ADDR.escrow, abi: ABI.escrow, functionName: "funded", args: [taskId], query: { enabled: CONFIGURED } });
  const reviewed = useReadContract({ address: ADDR.reputation, abi: ABI.reputation, functionName: "reviewed", args: address ? [taskId, address] : undefined, query: { enabled: CONFIGURED && Boolean(address) } });

  const t = taskQ.data as Task | undefined;
  if (!CONFIGURED) return <ConfigBanner />;
  if (taskQ.isLoading) return <p>Loading…</p>;
  if (!t) return <p className="card">Task not found.</p>;

  const lockedWei = (locked.data as bigint | undefined) ?? 0n;
  const fundedWei = (funded.data as bigint | undefined) ?? 0n;
  const paidOrRefunded = fundedWei > 0n && lockedWei === 0n;
  const status = STATUS[t.status];
  const isClient = same(address, t.client);
  const isWorker = same(address, t.worker);
  const d = unpackJson(t.descriptionURI);
  const pastGrace = Date.now() / 1000 > Number(t.deadline) + GRACE_SECONDS;
  const canAccept = me.eligible && !isClient && status === "Open" && (t.designatedWorker === ZERO || same(address, t.designatedWorker)) && Date.now() / 1000 < Number(t.deadline);
  const canFund = isClient && fundedWei === 0n && (status === "Open" || status === "Assigned");
  const canRefund = isClient && lockedWei > 0n && (status === "Cancelled" || status === "Rejected" || ((status === "Open" || status === "Assigned") && pastGrace));
  const canRelease = (isClient || isWorker) && lockedWei > 0n && status === "Approved";
  const canReview = (isClient || isWorker) && status === "Approved" && reviewed.data === false;

  let fundWei: bigint | undefined;
  try { fundWei = amount ? parseEther(amount) : undefined; } catch { fundWei = undefined; }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between text-sm text-slate-400"><span>Task #{id}</span><span className="rounded-full bg-white/10 px-3 py-1 text-white">{status}</span></div>
      <h1 className="text-3xl font-bold text-white">{d?.t ?? `Task ${id}`}</h1>
      <section className="card space-y-2 text-sm">
        {d?.d && <p className="text-slate-300">{d.d}</p>}
        {d?.l && <p><a className="text-electric underline" href={d.l.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${d.l.slice(7)}` : d.l} target="_blank" rel="noreferrer noopener">Details link</a></p>}
        {!d && <p className="break-all text-slate-400">{t.descriptionURI}</p>}
        <p className="text-slate-400">Client {short(t.client)}{t.worker !== ZERO ? ` · Worker ${short(t.worker)}` : t.designatedWorker !== ZERO ? ` · Assigned to ${short(t.designatedWorker)}` : ""}</p>
        <p className="text-slate-400">Deadline {new Date(Number(t.deadline) * 1000).toLocaleString()} · rejections {t.rejections}/3</p>
        {t.deliverableURI && <p className="break-all text-slate-300">Deliverable: {t.deliverableURI}</p>}
      </section>

      <section className="card space-y-1 text-sm" aria-label="Escrow">
        <h2 className="font-semibold text-white">Escrow</h2>
        {fundedWei === 0n ? <p className="text-slate-400">No bounty funded. Payment, if any, happens outside the contract.</p>
          : paidOrRefunded ? <p className="text-slate-300">{formatEther(fundedWei)} BNB has been settled.</p>
          : <p className="text-slate-300">{formatEther(lockedWei)} BNB locked. Released only after the client approves. Refund rules are on the Docs page.</p>}
      </section>

      {!me.connected && <p className="card">Connect your wallet to act on this task.</p>}

      {canAccept && (
        <section className="card space-y-2"><h2 className="font-semibold text-white">Accept this task</h2>
          <TxButton label="Accept task" address={ADDR.tasks} abi={ABI.tasks} fn="acceptTask" args={[taskId]} /></section>
      )}

      {isWorker && status === "Assigned" && (
        <section className="card space-y-3"><h2 className="font-semibold text-white">Submit your work</h2>
          <label className="label" htmlFor="u">Link to deliverable (IPFS or https)</label>
          <input id="u" className="input" maxLength={256} value={uri} onChange={(e) => setUri(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <TxButton label="Submit work" address={ADDR.tasks} abi={ABI.tasks} fn="submitWork" args={[uri]} disabled={!uri.trim()} />
            <TxButton ghost label="Step back from task" address={ADDR.tasks} abi={ABI.tasks} fn="releaseAssignment" args={[taskId]} />
          </div>
        </section>
      )}

      {isClient && status === "Submitted" && (
        <section className="card space-y-3"><h2 className="font-semibold text-white">Review the submission</h2>
          <label className="label" htmlFor="r">Reason if rejecting (optional link or note)</label>
          <input id="r" className="input" maxLength={256} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <TxButton label="Approve work" address={ADDR.tasks} abi={ABI.tasks} fn="approveWork" args={[taskId]} warning="Approving is permanent. Locked escrow, if any, becomes payable to the worker." />
            <TxButton ghost label="Reject" address={ADDR.tasks} abi={ABI.tasks} fn="rejectWork" args={[taskId, reason]} warning={t.rejections >= 2 ? "This is the third rejection. It is final, the task ends and the worker's record shows a failed task." : undefined} />
          </div>
        </section>
      )}

      {isClient && status === "Open" && (
        <section className="card"><TxButton ghost label="Cancel task" address={ADDR.tasks} abi={ABI.tasks} fn="cancelTask" args={[taskId]} /></section>
      )}

      {canFund && (
        <section className="card space-y-3"><h2 className="font-semibold text-white">Fund escrow (optional)</h2>
          <label className="label" htmlFor="a">Amount in BNB</label>
          <input id="a" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.05" />
          <TxButton label={`Lock ${amount || "…"} BNB in escrow`} address={ADDR.escrow} abi={ABI.escrow} fn="fund" args={[taskId]} value={fundWei} disabled={!fundWei || fundWei <= 0n}
            warning="You are sending real BNB to the escrow contract. It can only go to the worker after you approve their work, or back to you under the refund rules. This contract is unaudited and nobody can reverse a mistake. Only fund what you can afford to lose." />
        </section>
      )}

      {canRelease && (
        <section className="card space-y-2"><h2 className="font-semibold text-white">Pay the worker</h2>
          <TxButton label={`Release ${formatEther(lockedWei)} BNB to worker`} address={ADDR.escrow} abi={ABI.escrow} fn="release" args={[taskId]} /></section>
      )}

      {canRefund && (
        <section className="card space-y-2"><h2 className="font-semibold text-white">Refund</h2>
          <TxButton label={`Refund ${formatEther(lockedWei)} BNB to me`} address={ADDR.escrow} abi={ABI.escrow} fn="refund" args={[taskId]} /></section>
      )}

      {canReview && (
        <section className="card space-y-3"><h2 className="font-semibold text-white">Rate the other party</h2>
          <label className="label" htmlFor="rt">Rating</label>
          <select id="rt" className="input w-28" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select>
          <TxButton label="Submit review (once only)" address={ADDR.reputation} abi={ABI.reputation} fn="submitReview" args={[taskId, rating, ""]} />
        </section>
      )}
    </div>
  );
}
