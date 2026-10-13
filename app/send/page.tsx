"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Hex } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import Confetti from "../components/Confetti";
import { useWallet } from "../providers";
import { sendMoney } from "../lib/actions";
import { chain, fmtUsd, cleanAmount } from "../lib/web3";

export default function Send() {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [shown, setShown] = useState({ msg: "", key: "" });
  // An error describes the form as it was submitted: once the name or amount changes, it no longer applies.
  const formKey = `${to}|${amount}`;
  const error = shown.key === formKey ? shown.msg : "";
  const setError = (msg: string) => setShown({ msg, key: formKey });
  const [hash, setHash] = useState<Hex>();
  const router = useRouter();
  const { balance, name, address, exec } = useWallet();

  const send = async () => {
    setError("");
    setStatus("sending");
    try {
      if (!address) return;
      const tx = await sendMoney({ address, name, balance, exec }, to, amount);
      setHash(tx);
      setStatus("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Send failed");
      setStatus("idle");
    }
  };

  if (status === "sent") {
    return (
      <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
        <DotCanvas />
        <GlassCard>
          <Confetti />
          <div style={{ textAlign: "center" }}>
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
                background: "linear-gradient(135deg, #22a04b, #1a7f37)",
                boxShadow: "0 10px 30px rgba(26, 127, 55, 0.35)",
              }}
            >
              ✓
            </div>
            <p
              className="font-[family-name:var(--font-bebas-neue)] anim-fade-up"
              style={{ margin: "0 0 6px", fontSize: 40, color: "#2e1065", animationDelay: "0.15s" }}
            >
              ${amount} SENT
            </p>
            <p
              className="anim-fade-up"
              style={{ margin: 0, fontSize: 14, color: "#5b3fa3", animationDelay: "0.25s" }}
            >
              to <strong>@{to}</strong>
            </p>
            {hash && (
              <a
                href={`${chain.blockExplorers?.default.url}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="anim-fade-up"
                style={{ display: "block", marginTop: 14, fontSize: 12, color: "#5b3fa3", animationDelay: "0.35s" }}
              >
                View receipt ↗
              </a>
            )}
            <button
              className="btn anim-fade-up"
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
                animationDelay: "0.45s",
              }}
            >
              Done
            </button>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <GlassCard>
        <h1
          style={{
            margin: "0 0 20px",
            fontSize: 20,
            fontWeight: 700,
            color: "#2e1065",
            textAlign: "center",
          }}
        >
          Send money
        </h1>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderRadius: 10,
            border: "1px solid rgba(76, 29, 149, 0.3)",
            background: "rgba(255, 255, 255, 0.65)",
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              padding: "12px 0 12px 14px",
              fontSize: 14,
              color: "#5b3fa3",
              fontWeight: 600,
            }}
          >
            @
          </span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="username"
            style={{
              flex: 1,
              padding: "12px 14px 12px 4px",
              border: "none",
              background: "transparent",
              color: "#3a2568",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderRadius: 10,
            border: "1px solid rgba(76, 29, 149, 0.3)",
            background: "rgba(255, 255, 255, 0.65)",
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              padding: "12px 0 12px 14px",
              fontSize: 14,
              color: "#5b3fa3",
              fontWeight: 600,
            }}
          >
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(cleanAmount(e.target.value))}
            placeholder="0.00"
            style={{
              flex: 1,
              padding: "12px 14px 12px 4px",
              border: "none",
              background: "transparent",
              color: "#3a2568",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <p
          style={{
            margin: "0 0 18px",
            fontSize: 12,
            color: "#5b3fa3",
          }}
        >
          Balance: <strong style={{ fontWeight: 700 }}>{fmtUsd(balance)}</strong> · fee paid in USDC
        </p>
        {error && <p style={{ margin: "-10px 0 14px", fontSize: 12, color: "#b42318" }}>{error}</p>}

        <button
          className="btn"
          disabled={!to || !amount || status === "sending"}
          onClick={send}
          style={{
            width: "100%",
            padding: "12px 0",
            marginBottom: 10,
            borderRadius: 10,
            border: "none",
            cursor: to && amount && status === "idle" ? "pointer" : "not-allowed",
            opacity: to && amount ? 1 : 0.65,
            fontWeight: 600,
            fontSize: 15,
            color: "#fff",
            background: "linear-gradient(135deg, #4c1d95, #2e1065)",
          }}
        >
          {status === "sending" ? (
            <span className="anim-fade">
              <span
                className="spinner"
                style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff", marginRight: 8 }}
              />
              Sending…
            </span>
          ) : (
            <>Send{amount ? ` $${amount}` : ""}{to ? ` to @${to}` : ""}</>
          )}
        </button>

        <button
          onClick={() => router.push("/dashboard")}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 10,
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
