"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import { useWallet } from "../providers";
import { ADDR, profileAbi, publicClient } from "../lib/web3";
import { CATEGORIES, type Category } from "../lib/bills";

type Saved = { provider: string; plan: string; account: string };

const field: CSSProperties = {
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
const select: CSSProperties = { ...field, cursor: "pointer", appearance: "auto" };

export default function Profile() {
  const router = useRouter();
  const { address, authenticated, ready, exec } = useWallet();
  const [category, setCategory] = useState<Category>("airtime");
  const [provider, setProvider] = useState(CATEGORIES.airtime.providers[0].id);
  const [plan, setPlan] = useState("");
  const [account, setAccount] = useState("");
  const [saved, setSaved] = useState<{ key: string; detail?: Saved }>({ key: "" });
  const [busy, setBusy] = useState<"" | "save" | "remove">("");
  const [error, setError] = useState("");

  const bill = CATEGORIES[category];
  const key = `${address}:${category}`;
  const loading = !!address && saved.key !== key;
  const valid = /^\d{5,20}$/.test(account);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/auth");
  }, [ready, authenticated, router]);

  // Load what is already saved for this category and show it in the form.
  useEffect(() => {
    if (!address) return;
    let live = true;
    publicClient
      .readContract({ address: ADDR.profile, abi: profileAbi, functionName: "get", args: [address, category] })
      .then((d) => {
        if (!live) return;
        const detail = d.account ? { provider: d.provider, plan: d.plan, account: d.account } : undefined;
        setSaved({ key: `${address}:${category}`, detail });
        if (detail) {
          setProvider(detail.provider);
          setPlan(detail.plan);
          setAccount(detail.account);
        }
      })
      .catch(() => live && setSaved({ key: `${address}:${category}` }));
    return () => {
      live = false;
    };
  }, [address, category]);

  const pickCategory = (c: Category) => {
    setCategory(c);
    setProvider(CATEGORIES[c].providers[0].id);
    setPlan(CATEGORIES[c].staticPlans?.[0]?.code ?? "");
    setAccount("");
    setError("");
  };

  const run = async (kind: "save" | "remove") => {
    setError("");
    setBusy(kind);
    try {
      const data =
        kind === "save"
          ? encodeFunctionData({
              abi: profileAbi,
              functionName: "set",
              args: [category, provider, bill.plans === "static" ? plan : "", account],
            })
          : encodeFunctionData({ abi: profileAbi, functionName: "clear", args: [category] });
      await exec([{ to: ADDR.profile, data }]);
      if (kind === "save") setSaved({ key, detail: { provider, plan: bill.plans === "static" ? plan : "", account } });
      else {
        setSaved({ key });
        setAccount("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Something went wrong");
    } finally {
      setBusy("");
    }
  };

  const changed =
    !saved.detail ||
    saved.detail.provider !== provider ||
    saved.detail.account !== account ||
    saved.detail.plan !== (bill.plans === "static" ? plan : "");

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <GlassCard>
        <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#2e1065", textAlign: "center" }}>My bill details</h1>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: "#5b3fa3", textAlign: "center", lineHeight: 1.45 }}>
          Friends can pay these for you with your @name. Saved details are <strong>public on-chain</strong>, so don&apos;t save a number you want
          private.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16 }}>
          {(Object.keys(CATEGORIES) as Category[]).map((id) => (
            <button
              key={id}
              onClick={() => pickCategory(id)}
              style={{
                padding: "8px 0",
                borderRadius: 999,
                border: "1px solid rgba(76, 29, 149, 0.25)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                background: category === id ? "#2e1065" : "rgba(255,255,255,0.65)",
                color: category === id ? "#fff" : "#2e1065",
                transition: "background 0.2s ease, color 0.2s ease",
              }}
            >
              {CATEGORIES[id].label}
            </button>
          ))}
        </div>

        <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={bill.providerLabel} style={select} disabled={loading}>
          {bill.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {bill.plans === "static" && (
          <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Meter type" style={select} disabled={loading}>
            {bill.staticPlans?.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <input
          value={account}
          onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder={bill.field}
          style={field}
          disabled={loading}
        />

        <p style={{ margin: "0 0 14px", fontSize: 12, minHeight: 16, color: error ? "#b42318" : "#5b3fa3" }}>
          {error ||
            (loading ? "Loading…" : saved.detail ? "✓ Saved. Friends can pay this for you." : account && !valid ? "Digits only, 5 to 20 long." : "")}
        </p>

        <button
          className="btn"
          disabled={!valid || !changed || !!busy || loading}
          onClick={() => run("save")}
          style={{
            width: "100%",
            padding: "12px 0",
            marginBottom: 8,
            borderRadius: 10,
            border: "none",
            cursor: valid && changed && !busy ? "pointer" : "not-allowed",
            opacity: valid && changed ? 1 : 0.65,
            fontWeight: 600,
            fontSize: 15,
            color: "#fff",
            background: "linear-gradient(135deg, #4c1d95, #2e1065)",
          }}
        >
          {busy === "save" ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : "Save"}
        </button>
        {saved.detail && (
          <button
            onClick={() => run("remove")}
            disabled={!!busy}
            style={{ width: "100%", padding: "8px 0", border: "none", background: "transparent", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#b42318" }}
          >
            {busy === "remove" ? "Removing…" : "Remove these details"}
          </button>
        )}
        <button
          onClick={() => router.push("/dashboard")}
          style={{ width: "100%", padding: "8px 0", border: "none", background: "transparent", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#5b3fa3" }}
        >
          Back
        </button>
      </GlassCard>
    </div>
  );
}
