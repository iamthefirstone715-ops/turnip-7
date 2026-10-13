import { encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { ADDR, billPayAbi, orderIdOf, publicClient, registryAbi, schedulerAbi, settlementOf, toUnits, usdcAbi, type Settlement } from "./web3";
import { addEntry, updateEntry } from "./history";
import { saveContact } from "./contacts";
import { CATEGORIES, encodeBill, type Category } from "./bills";

// The money-moving steps, shared by the button screens and the chat so both run exactly the same code.

type Exec = (calls: { to: Address; data: Hex }[]) => Promise<Hex>;
export type Me = { address: Address; name: string; balance: bigint; exec: Exec };

const allowance = (owner: Address) => publicClient.readContract({ address: ADDR.usdc, abi: usdcAbi, functionName: "allowance", args: [owner, ADDR.billPay] });

/** USDC to a platform @username. Throws a short, user-facing message on anything wrong. */
export async function sendMoney(me: Me, to: string, amount: string): Promise<Hex> {
  const recipient = await publicClient.readContract({ address: ADDR.registry, abi: registryAbi, functionName: "resolve", args: [to] });
  if (recipient === zeroAddress) throw new Error(`@${to} doesn't exist`);
  if (to === me.name) throw new Error("You can't send to yourself");
  const value = toUnits(amount);
  if (value <= BigInt(0)) throw new Error("Enter an amount");
  if (value > me.balance) throw new Error("Not enough balance");
  const tx = await me.exec([{ to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "transfer", args: [recipient, value] }) }]);
  addEntry(me.address, { kind: "sent", title: `To @${to}`, amount: Number(value) / 1e6, status: "Completed", hash: tx });
  return tx;
}

export type BillInput = {
  category: Category;
  provider: string;
  plan?: string; // electricity meter type, or a data/TV plan code
  account: string;
  amount: string;
  person: string; // "mum", "@tobi", or "" for yourself; stays on this device
  remember: boolean;
};

const billTitle = (b: BillInput) => {
  const providerName = CATEGORIES[b.category].providers.find((p) => p.id === b.provider)?.name ?? "";
  return `${providerName} ${CATEGORIES[b.category].label}${b.person ? ` for ${b.person}` : ""}`;
};

/** Puts a bill into escrow. Resolves once the order is open; call waitForSettlement for the outcome. */
export async function payBill(me: Me, b: BillInput): Promise<{ tx: Hex; orderId: bigint }> {
  const value = toUnits(b.amount);
  if (value <= BigInt(0)) throw new Error("Enter an amount");
  if (value > me.balance) throw new Error("Not enough balance");
  const tx = await me.exec([
    // add to the existing approval: replacing it would silently cancel the room active schedules rely on
    { to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.billPay, (await allowance(me.address)) + value] }) },
    { to: ADDR.billPay, data: encodeFunctionData({ abi: billPayAbi, functionName: "pay", args: [encodeBill(b.category, b.provider, b.plan || undefined), b.account, value, ""] }) }, // who it's for is never published
  ]);
  if (b.remember && b.person) saveContact(me.address, { name: b.person, category: b.category, provider: b.provider, plan: b.category === "electricity" ? (b.plan ?? "") : "", account: b.account });
  addEntry(me.address, { kind: "bill", title: billTitle(b), amount: Number(value) / 1e6, status: "Processing", hash: tx });
  const orderId = await orderIdOf(tx);
  if (orderId === undefined) throw new Error("Order not found in receipt");
  updateEntry(me.address, tx, { orderId: String(orderId) });
  return { tx, orderId };
}

/** Polls the order until the worker settles it, then records the outcome in the activity list. */
export async function waitForSettlement(address: Address, tx: Hex, orderId: bigint): Promise<Settlement> {
  // ponytail: polls the order every 1.5s; switch to a websocket subscription if the RPC supports it
  for (;;) {
    const done = await settlementOf(orderId).catch(() => undefined); // a flaky RPC read just means "look again"
    if (done) {
      updateEntry(address, tx, done.status === "fulfilled" ? { status: "Paid", ref: done.ref } : { status: "Refunded" });
      return done;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export type ScheduleInput = Omit<BillInput, "amount"> & { perRun: string; runs: number; intervalSeconds: number };

/** Approves the whole cap up front and stores the schedule; the keeper runs it from there. */
export async function startSchedule(me: Me, s: ScheduleInput): Promise<Hex> {
  const per = toUnits(s.perRun);
  const cap = per * BigInt(s.runs);
  const tx = await me.exec([
    { to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.billPay, (await allowance(me.address)) + cap] }) },
    {
      to: ADDR.scheduler,
      data: encodeFunctionData({ abi: schedulerAbi, functionName: "create", args: [encodeBill(s.category, s.provider, s.plan || undefined), s.account, "", per, s.intervalSeconds, s.runs, BigInt(0)] }), // who it's for is never published
    },
  ]);
  if (s.remember && s.person) saveContact(me.address, { name: s.person, category: s.category, provider: s.provider, plan: s.category === "electricity" ? (s.plan ?? "") : "", account: s.account });
  return tx;
}
