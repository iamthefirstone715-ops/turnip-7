import { useSyncExternalStore } from "react";

// Chat for people new to crypto, buttons for people who know their way around. Remembered on this device; new users get chat.
export type Mode = "chat" | "buttons";
const KEY = "klink:mode";
const listeners = new Set<() => void>();

const read = (): Mode => {
  try {
    return localStorage.getItem(KEY) === "buttons" ? "buttons" : "chat";
  } catch {
    return "chat";
  }
};

export function setMode(m: Mode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {}
  listeners.forEach((l) => l());
}

export const useMode = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    (): Mode => "chat",
  );
