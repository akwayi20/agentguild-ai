"use client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "@wagmi/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { chain } from "@/lib/contracts";

// Browser-injected wallets only (Binance Wallet, MetaMask, others). No QR login, no stored sessions.
const config = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined) } as Record<number, ReturnType<typeof http>>,
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5_000 } } }));
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
