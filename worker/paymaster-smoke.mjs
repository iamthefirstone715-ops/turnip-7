// node --env-file=contracts/.env worker/paymaster-smoke.mjs
// Real UserOp on Monad testnet: fresh account with 0 MON sends USDC, gas charged in USDC by our paymaster.
import { createPublicClient, createWalletClient, encodeFunctionData, http, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PM = process.env.PAYMASTER ?? "0xFa387f173B0D1aD5c7CA1B23f2823aaC530C6093";
const BUNDLER = process.env.BUNDLER_URL ?? `https://public.pimlico.io/v2/${chain.id}/rpc`;
const erc = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);

const pub = createPublicClient({ chain, transport: http() });
const funder = privateKeyToAccount(process.env.DEPLOYER_KEY);
const owner = privateKeyToAccount(generatePrivateKey());
const account = await toSimpleSmartAccount({ client: pub, owner, entryPoint: { address: entryPoint07Address, version: "0.7" } });
console.log("smart account:", account.address);

const fw = createWalletClient({ chain, transport: http(), account: funder });
await pub.waitForTransactionReceipt({ hash: await fw.writeContract({ address: USDC, abi: erc, functionName: "transfer", args: [account.address, 5_000_000n] }) });

const pm = async () => ({ paymaster: PM, paymasterData: "0x", paymasterVerificationGasLimit: 100_000n, paymasterPostOpGasLimit: 100_000n });
const pimlico = createPimlicoClient({ transport: http(BUNDLER), entryPoint: { address: entryPoint07Address, version: "0.7" } });
const client = createSmartAccountClient({
  account,
  chain,
  bundlerTransport: http(BUNDLER),
  paymaster: { getPaymasterData: pm, getPaymasterStubData: pm },
  userOperation: { estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast },
});

const before = await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [account.address] });
const hash = await client.sendTransaction({
  calls: [
    { to: USDC, data: encodeFunctionData({ abi: erc, functionName: "approve", args: [PM, maxUint256] }) },
    { to: USDC, data: encodeFunctionData({ abi: erc, functionName: "transfer", args: [funder.address, 1_000_000n] }) },
  ],
});
const rc = await pub.waitForTransactionReceipt({ hash });
const after = await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [account.address] });
const mon = await pub.getBalance({ address: account.address });
console.log("tx:", hash, rc.status);
console.log("MON held by account:", mon);
console.log("USDC before/after:", before, after, "=> gas fee paid in USDC (base units):", before - 1_000_000n - after);
