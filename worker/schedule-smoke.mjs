// node --env-file=contracts/.env worker/schedule-smoke.mjs [billType] [account] [usdPerRun] [intervalSeconds] [runs]
// Creates a recurring payment on Monad testnet from a fresh 0-MON smart account (gas paid in USDC).
// With the worker running, the keeper triggers each due run and the worker buys it from the bill provider.
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";
import { USDC, ensureBudget, sendOp, smartClient, testOwnerKey, topUp } from "./aa.mjs";

const BILLPAY = process.env.BILLPAY ?? "0xC9af6BCa480a2A6059e81e463917DA366aBC370E";
const SCHEDULER = process.env.SCHEDULER ?? "0x930CADdcc1669193C0d245F65710832af816439F";
const [billType, acct, usd, secs, runs] = [process.argv[2] ?? "airtime:mtn", process.argv[3] ?? "08011111111", process.argv[4] ?? "0.2", Number(process.argv[5] ?? 60), Number(process.argv[6] ?? 2)];

const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const sch = parseAbi(["function create(string,string,string,uint96,uint32,uint16,uint64) returns (uint256)", "function nextId() view returns (uint256)"]);

const pub = createPublicClient({ chain, transport: http() });
const funder = privateKeyToAccount(process.env.DEPLOYER_KEY);
const client = await smartClient(pub, privateKeyToAccount(testOwnerKey()));
const per = BigInt(Math.round(Number(usd) * 1e6));
const total = per * BigInt(runs);
await topUp(pub, createWalletClient({ chain, transport: http(), account: funder }), client.account.address, total + 100_000n);

await ensureBudget(client, pub);
const id = await pub.readContract({ address: SCHEDULER, abi: sch, functionName: "nextId" });
const hash = await sendOp(client, [
  { to: USDC, data: encodeFunctionData({ abi: erc, functionName: "approve", args: [BILLPAY, total] }), value: 0n }, // the spend cap
  { to: SCHEDULER, data: encodeFunctionData({ abi: sch, functionName: "create", args: [billType, acct, "", per, secs, runs, 0n] }), value: 0n },
]);
console.log(`schedule #${id} created: ${billType} ${acct} $${usd} every ${secs}s x${runs} (cap $${Number(total) / 1e6}) tx ${hash}`);
console.log(`account ${client.account.address}`);
