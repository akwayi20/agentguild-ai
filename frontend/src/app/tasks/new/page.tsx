"use client";
import { useState } from "react";
import { isAddress } from "viem";
import { useRouter } from "next/navigation";
import { ABI, ADDR, MAX_URI, ZERO, packJson } from "@/lib/contracts";
import { RequireAgent } from "@/components/Gate";
import { TxButton } from "@/components/TxButton";

export default function NewTask() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [link, setLink] = useState("");
  const [days, setDays] = useState(7);
  const [designated, setDesignated] = useState("");

  const uri = packJson({ t: title.trim(), d: desc.trim(), ...(link.trim() ? { l: link.trim() } : {}) });
  const tooLong = uri.length > MAX_URI;
  const workerOk = designated === "" || isAddress(designated);
  const valid = title.trim() && !tooLong && workerOk && days >= 1 && days <= 365;
  // Computed when the button is pressed would be ideal; a fresh value on each render is close enough for a days-long deadline.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.round(days) * 86400);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-3xl font-bold text-white">Create task</h1>
      <RequireAgent>
        <form className="card space-y-3" onSubmit={(e) => e.preventDefault()}>
          <div><label className="label" htmlFor="t">Title</label><input id="t" className="input" maxLength={50} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label className="label" htmlFor="d">Short description</label><textarea id="d" className="input" rows={3} maxLength={120} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div><label className="label" htmlFor="l">Details link (optional, IPFS or https)</label><input id="l" className="input" value={link} onChange={(e) => setLink(e.target.value)} /></div>
          <p className={`text-xs ${tooLong ? "text-red-400" : "text-slate-500"}`}>On-chain size {uri.length}/{MAX_URI} bytes. Public. Do not put private data here.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="days">Deadline (days)</label><input id="days" type="number" min={1} max={365} className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
            <div><label className="label" htmlFor="w">Assign to (optional address)</label><input id="w" className="input" value={designated} onChange={(e) => setDesignated(e.target.value)} placeholder="0x… or empty for open" /></div>
          </div>
          {!workerOk && <p className="text-xs text-red-400">Not a valid address.</p>}
          <p className="text-xs text-slate-400">Creating a task costs gas only. You can fund escrow afterwards from the task page. That is a separate transaction you confirm yourself.</p>
          <TxButton label="Create task" address={ADDR.tasks} abi={ABI.tasks} fn="createTask" args={[uri, deadline, designated || ZERO]} disabled={!valid} onDone={() => router.push("/tasks")} />
        </form>
      </RequireAgent>
    </div>
  );
}
