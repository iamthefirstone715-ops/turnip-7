import { createPublicClient, createWalletClient, fallback, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { mock, vtpass } from "../../../worker/providers.mjs";
import { tick } from "../../../worker/tick.mjs";

// The bill worker, as one stateless pass: settle pending bills and run due schedules. Called by the app while someone is
// waiting on a bill and by a once-a-minute pinger, so no always-on server is needed. Safe to call at any time and by anyone:
// it only ever settles what the provider actually delivered, and a second overlapping call can't buy an order twice.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

let running = false; // per instance; other instances rely on the provider refusing a repeat purchase
let last = 0;

async function pass() {
  const key = process.env.OPERATOR_KEY as Hex | undefined;
  const billPay = (process.env.BILLPAY ?? process.env.NEXT_PUBLIC_BILLPAY) as Hex | undefined;
  if (!key || !billPay) return Response.json({ error: "The worker isn't configured." }, { status: 503 });
  if (running || Date.now() - last < 3000) return Response.json({ skipped: true });
  running = true;
  try {
    // Shared serverless IPs get throttled by any single public RPC, so roll over to the next one when a call fails.
    const transport = fallback(
      [process.env.RPC_URL, monadTestnet.rpcUrls.default.http[0], "https://rpc-testnet.monadinfra.com", "https://rpc.ankr.com/monad_testnet", "https://monad-testnet.drpc.org"]
        .filter((u): u is string => !!u)
        .map((u) => http(u, { retryCount: 1, timeout: 8000 })),
    );
    const publicClient = createPublicClient({ chain: monadTestnet, transport });
    const walletClient = createWalletClient({ chain: monadTestnet, transport, account: privateKeyToAccount(key) });
    const provider = process.env.PROVIDER === "vtpass" ? vtpass({ apiKey: process.env.VTPASS_API_KEY, secretKey: process.env.VTPASS_SECRET_KEY }) : mock();
    const logs: string[] = [];
    const result = await tick({
      publicClient,
      walletClient,
      billPay,
      scheduler: (process.env.SCHEDULER ?? process.env.NEXT_PUBLIC_SCHEDULER) as Hex | undefined,
      provider,
      log: (m: string) => logs.push(String(m)),
    });
    return Response.json({ ...result, logs: logs.slice(-10) });
  } catch (e) {
    const why = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message).split(String.fromCharCode(10))[0].slice(0, 200) : "unknown";
    return Response.json({ error: `tick failed: ${why}` }, { status: 502 });
  } finally {
    last = Date.now();
    running = false;
  }
}

export const GET = pass;
export const POST = pass;
