// Counts genuine, unique Agent ID participants from on-chain events only.
// Nothing here is estimated or stored off-chain. Every figure can be reproduced from the logs.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Which event argument identifies the wallet that sent the transaction.
// PaymentReleased is excluded because the caller can be client or worker, so the event
// alone does not say who acted. TaskRecorded is excluded because anyone may call syncTask.
const ACTOR_ARG = {
  AgentRegistered: "agent",
  AgentProfileUpdated: "agent",
  AgentStatusChanged: "agent",
  TaskCreated: "client",
  TaskAccepted: "worker",
  AssignmentReleased: "worker",
  WorkSubmitted: "worker",
  WorkApproved: "client",
  WorkRejected: "client",
  TaskCancelled: "client",
  TaskFunded: "client",
  PaymentRefunded: "client",
  ReviewSubmitted: "reviewer",
};

const AGENT_ID_ABI = ["function balanceOf(address) view returns (uint256)"];

function loadInterface(name) {
  const p = path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  return new ethers.Interface(JSON.parse(fs.readFileSync(p, "utf8")).abi);
}

/** First block whose timestamp is >= ts. Returns latest+1 if none. */
async function firstBlockAtOrAfter(provider, ts) {
  let hi = await provider.getBlockNumber();
  if ((await provider.getBlock(hi)).timestamp < ts) return hi + 1;
  let lo = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await provider.getBlock(mid)).timestamp >= ts) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function collectLogs(provider, address, from, to, chunk) {
  const logs = [];
  for (let start = from; start <= to; start += chunk) {
    const end = Math.min(start + chunk - 1, to);
    logs.push(...(await provider.getLogs({ address, fromBlock: start, toBlock: end })));
  }
  return logs;
}

/**
 * @param provider     ethers v6 provider
 * @param deployments  parsed deployments/<network>.json
 * @param config       parsed config/adoption.json
 * @param opts         { windowStart, windowEnd (unix s), logChunk }
 */
async function buildReport(provider, deployments, config, opts = {}) {
  const windowStart = opts.windowStart ?? Math.floor(Date.parse(config.submissionPeriod.startUtc) / 1000);
  const windowEnd = opts.windowEnd ?? Math.floor(Date.parse(config.submissionPeriod.endUtc) / 1000);
  const chunk = opts.logChunk ?? 5000;

  const latest = await provider.getBlockNumber();
  const startBlock = await firstBlockAtOrAfter(provider, windowStart);
  const endBlock = Math.min((await firstBlockAtOrAfter(provider, windowEnd)) - 1, latest);

  const agentId = new ethers.Contract(deployments.agentId.address, AGENT_ID_ABI, provider);
  const holderCache = new Map();
  const holds = async (addr) => {
    if (!holderCache.has(addr)) holderCache.set(addr, (await agentId.balanceOf(addr)) > 0n);
    return holderCache.get(addr);
  };

  const counts = { registrations: 0, tasksCreated: 0, tasksAccepted: 0, workSubmitted: 0, tasksCompleted: 0, tasksRejectedFinal: 0, reviews: 0, escrowFunded: 0 };
  let fundedWei = 0n;
  let releasedWei = 0n;
  const allActors = new Set();
  const allTxs = new Set();
  const pairs = new Set();
  const perContract = [];
  const txLinks = [];

  for (const c of deployments.contracts.filter((x) => x.includedInHackathonSubmission)) {
    const iface = loadInterface(c.name);
    const from = Math.max(startBlock, c.deploymentBlock ?? 0);
    const logs = endBlock >= from ? await collectLogs(provider, c.address, from, endBlock, chunk) : [];
    const actors = new Set();
    const txs = new Set();

    for (const log of logs) {
      let ev;
      try {
        ev = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!ev) continue;
      txs.add(log.transactionHash);
      allTxs.add(log.transactionHash);

      const argName = ACTOR_ARG[ev.name];
      if (argName) {
        const a = ethers.getAddress(ev.args[argName]);
        actors.add(a);
        allActors.add(a);
      }
      switch (ev.name) {
        case "AgentRegistered": counts.registrations++; break;
        case "TaskCreated": counts.tasksCreated++; break;
        case "TaskAccepted": counts.tasksAccepted++; break;
        case "WorkSubmitted": counts.workSubmitted++; break;
        case "WorkApproved":
          counts.tasksCompleted++;
          pairs.add([ev.args.client, ev.args.worker].map((x) => x.toLowerCase()).sort().join("|"));
          break;
        case "WorkRejected": if (ev.args.finalRejection) counts.tasksRejectedFinal++; break;
        case "ReviewSubmitted": counts.reviews++; break;
        case "TaskFunded": counts.escrowFunded++; fundedWei += ev.args.amount; break;
        case "PaymentReleased": releasedWei += ev.args.amount; break;
        default:
      }
    }

    let eligible = 0;
    for (const a of actors) if (await holds(a)) eligible++;
    perContract.push({
      name: c.name,
      address: c.address,
      transactions: txs.size,
      uniqueAddresses: actors.size,
      uniqueAgentIdAddresses: eligible,
    });
    for (const h of txs) txLinks.push({ contract: c.name, tx: h });
  }

  const eligibleActors = [];
  const withoutAgentId = [];
  for (const a of allActors) (await holds(a) ? eligibleActors : withoutAgentId).push(a);

  const min = config.adoption.minimumUniqueAgentIds;
  const target = config.adoption.targetUniqueAgentIds;
  const unique = eligibleActors.length;

  return {
    generatedAt: new Date().toISOString(),
    network: deployments.network,
    chainId: deployments.chainId,
    window: { startUnix: windowStart, endUnix: windowEnd, startBlock, endBlock, latestBlock: latest },
    agentIdContract: deployments.agentId.address,
    contracts: perContract,
    totals: {
      uniqueAgentIdAddresses: unique,
      addressesWithoutAgentId: withoutAgentId,
      transactions: allTxs.size,
      ...counts,
      successfulCollaborations: pairs.size,
      escrowFundedWei: fundedWei.toString(),
      escrowReleasedWei: releasedWei.toString(),
    },
    adoption: {
      minimum: min,
      target,
      minimumMet: unique >= min,
      targetMet: unique >= target,
      remainingToMinimum: Math.max(0, min - unique),
      remainingToTarget: Math.max(0, target - unique),
    },
    addresses: eligibleActors.sort(),
    transactionHashes: txLinks,
    note: "Failed transactions do not emit events and are not visible here. Check them on BscScan.",
  };
}

/** Final eligibility gate. Items we cannot prove from the chain need a human to confirm them. */
async function evaluateGate(provider, report, deployments, config, manual = {}) {
  const items = [];
  const add = (id, label, status, detail) => items.push({ id, label, status, detail });
  const submitted = deployments.contracts.filter((c) => c.includedInHackathonSubmission);

  add("live", "Product is live", manual.productLive ? "pass" : "unconfirmed", "Confirm in config/manual-checks.json after deploying the frontend.");

  let allCode = submitted.length === 4;
  for (const c of submitted) if ((await provider.getCode(c.address)) === "0x") allCode = false;
  const onBnb = deployments.chainId === config.agentId.chainId;
  add("bnb", "Deployed on BNB Chain mainnet", allCode && onBnb ? "pass" : "fail",
    onBnb ? (allCode ? "All 4 contracts have code." : "A contract has no code at its address.") : `Chain ${deployments.chainId} is not BNB Chain mainnet (${config.agentId.chainId}).`);

  let agentOk = false;
  let agentDetail = "";
  try {
    const official = deployments.agentId.address.toLowerCase() === config.agentId.address.toLowerCase();
    const hasCode = (await provider.getCode(deployments.agentId.address)) !== "0x";
    const reg = new ethers.Contract(submitted.find((c) => c.name === "AgentGuildRegistry").address, ["function agentId() view returns (address)"], provider);
    const wired = (await reg.agentId()).toLowerCase() === config.agentId.address.toLowerCase();
    agentOk = official && hasCode && wired && !deployments.agentId.isMock;
    agentDetail = `official address: ${official}, code present: ${hasCode}, registry wired to it: ${wired}, mock: ${!!deployments.agentId.isMock}`;
  } catch (e) {
    agentDetail = e.message;
  }
  add("agentid", "Official Agent ID verification works", agentOk ? "pass" : "fail", agentDetail);

  const n = report.totals.uniqueAgentIdAddresses;
  add("min30", `At least ${config.adoption.minimumUniqueAgentIds} unique Agent ID addresses in the submission period`, report.adoption.minimumMet ? "pass" : "fail", `${n} counted. ${report.adoption.remainingToMinimum} to go.`);
  add("target100", `Adoption target of ${config.adoption.targetUniqueAgentIds} (buffer, not a hard gate)`, report.adoption.targetMet ? "pass" : "unconfirmed", `${n} of ${config.adoption.targetUniqueAgentIds}. ${report.adoption.remainingToTarget} to go.`);

  // On-chain wiring: each contract must point at the right sibling.
  let wiring = true;
  let wiringDetail = "";
  try {
    const addr = Object.fromEntries(submitted.map((c) => [c.name, c.address]));
    const get = (a, sig) => new ethers.Contract(a, [`function ${sig} view returns (address)`], provider)[sig.split("(")[0]]();
    const checks = [
      [await get(addr.AgentGuildTasks, "registry()"), addr.AgentGuildRegistry],
      [await get(addr.AgentGuildEscrow, "tasks()"), addr.AgentGuildTasks],
      [await get(addr.AgentGuildReputation, "tasks()"), addr.AgentGuildTasks],
      [await get(addr.AgentGuildReputation, "registry()"), addr.AgentGuildRegistry],
    ];
    wiring = checks.every(([a, b]) => a.toLowerCase() === b.toLowerCase());
    wiringDetail = wiring ? "Tasks, Escrow and Reputation all point at the submitted siblings." : "A contract points at the wrong sibling.";
  } catch (e) {
    wiring = false;
    wiringDetail = e.message;
  }
  add("addresses", "All relevant contract addresses are correct and included", wiring ? "pass" : "fail", wiringDetail);

  const unverified = submitted.filter((c) => !c.sourceVerified).map((c) => c.name);
  add("bscscan", "Contracts verified on BscScan", unverified.length === 0 ? "pass" : "fail", unverified.length ? `Not verified: ${unverified.join(", ")}` : "All verified.");
  add("github", "Source code is public on GitHub", manual.githubPublic ? "pass" : "unconfirmed", "Confirm in config/manual-checks.json.");

  const t = report.totals;
  const flows = t.registrations > 0 && t.tasksCreated > 0 && t.tasksAccepted > 0 && t.workSubmitted > 0 && t.tasksCompleted > 0;
  add("workflows", "Core workflows have run on-chain (register, create, accept, submit, approve)", flows && manual.coreWorkflowsTested ? "pass" : flows ? "unconfirmed" : "fail",
    `registrations ${t.registrations}, created ${t.tasksCreated}, accepted ${t.tasksAccepted}, submitted ${t.workSubmitted}, approved ${t.tasksCompleted}`);

  add("verifiable", "Transactions are independently verifiable", report.transactionHashes.length > 0 && manual.txIndependentlyChecked ? "pass" : "unconfirmed", `${report.transactionHashes.length} transaction hashes listed. Spot-check them on BscScan.`);
  add("submissionInfo", "Project information and addresses ready for submission", manual.submissionInfoReady ? "pass" : "unconfirmed", "Confirm in config/manual-checks.json.");

  const ready = items.filter((i) => i.id !== "target100").every((i) => i.status === "pass");
  return { ready, items };
}

function toMarkdown(report, gate) {
  const t = report.totals;
  const lines = [];
  lines.push(`# AgentGuild eligibility report`);
  lines.push(`Generated ${report.generatedAt} on ${report.network} (chain ${report.chainId}). Blocks ${report.window.startBlock} to ${report.window.endBlock}.`);
  lines.push(``, `**Submission ready: ${gate.ready ? "YES" : "NO"}**`, ``);
  lines.push(`## Adoption`);
  lines.push(`- Unique Agent ID addresses: **${t.uniqueAgentIdAddresses}** (minimum ${report.adoption.minimum}, target ${report.adoption.target})`);
  lines.push(`- Remaining to minimum: ${report.adoption.remainingToMinimum}. Remaining to target: ${report.adoption.remainingToTarget}.`);
  lines.push(`- Interacting addresses without an Agent ID (not counted): ${t.addressesWithoutAgentId.length}`);
  lines.push(``, `## Activity`);
  lines.push(`- Registrations ${t.registrations}, tasks created ${t.tasksCreated}, accepted ${t.tasksAccepted}, submissions ${t.workSubmitted}, completed ${t.tasksCompleted}, final rejections ${t.tasksRejectedFinal}`);
  lines.push(`- Successful collaborations (unique pairs): ${t.successfulCollaborations}, reviews ${t.reviews}, escrow funded ${ethers.formatEther(t.escrowFundedWei)} BNB`);
  lines.push(`- Transactions with events: ${t.transactions}`);
  lines.push(``, `## Contracts`);
  for (const c of report.contracts) lines.push(`- ${c.name} \`${c.address}\`: ${c.uniqueAgentIdAddresses} Agent ID addresses, ${c.transactions} transactions`);
  lines.push(``, `## Gate`);
  for (const i of gate.items) lines.push(`- [${i.status === "pass" ? "x" : " "}] ${i.label}: **${i.status}**. ${i.detail}`);
  lines.push(``, `_${report.note}_`);
  return lines.join("\n");
}

module.exports = { buildReport, evaluateGate, toMarkdown, firstBlockAtOrAfter };
