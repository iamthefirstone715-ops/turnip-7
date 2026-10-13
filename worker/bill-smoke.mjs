// node --env-file=contracts/.env worker/bill-smoke.mjs [billType] [account] [usd]
// Places a real bill order on Monad testnet from a fresh 0-MON smart account (gas paid in USDC).
// Run the worker (npm run worker) to settle it.
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";
import { USDC, ensureBudget, sendOp, smartClient, testOwnerKey, topUp } from "./aa.mjs";

const BILLPAY = process.env.BILLPAY ?? "0xC9af6BCa480a2A6059e81e463917DA366aBC370E";
const [type, acct, usd] = [process.argv[2] ?? "electricity:ikeja-electric:prepaid", process.argv[3] ?? "1111111111111", process.argv[4] ?? "1.5"];

const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const bp = parseAbi(["function pay(string,string,uint96,string) returns (uint256)", "function nextId() view returns (uint256)"]);

const pub = createPublicClient({ chain, transport: http() });
const funder = privateKeyToAccount(process.env.DEPLOYER_KEY);
const client = await smartClient(pub, privateKeyToAccount(testOwnerKey()));
const amount = BigInt(Math.round(Number(usd) * 1e6));
await topUp(pub, createWalletClient({ chain, transport: http(), account: funder }), client.account.address, amount + 100_000n);

await ensureBudget(client, pub);
const idBefore = await pub.readContract({ address: BILLPAY, abi: bp, functionName: "nextId" });
const hash = await sendOp(client, [
  { to: USDC, data: encodeFunctionData({ abi: erc, functionName: "approve", args: [BILLPAY, amount] }), value: 0n },
  { to: BILLPAY, data: encodeFunctionData({ abi: bp, functionName: "pay", args: [type, acct, amount, ""] }), value: 0n },
]);
console.log(`order #${idBefore} placed (${type} ${acct} $${usd}) tx ${hash}`);
console.log(`check: cast call ${BILLPAY} 'orders(uint256)(address,uint96,uint64,uint8)' ${idBefore} --rpc-url https://testnet-rpc.monad.xyz   (status 1=pending 2=fulfilled 3=refunded)`);
