import { parseAbi } from "viem";

export const schedulerAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function get(uint256 id) view returns ((address owner, uint96 amount, uint32 interval, uint64 nextDue, uint16 runsLeft, string billType, string account, string beneficiary))",
  "function execute(uint256 id) returns (uint256)",
]);

/**
 * Triggers due scheduled payments. Anyone could do this, since a run can only spend what the owner approved and can only
 * go to the stored bill; the keeper just pays the gas. The BillRequested order it creates is then fulfilled by the worker.
 * Each schedule's next due time is cached, so a tick only reads schedules that are new or due: far-future or spammed
 * schedules cost nothing, and at most `maxPerTick` runs are sent per tick.
 */
export function createKeeper({ publicClient, walletClient, scheduler, retryMs = 60_000, maxPerTick = 25, lookback, log = console.log }) {
  const due = new Map(); // id -> nextDue (unix seconds); dropped once a schedule is finished or cancelled
  const backoff = new Map(); // id -> time before which we won't retry a failing run
  let seen = 1n; // every id below this has been read once
  let started = false;

  const read = (id) => publicClient.readContract({ address: scheduler, abi: schedulerAbi, functionName: "get", args: [id], blockTag: "latest" });

  async function tick() {
    const next = await publicClient.readContract({ address: scheduler, abi: schedulerAbi, functionName: "nextId", blockTag: "latest" });
    if (!started) {
      started = true;
      if (lookback && next > BigInt(lookback) + 1n) seen = next - BigInt(lookback); // serverless: only the latest schedules can still be live
    }
    for (; seen < next; seen++) {
      const s = await read(seen);
      if (s.runsLeft > 0) due.set(seen, s.nextDue);
    }

    const chainNow = (await publicClient.getBlock({ blockTag: "latest" })).timestamp; // the contract compares against block time
    let ran = 0;
    for (const [id, nextDue] of due) {
      if (ran >= maxPerTick) break;
      if (nextDue > chainNow || (backoff.get(id) ?? 0) > Date.now()) continue;
      const s = await read(id); // fresh: it may have been cancelled or already run by someone else
      if (s.runsLeft === 0) {
        due.delete(id);
        continue;
      }
      if (s.nextDue > chainNow) {
        due.set(id, s.nextDue);
        continue;
      }
      try {
        // Simulating first means a run that would revert (no balance, spent allowance) costs nothing.
        const { request } = await publicClient.simulateContract({ address: scheduler, abi: schedulerAbi, functionName: "execute", args: [id], account: walletClient.account });
        await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract(request) });
        ran++;
        const after = await read(id);
        if (after.runsLeft === 0) due.delete(id);
        else due.set(id, after.nextDue);
        log(`schedule #${id}: ran (${after.runsLeft} left) ${s.billType} ${s.account}`);
      } catch (e) {
        log(`schedule #${id}: skipped, will retry later: ${e.shortMessage ?? e.message}`);
        backoff.set(id, Date.now() + retryMs);
      }
    }
  }

  return { tick };
}
