// node --env-file=contracts/.env worker/paymaster-smoke.mjs
// Real user operations on Monad testnet: a fresh account with 0 MON approves the paymaster (its only allowed first op),
// then sends USDC with the gas charged up front in USDC and the unused part refunded.
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";
import { USDC, ensureBudget, sendOp, smartClient, testOwnerKey, topUp } from "./aa.mjs";

const erc = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const pub = createPublicClient({ chain, transport: http() });
const funder = privateKeyToAccount(process.env.DEPLOYER_KEY);
const client = await smartClient(pub, privateKeyToAccount(testOwnerKey()));
const me = client.account.address;
console.log("smart account:", me);

await topUp(pub, createWalletClient({ chain, transport: http(), account: funder }), me, 120_000n);
const before = await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [me] });
console.log("approval op:", await ensureBudget(client, pub));
const hash = await sendOp(client, [{ to: USDC, data: encodeFunctionData({ abi: erc, functionName: "transfer", args: [funder.address, 50_000n] }), value: 0n }]);
const after = await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [me] });
console.log("tx:", hash);
console.log("MON held by account:", await pub.getBalance({ address: me }));
console.log("USDC before/after:", before, after, "=> gas fees paid in USDC (base units):", before - 50_000n - after);
