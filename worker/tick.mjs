import { parseAbi } from "viem";
import { createWorker } from "./index.mjs";
import { createKeeper } from "./keeper.mjs";

const abi = parseAbi(["function nextId() view returns (uint256)", "function orders(uint256) view returns (address payer, uint96 amount, uint64 createdAt, uint8 status)"]);

/**
 * One stateless pass, for serverless hosting where nothing survives between calls: settle any pending bill and run any due
 * schedule. It keeps no cursor; it looks at the latest `recent` orders and, only if one is still pending, scans the last
 * `window` blocks for its request. Safe to run twice at once: the provider refuses a second purchase of the same order
 * and the contract only settles a pending one.
 */
export async function tick({ publicClient, walletClient, billPay, scheduler, provider, recent = 30, window = 1500n, log = console.log }) {
  const next = await publicClient.readContract({ address: billPay, abi, functionName: "nextId" });
  const from = next > BigInt(recent) + 1n ? next - BigInt(recent) : 1n;
  const ids = [];
  for (let id = from; id < next; id++) ids.push(id);
  const orders = await Promise.all(ids.map((id) => publicClient.readContract({ address: billPay, abi, functionName: "orders", args: [id] })));
  const scanned = orders.some((o) => o[3] === 1);
  if (scanned) {
    const head = await publicClient.getBlockNumber({ cacheTime: 0 });
    await createWorker({ publicClient, walletClient, billPay, provider, startBlock: head - window + 1n, log }).scan();
  }
  if (scheduler) await createKeeper({ publicClient, walletClient, scheduler, lookback: 60, log }).tick();
  return { scanned };
}
