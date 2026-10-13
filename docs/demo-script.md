# Demo script (about 90 seconds)

Record the browser at http://localhost:3000 with the worker running (`npm run worker`) and a funded test account. Say plainly that it runs on Monad testnet and that bill delivery uses a mock provider.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page | "To pay a normal bill from a crypto wallet today, you first need a second token just for fees. PAY removes that." |
| 0:08 | Sign in with email, then the claim page | "Sign in with email. No seed phrase. Pick a name." |
| 0:15 | Claim page hint "Add a little USDC first (gas is paid in USDC)" | "There is no gas token to buy. The fee comes out of the USDC." |
| 0:22 | Claim `@name`, success, dashboard counts up | "Claiming is one on-chain transaction. The account holds zero MON, and the fee was about half a cent in USDC." |
| 0:35 | Open the transaction on the block explorer | "Here it is on Monad testnet. The paymaster fronted the gas and charged USDC." |
| 0:45 | Send to another `@name` | "Sending is the same. A name, an amount, done." |
| 0:55 | Pay bills: electricity for `mum`, $5, entering her meter once and ticking Remember | "Paying someone else's bill. I enter her details once, and next time her name is enough. The money goes into escrow, not to us." |
| 1:05 | Processing screen, then "Electricity paid" with reference | "The worker asks the provider to deliver. Only after a delivery reference does the escrow pay out." |
| 1:15 | Second bill with phone `00099999999`, then "$ refunded" | "If the provider rejects it, the money comes back automatically." |
| 1:25 | Schedules: type "pay mum's electricity $20 monthly", enter her meter once, tick Remember, Start | "Describe it in a sentence. A small model fills the form and I check it. It can't pay anything itself." |
| 1:40 | Same page with a 2-minute demo interval, then the repeat arrives | "The first payment goes out now, and it repeats on schedule from an amount I approved up front. I can cancel any time." |
| 1:50 | Dashboard activity list | "Names, one balance, real bills. No crypto vocabulary anywhere." |

## Before recording

- Fund the account with testnet USDC (https://faucet.circle.com) and make sure the operator wallet has MON (`worker/.env` `OPERATOR_KEY`).
- Start the worker. With the mock provider, any account number works except one starting with `000`, which is rejected so the refund path shows.
- Do not claim real bill delivery. If VTpass sandbox keys are in `worker/.env` with `PROVIDER=vtpass`, say "sandbox" instead of "mock".
- Keep the explorer tab open to the claim transaction for the 0:35 beat.
