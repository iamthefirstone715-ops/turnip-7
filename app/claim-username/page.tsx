"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, zeroAddress } from "viem";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import Confetti from "../components/Confetti";
import { useWallet } from "../providers";
import { ADDR, publicClient, registryAbi } from "../lib/web3";

export default function ClaimUsername() {
  const [username, setUsername] = useState("");
  const [checked, setChecked] = useState({ name: "", free: false });
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { exec, address, balance, loaded } = useWallet();
  const [copied, setCopied] = useState(false);
  const needsFunds = loaded && balance < BigInt(50_000); // gas is paid in USDC, so claiming needs a little
  const valid = username.length >= 3 && username.length <= 20;
  const checking = valid && username !== checked.name;
  const available = valid && !checking && checked.free;

  useEffect(() => {
    if (username.length < 3) return;
    const id = setTimeout(async () => {
      const owner = await publicClient.readContract({
        address: ADDR.registry,
        abi: registryAbi,
        functionName: "resolve",
        args: [username],
      });
      setChecked({ name: username, free: owner === zeroAddress });
    }, 400);
    return () => clearTimeout(id);
  }, [username]);

  const ready = available && !claiming && !claimed;

  const claim = async () => {
    setError("");
    setClaiming(true);
    try {
      await exec([
        { to: ADDR.registry, data: encodeFunctionData({ abi: registryAbi, functionName: "register", args: [username] }) },
      ]);
      setClaimed(true);
      setTimeout(() => router.push("/dashboard"), 1300);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Claim failed");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <GlassCard>
        {claimed && <Confetti />}
        <h1
          className="anim-fade-up"
          style={{
            margin: "0 0 20px",
            fontSize: 20,
            fontWeight: 700,
            color: "#2e1065",
            textAlign: "center",
            animationDelay: "0.1s",
          }}
        >
          Claim your username
        </h1>

        <div
          className="anim-fade-up"
          style={{
            display: "flex",
            alignItems: "center",
            borderRadius: 10,
            border: "1px solid rgba(76, 29, 149, 0.3)",
            background: "rgba(255, 255, 255, 0.65)",
            marginBottom: 8,
            overflow: "hidden",
            animationDelay: "0.2s",
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
            value={username}
            disabled={claimed}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="yourname"
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
            minHeight: 16,
          }}
        >
          {error ? (
            <span style={{ color: "#b42318" }}>{error}</span>
          ) : !username ? null : !valid ? (
            <span>3–20 characters: a–z, 0–9, _</span>
          ) : checking ? (
            <span className="anim-fade">
              <span className="spinner" /> Checking availability…
            </span>
          ) : available ? (
            <span key={username} className="anim-pop" style={{ display: "inline-block", color: "#1a7f37", fontWeight: 600 }}>
              ✓ @{username} is available
            </span>
          ) : (
            <span style={{ color: "#b42318", fontWeight: 600 }}>@{username} is taken</span>
          )}
        </p>

        {needsFunds && address && (
          <div className="anim-fade" style={{ margin: "0 0 14px", fontSize: 12, color: "#5b3fa3", lineHeight: 1.5 }}>
            Add a little testnet USDC first (gas is paid in USDC).{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" style={{ color: "#2e1065", fontWeight: 600 }}>
              Circle faucet ↗
            </a>
            <button
              data-testid="wallet-address"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              style={{ display: "block", marginTop: 6, padding: 0, border: "none", background: "none", cursor: "pointer", fontFamily: "monospace", fontSize: 11, color: copied ? "#1a7f37" : "#3a2568", wordBreak: "break-all", textAlign: "left" }}
            >
              {copied ? "Copied" : address}
            </button>
          </div>
        )}

        <button
          className="btn anim-fade-up"
          disabled={!ready}
          onClick={claim}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 10,
            border: "none",
            cursor: ready ? "pointer" : claimed ? "default" : "not-allowed",
            fontWeight: 600,
            fontSize: 15,
            color: "#fff",
            opacity: ready || claimed ? 1 : 0.65,
            background: claimed
              ? "linear-gradient(135deg, #22a04b, #1a7f37)"
              : "linear-gradient(135deg, #4c1d95, #2e1065)",
            transition: "background 0.3s ease, opacity 0.3s ease",
            animationDelay: "0.3s",
          }}
        >
          {claimed ? (
            <span className="anim-pop" style={{ display: "inline-block" }}>
              ✓ @{username} is yours
            </span>
          ) : claiming ? (
            <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
          ) : (
            <>Claim @{username || "username"}</>
          )}
        </button>
      </GlassCard>
    </div>
  );
}
