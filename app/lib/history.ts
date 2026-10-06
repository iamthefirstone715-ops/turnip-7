import type { Address } from "viem";

// ponytail: activity lives in this browser's localStorage. The public Monad RPC caps getLogs at ~100 blocks,
// so scanning chain history per user isn't practical; swap for an indexer endpoint if this outgrows a demo.
export type Entry = {
  id: string;
  kind: "received" | "sent" | "bill";
  title: string;
  amount: number; // USD
  ts: number;
  status: string;
  hash?: string;
  ref?: string;
};

const hKey = (a: Address) => `pay:history:${a.toLowerCase()}`;
const bKey = (a: Address) => `pay:balance:${a.toLowerCase()}`;

function read<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const loadHistory = (a: Address) => read<Entry[]>(hKey(a)) ?? [];

export function addEntry(a: Address, e: Omit<Entry, "id" | "ts">) {
  const entry: Entry = { ...e, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() };
  write(hKey(a), [entry, ...loadHistory(a)].slice(0, 50));
}

export function updateEntry(a: Address, hash: string, patch: Partial<Entry>) {
  write(
    hKey(a),
    loadHistory(a).map((e) => (e.hash === hash ? { ...e, ...patch } : e)),
  );
}

/** Remember the balance after our own actions so later increases can be recognised as incoming funds. */
export const setKnownBalance = (a: Address, bal: bigint) => write(bKey(a), bal.toString());

/** Call on dashboard load: an unexplained balance increase is logged as received funds. */
export function syncReceived(a: Address, bal: bigint) {
  const known = read<string>(bKey(a));
  if (known !== undefined && bal > BigInt(known)) {
    addEntry(a, { kind: "received", title: "Funds received", amount: Number(bal - BigInt(known)) / 1e6, status: "Completed" });
  }
  setKnownBalance(a, bal);
}
