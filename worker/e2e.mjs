// node worker/e2e.mjs  (needs `forge build` in contracts/ first). Local anvil, mock provider.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createWorker, abi } from "./index.mjs";
import { mock } from "./providers.mjs";

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // operator
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // treasury
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // payer
];
const [deployer, operator, treasury, payer] = KEYS.map(privateKeyToAccount);
const artifact = (p) => JSON.parse(readFileSync(new URL(`../contracts/out/${p}.json`, import.meta.url), "utf8"));

const anvil = spawn("anvil", ["--port", "8546", "--silent"], { stdio: "ignore" });
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
  console.log("\nE2E PASS: fulfil, refund, escrow empty, idempotent restart");
} finally {
  anvil.kill();
}
