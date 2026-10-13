import { createPublicClient, decodeEventLog, encodeFunctionData, http, parseAbi, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from "viem";
import { monadTestnet } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

export const chain = monadTestnet;

export const ADDR = {
  usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address,
  registry: process.env.NEXT_PUBLIC_REGISTRY as Address,
  billPay: process.env.NEXT_PUBLIC_BILLPAY as Address,
  paymaster: process.env.NEXT_PUBLIC_PAYMASTER as Address,
  scheduler: process.env.NEXT_PUBLIC_SCHEDULER as Address,
};

const PIMLICO_KEY = process.env.NEXT_PUBLIC_PIMLICO_KEY;
// The keyless public endpoint works on testnet (verified), with lower rate limits.
const BUNDLER_URL = PIMLICO_KEY
  ? `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${PIMLICO_KEY}`
  : `https://public.pimlico.io/v2/${chain.id}/rpc`;

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);
export const registryAbi = parseAbi([
  "function register(string name)",
  "function resolve(string name) view returns (address)",
  "function nameOf(address) view returns (string)",
]);
export const schedulerAbi = parseAbi([
  "function create(string billType, string account, string beneficiary, uint96 amount, uint32 interval, uint16 runs, uint64 firstDue) returns (uint256)",
  "function cancel(uint256 id)",
  "function nextId() view returns (uint256)",
  "function get(uint256 id) view returns ((address owner, uint96 amount, uint32 interval, uint64 nextDue, uint16 runsLeft, string billType, string account, string beneficiary))",
]);
export const billPayAbi = parseAbi([
  "function pay(string billType, string account, uint96 amount, string beneficiary) returns (uint256)",
  "function nextId() view returns (uint256)",
  "function orders(uint256) view returns (address payer, uint96 amount, uint64 createdAt, uint8 status)",
  "function reclaim(uint256 id)",
  "function TIMEOUT() view returns (uint256)",
  "event BillRequested(uint256 indexed orderId, address indexed payer, string billType, string account, uint256 amount, string beneficiary)",
  "event BillFulfilled(uint256 indexed orderId, string ref)",
  "event BillRefunded(uint256 indexed orderId)",
]);

export const publicClient = createPublicClient({ chain, transport: http() });

export type Settlement = { status: "fulfilled"; ref: string } | { status: "refunded" };

/** The order id a bill payment transaction opened, or undefined if the transaction isn't one. */
export async function orderIdOf(hash: Hex): Promise<bigint | undefined> {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: billPayAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "BillRequested") return ev.args.orderId;
    } catch {}
  }
}

/** How an order ended, or undefined while it is still pending. Reads order state, so it works however long ago it settled. */
export async function settlementOf(orderId: bigint): Promise<Settlement | undefined> {
  const status = (await publicClient.readContract({ address: ADDR.billPay, abi: billPayAbi, functionName: "orders", args: [orderId] }))[3];
  if (status === 3) return { status: "refunded" };
  if (status !== 2) return undefined;
  // The RPC caps getLogs at ~100 blocks: look for the delivery reference in the most recent windows only.
  const latest = await publicClient.getBlockNumber();
  for (let i = BigInt(0); i < BigInt(8); i++) {
    const toBlock = latest - i * BigInt(99);
    const logs = await publicClient.getLogs({ address: ADDR.billPay, fromBlock: toBlock - BigInt(98), toBlock }).catch(() => []);
    for (const log of logs) {
      try {
        const ev = decodeEventLog({ abi: billPayAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "BillFulfilled" && ev.args.orderId === orderId) return { status: "fulfilled", ref: ev.args.ref };
      } catch {}
    }
  }
  return { status: "fulfilled", ref: "" };
}

export async function makeSmartClient(owner: WalletClient<Transport, Chain, Account>) {
  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  // Our USDCPaymaster needs no signature: just its address plus gas limits.
  const pmData = async () => ({
    paymaster: ADDR.paymaster,
    paymasterData: "0x" as const,
    paymasterVerificationGasLimit: BigInt(200_000),
    paymasterPostOpGasLimit: BigInt(100_000),
  });

  const pimlico = createPimlicoClient({
    transport: http(BUNDLER_URL),
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  return createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: { getPaymasterData: pmData, getPaymasterStubData: pmData },
    userOperation: {
      estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
    },
  });
}

export type SmartClient = Awaited<ReturnType<typeof makeSmartClient>>;
type Call = { to: Address; data: Hex; value?: bigint };

/** USDC the paymaster may take for fees, approved a little at a time (never unlimited). */
export const PAYMASTER_BUDGET = BigInt(2_000_000);
const PAYMASTER_LOW = BigInt(100_000);

/** Sends one user operation and returns its transaction hash; throws if the call itself reverted. */
export async function sendOp(client: SmartClient, calls: Call[], callGasLimit?: bigint): Promise<Hex> {
  const prepared = await client.prepareUserOperation({ calls, ...(callGasLimit ? { callGasLimit } : {}) });
  const { signature, ...op } = prepared;
  void signature; // the placeholder signature from estimation; the op is re-signed after the gas change below
  // Pimlico on Monad testnet has rejected its own preVerificationGas estimate (30% headroom was not enough).
  const hash = await client.sendUserOperation({ ...op, preVerificationGas: (op.preVerificationGas * BigInt(16)) / BigInt(10) });
  const { success, receipt } = await client.waitForUserOperationReceipt({ hash });
  if (!success) throw new Error("The transaction failed. Only the network fee was charged.");
  return receipt.transactionHash;
}

/**
 * The paymaster takes fees from a small USDC approval. An account that hasn't approved it may send only that approval
 * (with enough call gas that it can't be made to fail), so top it up in its own operation when it runs low.
 */
export async function ensurePaymasterBudget(client: SmartClient, owner: Address) {
  const allowance = await publicClient.readContract({ address: ADDR.usdc, abi: usdcAbi, functionName: "allowance", args: [owner, ADDR.paymaster] });
  if (allowance >= PAYMASTER_LOW) return;
  await sendOp(
    client,
    [{ to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.paymaster, PAYMASTER_BUDGET] }), value: BigInt(0) }],
    BigInt(120_000),
  );
}

/** 6-decimal USDC base units to "$12.34". */
export const fmtUsd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
export const toUnits = (usd: string) => BigInt(Math.round(parseFloat(usd) * 1e6));

/** Keeps digits and one dot, max 2 decimals: no negatives, no exponent, no spinner. */
export const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
};
