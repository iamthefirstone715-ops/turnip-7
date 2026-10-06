"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLoginWithEmail, useLoginWithOAuth } from "@privy-io/react-auth";
import DotCanvas from "../components/DotCanvas";
import GlassCard from "../components/GlassCard";
import { useWallet } from "../providers";

export default function Auth() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const { authenticated, ready, loaded, name } = useWallet();
  const { initOAuth } = useLoginWithOAuth();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const codeSent = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const busy = state.status === "sending-code" || state.status === "submitting-code";

  useEffect(() => {
    if (authenticated && ready && loaded) router.replace(name ? "/dashboard" : "/claim-username");
  }, [authenticated, ready, loaded, name, router]);

  const onEmail = async () => {
    setError("");
    try {
      if (codeSent) await loginWithCode({ code });
      else await sendCode({ email });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <GlassCard>
        <div style={{ position: "relative", display: "flex", marginBottom: 24 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: "50%",
              borderRadius: 10,
              background: "#2e1065",
              transform: mode === "signup" ? "translateX(0)" : "translateX(100%)",
              transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
          {(["signup", "login"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                position: "relative",
                flex: 1,
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                background: "transparent",
                color: mode === m ? "#fff" : "#5b3fa3",
                transition: "color 0.3s ease",
              }}
            >
              {m === "signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>

        <button
          className="btn anim-fade-up"
          onClick={() => initOAuth({ provider: "google" })}
          style={{
            width: "100%",
            padding: "12px 0",
            marginBottom: 14,
            animationDelay: "0.15s",
            borderRadius: 10,
            border: "1px solid rgba(255, 255, 255, 0.4)",
            background: "rgba(255, 255, 255, 0.6)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
            color: "#1f1f1f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.95 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.16.27-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"
            />
          </svg>
          Continue with Google
        </button>

        <div
          className="anim-fade-up"
          style={{
            animationDelay: "0.25s",
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "4px 0 14px",
            color: "#5b3fa3",
            fontSize: 12,
          }}
        >
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.4)" }} />
          or
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.4)" }} />
        </div>

        <input
          key={codeSent ? "code" : "email"}
          type={codeSent ? "text" : "email"}
          inputMode={codeSent ? "numeric" : "email"}
          placeholder={codeSent ? `Code sent to ${email}` : "Email"}
          value={codeSent ? code : email}
          onChange={(e) => (codeSent ? setCode(e.target.value) : setEmail(e.target.value))}
          className="anim-fade-up"
          style={{
            animationDelay: "0.35s",
            width: "100%",
            padding: "12px 14px",
            marginBottom: 18,
            borderRadius: 10,
            border: "1px solid rgba(255, 255, 255, 0.4)",
            background: "rgba(255, 255, 255, 0.15)",
            color: "#3a2568",
            fontSize: 14,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {error && (
          <p className="anim-fade" style={{ margin: "-10px 0 12px", fontSize: 12, color: "#b42318" }}>
            {error}
          </p>
        )}

        <button
          className="btn anim-fade-up"
          disabled={busy || (codeSent ? code.length < 6 : !email.includes("@"))}
          onClick={onEmail}
          style={{
            animationDelay: "0.45s",
            opacity: busy ? 0.7 : 1,
            width: "100%",
            padding: "12px 0",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 15,
            color: "#fff",
            background: "linear-gradient(135deg, #4c1d95, #2e1065)",
          }}
        >
          {busy ? (
            <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
          ) : codeSent ? (
            "Verify code"
          ) : (
            "Continue with Email"
          )}
        </button>
      </GlassCard>
    </div>
  );
}
