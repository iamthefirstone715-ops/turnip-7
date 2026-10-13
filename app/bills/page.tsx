"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { zeroAddress, type Hex } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import Confetti from "../components/Confetti";
import { CATEGORY_ICON, Icon, IconTile, Label, panel, Steps, type Step } from "../components/Kit";
import { primaryBtn } from "../lib/ui";
import { useWallet } from "../providers";
import { setKnownBalance } from "../lib/history";
import { payBill, waitForSettlement } from "../lib/actions";
import { ADDR, chain, fmtUsd, publicClient, registryAbi, cleanAmount, toUnits } from "../lib/web3";
import { contactName, loadContacts } from "../lib/contacts";
import { CATEGORIES, NGN_PER_USD, usdForNgn, type Category, type Plan } from "../lib/bills";

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

export default function Bills() {
  const router = useRouter();
  const { balance, address, name, refresh, exec } = useWallet();
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
    if (toUnits(amountStr) > balance) return setError("Not enough balance");
    if (!address) return;
    setStage("paying");
    try {
      const { tx, orderId } = await payBill(
        { address, name, balance, exec },
        { category, provider, plan: bill.plans ? planCode : "", account, amount: amountStr, person: personKey, remember },
      );
      setHash(tx);
      setVersion((v) => v + 1); // a remembered person shows up next time
      setStage("processing");
      const res = await waitForSettlement(address, tx, orderId);
      setKnownBalance(address, await refresh()); // a refund is not "received funds"
      setResult(res);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Payment failed");
      setStage("form");
    }
  };

  const receiptLink = hash && (
    <a href={`${chain.blockExplorers?.default.url}/tx/${hash}`} target="_blank" rel="noreferrer" style={{ color: "#5b3fa3", fontWeight: 600 }}>
      View receipt ↗
    </a>
  );

  if (stage === "processing" || stage === "done") {
    const ok = stage === "done" && result?.status === "fulfilled";
    const back = stage === "done" && !ok;
    const usd = Number(amountStr).toFixed(2);
    const steps: Step[] = [
      { label: "Held in escrow", detail: <>${usd} is locked in the contract, not sent to us. {receiptLink}</>, state: "done" },
      {
        label: back ? "Provider couldn't deliver" : stage === "processing" ? "Provider delivering…" : "Provider delivered",
        detail: stage === "processing" ? "The worker is buying it from the provider right now." : back ? "So nothing was bought." : undefined,
        state: stage === "processing" ? "active" : ok ? "done" : "back",
      },
      {
        label: ok ? "Escrow paid out" : back ? "Refunded to you" : "Paid out only on delivery",
        detail:
          ok && result?.status === "fulfilled" ? (
            <>
              Reference{" "}
              <code style={{ display: "inline-block", marginTop: 4, padding: "3px 8px", borderRadius: 8, background: "rgba(46, 16, 101, 0.08)", color: "#2e1065", fontSize: 12, fontWeight: 700 }}>{result.ref}</code>
            </>
          ) : back ? (
            "The money is back in your balance."
          ) : (
            "Not delivered within an hour? Take it back from your dashboard."
          ),
        state: stage === "processing" ? "todo" : ok ? "done" : "back",
      },
    ];
    return (
      <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
        <DotCanvas />
        <GlassCard width={400}>
          {ok && <Confetti />}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
            <IconTile name={CATEGORY_ICON[category]} tone={ok ? "good" : back ? "back" : "wait"} size={48} />
            <div style={{ minWidth: 0 }}>
              <p className="font-[family-name:var(--font-bebas-neue)]" style={{ margin: 0, fontSize: 32, lineHeight: 1, color: "#2e1065" }}>
                {ok ? `${bill.label} paid` : back ? `$${usd} refunded` : `$${usd} ${bill.label.toLowerCase()}`}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#5b3fa3" }}>
                {providerName}
                {personKey ? (
                  <>
                    {" "}
                    · for <strong>{personKey}</strong>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <Steps steps={steps} />
          {stage === "done" && (
            <button className="btn anim-fade-up" onClick={() => router.push("/dashboard")} style={{ ...primaryBtn, marginTop: 22, animationDelay: "0.4s" }}>
              Done
            </button>
          )}
        </GlassCard>
      </div>
    );
  }

  const naira = Number(amountStr) > 0 ? Math.round(Number(amountStr) * NGN_PER_USD).toLocaleString() : "";

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <GlassCard width={420}>
        <h1 className="font-[family-name:var(--font-bebas-neue)]" style={{ margin: "0 0 16px", fontSize: 30, fontWeight: 400, letterSpacing: 1, color: "#2e1065", textAlign: "center" }}>
          Pay a bill
        </h1>

        <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
          {(Object.keys(CATEGORIES) as Category[]).map((id) => {
            const on = category === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={on}
                onClick={() => pickCategory(id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "10px 0 8px",
                  borderRadius: 14,
                  border: `1px solid ${on ? "#2e1065" : "rgba(76, 29, 149, 0.2)"}`,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  background: on ? "linear-gradient(135deg, #4c1d95, #2e1065)" : "rgba(255,255,255,0.55)",
                  color: on ? "#fff" : "#2e1065",
                  boxShadow: on ? "0 8px 18px rgba(76, 29, 149, 0.28)" : "none",
                  transition: "background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease",
                }}
              >
                <Icon name={CATEGORY_ICON[id]} size={18} />
                {CATEGORIES[id].label}
              </button>
            );
          })}
        </div>

        <Label htmlFor="who">Who it&apos;s for</Label>
        <div style={{ ...input, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, padding: "0 0 0 12px" }}>
          <Icon name="user" size={16} color="#5b3fa3" />
          <input
            id="who"
            value={forWho}
            onChange={(e) => onWho(e.target.value)}
            placeholder="Yourself, @username, or a name like mum"
            style={{ ...input, width: "auto", flex: 1, minWidth: 0, margin: 0, border: "none", background: "transparent", paddingLeft: 0 }}
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
                      : `Enter ${personKey}'s details once. Next time the name is enough.`}
        </p>

        <div style={panel}>
          <div style={{ display: "grid", gridTemplateColumns: bill.plans ? "1fr 1fr" : "1fr", gap: 8 }}>
            <div>
              <Label htmlFor="provider">{bill.providerLabel}</Label>
              <select id="provider" value={provider} onChange={(e) => pickProvider(e.target.value)} style={select}>
                {bill.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {bill.plans && (
              <div>
                <Label htmlFor="plan">{category === "electricity" ? "Meter type" : "Plan"}</Label>
                <select id="plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)} disabled={plansLoading} style={select}>
                  <option value="" disabled>
                    {plansLoading ? "Loading plans…" : plans.length ? "Choose a plan" : "No plans available"}
                  </option>
                  {plans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <Label htmlFor="account">{bill.field}</Label>
          <input id="account" value={account} onChange={(e) => setAccount(e.target.value.trim())} inputMode="numeric" placeholder={category === "electricity" ? "13 digits" : "080…"} style={input} />
          {personKey && nameValid && !unchangedContact && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 600, color: "#2e1065", margin: "0 0 10px", cursor: "pointer" }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "#4c1d95", width: 16, height: 16 }} />
              {savedContact ? `Update ${personKey}'s saved details` : `Remember ${personKey} on this device`}
            </label>
          )}
        </div>

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
          <>
            <Label htmlFor="amount" aside={naira && `≈ ₦${naira}`}>
              Amount
            </Label>
            <div style={{ ...input, display: "flex", alignItems: "center", padding: "0 0 0 14px" }}>
              <span className="font-[family-name:var(--font-bebas-neue)]" style={{ fontSize: 26, color: "#5b3fa3" }}>
                $
              </span>
              <input
                id="amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
                placeholder="0.00"
                className="font-[family-name:var(--font-bebas-neue)]"
                style={{ ...input, margin: 0, border: "none", background: "transparent", fontSize: 26, padding: "6px 8px", letterSpacing: 0.5 }}
              />
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "0 0 14px", fontSize: 12, color: "#5b3fa3" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={14} /> Held in escrow until delivered
          </span>
          <span>
            Balance <strong style={{ color: "#2e1065" }}>{fmtUsd(balance)}</strong>
          </span>
        </div>
        {error && <p style={{ margin: "-6px 0 12px", fontSize: 12, color: "#b42318" }}>{error}</p>}

        <button
          className="btn"
          disabled={!canPay}
          onClick={pay}
          style={{ ...primaryBtn, marginBottom: 6, cursor: canPay ? "pointer" : "not-allowed", opacity: canPay || stage === "paying" ? 1 : 0.6 }}
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
        <button onClick={() => router.push("/dashboard")} style={{ width: "100%", padding: "10px 0", border: "none", background: "transparent", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#5b3fa3" }}>
          Cancel
        </button>
      </GlassCard>
    </div>
  );
}
