export interface Vault {
  id: string;
  name: string;
  token: string;
  tokenSymbol: string;
  description: string;
  netApy: number;
  tvl: number;
  estYearlyYield: number;
  isNew?: boolean;
  comingSoon?: boolean;
  iconUrl: string;
  iconBg: string;
  shareIcon?: string; // icon for the vault's receipt token, shown next to the share symbol
  shareSymbol?: string; // on-chain symbol of the receipt token (e.g. bUSDC) — what the depositor actually receives
  contractAddress?: string;
  decimals?: number;  // underlying token decimals (6 USDC, 18 WETH, 8 cbBTC). Defaults to 6.
  /// Aerodrome LP vault config (present => this is a BasementAeroVault driven via the shared BasementAeroZap).
  lp?: {
    strategy: string;     // BasementAeroStrategy (for APR + harvest)
    pool: string;         // want pool / LP token (for APR reserves)
    gauge: string;        // gauge (for APR rewardRate)
    depositToken: string; // token users deposit/withdraw through the zap (a pool token: USDC or WETH)
    depositSymbol: string;
    native?: boolean;     // deposit token is WETH => also offer native ETH (auto-wrap)
    assets: { src: string; alt: string; bg: string }[]; // the two underlying token icons
    // Non-pool tokens depositable via BasementAeroZap.zapInToken (swapped into the hub first). `pricePool`
    // is the token/hub pool used to value the deposit for the minShares slippage bound.
    extraTokens?: { symbol: string; address: string; decimals: number; pricePool: string; icon: string }[];
  };
}

export const VAULTS: Vault[] = [
  {
    id: "usdc",
    name: "EarnUSDC",
    token: "USD Coin",
    tokenSymbol: "USDC",
    description: "Earn yield on your USDC through optimized Base lending strategies.",
    netApy: 9.5, // static fallback; live value comes from the Morpho API
    tvl: 0,
    estYearlyYield: 0,
    iconUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    iconBg: "#2775ca",
    shareIcon: "/tokens/earnusdc.svg",
    shareSymbol: "bUSDC",
    contractAddress: "0xd795C20D954204853BB08d574DaE4ae362F2500a",
    decimals: 6,
  },
  {
    id: "weth",
    name: "EarnETH",
    token: "Wrapped Ether",
    tokenSymbol: "WETH",
    description: "Earn yield on your ETH through optimized Base lending strategies.",
    netApy: 1.63, // static fallback; live value comes from Morpho V2 API
    tvl: 0,
    estYearlyYield: 0,
    isNew: true,
    iconUrl: "/tokens/weth.png",
    iconBg: "#1c1c3a",
    shareIcon: "/tokens/earneth.svg",
    shareSymbol: "bETH",
    contractAddress: "0xD53e343bae99F8707042a049Acd539C7BE231AFB",
    decimals: 18,
  },
  {
    id: "earnbtc",
    name: "EarnBTC",
    token: "Coinbase Wrapped BTC",
    tokenSymbol: "cbBTC",
    description: "Earn yield on Bitcoin. Deposit cbBTC, USDC, ETH, or WETH — non-cbBTC is swapped to cbBTC and supplied to the Gauntlet cbBTC Core Morpho vault, auto-compounding.",
    netApy: 1.5, // static fallback; live value comes from the Morpho API (Gauntlet cbBTC Core)
    tvl: 0,
    estYearlyYield: 0,
    isNew: true,
    iconUrl: "https://assets.coingecko.com/coins/images/40143/large/cbbtc.webp",
    iconBg: "#0052ff",
    shareIcon: "/tokens/earnbtc.svg",
    shareSymbol: "bBTC",
    contractAddress: "0x2656Fc87033F23216E848E0D3738A62cb116e070",
    decimals: 8,
  },
  {
    id: "lp-aero-usdc",
    name: "LP USDC/AERO",
    token: "USD Coin",
    tokenSymbol: "USDC",
    description: "Deposit USDC. It's split 50/50 into AERO and USDC, provided as liquidity on Aerodrome, and staked to earn AERO — which is auto-compounded back into the position.",
    netApy: 25.0, // static fallback: ~24.8% gross APR − 10% fee, compounded daily; live via useAeroApr()
    tvl: 0,
    estYearlyYield: 0,
    isNew: true,
    iconUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    iconBg: "#2775ca",
    decimals: 6, // USD-denominated display (deposit/withdraw token is USDC via the zap)
    contractAddress: "0x658c3C796066Af21f19e496C3C7733257D8da985", // BasementAeroVault (bUSDC/AERO; timelock + donation-proof cap)
    lp: {
      strategy: "0x754514E6341E9DEd947D68C01AC5a00d62D9220F",
      pool: "0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d",
      gauge: "0x4F09bAb2f0E15e2A078A227FE1537665F55b8360",
      depositToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
      depositSymbol: "USDC",
      assets: [
        { src: "https://assets.coingecko.com/coins/images/6319/large/usdc.png", alt: "USDC", bg: "#2775ca" },
        { src: "https://assets.coingecko.com/coins/images/31745/large/token.png", alt: "AERO", bg: "#1a1a2e" },
      ],
    },
  },
  {
    id: "lp-weth-cbbtc",
    name: "LP WETH/cbBTC",
    token: "Wrapped Ether",
    tokenSymbol: "WETH",
    description: "Deposit WETH or ETH. It's split 50/50 into WETH and cbBTC, provided as liquidity on Aerodrome, and staked to earn AERO — auto-compounded back into the position.",
    netApy: 0, // live via useAeroApr()
    tvl: 0,
    estYearlyYield: 0,
    isNew: true,
    iconUrl: "/tokens/weth.png",
    iconBg: "#1c1c3a",
    decimals: 18, // WETH-denominated display
    contractAddress: "0x5a38D1546122eDfe766799058e93dFb11C8FEFEd", // BasementAeroVault (bWETH/cbBTC)
    lp: {
      strategy: "0x5BE336419f64353e4e7d04676E8Bc7Ce8E55C95E",
      pool: "0x2578365B3dfA7FfE60108e181EFb79FeDdec2319",
      gauge: "0xAFdEBa12B6a870d6639d043030b4b49F9C7c62BB",
      depositToken: "0x4200000000000000000000000000000000000006", // WETH
      depositSymbol: "WETH",
      native: true,
      assets: [
        { src: "/tokens/weth.png", alt: "WETH", bg: "#1c1c3a" },
        { src: "https://assets.coingecko.com/coins/images/40143/large/cbbtc.webp", alt: "cbBTC", bg: "#0052ff" },
      ],
      extraTokens: [
        { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, pricePool: "0xcDAC0d6c6C59727a65F871236188350531885C43", icon: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
      ],
    },
  },
];

export { fmtUsd } from "@/lib/format";
