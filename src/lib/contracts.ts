export const EARN_USDC_ADDRESS  = "0xd795C20D954204853BB08d574DaE4ae362F2500a" as const;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const MORPHO_VAULT_ADDRESS = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61" as const;

// EarnETH (WETH vault) — same contract shape as EarnUSDC
export const EARN_ETH_ADDRESS = "0xD53e343bae99F8707042a049Acd539C7BE231AFB" as const;
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as const;
export const MORPHO_WETH_VAULT_ADDRESS = "0xFeFeC33668E22677c4762d0853d56245a800ff08" as const; // Gauntlet WETH Balanced

// EarnBTC (cbBTC vault) — same contract shape as EarnUSDC; multi-token deposit (USDC/ETH/WETH/cbBTC)
// is routed through MorphoZap, which swaps to cbBTC on Aerodrome before depositing.
export const EARN_BTC_ADDRESS = "0x2656Fc87033F23216E848E0D3738A62cb116e070" as const;
// MorphoZap: generic multi-token deposit router for ALL single-asset Earn vaults (EarnUSDC/ETH/BTC).
// zapIn(vault, tokenIn, amountIn, minShares, to) swaps tokenIn → vault.asset() (via WETH hub) and deposits.
export const MORPHO_ZAP_ADDRESS = "0x7f8FB8b7Cb225AC642a22234931c43B5E2E9dB3D" as const;
export const MORPHO_ZAP_ABI = [
  { name: "zapIn", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minShares", type: "uint256" },
      { name: "to", type: "address" },
    ], outputs: [{ name: "shares", type: "uint256" }] },
  { name: "previewAssetOut", type: "function", stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }, { name: "tokenIn", type: "address" }, { name: "amountIn", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }] },
] as const;
export const CBBTC_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as const;
export const MORPHO_CBBTC_VAULT_ADDRESS = "0x6770216aC60F634483Ec073cBABC4011c94307Cb" as const; // Gauntlet cbBTC Core

// Chainlink USD price feeds (Base, 8 decimals) — used to value WETH/cbBTC deposit caps in USD.
export const ETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" as const;
export const BTC_USD_FEED = "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F" as const;
export const CHAINLINK_ABI = [
  { name: "latestRoundData", type: "function", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ] },
] as const;

// BasementAeroVault stack — generic ERC-4626 vault whose asset is the AERO/USDC LP, auto-compounding
// AERO via BasementAeroStrategy. Users deposit/withdraw through BasementAeroZap (zapIn/zapOut); the
// vault itself holds the LP token, so shares are LP-denominated.
export const AERO_ZAP_ADDRESS      = "0x8E2c0106051C73bB28Fcd16F0731140e8926dAED" as const; // BasementAeroZap (optimal swap + zapInToken for non-pool tokens)
export const AERO_TOKEN_ADDRESS    = "0x940181a94A35A4569E4529A3CDfB74e38FD98631" as const;

// WETH: deposit() wraps native ETH -> WETH (for "Use Native" deposits)
export const WETH_ABI = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

export const EARN_USDC_ABI = [
  {
    name: "totalAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "convertToShares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "depositCap",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "maxDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// BasementAeroVault — ERC-4626 whose asset is the LP token (so totalAssets/convertToAssets are in LP
// units, not USD; use BasementAeroZap.valueOfSharesInToken for USD display). Includes approve/allowance
// because zapOut needs the user to approve their shares to the zap.
export const OPT_AERO_VAULT_ABI = [
  { name: "deposit",         type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  // redeem lets a holder withdraw the raw LP token directly (no zap/swap) — the "receive LP" withdraw path.
  { name: "redeem",          type: "function", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalAssets",     type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalSupply",     type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf",       type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "convertToShares", type: "function", stateMutability: "view", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "depositCap",      type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "maxDeposit",      type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "asset",           type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "allowance",       type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "approve",         type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
// Existing AERO LP references reuse this name.
export const AERO_LP_ABI = OPT_AERO_VAULT_ABI;

// BasementAeroZap — USDC <-> LP router for BasementAeroVaults.
export const AERO_ZAP_ABI = [
  {
    name: "zapIn", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minShares", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "zapInToken", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minShares", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "zapOut", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "tokenOut", type: "address" },
      { name: "minOut", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "valueOfSharesInToken", type: "function", stateMutability: "view",
    inputs: [
      { name: "vault", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "quoteToken", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// BasementAeroStrategy — the harvestable strategy behind a BasementAeroVault.
export const AERO_STRATEGY_ABI = [
  { name: "harvest",          type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "rewardsAvailable", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "minHarvest",       type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "performanceFee",   type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "callFee",          type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "harvestPublic",    type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { name: "rewardPool",       type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

export const MORPHO_VAULT_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
