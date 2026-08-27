# Depositing & Withdrawing

All actions happen from the app at [basement.finance](https://basement.finance). Connect a wallet on **Base**, pick a vault, and use the deposit/withdraw panel.

## Depositing

1. Open a vault and stay on the **Deposit** tab.
2. Choose the asset you want to deposit from the token selector. Earn vaults accept USDC / ETH / WETH / cbBTC; LP vaults accept the pool tokens (and, for WETH/cbBTC, USDC), plus native ETH where supported.
3. Enter an amount. The **Receive** box shows the share token you'll get (e.g. `bUSDC`).
4. Approve the token if prompted (first time only), then confirm the deposit.

If you deposit a token that isn't the vault's native asset, the transaction routes through a zap that swaps and deposits in one go. You may see an approval step for the router the first time.

## Withdrawing

1. Open the vault and switch to the **Withdraw** tab.
2. Enter how much of your position to withdraw (or use the percentage shortcuts).
3. **For LP vaults**, pick what to receive in the **Receive** selector:
   * the deposit token (USDC or WETH) — routed back through the zap, or
   * the raw **LP token** — a direct redeem with no swap.
4. Approve your shares to the router if prompted (needed only for the zap path), then confirm.

Withdrawals redeem your ERC-4626 shares for the underlying value. **Redemptions are always open**, even if deposits are paused, so you can exit at any time.

## Slippage & swaps

Deposits/withdrawals that involve a swap (any non-native asset, and the LP zap) apply a slippage bound to protect you. In volatile conditions a transaction may revert rather than execute at a bad price — retry, or use the vault's native asset / raw-LP path to avoid the swap entirely.
