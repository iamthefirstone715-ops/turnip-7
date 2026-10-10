# PAY

Send money and pay bills by @username, holding only USDC. No addresses, no gas token, no seed phrase.

Built for Monad Metropolis, Consumer Products & Payments track. Runs on Monad testnet (chain 10143).

## The problem

A crypto wallet can't pay a normal bill, and a new user can't even send USDC without first buying a second token for gas. PAY removes both:

- **One balance.** Users hold USDC only. The network fee is charged in USDC, so nobody ever needs MON.
- **Names, not addresses.** Sign in with Google or email, claim `@name`, send to `@name`.
- **Bills.** Pay airtime, data, electricity or TV, for yourself or for someone else's `@name`. Save your own bill details once (Dashboard, Bill details); when a friend types `For @yourname`, the network, meter type and number fill in automatically. The money sits in escrow and only reaches us if the provider delivers. Otherwise it comes back.

## How it works

| Piece | What it does |
|---|---|
| `UsernameRegistry` | On-chain `@name` to smart-account address. One name per address, a-z 0-9 _ , 3 to 20 chars. |
| `USDCPaymaster` | ERC-4337 v0.7 paymaster. Fronts the MON for gas, then charges the account in USDC after the call. |
| `BillProfile` | Each account can publish one saved bill detail per category (provider, meter type, phone/meter/smartcard number). Public by design, so paying for someone else can autofill them. |
| `BillPay` | Escrows USDC per bill order. The operator can release it to the treasury only with a delivery reference, or refund it. The payer can reclaim after 1 hour. |
| Worker (`worker/`) | Watches `BillRequested`, asks the bill provider to deliver, then calls `fulfill` or `refund` on-chain. |
| App (`app/`) | Next.js. Privy login creates an embedded wallet that owns a smart account (permissionless + Pimlico bundler). |

The first transaction a user sends also batches the USDC approval for the paymaster, so there is no separate setup step.

## What has been verified

Everything below was run, not assumed.

- **Contracts:** `cd contracts && forge test` passes 16 tests, including a fuzz test that funds are conserved and a full EntryPoint v0.7 run where an account with 0 MON pays gas in USDC.
- **Live paymaster:** a new account holding 0 MON sent USDC through Pimlico's bundler on Monad testnet and paid 4,747 base units (about $0.0047) in gas. Script: `worker/paymaster-smoke.mjs`. Tx `0x7b9dee02910a6b4b5df7a585aae0f69f5ba279a8fc02c97b4eda0cf95a9973f1`.
- **Full user flow in a browser (testnet):** login, wallet creation, funding, claiming a username on-chain, dashboard showing name and balance, and a $1 airtime payment that went into escrow.
- **Bill settlement:** the worker settled that order on-chain. The order is fulfilled, the treasury received the $1, and the escrow is empty.
- **Real bill via VTpass sandbox:** order #2 (electricity, $1.50) was placed on-chain from a 0-MON account (`worker/bill-smoke.mjs`), the worker bought it from the VTpass sandbox, and the delivered token `26362054405982757802` is the on-chain fulfilment reference. The treasury received the USDC and the escrow is empty. Orders for Glo airtime (#5) and an MTN data plan (#6) were also placed from the chain and delivered by the sandbox.
- **Worker end-to-end:** `npm run test:worker` runs a local chain with real contracts. It covers a delivered bill, a rejected bill that is refunded, an empty escrow afterwards, and an idempotent restart.

## Deployed (Monad testnet)

| Contract | Address |
|---|---|
| UsernameRegistry | `0x9a65ef9ab151b73F067C3d99cd5B5Db57225f659` |
| BillPay | `0xF4dC10dD779b9440A4b63a58A4fC7a56AadE71Bb` |
| USDCPaymaster | `0xFa387f173B0D1aD5c7CA1B23f2823aaC530C6093` |
| BillProfile | `0xA30350744a5F43F09a75fC3cE60513f724d7E819` |
| USDC (Circle testnet) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |

## Limits, stated plainly

- **Testnet only.** On mainnet the paymaster would be Pimlico's ERC-20 paymaster, which accepts USDC on Monad (confirmed live). Our own paymaster uses a fixed USDC/MON rate with no price feed.
- **Bills:** the worker defaults to a mock provider; set `PROVIDER=vtpass` for the VTpass sandbox, which has been run end to end (below). Airtime, data, electricity and TV are wired. The payer picks the network, distribution company or TV provider, and for data and TV a plan whose price is fetched live from VTpass; the choice travels on-chain in `billType` as `category:provider[:plan]`. A plan paid for with too little is refunded without contacting the provider. Gift cards and international airtime are not implemented. Amounts convert at a fixed 1,500 NGN per USD.
- **Saved bill details are public on-chain.** That is what lets anyone pay for you, so the save page warns not to store a number you want private. Meter and smartcard numbers are harmless to publish; phone numbers are personal data.
- **Operator trust.** If the worker is down or cannot settle after the provider delivered, the payer can reclaim after 1 hour and keep the bill. The worker retries settlement to reduce this.
- **Activity history is stored in the browser.** The public RPC limits `getLogs` to about 100 blocks, so the dashboard keeps its own record of sends, bills and incoming funds.
- **Not tested:** Google login (email login was), and sending between two real users.
- Not built: recurring bills, a family budget pot, paying an X handle that has not signed up.

## Run it

```bash
npm install
cp .env.example .env.local          # Privy app ID, optional Pimlico key, contract addresses
npm run dev                         # app on http://localhost:3000
npm run worker                      # bill worker (needs worker/.env, see worker/.env.example)
npm run test:worker                 # worker tests + local-chain e2e

# contracts (lib/ is not committed)
cd contracts
forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 eth-infinitism/account-abstraction@v0.7.0
forge test
```

Get testnet USDC at https://faucet.circle.com and testnet MON at https://faucet.monad.xyz.

Design spec: `docs/superpowers/specs/2026-10-04-billpay-design.md`.
