"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, encodeFunctionData, type Hex } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import Confetti from "../components/Confetti";
import { useWallet } from "../providers";
import { addEntry, setKnownBalance, updateEntry } from "../lib/history";
import { ADDR, billPayAbi, chain, fmtUsd, publicClient, toUnits, usdcAbi } from "../lib/web3";

const BILLS = [
  { id: "airtime", label: "Airtime", field: "Phone number" },
  { id: "data", label: "Data", field: "Phone number" },
  { id: "electricity", label: "Electricity", field: "Meter number" },
  { id: "tv", label: "TV", field: "Smartcard number" },
  { id: "giftcard", label: "Gift card", field: "Email for delivery" },
] as const;

type Result = { status: "fulfilled"; ref: string } | { status: "refunded" };

const input: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  marginBottom: 12,
  borderRadius: 10,
  border: "1px solid rgba(255, 255, 255, 0.4)",
  background: "rgba(255, 255, 255, 0.15)",
  color: "#3a2568",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

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
  const [type, setType] = useState<(typeof BILLS)[number]["id"]>("airtime");
  const [forWho, setForWho] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"form" | "paying" | "processing" | "done">("form");
  const [result, setResult] = useState<Result>();
  const [hash, setHash] = useState<Hex>();
  const [error, setError] = useState("");

  const bill = BILLS.find((b) => b.id === type)!;
  const canPay = !!account && Number(amount) > 0 && stage === "form";

  const pay = async () => {
    setError("");
    const value = toUnits(amount);
    if (value > balance) return setError("Not enough balance");
    setStage("paying");
    try {
      const tx = await exec([
        { to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.billPay, value] }) },
        {
          to: ADDR.billPay,
          data: encodeFunctionData({ abi: billPayAbi, functionName: "pay", args: [type, account, value, forWho] }),
        },
      ]);
      setHash(tx);
      const title = `${bill.label}${forWho ? ` for @${forWho}` : ""}`;
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
                  ${amount} is held safely until the provider confirms.
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
                  {ok ? `${bill.label} paid` : `$${amount} refunded`}
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          {BILLS.map((b) => (
            <button
              key={b.id}
              onClick={() => setType(b.id)}
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.5)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                background: type === b.id ? "#2e1065" : "rgba(255,255,255,0.25)",
                color: type === b.id ? "#fff" : "#2e1065",
                transition: "background 0.2s ease, color 0.2s ease",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div style={{ ...input, display: "flex", alignItems: "center", padding: 0, overflow: "hidden" }}>
          <span style={{ padding: "12px 0 12px 14px", fontSize: 14, color: "#5b3fa3", fontWeight: 600 }}>For @</span>
          <input
            value={forWho}
            onChange={(e) => setForWho(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="me (or a username)"
            style={{ ...input, margin: 0, border: "none", background: "transparent", paddingLeft: 4 }}
          />
        </div>
        <input value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder={bill.field} style={input} />
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount in $"
          style={input}
        />

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
            opacity: canPay || stage === "paying" ? 1 : 0.5,
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
              Pay{amount ? ` $${amount}` : ""}
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
