import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { createWorker } from "./index.mjs";
import { mock, vtpass } from "./providers.mjs";

// node --env-file=worker/.env worker/run.mjs
const { RPC_URL, BILLPAY, OPERATOR_KEY, START_BLOCK, PROVIDER = "mock", VTPASS_API_KEY, VTPASS_SECRET_KEY } = process.env;
if (!BILLPAY || !OPERATOR_KEY) throw new Error("BILLPAY and OPERATOR_KEY are required");
const transport = http(RPC_URL ?? monadTestnet.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: monadTestnet, transport });
const walletClient = createWalletClient({ chain: monadTestnet, transport, account: privateKeyToAccount(OPERATOR_KEY) });
const provider = PROVIDER === "vtpass" ? vtpass({ apiKey: VTPASS_API_KEY, secretKey: VTPASS_SECRET_KEY }) : mock();
const worker = createWorker({
  publicClient,
  walletClient,
  billPay: BILLPAY,
  provider,
  cursorFile: new URL("./.cursor", import.meta.url),
  startBlock: START_BLOCK ? BigInt(START_BLOCK) : undefined,
});
console.log(`worker up, provider=${PROVIDER}, operator=${walletClient.account.address}`);
for (;;) {
  await worker.scan().catch((e) => console.log("scan error:", e.shortMessage ?? e.message));
  await new Promise((r) => setTimeout(r, 2000));
}
