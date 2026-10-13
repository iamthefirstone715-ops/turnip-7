// node --test worker/tick.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "./tick.mjs";

// A fake chain with `statuses[i]` for order i+1 (1 pending, 2 fulfilled) and no logs.
const fake = (statuses, seen = []) => ({
  getBlockNumber: async () => 1000n,
  getContractEvents: async () => {
    seen.push("logs");
    return [];
  },
  readContract: async ({ functionName, args }) => {
    if (functionName === "nextId") return BigInt(statuses.length + 1);
    if (functionName === "orders") return ["0x0", 1n, 1n, statuses[Number(args[0]) - 1]];
    throw new Error(`unexpected ${functionName}`);
  },
});

test("nothing pending: no log scan at all", async () => {
  const seen = [];
  const r = await tick({ publicClient: fake([2, 2, 3], seen), walletClient: {}, billPay: "0x1", provider: {} });
  assert.deepEqual(seen, []);
  assert.equal(r.scanned, false);
});

test("a pending order triggers a scan of the recent window", async () => {
  const seen = [];
  const r = await tick({ publicClient: fake([2, 1], seen), walletClient: {}, billPay: "0x1", provider: {}, window: 300n });
  assert.equal(r.scanned, true);
  assert.equal(seen.length, 3); // 300 blocks in 100-block ranges
});

test("only recent orders are checked", async () => {
  const reads = [];
  const pc = fake(new Array(100).fill(2));
  const orig = pc.readContract;
  pc.readContract = async (a) => {
    if (a.functionName === "orders") reads.push(a.args[0]);
    return orig(a);
  };
  await tick({ publicClient: pc, walletClient: {}, billPay: "0x1", provider: {}, recent: 10 });
  assert.equal(reads.length, 10);
});
