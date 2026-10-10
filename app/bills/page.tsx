"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, encodeFunctionData, zeroAddress, type Hex } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import Confetti from "../components/Confetti";
import { useWallet } from "../providers";
import { addEntry, setKnownBalance, updateEntry } from "../lib/history";
import { ADDR, billPayAbi, chain, fmtUsd, profileAbi, publicClient, registryAbi, cleanAmount, toUnits, usdcAbi } from "../lib/web3";
import { CATEGORIES, NGN_PER_USD, encodeBill, usdForNgn, type Category, type Plan } from "../lib/bills";

type Result = { status: "fulfilled"; ref: string } | { status: "refunded" };

const input: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  marginBottom: 12,
  borderRadius: 10,
  border: "1px solid rgba(76, 29, 149, 0.3)",
  background: "rgba(255, 255, 255, 0.65)",
  color: "#3a2568",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const select: CSSProperties = { ...input, cursor: "pointer", appearance: "auto" };

async function waitForSettlement(orderId: bigint, fromBlock: bigint): Promise<Result> {
  // ponytail: polls logs every 1.5s; switch to a websocket subscription if the RPC supports it
  for (;;) {
    const logs = await publicClient.getLogs({ address: ADDR.billPay, fromBlock, toBlock: "latest" });
    for (const log of logs) {
      try {
        const ev = decodeEventLog({ abi: billPayAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "BillFulfilled" && ev.args.orderId === orderId) return { status: "fulfilled", ref: ev.args.ref };
        if (ev.eventName === "BillRefunded" && ev.args.orderId === orderId) return { status: "refunded" };
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export default function Bills() {
  const router = useRouter();
  const { balance, address, refresh, exec } = useWallet();
  const [category, setCategory] = useState<Category>("airtime");
  const [provider, setProvider] = useState(CATEGORIES.airtime.providers[0].id);
  const [planCode, setPlanCode] = useState("");
  const [plansFor, setPlansFor] = useState<{ key: string; list: Plan[] }>({ key: "", list: [] });
  const [forWho, setForWho] = useState("");
  // What @forWho has published for this category: "no-user" (name doesn't exist), "empty", or "ok" with details.
  const [lookup, setLookup] = useState<{ key: string; status: "no-user" | "empty" | "ok"; detail?: { provider: string; plan: string; account: string } }>({
    key: "",
    status: "empty",
  });
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"form" | "paying" | "processing" | "done">("form");
  const [result, setResult] = useState<Result>();
  const [hash, setHash] = useState<Hex>();
  const [error, setError] = useState("");

  const bill = CATEGORIES[category];
  const lookupKey = `${forWho}:${category}`;
  const checking = forWho.length >= 3 && lookup.key !== lookupKey;
  const found = forWho.length >= 3 && !checking && lookup.status === "ok" ? lookup.detail : undefined;
  const noUser = !checking && forWho.length >= 3 && lookup.status === "no-user";
  // When @forWho has published details for this category, those win over what is typed here.
  const effProvider = found?.provider ?? provider;
  const effPlanCode = found?.plan ? found.plan : planCode;
  const effAccount = found?.account ?? account;
  const providerName = bill.providers.find((p) => p.id === effProvider)?.name ?? "";
  const fetched = bill.plans === "fetch";
  const plans = fetched ? plansFor.list : (bill.staticPlans ?? []);
  const plansLoading = fetched && plansFor.key !== effProvider;
  const plan = plans.find((p) => p.code === effPlanCode);
  // Data and TV plans have a fixed naira price, so the dollar amount follows the plan.
  const amountStr = fetched ? (plan ? usdForNgn(plan.ngn).toFixed(2) : "") : amount;
  const forWhoOk = !forWho || (forWho.length >= 3 && !checking && !noUser);
  const canPay = !!effAccount && Number(amountStr) > 0 && (!bill.plans || !!plan) && forWhoOk && stage === "form";

  useEffect(() => {
    if (!fetched) return;
    let live = true;
    fetch(`/api/plans?serviceID=${effProvider}`)
      .then((r) => r.json())
      .then((list) => live && setPlansFor({ key: effProvider, list: Array.isArray(list) ? list : [] }))
      .catch(() => live && setPlansFor({ key: effProvider, list: [] }));
    return () => {
      live = false;
    };
  }, [fetched, effProvider]);

  // Look @forWho up in the registry, then read what they saved for this category.
  useEffect(() => {
    if (forWho.length < 3) return;
    let live = true;
    const key = `${forWho}:${category}`;
    const t = setTimeout(async () => {
      try {
        const owner = await publicClient.readContract({ address: ADDR.registry, abi: registryAbi, functionName: "resolve", args: [forWho] });
        if (!live) return;
        if (owner === zeroAddress) return setLookup({ key, status: "no-user" });
        const d = await publicClient.readContract({ address: ADDR.profile, abi: profileAbi, functionName: "get", args: [owner, category] });
        if (!live) return;
        const usable = d.account && CATEGORIES[category].providers.some((p) => p.id === d.provider);
        setLookup(usable ? { key, status: "ok", detail: { provider: d.provider, plan: d.plan, account: d.account } } : { key, status: "empty" });
      } catch {
        if (live) setLookup({ key, status: "empty" });
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [forWho, category]);

  const pickCategory = (c: Category) => {
    setCategory(c);
    setProvider(CATEGORIES[c].providers[0].id);
    setPlanCode(CATEGORIES[c].staticPlans?.[0]?.code ?? "");
    setAmount("");
  };
  const pickProvider = (id: string) => {
    setProvider(id);
    setPlanCode(bill.plans === "static" ? (bill.staticPlans?.[0]?.code ?? "") : "");
  };

  const pay = async () => {
    setError("");
    const billType = encodeBill(category, effProvider, bill.plans ? effPlanCode : undefined);
    const value = toUnits(amountStr);
    if (value > balance) return setError("Not enough balance");
    setStage("paying");
    try {
      const tx = await exec([
        { to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.billPay, value] }) },
        {
          to: ADDR.billPay,
          data: encodeFunctionData({ abi: billPayAbi, functionName: "pay", args: [billType, effAccount, value, forWho] }),
        },
      ]);
      setHash(tx);
      const title = `${providerName} ${bill.label}${forWho ? ` for @${forWho}` : ""}`;
      if (address) addEntry(address, { kind: "bill", title, amount: Number(value) / 1e6, status: "Processing", hash: tx });
      const receipt = await publicClient.getTransactionReceipt({ hash: tx });
      let orderId: bigint | undefined;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: billPayAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "BillRequested") orderId = ev.args.orderId;
        } catch {}
      }
      if (orderId === undefined) throw new Error("Order not found in receipt");
      setStage("processing");
      const res = await waitForSettlement(orderId, receipt.blockNumber);
      if (address) {
        updateEntry(address, tx, res.status === "fulfilled" ? { status: "Paid", ref: res.ref } : { status: "Refunded" });
        setKnownBalance(address, await refresh()); // a refund is not "received funds"
      }
      setResult(res);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Payment failed");
      setStage("form");
    }
  };

  if (stage === "processing" || stage === "done") {
    const ok = result?.status === "fulfilled";
    return (
      <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
        <DotCanvas />
        <GlassCard>
          {stage === "done" && ok && <Confetti />}
          <div style={{ textAlign: "center" }}>
            {stage === "processing" ? (
              <>
                <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                <p style={{ margin: "16px 0 4px", fontWeight: 700, color: "#2e1065" }}>Paying {bill.label.toLowerCase()}…</p>
                <p style={{ margin: 0, fontSize: 13, color: "#5b3fa3" }}>
                  ${amountStr} is held safely until the provider confirms.
                </p>
              </>
            ) : (
              <>
                <div
                  className="anim-pop"
                  style={{
                    width: 64,
                    height: 64,
                    margin: "0 auto 16px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 30,
                    color: "#fff",
                    background: ok ? "linear-gradient(135deg, #22a04b, #1a7f37)" : "linear-gradient(135deg, #f59e0b, #b45309)",
                  }}
                >
                  {ok ? "✓" : "↺"}
                </div>
                <p
                  className="font-[family-name:var(--font-bebas-neue)] anim-fade-up"
                  style={{ margin: "0 0 6px", fontSize: 34, color: "#2e1065" }}
                >
                  {ok ? `${bill.label} paid` : `$${amountStr} refunded`}
                </p>
                <p className="anim-fade-up" style={{ margin: 0, fontSize: 13, color: "#5b3fa3", animationDelay: "0.1s" }}>
                  {ok ? (
                    <>
                      {forWho ? <>for <strong>@{forWho}</strong> · </> : null}Reference <strong>{result.ref}</strong>
                    </>
                  ) : (
                    "The provider couldn't complete it, so your money came back."
                  )}
                </p>
              </>
            )}
            {hash && (
              <a
                href={`${chain.blockExplorers?.default.url}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                style={{ display: "block", marginTop: 14, fontSize: 12, color: "#5b3fa3" }}
              >
                View receipt ↗
              </a>
            )}
            {stage === "done" && (
              <button
                className="btn"
                onClick={() => router.push("/dashboard")}
                style={{
                  marginTop: 18,
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                  color: "#fff",
                  background: "linear-gradient(135deg, #4c1d95, #2e1065)",
                }}
              >
                Done
              </button>
            )}
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <GlassCard>
        <h1 style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 700, color: "#2e1065", textAlign: "center" }}>
          Pay a bill
        </h1>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16 }}>
          {(Object.keys(CATEGORIES) as Category[]).map((id) => (
            <button
              key={id}
              onClick={() => pickCategory(id)}
              style={{
                padding: "8px 0",
                textAlign: "center",
                whiteSpace: "nowrap",
                borderRadius: 999,
                border: "1px solid rgba(76, 29, 149, 0.25)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                background: category === id ? "#2e1065" : "rgba(255,255,255,0.65)",
                color: category === id ? "#fff" : "#2e1065",
                transition: "background 0.2s ease, color 0.2s ease",
              }}
            >
              {CATEGORIES[id].label}
            </button>
          ))}
        </div>

        <div style={{ ...input, marginBottom: 6, display: "flex", alignItems: "center", padding: 0, overflow: "hidden" }}>
          <span style={{ padding: "12px 0 12px 14px", fontSize: 14, color: "#5b3fa3", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
            For @
          </span>
          <input
            value={forWho}
            onChange={(e) => setForWho(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="me (or a username)"
            style={{ ...input, width: "auto", flex: 1, minWidth: 0, margin: 0, border: "none", background: "transparent", paddingLeft: 4 }}
          />
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, minHeight: 16, lineHeight: 1.4, color: noUser ? "#b42318" : found ? "#1a7f37" : "#5b3fa3", fontWeight: found || noUser ? 600 : 400 }}>
          {forWho.length < 3
            ? forWho
              ? "Usernames are at least 3 characters."
              : "Leave empty to pay for yourself, or type a username to pay for them."
            : checking
              ? "Checking…"
              : noUser
                ? `@${forWho} doesn't exist.`
                : found
                  ? `Using @${forWho}'s saved ${bill.label.toLowerCase()} details.`
                  : `@${forWho} hasn't saved ${bill.label.toLowerCase()} details, so enter them below.`}
        </p>

        <select value={effProvider} onChange={(e) => pickProvider(e.target.value)} aria-label={bill.providerLabel} disabled={!!found} style={select}>
          {bill.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {bill.plans && (
          <select
            value={effPlanCode}
            onChange={(e) => setPlanCode(e.target.value)}
            aria-label="Plan"
            disabled={plansLoading || (bill.plans === "static" && !!found?.plan)}
            style={select}
          >
            <option value="" disabled>
              {plansLoading ? "Loading plans…" : plans.length ? "Choose a plan" : "No plans available"}
            </option>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <input
          value={effAccount}
          onChange={(e) => setAccount(e.target.value.trim())}
          readOnly={!!found}
          placeholder={bill.field}
          style={found ? { ...input, background: "rgba(255, 255, 255, 0.4)" } : input}
        />
        {fetched ? (
          plan && (
            <p className="anim-fade" style={{ margin: "0 0 12px", fontSize: 13, color: "#2e1065", fontWeight: 600 }}>
              You pay ${amountStr}{" "}
              <span style={{ fontWeight: 400, color: "#5b3fa3" }}>
                (₦{plan.ngn.toLocaleString()} at ₦{NGN_PER_USD.toLocaleString()} per $1)
              </span>
            </p>
          )
        ) : (
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(cleanAmount(e.target.value))}
            placeholder="Amount in $"
            style={input}
          />
        )}

        <p style={{ margin: "0 0 16px", fontSize: 12, color: "#5b3fa3" }}>
          Balance: <strong>{fmtUsd(balance)}</strong> · refunded automatically if it fails
        </p>
        {error && <p style={{ margin: "-8px 0 14px", fontSize: 12, color: "#b42318" }}>{error}</p>}

        <button
          className="btn"
          disabled={!canPay}
          onClick={pay}
          style={{
            width: "100%",
            padding: "12px 0",
            marginBottom: 10,
            borderRadius: 10,
            border: "none",
            cursor: canPay ? "pointer" : "not-allowed",
            opacity: canPay || stage === "paying" ? 1 : 0.65,
            fontWeight: 600,
            fontSize: 15,
            color: "#fff",
            background: "linear-gradient(135deg, #4c1d95, #2e1065)",
          }}
        >
          {stage === "paying" ? (
            <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
          ) : (
            <>
              Pay{amountStr ? ` $${amountStr}` : ""}
              {forWho ? ` for @${forWho}` : ""}
            </>
          )}
        </button>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            width: "100%",
            padding: "10px 0",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
            color: "#5b3fa3",
          }}
        >
          Cancel
        </button>
      </GlassCard>
    </div>
  );
}
