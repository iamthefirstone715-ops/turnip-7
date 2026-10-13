// Shared ERC-4337 helpers for the smoke scripts: same flow as the app (app/lib/web3.ts).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, http, parseAbi } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

export const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
export const PAYMASTER = process.env.PAYMASTER ?? "0x0aFbcc35D07f80F9B88f4fc4Fd704467dA05defD";
const BUNDLER = process.env.BUNDLER_URL ?? `https://public.pimlico.io/v2/${chain.id}/rpc`;
const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);

/** One saved test owner (gitignored), so a failed run doesn't strand USDC in an account whose key was thrown away. */
export function testOwnerKey() {
  const f = new URL("./.smoke-key", import.meta.url);
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  const k = generatePrivateKey();
  writeFileSync(f, k);
  return k;
}

/** Tops the test account up to `need` USDC from the funder wallet (only the difference). */
export async function topUp(pub, funderWallet, to, need) {
  const have = await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [to] });
  if (have >= need) return;
  await pub.waitForTransactionReceipt({ hash: await funderWallet.writeContract({ address: USDC, abi: erc, functionName: "transfer", args: [to, need - have] }) });
}

export async function smartClient(pub, owner) {
  const account = await toSimpleSmartAccount({ client: pub, owner, entryPoint: { address: entryPoint07Address, version: "0.7" } });
  const pm = async () => ({ paymaster: PAYMASTER, paymasterData: "0x", paymasterVerificationGasLimit: 200_000n, paymasterPostOpGasLimit: 100_000n });
  const pimlico = createPimlicoClient({ transport: http(BUNDLER), entryPoint: { address: entryPoint07Address, version: "0.7" } });
  return createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(BUNDLER),
    paymaster: { getPaymasterData: pm, getPaymasterStubData: pm },
    userOperation: { estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast },
  });
}

/** Sends one user operation (re-signed after adding preVerificationGas headroom); returns the tx hash. */
export async function sendOp(client, calls, callGasLimit) {
  const { signature: _stub, ...op } = await client.prepareUserOperation({ calls, ...(callGasLimit ? { callGasLimit } : {}) });
  const hash = await client.sendUserOperation({ ...op, preVerificationGas: (op.preVerificationGas * 16n) / 10n });
  const { success, receipt } = await client.waitForUserOperationReceipt({ hash });
  if (!success) throw new Error(`user operation reverted: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/** An unapproved account may only send the paymaster approval itself, so do that first when the budget is low. */
export async function ensureBudget(client, pub) {
  const owner = client.account.address;
  const allowance = await pub.readContract({ address: USDC, abi: erc, functionName: "allowance", args: [owner, PAYMASTER] });
  if (allowance >= 100_000n) return undefined;
  return sendOp(client, [{ to: USDC, data: encodeFunctionData({ abi: erc, functionName: "approve", args: [PAYMASTER, 2_000_000n] }), value: 0n }], 120_000n);
}
