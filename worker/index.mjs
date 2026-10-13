import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseAbi } from "viem";

export const abi = parseAbi([
  "event BillRequested(uint256 indexed orderId, address indexed payer, string billType, string account, uint256 amount, string beneficiary)",
  "function orders(uint256) view returns (address payer, uint96 amount, uint64 createdAt, uint8 status)",
  "function fulfill(uint256 id, string ref)",
  "function refund(uint256 id)",
]);

const PENDING = 1;

/** Watches BillRequested, asks the provider to deliver, then fulfills or refunds on-chain. */
export function createWorker({ publicClient, walletClient, billPay, provider, cursorFile, startBlock, range = 100n, concurrency = 8, log = console.log }) {
  const inflight = new Set();
  let queue = Promise.resolve();

  const read = () => (cursorFile && existsSync(cursorFile) ? BigInt(readFileSync(cursorFile, "utf8")) : undefined);
  const save = (b) => cursorFile && writeFileSync(cursorFile, b.toString());
  let cursor = read();

  async function settle(fn, args) {
    const hash = await walletClient.writeContract({ address: billPay, abi, functionName: fn, args });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // The provider already delivered by the time we settle, so retry before giving up:
  // an unsettled order lets the payer reclaim after TIMEOUT while keeping the bill.
  async function settleWithRetry(fn, args) {
    for (let i = 1; ; i++) {
      try {
        return await settle(fn, args);
      } catch (e) {
        if (i === 4) throw e;
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  }

  async function process(ev) {
    const id = ev.args.orderId;
    if (inflight.has(id)) return;
    inflight.add(id);
    try {
      const [, , createdAt, status] = await publicClient.readContract({ address: billPay, abi, functionName: "orders", args: [id] });
      if (status !== PENDING) return; // already settled (restart or duplicate scan)
      const order = { id, billType: ev.args.billType, account: ev.args.account, usd: Number(ev.args.amount) / 1e6, createdAt: Number(createdAt) };
      log(`#${id} ${order.billType} ${order.account} $${order.usd}`);
      const r = await provider.fulfill(order);
      if (r.pending) return log(`#${id} still pending at provider, left escrowed (payer can reclaim)`);
      if (r.ok) {
        await settleWithRetry("fulfill", [id, r.ref]);
        log(`#${id} fulfilled: ${r.ref}`);
      } else {
        await settleWithRetry("refund", [id]);
        log(`#${id} refunded: ${r.reason}`);
      }
    } catch (e) {
      log(`#${id} ERROR, left escrowed: ${e.shortMessage ?? e.message}`);
    } finally {
      inflight.delete(id);
    }
  }

  /** Scans new blocks once. Returns when every order found has been handled. */
  async function scan() {
    const head = await publicClient.getBlockNumber({ cacheTime: 0 }); // viem caches this for 4s by default
    if (cursor === undefined) cursor = (startBlock ?? head) - 1n;
    const jobs = [];
    while (cursor < head) {
      const ranges = []; // public RPC caps getLogs at 100 blocks, so fetch several ranges at once to catch up fast
      for (let c = cursor; c < head && ranges.length < concurrency; ) {
        const from = c + 1n;
        const to = from + range - 1n > head ? head : from + range - 1n;
        ranges.push([from, to]);
        c = to;
      }
      const batches = await Promise.all(
        ranges.map(([fromBlock, toBlock]) => publicClient.getContractEvents({ address: billPay, abi, eventName: "BillRequested", fromBlock, toBlock })),
      );
      for (const ev of batches.flat()) jobs.push((queue = queue.then(() => process(ev)))); // one tx at a time: operator nonce
      cursor = ranges[ranges.length - 1][1];
      save(cursor);
    }
    await Promise.all(jobs);
  }

  return { scan, process };
}
