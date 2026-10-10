import { createPublicClient, http, parseAbi, type Account, type Address, type Chain, type Transport, type WalletClient } from "viem";
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
  profile: process.env.NEXT_PUBLIC_PROFILE as Address,
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
export const profileAbi = parseAbi([
  "function set(string category, string provider, string plan, string account)",
  "function clear(string category)",
  "function get(address owner, string category) view returns ((string provider, string plan, string account))",
]);
export const billPayAbi = parseAbi([
  "function pay(string billType, string account, uint96 amount, string beneficiary) returns (uint256)",
  "event BillRequested(uint256 indexed orderId, address indexed payer, string billType, string account, uint256 amount, string beneficiary)",
  "event BillFulfilled(uint256 indexed orderId, string ref)",
  "event BillRefunded(uint256 indexed orderId)",
]);

export const publicClient = createPublicClient({ chain, transport: http() });

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
    paymasterVerificationGasLimit: BigInt(100_000),
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

/** 6-decimal USDC base units to "$12.34". */
export const fmtUsd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
export const toUnits = (usd: string) => BigInt(Math.round(parseFloat(usd) * 1e6));

/** Keeps digits and one dot, max 2 decimals: no negatives, no exponent, no spinner. */
export const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
};
