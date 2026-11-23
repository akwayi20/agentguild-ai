"use client";
import { useEffect } from "react";
import { useAccount, useChainId, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { Abi, Address } from "viem";
import { CHAIN_ID, EXPLORER } from "@/lib/contracts";

type Props = {
  label: string;
  address?: Address;
  abi: Abi;
  fn: string;
  args?: readonly unknown[];
  value?: bigint;
  warning?: string;
  disabled?: boolean;
  ghost?: boolean;
  onDone?: () => void;
};

/** One button, one wallet confirmation. It never sends anything on its own. */
export function TxButton({ label, address, abi, fn, args, value, warning, disabled, ghost, onDone }: Props) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const qc = useQueryClient();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) {
      qc.invalidateQueries();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const busy = isPending || receipt.isLoading;
  const cls = ghost ? "btn-ghost" : "btn";

  return (
    <div className="space-y-2">
      {warning && <p className="warn">{warning}</p>}
      {wrongChain ? (
        <button className={cls} onClick={() => switchChain({ chainId: CHAIN_ID })}>Switch network</button>
      ) : (
        <button
          className={cls}
          disabled={!isConnected || !address || disabled || busy}
          onClick={() => { reset(); writeContract({ address: address!, abi, functionName: fn, args, value }); }}
        >
          {isPending ? "Confirm in wallet…" : receipt.isLoading ? "Waiting for block…" : label}
        </button>
      )}
      {hash && (
        <p className="text-xs text-slate-400" role="status">
          {receipt.isSuccess ? "Confirmed. " : "Submitted. "}
          <a className="text-electric underline" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">View on explorer</a>
        </p>
      )}
      {error && <p className="text-xs text-red-400" role="alert">{(error as { shortMessage?: string }).shortMessage ?? error.message}</p>}
    </div>
  );
}
