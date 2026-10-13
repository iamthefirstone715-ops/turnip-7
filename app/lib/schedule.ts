import { CATEGORIES, type Category } from "./bills.ts";

// The model only fills in a form. Everything it returns is treated as untrusted text and re-validated here:
// unknown providers, odd numbers or injected instructions can only produce an empty or rejected field, never a payment.

export type Interval = "daily" | "weekly" | "monthly" | "minutes";
export const INTERVAL_SECONDS: Record<Exclude<Interval, "minutes">, number> = { daily: 86_400, weekly: 604_800, monthly: 2_592_000 };

export const SCHEDULABLE: Category[] = ["airtime", "electricity"];

export type Proposal = {
  category: Category;
  provider: string; // "" = still to choose
  meterType: "prepaid" | "postpaid";
  account: string; // "" = still to enter
  amountUsd: number | null;
  interval: Interval;
  minutes: number; // only used when interval === "minutes"
  runs: number;
  /** "" = self, "@name" = a platform username, anything else is a person's name saved on this device, like "mum". */
  recipient: string;
  summary: string;
};

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pulls the first JSON object out of a model reply, tolerating code fences or stray prose. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function intervalSeconds(interval: Interval, minutes: number) {
  return interval === "minutes" ? Math.max(60, Math.round(minutes) * 60) : INTERVAL_SECONDS[interval];
}

export function buildProposal(raw: unknown): ProposalResult {
  if (!isObj(raw)) return { ok: false, message: "I couldn't understand that. Try: pay my mum's electricity $20 monthly." };

  const category = raw.category;
  if (category !== "airtime" && category !== "electricity") {
    const why = typeof raw.unsupported === "string" ? raw.unsupported.slice(0, 120) : "";
    return { ok: false, message: why || "I can only schedule airtime or electricity for now." };
  }

  const provider =
    typeof raw.provider === "string" && CATEGORIES[category].providers.some((p) => p.id === raw.provider) ? raw.provider : "";

  const meterType = raw.meterType === "postpaid" ? "postpaid" : "prepaid";

  const account = typeof raw.account === "string" && /^\d{5,20}$/.test(raw.account.trim()) ? raw.account.trim() : "";

  const amount = typeof raw.amountUsd === "number" && Number.isFinite(raw.amountUsd) ? Math.round(raw.amountUsd * 100) / 100 : NaN;
  const amountUsd = amount >= 0.05 && amount <= 500 ? amount : null;

  const every = isObj(raw.interval) ? raw.interval.every : undefined;
  const interval: Interval = every === "day" ? "daily" : every === "week" ? "weekly" : every === "minutes" ? "minutes" : "monthly";
  const rawMinutes = isObj(raw.interval) && typeof raw.interval.minutes === "number" ? raw.interval.minutes : 1;
  const minutes = Math.min(1440, Math.max(1, Math.round(rawMinutes)));

  const rawRuns = typeof raw.runs === "number" && Number.isFinite(raw.runs) ? Math.round(raw.runs) : NaN;
  const runs = rawRuns >= 1 && rawRuns <= 60 ? rawRuns : interval === "minutes" ? 3 : 12;

  let recipient = "";
  if (isObj(raw.recipient) && typeof raw.recipient.value === "string") {
    const v = raw.recipient.value.trim().replace(/^@/, "");
    if (raw.recipient.kind === "username" && /^[a-z0-9_]{3,20}$/.test(v.toLowerCase())) recipient = `@${v.toLowerCase()}`;
    else if ((raw.recipient.kind === "name" || raw.recipient.kind === "label") && /^[\p{L} ]{1,30}$/u.test(v)) recipient = v.toLowerCase();
  }

  const summary = typeof raw.summary === "string" ? raw.summary.slice(0, 160) : "";
  return { ok: true, proposal: { category, provider, meterType, account, amountUsd, interval, minutes, runs, recipient, summary } };
}

// Chat mode: one sentence can be a send, a bill paid now, or a repeating payment. Same rule as above: the model's
// answer is untrusted, so each kind is rebuilt from validated fields and anything else is refused.
export type Intent =
  | { kind: "send"; to: string; amountUsd: number | null; summary: string }
  | { kind: "bill"; proposal: Proposal }
  | { kind: "schedule"; proposal: Proposal };
export type IntentResult = { ok: true; intent: Intent } | { ok: false; message: string };

export function buildIntent(raw: unknown): IntentResult {
  if (!isObj(raw)) return { ok: false, message: "I didn't catch that. Try: send @mumdemo $2, or pay my mum's electricity $5." };
  const summary = typeof raw.summary === "string" ? raw.summary.slice(0, 160) : "";
  if (raw.intent === "send") {
    const to = typeof raw.to === "string" ? raw.to.trim().replace(/^@/, "").toLowerCase() : "";
    if (/^0x/.test(to)) return { ok: false, message: "Send to an @username, not a wallet address." };
    if (!/^[a-z0-9_]{3,20}$/.test(to)) return { ok: false, message: "Who should I send it to? Use their @username, like @mumdemo." };
    const amount = typeof raw.amountUsd === "number" && Number.isFinite(raw.amountUsd) ? Math.round(raw.amountUsd * 100) / 100 : NaN;
    return { ok: true, intent: { kind: "send", to, amountUsd: amount >= 0.01 && amount <= 500 ? amount : null, summary } };
  }
  if (raw.intent === "bill" || raw.intent === "schedule") {
    const r = buildProposal(raw);
    return r.ok ? { ok: true, intent: { kind: raw.intent, proposal: r.proposal } } : r;
  }
  const why = typeof raw.unsupported === "string" ? raw.unsupported.slice(0, 160) : "";
  return { ok: false, message: why || "I can send money, pay airtime or electricity, or set up a repeating payment." };
}
