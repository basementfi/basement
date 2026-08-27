"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";
import { useTheme } from "next-themes";
import "@rainbow-me/rainbowkit/styles.css";

export default function Web3({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          theme={
            resolvedTheme === "light"
              ? lightTheme({ accentColor: "#4f8ef7", borderRadius: "medium" })
              : darkTheme({ accentColor: "#4f8ef7", borderRadius: "medium", overlayBlur: "small" })
          }
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
