"use client";

import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import DotCanvas from "./components/DotCanvas";

const features = [
  {
    title: "Just a username",
    desc: "No wallet addresses, no QR codes. Send to @someone and it lands in their account.",
  },
  {
    title: "No seed phrases",
    desc: "Sign up with Google or email. Your wallet is created and secured for you.",
  },
  {
    title: "Instant settlement",
    desc: "Payments confirm in seconds, onchain, with nothing for the sender to manage.",
  },
];

const pings = [
  { from: "mara", amount: "42.50" },
  { from: "delano", amount: "12.00" },
  { from: "juno", amount: "8.75" },
  { from: "priya", amount: "25.00" },
];

// Each word starts offset (x px, y px, rotation deg), drifts for a beat, then snaps into place.
const WORDS = [
  { text: "SEND", x: -160, y: -60, r: -10 },
  { text: "MONEY", x: 40, y: -110, r: 6 },
  { text: "TO", x: 170, y: -40, r: 10 },
  { text: "A", x: -90, y: 90, r: -8 },
  { text: "NAME,", x: 120, y: 80, r: 7, br: true },
  { text: "NOT", x: -140, y: 70, r: -9, shimmer: true },
  { text: "AN", x: 20, y: 110, r: 5, shimmer: true },
  { text: "ADDRESS.", x: 150, y: -70, r: 8, shimmer: true },
];

export default function Landing() {
  const router = useRouter();
  const [ping, setPing] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPing((p) => (p + 1) % pings.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", minHeight: "100vh" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: -1 }}>
        <DotCanvas />
      </div>

      <nav
        className="anim-fade"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px 40px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span
          className="font-[family-name:var(--font-bebas-neue)]"
          style={{ fontSize: 28, letterSpacing: 1, color: "#2e1065" }}
        >
          PAY
        </span>
        <button
          className="btn"
          onClick={() => router.push("/auth")}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: "1px solid rgba(255, 255, 255, 0.5)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
            color: "#2e1065",
            background: "rgba(255, 255, 255, 0.3)",
          }}
        >
          Log in
        </button>
      </nav>

      <div
        style={{
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "60px 24px 40px",
        }}
      >
        <div style={{ height: 44, marginBottom: 18, display: "flex", justifyContent: "center" }}>
          <div className="anim-float">
            <div
              key={ping}
              className="anim-pop"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.55)",
                border: "1px solid rgba(255, 255, 255, 0.7)",
                boxShadow: "0 8px 24px rgba(122, 60, 220, 0.18)",
                fontSize: 13,
                color: "#2e1065",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#1a7f37",
                  boxShadow: "0 0 0 3px rgba(26, 127, 55, 0.2)",
                }}
              />
              <strong>@{pings[ping].from}</strong> sent you
              <strong style={{ color: "#1a7f37" }}>${pings[ping].amount}</strong>
            </div>
          </div>
        </div>

        <h1
          className="font-[family-name:var(--font-bebas-neue)]"
          style={{
            margin: "0 0 18px",
            fontSize: 72,
            lineHeight: 1.05,
            color: "#2e1065",
            letterSpacing: 1,
          }}
        >
          {WORDS.map((w, i) => (
            <Fragment key={w.text}>
              <span
                className={`word${w.shimmer ? " shimmer-text" : ""}`}
                style={
                  {
                    "--x": `${w.x}px`,
                    "--y": `${w.y}px`,
                    "--r": `${w.r}deg`,
                    animationDelay: `${0.15 + i * 0.08}s`,
                  } as CSSProperties
                }
              >
                {w.text}
              </span>
              {w.br ? <br /> : " "}
            </Fragment>
          ))}
        </h1>
        <p
          className="anim-fade-up"
          style={{
            margin: "0 auto 32px",
            fontSize: 17,
            color: "#5b3fa3",
            maxWidth: 480,
            animationDelay: "1.5s",
          }}
        >
          Claim a username. Get paid instantly. No wallets, no seed phrases.
        </p>

        <div
          className="anim-fade-up"
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            animationDelay: "1.65s",
          }}
        >
          <button
            className="btn anim-glow"
            onClick={() => router.push("/auth")}
            style={{
              padding: "14px 28px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
              color: "#fff",
              background: "linear-gradient(135deg, #4c1d95, #2e1065)",
            }}
          >
            Get started
          </button>
          <button
            className="btn"
            onClick={() => router.push("/auth")}
            style={{
              padding: "14px 28px",
              borderRadius: 10,
              border: "1px solid rgba(255, 255, 255, 0.5)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
              color: "#2e1065",
              background: "rgba(255, 255, 255, 0.3)",
            }}
          >
            Log in
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 20,
          padding: "20px 40px 80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {features.map((f, i) => (
          <div
            key={f.title}
            className="anim-fade-up btn"
            style={{
              width: 260,
              padding: "24px 22px",
              borderRadius: 16,
              background: "rgba(255, 255, 255, 0.2)",
              border: "1px solid rgba(255, 255, 255, 0.4)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              animationDelay: `${1.8 + i * 0.12}s`,
            }}
          >
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: 16,
                fontWeight: 700,
                color: "#2e1065",
              }}
            >
              {f.title}
            </h3>
            <p style={{ margin: 0, fontSize: 13.5, color: "#5b3fa3", lineHeight: 1.5 }}>
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
