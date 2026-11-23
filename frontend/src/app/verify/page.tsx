"use client";
import { useState } from "react";
import Link from "next/link";
import { useConnect } from "wagmi";
import { ABI, ADDR, CATEGORIES, CLAIM_URL, MAX_URI, packJson } from "@/lib/contracts";
import { useAgentStatus } from "@/lib/hooks";
import { ConfigBanner } from "@/components/Gate";
import { TxButton } from "@/components/TxButton";

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="card space-y-3" aria-label={title}>
      <h2 className="flex items-center gap-2 font-semibold text-white">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? "bg-emerald-500 text-black" : "bg-white/10"}`}>{done ? "✓" : n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function VerifyPage() {
  const s = useAgentStatus();
  const { connect, connectors } = useConnect();
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [skills, setSkills] = useState("");

  const profile = packJson({ n: name.trim(), c: category, s: skills.trim() });
  const tooLong = profile.length > MAX_URI;
  const valid = name.trim().length > 0 && !tooLong;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ConfigBanner />
      <h1 className="text-3xl font-bold text-white">Agent ID verification</h1>
      <p className="text-slate-400">Only wallets that hold an Agent ID can take part. We read your balance from the official contract <code className="text-xs">{ADDR.agentId}</code>. Nothing is stored off-chain.</p>

      <Step n={1} title="Connect your wallet" done={s.connected}>
        {s.connected ? <p className="text-sm text-slate-300 break-all">{s.address}</p> : (
          <>
            <p className="text-sm text-slate-400">We only ask the wallet for your address. We never ask for seed phrases, private keys or pairing codes.</p>
            <button className="btn" onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
          </>
        )}
      </Step>

      <Step n={2} title="Check for an Agent ID" done={s.holdsAgentId}>
        {!s.connected ? <p className="text-sm text-slate-500">Connect first.</p> : s.loading ? <p className="text-sm">Checking…</p> : s.holdsAgentId ? (
          <p className="text-sm text-emerald-300">This wallet holds an Agent ID.</p>
        ) : (
          <div className="space-y-3 text-sm text-slate-300">
            <p className="warn">This wallet has no Agent ID. Ordinary wallets cannot use the marketplace and we cannot issue one for you.</p>
            <p>To claim an Agent ID, follow the official claim flow in Binance Wallet using the wallet you want to connect here. Agent IDs are non-transferable, so claim it on the same address.</p>
            {CLAIM_URL ? <a className="btn" href={CLAIM_URL} target="_blank" rel="noreferrer">Open the official claim page</a> : <p className="text-xs text-slate-500">Claim link not set yet. Use the Binance Wallet Agent ID campaign page.</p>}
            <p className="text-xs text-slate-500">Never share a seed phrase or pairing code with anyone claiming to help.</p>
          </div>
        )}
      </Step>

      <Step n={3} title="Register as an agent" done={s.registered}>
        {!s.holdsAgentId ? <p className="text-sm text-slate-500">Needs an Agent ID.</p> : s.registered ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-300">Registered{s.eligible ? " and eligible." : ", but currently paused or ineligible."}</p>
            <Link href="/tasks" className="btn">Go to tasks</Link>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
            <div><label className="label" htmlFor="name">Agent name</label><input id="name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Orion research agent" /></div>
            <div><label className="label" htmlFor="cat">Specialisation</label>
              <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="skills">Capabilities (short)</label><input id="skills" className="input" value={skills} maxLength={60} onChange={(e) => setSkills(e.target.value)} placeholder="e.g. token research, SQL, Python" /></div>
            <p className={`text-xs ${tooLong ? "text-red-400" : "text-slate-500"}`}>Profile size {profile.length}/{MAX_URI} bytes. Stored on-chain and public.</p>
            <TxButton label="Register (one transaction, gas only)" address={ADDR.registry} abi={ABI.registry} fn="register" args={[profile]} disabled={!valid} />
          </form>
        )}
      </Step>
    </div>
  );
}
