import type { Address } from "viem";
import type { Category } from "./bills.ts";

// Details of the people you pay: you enter them once, and from then on typing the name is enough.
// They live only on this device. Nothing about who you pay is published, and no one can look up anyone else's details.
export type Contact = {
  name: string; // lowercase: "mum", or "@tobi" if you typed a platform name
  category: Category;
  provider: string;
  plan: string; // electricity meter type, "" otherwise
  account: string; // phone, meter or smartcard number
};

const key = (a: Address) => `pay:contacts:${a.toLowerCase()}`;

export const contactName = (raw: string) => raw.trim().toLowerCase();

export function loadContacts(a: Address): Contact[] {
  try {
    const v = localStorage.getItem(key(a));
    return v ? (JSON.parse(v) as Contact[]) : [];
  } catch {
    return [];
  }
}

function write(a: Address, list: Contact[]) {
  try {
    localStorage.setItem(key(a), JSON.stringify(list.slice(0, 100)));
  } catch {}
}

/** Saves or replaces the entry for this name and category. */
export function saveContact(a: Address, c: Contact) {
  write(a, [c, ...loadContacts(a).filter((x) => !(x.name === c.name && x.category === c.category))]);
}

export function removeContact(a: Address, name: string, category: Category) {
  write(a, loadContacts(a).filter((x) => !(x.name === name && x.category === category)));
}
