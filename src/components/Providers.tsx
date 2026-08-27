"use client";

import dynamic from "next/dynamic";
import { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

// Web3 (wagmi + RainbowKit) is client-only: RainbowKit's getDefaultConfig is a client function and
// can't be imported into the server component graph.
const Web3 = dynamic(() => import("./Web3"), { ssr: false });

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <Web3>{children}</Web3>
    </ThemeProvider>
  );
}
