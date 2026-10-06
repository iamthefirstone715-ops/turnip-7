"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, encodeFunctionData, maxUint256, type Address, type Hex } from "viem";
import { setKnownBalance } from "./lib/history";
import { ADDR, chain, makeSmartClient, publicClient, registryAbi, usdcAbi, type SmartClient } from "./lib/web3";

type Call = { to: Address; data: Hex };

type Wallet = {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  address?: Address;
  name: string;
  balance: bigint;
  /** True once name/balance have been read for the current account. */
  loaded: boolean;
  refresh: () => Promise<bigint>;
  /** Sends calls as one UserOperation, gas paid in USDC. Returns tx hash. */
  exec: (calls: Call[]) => Promise<Hex>;
};

const Ctx = createContext<Wallet | null>(null);

const readAccount = (a: Address) =>
  Promise.all([
    publicClient.readContract({ address: ADDR.usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] }),
    publicClient.readContract({ address: ADDR.registry, abi: registryAbi, functionName: "nameOf", args: [a] }),
  ]);

export function useWallet() {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet outside Providers");
  return w;
}

function WalletState({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const [client, setClient] = useState<SmartClient>();
  const [name, setName] = useState("");
  const [balance, setBalance] = useState(BigInt(0));
  const [loaded, setLoaded] = useState(false);

  const embedded = wallets.find((w) => w.walletClientType === "privy");

  // The app is in Privy's server-wallet mode, so createOnLogin does not fire: create the embedded wallet explicitly.
  useEffect(() => {
    if (!authenticated || !walletsReady || embedded || creating.current) return;
    creating.current = true;
    createWallet()
      .catch((e) => console.error("[pay] createWallet failed:", e))
      .finally(() => {
        creating.current = false;
      });
  }, [authenticated, walletsReady, embedded, createWallet]);

  useEffect(() => {
    if (!authenticated || !embedded) return;
    let live = true;
    (async () => {
      await embedded.switchChain(chain.id);
      const owner = createWalletClient({
        account: embedded.address as Address,
        chain,
        transport: custom(await embedded.getEthereumProvider()),
      });
      const c = await makeSmartClient(owner);
      if (live) setClient(c);
    })();
    return () => {
      live = false;
    };
  }, [authenticated, embedded]);

  const address = client?.account.address;

  const apply = useCallback(([bal, n]: [bigint, string]) => {
    setBalance(bal);
    setName(n);
    setLoaded(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return BigInt(0);
    const r = await readAccount(address);
    apply(r);
    return r[0];
  }, [address, apply]);

  useEffect(() => {
    if (!address) return;
    let live = true;
    readAccount(address).then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [address, apply]);

  const exec = useCallback(
    async (calls: Call[]) => {
      if (!client || !address) throw new Error("Wallet not ready");
      const allowance = await publicClient.readContract({
        address: ADDR.usdc,
        abi: usdcAbi,
        functionName: "allowance",
        args: [address, ADDR.paymaster],
      });
      // First op batches the paymaster approval so gas can be charged in USDC.
      const approve: Call[] =
        allowance < BigInt(1e6)
          ? [{ to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.paymaster, maxUint256] }) }]
          : [];
      const hash = await client.sendTransaction({ calls: [...approve, ...calls] });
      await publicClient.waitForTransactionReceipt({ hash });
      setKnownBalance(address, await refresh());
      return hash;
    },
    [client, address, refresh]
  );

  return (
    <Ctx.Provider
      value={{ ready: ready && (!authenticated || !!client), authenticated, login, logout, address, name, balance, loaded, refresh, exec }}
    >
      {children}
    </Ctx.Provider>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["google", "email"],
        defaultChain: chain,
        supportedChains: [chain],
        appearance: { theme: "light", accentColor: "#4c1d95" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
      }}
    >
      <WalletState>{children}</WalletState>
    </PrivyProvider>
  );
}
