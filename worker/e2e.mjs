// node worker/e2e.mjs  (needs `forge build` in contracts/ first). Local anvil, mock provider.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createWorker, abi } from "./index.mjs";
import { mock } from "./providers.mjs";
import { createKeeper } from "./keeper.mjs";

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // operator
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // treasury
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // payer
];
const [deployer, operator, treasury, payer] = KEYS.map(privateKeyToAccount);
const artifact = (p) => JSON.parse(readFileSync(new URL(`../contracts/out/${p}.json`, import.meta.url), "utf8"));

// ANVIL_WSL=1 runs the Linux anvil inside WSL, for machines where Windows blocks the native binary.
const viaWsl = process.env.ANVIL_WSL === "1";
const anvil = viaWsl
  ? spawn("wsl", ["-e", "bash", "-lc", "exec ~/.foundry/bin/anvil --port 8546 --host 0.0.0.0 --silent"], { stdio: "ignore" })
  : spawn("anvil", ["--port", "8546", "--silent"], { stdio: "ignore" });
try {
  const transport = http("http://127.0.0.1:8546");
  const pub = createPublicClient({ chain: foundry, transport });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const wallet = (account) => createWalletClient({ chain: foundry, transport, account });
  const deploy = async (a, args = []) => {
    const hash = await wallet(deployer).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  };

  const usdcA = artifact("BillPay.t.sol/MockUSDC");
  const usdc = await deploy(usdcA);
  const billPay = await deploy(artifact("BillPay.sol/BillPay"), [usdc, operator.address, treasury.address]);
  const erc = parseAbi(["function mint(address,uint256)", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
  const bp = parseAbi(["function pay(string,string,uint96,string) returns (uint256)"]);
  const send = async (account, address, abi_, fn, args) =>
    pub.waitForTransactionReceipt({ hash: await wallet(account).writeContract({ address, abi: abi_, functionName: fn, args }) });

  await send(deployer, usdc, erc, "mint", [payer.address, 100_000_000n]);
  await send(payer, usdc, erc, "approve", [billPay, 2n ** 255n]);
  await send(payer, billPay, bp, "pay", ["airtime", "08011111111", 5_000_000n, ""]); // #1 ok
  await send(payer, billPay, bp, "pay", ["electricity", "45012345678", 10_000_000n, "mum"]); // #2 ok
  await send(payer, billPay, bp, "pay", ["airtime", "00099999999", 7_000_000n, ""]); // #3 provider rejects

  const logs = [];
  const make = () => createWorker({ publicClient: pub, walletClient: wallet(operator), billPay, provider: mock(), startBlock: 0n, log: (m) => (logs.push(m), console.log(m)) });
  await make().scan();

  const status = async (id) => (await pub.readContract({ address: billPay, abi, functionName: "orders", args: [id] }))[3];
  const bal = (a) => pub.readContract({ address: usdc, abi: erc, functionName: "balanceOf", args: [a] });
  assert.equal(await status(1n), 2, "#1 fulfilled");
  assert.equal(await status(2n), 2, "#2 fulfilled");
  assert.equal(await status(3n), 3, "#3 refunded");
  assert.equal(await bal(treasury.address), 15_000_000n, "treasury got only delivered bills");
  assert.equal(await bal(payer.address), 85_000_000n, "failed bill was refunded");
  assert.equal(await bal(billPay), 0n, "escrow empty");

  logs.length = 0;
  await make().scan(); // restart from scratch: must be a no-op for settled orders
  assert.equal(logs.length, 0, "rescan is idempotent");
  // --- recurring payments: keeper runs due schedules, worker fulfils them, the approved cap is a hard stop ---
  const scheduler = await deploy(artifact("Scheduler.sol/Scheduler"), [billPay]);
  await send(operator, billPay, parseAbi(["function setScheduler(address)"]), "setScheduler", [scheduler]);
  const before = await bal(payer.address);
  await send(payer, usdc, erc, "approve", [billPay, 20_000_000n]); // cap: two runs of 10
  await send(payer, scheduler, parseAbi(["function create(string,string,string,uint96,uint32,uint16,uint64) returns (uint256)"]), "create", [
    "electricity:ikeja-electric:prepaid", "45012345678", "mum", 10_000_000n, 60, 3, 0n,
  ]);
  const keeper = createKeeper({ publicClient: pub, walletClient: wallet(operator), scheduler, retryMs: 0, log: (m) => (logs.push(m), console.log(m)) });
  const w = make();
  const later = async (secs) => {
    await pub.request({ method: "evm_increaseTime", params: [secs] });
    await pub.request({ method: "evm_mine", params: [] });
  };

  await keeper.tick();
  await w.scan();
  assert.equal(await status(4n), 2, "run 1 was created and fulfilled");
  assert.equal(await bal(payer.address), before - 10_000_000n, "run 1 paid from the payer");

  await keeper.tick(); // not due again yet
  assert.equal(await bal(payer.address), before - 10_000_000n, "no early second run");

  await later(61);
  await keeper.tick();
  await w.scan();
  assert.equal(await status(5n), 2, "run 2 fulfilled after the interval");
  assert.equal(await bal(payer.address), before - 20_000_000n);

  await later(61);
  logs.length = 0;
  await keeper.tick(); // third run is due but the approval is used up
  assert.ok(logs.some((m) => /skipped/.test(m)), "third run skipped instead of crashing");
  assert.equal(await bal(payer.address), before - 20_000_000n, "spend cap held");
  assert.equal(await bal(billPay), 0n, "escrow empty");

  console.log("\nE2E PASS: fulfil, refund, escrow empty, idempotent restart, recurring runs and spend cap");
} finally {
  anvil.kill();
  if (viaWsl) spawnSync("wsl", ["-e", "pkill", "-f", "anvil --port 8546"]);
}
