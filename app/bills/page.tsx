"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, zeroAddress, type Hex } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import Confetti from "../components/Confetti";
import { useWallet } from "../providers";
import { addEntry, setKnownBalance, updateEntry } from "../lib/history";
import { ADDR, billPayAbi, chain, fmtUsd, orderIdOf, publicClient, registryAbi, cleanAmount, settlementOf, toUnits, usdcAbi } from "../lib/web3";
import { contactName, loadContacts, saveContact } from "../lib/contacts";
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

async function waitForSettlement(orderId: bigint): Promise<Result> {
  // ponytail: polls the order every 1.5s; switch to a websocket subscription if the RPC supports it
  for (;;) {
    const done = await settlementOf(orderId).catch(() => undefined); // a flaky RPC read just means "look again"
    if (done) return done;
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
  // Who it's for: a name you'll recognise ("mum") or a platform @username. Kept on this device, never put on-chain.
  const [forWho, setForWho] = useState("");
  const [remember, setRemember] = useState(true);
  const [version, setVersion] = useState(0);
  const [nameCheck, setNameCheck] = useState<{ key: string; exists: boolean }>({ key: "", exists: true });
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"form" | "paying" | "processing" | "done">("form");
  const [result, setResult] = useState<Result>();
  const [hash, setHash] = useState<Hex>();
  const [shown, setShown] = useState({ msg: "", key: "" });

  const contacts = useMemo(() => {
    void version; // re-read after a person is saved
    return address ? loadContacts(address) : [];
  }, [address, version]);
  const bill = CATEGORIES[category];
  const personKey = contactName(forWho); // "@tobi", "mum", or "" for yourself
  const handle = personKey.startsWith("@") ? personKey.slice(1) : "";
  const handleOk = /^[a-z0-9_]{3,20}$/.test(handle);
  const checking = handleOk && nameCheck.key !== handle;
  const noUser = handleOk && !checking && !nameCheck.exists;
  const nameValid = !personKey || (personKey.startsWith("@") ? handleOk && !checking && !noUser : /^[\p{L} ]{1,30}$/u.test(personKey));
  const savedContact = personKey ? contacts.find((c) => c.name === personKey && c.category === category) : undefined;
  const unchangedContact = !!savedContact && savedContact.provider === provider && savedContact.account === account && (category !== "electricity" || savedContact.plan === planCode);
  const providerName = bill.providers.find((p) => p.id === provider)?.name ?? "";
  const fetched = bill.plans === "fetch";
  const plans = fetched ? plansFor.list : (bill.staticPlans ?? []);
  const plansLoading = fetched && plansFor.key !== provider;
  const plan = plans.find((p) => p.code === planCode);
  // Data and TV plans have a fixed naira price, so the dollar amount follows the plan.
  const amountStr = fetched ? (plan ? usdForNgn(plan.ngn).toFixed(2) : "") : amount;
  // An error describes the form as it was submitted: once anything changes, it no longer applies.
  const formKey = [category, provider, planCode, account, amountStr, forWho].join("|");
  const error = shown.key === formKey ? shown.msg : "";
  const setError = (msg: string) => setShown({ msg, key: formKey });
  const canPay = !!account && Number(amountStr) > 0 && (!bill.plans || !!plan) && nameValid && stage === "form";

  useEffect(() => {
    if (!fetched) return;
    let live = true;
    fetch(`/api/plans?serviceID=${provider}`)
      .then((r) => r.json())
      .then((list) => live && setPlansFor({ key: provider, list: Array.isArray(list) ? list : [] }))
      .catch(() => live && setPlansFor({ key: provider, list: [] }));
    return () => {
      live = false;
    };
  }, [fetched, provider]);

  // For a platform @username, only check that the name exists (a typo guard). Nobody's details are ever looked up.
  useEffect(() => {
    if (!handleOk) return;
    let live = true;
    const t = setTimeout(() => {
      publicClient
        .readContract({ address: ADDR.registry, abi: registryAbi, functionName: "resolve", args: [handle] })
        .then((owner) => live && setNameCheck({ key: handle, exists: owner !== zeroAddress }))
        .catch(() => live && setNameCheck({ key: handle, exists: true }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [handle, handleOk]);

  // Copy a person you've saved into the form; returns whether there was one.
  const fillFrom = (name: string, cat: Category) => {
    const c = address ? loadContacts(address).find((x) => x.name === contactName(name) && x.category === cat) : undefined;
    if (!c) return false;
    setProvider(c.provider);
    if (cat === "electricity") setPlanCode(c.plan || "prepaid");
    setAccount(c.account);
    return true;
  };
  const resetDetails = (cat: Category) => {
    setProvider(CATEGORIES[cat].providers[0].id);
    setPlanCode(CATEGORIES[cat].staticPlans?.[0]?.code ?? "");
    setAccount("");
  };
  const onWho = (raw: string) => {
    const v = raw.slice(0, 30);
    setForWho(v);
    if (!fillFrom(v, category) && savedContact) resetDetails(category); // don't leave the previous person's number behind
  };

  const pickCategory = (c: Category) => {
    setCategory(c);
    resetDetails(c);
    fillFrom(forWho, c);
    setAmount("");
  };
  const pickProvider = (id: string) => {
    setProvider(id);
    setPlanCode(bill.plans === "static" ? (bill.staticPlans?.[0]?.code ?? "") : "");
  };

  const pay = async () => {
    setError("");
    const billType = encodeBill(category, provider, bill.plans ? planCode : undefined);
    const value = toUnits(amountStr);
    if (value > balance) return setError("Not enough balance");
    setStage("paying");
    try {
      const tx = await exec([
        {
          to: ADDR.usdc,
          // add to the existing approval: replacing it would silently cancel the room active schedules rely on
          data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.billPay, (await publicClient.readContract({ address: ADDR.usdc, abi: usdcAbi, functionName: "allowance", args: [address!, ADDR.billPay] })) + value] }),
        },
        {
          to: ADDR.billPay,
          data: encodeFunctionData({ abi: billPayAbi, functionName: "pay", args: [billType, account, value, ""] }), // who it's for is never published
        },
      ]);
      setHash(tx);
      if (remember && address && personKey) {
        saveContact(address, { name: personKey, category, provider, plan: category === "electricity" ? planCode : "", account });
        setVersion((v) => v + 1);
      }
      const title = `${providerName} ${bill.label}${personKey ? ` for ${personKey}` : ""}`;
      if (address) addEntry(address, { kind: "bill", title, amount: Number(value) / 1e6, status: "Processing", hash: tx });
      const orderId = await orderIdOf(tx);
      if (orderId === undefined) throw new Error("Order not found in receipt");
      setStage("processing");
      const res = await waitForSettlement(orderId);
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
                  ${amountStr} is held safely until the provider confirms. If it isn&apos;t delivered within an hour, you can take it back from your dashboard.
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
                      {personKey ? <>for <strong>{personKey}</strong> · </> : null}Reference <strong>{result.ref}</strong>
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
            For
          </span>
          <input
            value={forWho}
            onChange={(e) => onWho(e.target.value)}
            placeholder="yourself, or @username / a name like mum"
            style={{ ...input, width: "auto", flex: 1, minWidth: 0, margin: 0, border: "none", background: "transparent", paddingLeft: 8 }}
          />
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, minHeight: 16, lineHeight: 1.4, color: noUser || (personKey && !nameValid && !checking) ? "#b42318" : savedContact ? "#1a7f37" : "#5b3fa3", fontWeight: savedContact || noUser ? 600 : 400 }}>
          {!personKey
            ? "Leave empty to pay for yourself."
            : personKey.startsWith("@") && !handleOk
              ? "Usernames are 3 to 20 letters, numbers or _."
              : checking
                ? "Checking…"
                : noUser
                  ? `@${handle} doesn't exist.`
                  : !nameValid
                    ? "Names can use letters and spaces."
                    : savedContact
                      ? `Using your saved details for ${personKey}.`
                      : `Enter ${personKey}'s details once below. I'll remember them on this device, so next time the name is enough.`}
        </p>

        <select value={provider} onChange={(e) => pickProvider(e.target.value)} aria-label={bill.providerLabel} style={select}>
          {bill.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {bill.plans && (
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            aria-label="Plan"
            disabled={plansLoading}
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

        <input value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder={bill.field} style={input} />
        {personKey && nameValid && !unchangedContact && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#5b3fa3", margin: "0 0 12px", cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {savedContact ? `Update ${personKey}'s saved details` : `Remember ${personKey} for next time (this device only)`}
          </label>
        )}
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
              {personKey ? ` for ${personKey}` : ""}
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
