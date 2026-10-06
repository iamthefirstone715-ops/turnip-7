# Metropolis Pay — Design Spec (2026-10-04)

Monad Metropolis, Consumer Products & Payments track. Deadline 2026-10-13.

## Goal
Send money by @username and pay real bills (airtime, data, electricity, TV, gift cards) for yourself or for someone else's @username, holding only USDC. No MON, no addresses, no chain picker.

## Success
- User logs in with Google/email, claims @name, holds testnet USDC only.
- Sends USDC to @name; gas paid in USDC.
- Pays `@mum`'s electricity; receives token/reference receipt with tx hash.
- Failed bill auto-refunds; payer can reclaim after timeout if operator is silent.

## Network
Monad testnet (10143). USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` (Circle faucet).
Mainnet USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (Pimlico ERC-20 paymaster verified live).

## Components
1. **UsernameRegistry** — `register(name)`, `resolve(name)`, `nameOf(addr)`. Lowercase a-z0-9_, 3–20 chars, one name per address, no transfer.
2. **BillPay** — escrow per bill order.
   - `pay(billType, account, amount, beneficiary)` pulls USDC into contract, emits `BillRequested`.
   - `fulfill(orderId, reference)` operator only: USDC to treasury, emits `BillFulfilled`.
   - `refund(orderId)` operator only: USDC back to payer.
   - `reclaim(orderId)` payer only, after `TIMEOUT`: USDC back to payer.
   - Refusal: payer funds never reach treasury without a fulfilment reference; never stuck past timeout.
3. **USDCPaymaster** (testnet) — ERC-4337 v0.7 paymaster, fixed USDC/MON rate, charges actual gas in USDC in `postOp`. Mainnet uses Pimlico ERC-20 paymaster instead.
4. **Fulfilment worker** (Node) — watches `BillRequested`, calls VTpass sandbox (NG bills) / Reloadly sandbox (airtime, gift cards), then `fulfill` or `refund`.
5. **Frontend** (existing Next.js) — Privy login, permissionless smart account, Pimlico bundler, pages: auth, claim, dashboard, send, bills.

## Out of scope (9 days)
Earmarked family budget, recurring bills, money spraying, X-handle claims, cash-out, card on-ramp. Stretch only.

## Build order
1. Contracts + Foundry tests (no keys needed).
2. Paymaster + deploy to testnet (needs deployer key + faucet MON — user approval).
3. Frontend wiring: Privy + smart account + send (needs Privy app id, Pimlico key).
4. Bills page + worker on sandboxes (needs VTpass/Reloadly sandbox keys).
5. Demo polish, video, write-up.

## Risks
- Pimlico bundler rules vs custom paymaster storage access — verify early on testnet.
- VTpass test meter/smartcard numbers unknown until signup.
- Operator key is a trust point for `fulfill`; mitigated by payer `reclaim` timeout.
