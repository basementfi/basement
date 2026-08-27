import { http } from "wagmi";
import { base } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet } from "@rainbow-me/rainbowkit/wallets";

// A real WalletConnect Project ID (free at https://cloud.reown.com) is required for mobile wallet
// connections (MetaMask, Rainbow, etc. via their https universal links). Set it in the env; the
// "basement" fallback only lets injected desktop extensions work.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "basement";

// Curated wallet list: MetaMask, Rabby, Coinbase, Rainbow (official built-in connectors). The
// generic WalletConnect picker tile is intentionally omitted. Rabby shows its icon and connects via
// injection on desktop (extension) and inside Rabby's in-app browser; on a plain mobile browser
// RainbowKit hides it (Rabby has no mobile WalletConnect universal link, so it can't connect there).
export const wagmiConfig = getDefaultConfig({
  appName: "Basement",
  projectId,
  chains: [base],
  transports: {
    [base.id]: http("/api/rpc"),
  },
  wallets: [
    {
      groupName: "Wallets",
      wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet],
    },
  ],
  ssr: true,
});
