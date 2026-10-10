// node --env-file=contracts/.env worker/bill-smoke.mjs
// Places a real bill order on Monad testnet from a fresh 0-MON smart account (gas paid in USDC).
// Run the worker (npm run worker) to settle it, then re-run this script's printed status checks.
import { createPublicClient, createWalletClient, encodeFunctionData, http, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PM = "0xFa387f173B0D1aD5c7CA1B23f2823aaC530C6093";
const BILLPAY = "0xF4dC10dD779b9440A4b63a58A4fC7a56AadE71Bb";
const BUNDLER = `https://public.pimlico.io/v2/${chain.id}/rpc`;
const [type, acct, usd] = [process.argv[2] ?? "electricity", process.argv[3] ?? "1111111111111", process.argv[4] ?? "1.5"];

const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const bp = parseAbi([
  "function pay(string,string,uint96,string) returns (uint256)",
  "function orders(uint256) view returns (address,uint96,uint64,uint8)",
  "function nextId() view returns (uint256)",
]);

const pub = createPublicClient({ chain, transport: http() });
const funder = privateKeyToAccount(process.env.DEPLOYER_KEY);
const owner = privateKeyToAccount(generatePrivateKey());
const account = await toSimpleSmartAccount({ client: pub, owner, entryPoint: { address: entryPoint07Address, version: "0.7" } });
await pub.waitForTransactionReceipt({
  hash: await createWalletClient({ chain, transport: http(), account: funder }).writeContract({ address: USDC, abi: erc, functionName: "transfer", args: [account.address, BigInt(Math.round(Number(usd) * 1e6)) + 100_000n] }),
});

const pm = async () => ({ paymaster: PM, paymasterData: "0x", paymasterVerificationGasLimit: 100_000n, paymasterPostOpGasLimit: 100_000n });
const pimlico = createPimlicoClient({ transport: http(BUNDLER), entryPoint: { address: entryPoint07Address, version: "0.7" } });
const client = createSmartAccountClient({
  account,
  chain,
  bundlerTransport: http(BUNDLER),
  paymaster: { getPaymasterData: pm, getPaymasterStubData: pm },
  userOperation: { estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast },
});

const amount = BigInt(Math.round(Number(usd) * 1e6));
const idBefore = await pub.readContract({ address: BILLPAY, abi: bp, functionName: "nextId" });
const hash = await client.sendTransaction({
  calls: [
    { to: USDC, data: encodeFunctionData({ abi: erc, functionName: "approve", args: [PM, maxUint256] }) },
    { to: USDC, data: encodeFunctionData({ abi: erc, functionName: "approve", args: [BILLPAY, amount] }) },
    { to: BILLPAY, data: encodeFunctionData({ abi: bp, functionName: "pay", args: [type, acct, amount, ""] }) },
  ],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`order #${idBefore} placed (${type} ${acct} $${usd}) tx ${hash}`);
console.log(`check: cast call ${BILLPAY} 'orders(uint256)(address,uint96,uint64,uint8)' ${idBefore} --rpc-url https://testnet-rpc.monad.xyz   (status 1=pending 2=fulfilled 3=refunded)`);
