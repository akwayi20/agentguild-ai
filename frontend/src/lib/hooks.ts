"use client";
import { useAccount, useReadContract } from "wagmi";
import type { Address } from "viem";
import { ABI, ADDR, CONFIGURED, ZERO } from "./contracts";

export type AgentStatus = {
  address?: Address;
  connected: boolean;
  loading: boolean;
  holdsAgentId: boolean;
  registered: boolean;
  eligible: boolean;
};

/** Everything the UI needs to know about the connected wallet, read straight from the chain. */
export function useAgentStatus(): AgentStatus {
  const { address, isConnected } = useAccount();
  const enabled = Boolean(address);

  const bal = useReadContract({ address: ADDR.agentId, abi: ABI.agentId, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled } });
  const agent = useReadContract({ address: ADDR.registry, abi: ABI.registry, functionName: "getAgent", args: address ? [address] : undefined, query: { enabled: enabled && CONFIGURED } });
  const elig = useReadContract({ address: ADDR.registry, abi: ABI.registry, functionName: "isEligible", args: address ? [address] : undefined, query: { enabled: enabled && CONFIGURED } });

  const a = agent.data as { registeredAt: bigint } | undefined;
  return {
    address,
    connected: isConnected,
    loading: enabled && (bal.isLoading || (CONFIGURED && (agent.isLoading || elig.isLoading))),
    holdsAgentId: ((bal.data as bigint | undefined) ?? 0n) > 0n,
    registered: Boolean(a && a.registeredAt > 0n),
    eligible: Boolean(elig.data),
  };
}

export const isZero = (a?: string) => !a || a === ZERO;
