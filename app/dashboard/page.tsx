"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import DotCanvas from "../components/DotCanvas";
import { useWallet } from "../providers";
import { loadHistory, syncReceived, type Entry } from "../lib/history";

const cardStyle: CSSProperties = {
  width: 480,
  padding: "24px 28px",
  borderRadius: 16,
  background: "rgba(236, 224, 255, 0.55)",
  border: "1px solid rgba(255, 255, 255, 0.4)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
  boxShadow: "0 20px 50px rgba(122, 60, 220, 0.2)",
  fontFamily: "system-ui, sans-serif",
};

function useCountUp(target: number, ms = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: 11,
  letterSpacing: 1,
  fontWeight: 700,
  color: "rgba(46, 16, 101, 0.5)",
  textTransform: "uppercase",
};

export default function Dashboard() {
  const [selected, setSelected] = useState<Entry | null>(null);
  const router = useRouter();
  const {
    authenticated,
    ready,
    loaded,
    name,
    balance: bal,
    address,
    logout,
  } = useWallet();
  const balance = useCountUp(Number(bal) / 1e6);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/auth");
    else if (loaded && !name) router.replace("/claim-username");
  }, [ready, authenticated, loaded, name, router]);

  // syncReceived is idempotent (it stores the balance it saw), so re-running on strict-mode double render is safe.
  const entries = useMemo<Entry[]>(() => {
    if (!address || !loaded) return [];
    syncReceived(address, bal);
    return loadHistory(address);
  }, [address, loaded, bal]);

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DotCanvas />
      <div
        style={{
          position: "absolute",
          top: 80,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div className="anim-fade-up" style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingBottom: 16,
              marginBottom: 16,
              borderBottom: "1px dashed rgba(46, 16, 101, 0.3)",
            }}
          >
            <span
              className="font-[family-name:var(--font-bebas-neue)]"
              style={{ fontSize: 18, letterSpacing: 2, color: "#2e1065" }}
            >
              PAY
            </span>
            <span style={{ display: "flex", gap: 14 }}>
              <button
                onClick={copyAddress}
                title="Copy wallet address to add testnet USDC"
                style={{
                  ...linkBtn,
                  color: copied ? "#1a7f37" : "rgba(46, 16, 101, 0.5)",
                }}
              >
                {copied ? "Copied" : "Add funds"}
              </button>
              <button
                onClick={() => logout().then(() => router.replace("/"))}
                style={linkBtn}
              >
                Log out
              </button>
            </span>
          </div>

          <p
            className="font-[family-name:var(--font-bebas-neue)]"
            style={{
              margin: "0 0 20px",
              fontSize: 44,
              letterSpacing: 1,
            }}
          >
            <span className="shimmer-text">@{name || "…"}</span>
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: 16,
              borderTop: "1px dashed rgba(46, 16, 101, 0.3)",
            }}
          >
            <span
              className="font-[family-name:var(--font-bebas-neue)]"
              style={{
                fontSize: 22,
                color: "#2e1065",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ${balance.toFixed(2)}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={() => router.push("/bills")}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "1px solid rgba(46, 16, 101, 0.25)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                  color: "#2e1065",
                  background: "rgba(255, 255, 255, 0.5)",
                }}
              >
                Pay bills
              </button>
              <button
                className="btn anim-glow"
                onClick={() => router.push("/send")}
                style={{
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
                Send
              </button>
            </span>
          </div>
        </div>

        <div
          className="anim-fade-up"
          style={{ ...cardStyle, animationDelay: "0.15s" }}
        >
          <span
            className="font-[family-name:var(--font-bebas-neue)]"
            style={{
              display: "block",
              fontSize: 18,
              letterSpacing: 2,
              color: "#2e1065",
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: "1px dashed rgba(46, 16, 101, 0.3)",
            }}
          >
            TRANSACTIONS
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {entries.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, color: "rgba(46, 16, 101, 0.55)" }}>No activity yet.</p>
            )}
            {entries.map((a, i) => (
              <div
                key={a.id}
                className="row-hover anim-fade-up"
                onClick={() => setSelected(a)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  padding: "8px 10px",
                  margin: "0 -10px",
                  animationDelay: `${0.35 + i * 0.08}s`,
                }}
              >
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#2e1065",
                    }}
                  >
                    {a.title}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "rgba(46, 16, 101, 0.55)",
                    }}
                  >
                    {new Date(a.ts).toLocaleDateString()} · {a.status}
                  </p>
                </div>
                <span
                  className="font-[family-name:var(--font-bebas-neue)]"
                  style={{
                    fontSize: 18,
                    letterSpacing: 0.5,
                    color: a.kind === "received" ? "#1a7f37" : "#2e1065",
                  }}
                >
                  {a.kind === "received" ? "+" : "-"}${a.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div
          className="anim-fade"
          onClick={() => setSelected(null)}
          style={{
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            position: "fixed",
            inset: 0,
            background: "rgba(46, 16, 101, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          <div
            className="anim-pop"
            onClick={(e) => e.stopPropagation()}
            style={{
              ...cardStyle,
              width: 340,
              background: "#ece0ff",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
            }}
          >
            <span
              className="font-[family-name:var(--font-bebas-neue)]"
              style={{
                display: "block",
                fontSize: 18,
                letterSpacing: 2,
                color: "#2e1065",
                marginBottom: 16,
                paddingBottom: 16,
                borderBottom: "1px dashed rgba(46, 16, 101, 0.3)",
              }}
            >
              TRANSACTION
            </span>

            <p
              className="font-[family-name:var(--font-bebas-neue)]"
              style={{
                margin: "0 0 4px",
                fontSize: 36,
                color: selected.kind === "received" ? "#1a7f37" : "#2e1065",
              }}
            >
              {selected.kind === "received" ? "+" : "-"}${selected.amount.toFixed(2)}
            </p>
            <p
              style={{
                margin: "0 0 20px",
                fontSize: 13,
                color: "rgba(46, 16, 101, 0.55)",
              }}
            >
              {selected.title}
            </p>

            {[
              ["Date", new Date(selected.ts).toLocaleString()],
              ["Status", selected.status],
              ...(selected.ref ? [["Reference", selected.ref]] : []),
              ...(selected.hash ? [["Tx", `${selected.hash.slice(0, 10)}…`]] : []),
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderTop: "1px dashed rgba(46, 16, 101, 0.2)",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "rgba(46, 16, 101, 0.55)" }}>
                  {label}
                </span>
                <span style={{ color: "#2e1065", fontWeight: 600 }}>
                  {value}
                </span>
              </div>
            ))}

            <button
              onClick={() => setSelected(null)}
              style={{
                width: "100%",
                marginTop: 20,
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                color: "#fff",
                background: "linear-gradient(135deg, #4c1d95, #2e1065)",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
