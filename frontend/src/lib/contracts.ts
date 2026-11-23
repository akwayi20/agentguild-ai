import { bsc, bscTestnet } from "viem/chains";
import type { Abi, Address } from "viem";
import registryAbi from "./abi/AgentGuildRegistry.json";
import tasksAbi from "./abi/AgentGuildTasks.json";
import escrowAbi from "./abi/AgentGuildEscrow.json";
import reputationAbi from "./abi/AgentGuildReputation.json";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 56);
export const chain = CHAIN_ID === 97 ? bscTestnet : bsc;
export const EXPLORER = chain.blockExplorers.default.url;

const OFFICIAL_AGENT_ID = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
const env = (v: string | undefined) => (v && v.startsWith("0x") ? (v as Address) : undefined);

export const ADDR = {
  agentId: (env(process.env.NEXT_PUBLIC_AGENT_ID_ADDRESS) ?? OFFICIAL_AGENT_ID) as Address,
  registry: env(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS),
  tasks: env(process.env.NEXT_PUBLIC_TASKS_ADDRESS),
  escrow: env(process.env.NEXT_PUBLIC_ESCROW_ADDRESS),
  reputation: env(process.env.NEXT_PUBLIC_REPUTATION_ADDRESS),
};
export const CONFIGURED = Boolean(ADDR.registry && ADDR.tasks && ADDR.escrow && ADDR.reputation);
export const CLAIM_URL = process.env.NEXT_PUBLIC_AGENT_ID_CLAIM_URL || "";

export const ABI = {
  agentId: [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  ] as const satisfies Abi,
  registry: registryAbi as Abi,
  tasks: tasksAbi as Abi,
  escrow: escrowAbi as Abi,
  reputation: reputationAbi as Abi,
};

export const STATUS = ["None", "Open", "Assigned", "Submitted", "Approved", "Rejected", "Cancelled"] as const;

export type Task = {
  client: Address;
  worker: Address;
  designatedWorker: Address;
  deadline: bigint;
  createdAt: bigint;
  status: number;
  rejections: number;
  descriptionURI: string;
  deliverableURI: string;
};

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const GRACE_SECONDS = 3 * 24 * 60 * 60;
export const MAX_URI = 256;

export const CATEGORIES = [
  "Research", "Coding", "Data analysis", "Financial analysis", "Content generation", "Automation", "Security analysis",
];

/** Compact on-chain profile or task text. Kept under the 256 byte contract limit. */
export function packJson(obj: Record<string, string>): string {
  return "data:application/json," + encodeURIComponent(JSON.stringify(obj));
}
export function unpackJson(uri: string): Record<string, string> | null {
  if (!uri.startsWith("data:application/json,")) return null;
  try {
    return JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length)));
  } catch {
    return null;
  }
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
