"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Hex } from "viem";
import DotCanvas from "./DotCanvas";
import { CATEGORY_ICON, Icon, IconTile, Label, Steps, type Step } from "./Kit";
import { useWallet } from "../providers";
import { chain, cleanAmount, fmtUsd, type Settlement } from "../lib/web3";
import { CATEGORIES } from "../lib/bills";
import { contactName, loadContacts } from "../lib/contacts";
import { setKnownBalance } from "../lib/history";
import { intervalSeconds, type Intent, type Interval, type Proposal } from "../lib/schedule";
import { payBill, sendMoney, startSchedule, waitForSettlement, type Me } from "../lib/actions";
import { field, primaryBtn, select } from "../lib/ui";

type Msg = { id: number; from: "you" | "klink"; text?: string; intent?: Intent };

const bubble = (you: boolean): CSSProperties => ({
  maxWidth: "78%",
  padding: "10px 14px",
  borderRadius: you ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
  background: you ? "linear-gradient(135deg, #5b21b6, #2e1065)" : "rgba(255, 255, 255, 0.72)",
  color: you ? "#fff" : "#2e1065",
  fontSize: 14,
  lineHeight: 1.45,
  boxShadow: you ? "0 8px 20px rgba(76, 29, 149, 0.25)" : "0 4px 14px rgba(76, 29, 149, 0.08)",
});

const cardBox: CSSProperties = {
  flex: "0 1 360px",
  minWidth: 0,
  padding: 16,
  borderRadius: 18,
  background: "rgba(255, 255, 255, 0.78)",
  border: "1px solid rgba(255, 255, 255, 0.9)",
  boxShadow: "0 10px 30px rgba(76, 29, 149, 0.14)",
  color: "#2e1065",
};

const receipt = (tx?: Hex) =>
  tx && (
    <a href={`${chain.blockExplorers?.default.url}/tx/${tx}`} target="_blank" rel="noreferrer" style={{ color: "#5b3fa3", fontWeight: 700, fontSize: 12 }}>
      View receipt ↗
    </a>
  );

function Avatar() {
  return (
    <span
      className="font-[family-name:var(--font-bebas-neue)]"
      style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#fff", background: "linear-gradient(135deg, #7c3aed, #2e1065)" }}
    >
      K
    </span>
  );
}

function CardHead({ icon, title, sub }: { icon: Parameters<typeof IconTile>[0]["name"]; title: string; sub?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <IconTile name={icon} tone="muted" size={36} />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</p>
        {sub && <p style={{ margin: 0, fontSize: 12, color: "#5b3fa3" }}>{sub}</p>}
      </div>
    </div>
  );
}

const fail = (e: unknown, fallback: string) => (e instanceof Error ? e.message.split("\n")[0] : fallback);

function SendCard({ intent, me, onDone }: { intent: Extract<Intent, { kind: "send" }>; me: Me; onDone: () => void }) {
  const [to, setTo] = useState(intent.to);
  const [amount, setAmount] = useState(intent.amountUsd ? String(intent.amountUsd) : "");
  const [stage, setStage] = useState<"confirm" | "sending" | "done">("confirm");
  const [tx, setTx] = useState<Hex>();
  const [err, setErr] = useState("");
  const ok = /^[a-z0-9_]{3,20}$/.test(to) && Number(amount) > 0;

  const go = async () => {
    setErr("");
    setStage("sending");
    try {
      setTx(await sendMoney(me, to, amount));
      setStage("done");
      onDone();
    } catch (e) {
      setErr(fail(e, "Send failed"));
      setStage("confirm");
    }
  };

  if (stage === "done")
    return (
      <div style={cardBox} className="anim-pop">
        <CardHead icon="check" title={`Sent $${Number(amount).toFixed(2)} to @${to}`} sub={<>Fee paid in USDC · {receipt(tx)}</>} />
      </div>
    );
  return (
    <div style={cardBox} className="anim-fade-up">
      <CardHead icon="send" title="Send money" sub="Arrives in seconds. The fee comes out of your USDC." />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8 }}>
        <div>
          <Label htmlFor="c-to">To</Label>
          <div style={{ ...field, display: "flex", alignItems: "center", padding: "0 0 0 12px" }}>
            <span style={{ color: "#5b3fa3", fontWeight: 700 }}>@</span>
            <input id="c-to" value={to} onChange={(e) => setTo(e.target.value.replace(/^@/, "").toLowerCase())} style={{ ...field, margin: 0, border: "none", background: "transparent", paddingLeft: 2 }} />
          </div>
        </div>
        <div>
          <Label htmlFor="c-amt">Amount $</Label>
          <input id="c-amt" value={amount} inputMode="decimal" onChange={(e) => setAmount(cleanAmount(e.target.value))} style={field} />
        </div>
      </div>
      {err && <p style={{ margin: "0 0 10px", fontSize: 12, color: "#b42318" }}>{err}</p>}
      <button className="btn" disabled={!ok || stage === "sending"} onClick={go} style={{ ...primaryBtn, opacity: ok ? 1 : 0.6 }}>
        {stage === "sending" ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : `Send${Number(amount) > 0 ? ` $${Number(amount).toFixed(2)}` : ""} to @${to || "…"}`}
      </button>
    </div>
  );
}

const EVERY: Record<Interval, string> = { monthly: "Every month", weekly: "Every week", daily: "Every day", minutes: "Every few minutes (demo)" };

function PayCard({ intent, me, onDone }: { intent: Extract<Intent, { kind: "bill" | "schedule" }>; me: Me; onDone: () => void }) {
  const p: Proposal = intent.proposal;
  const scheduled = intent.kind === "schedule";
  const person = contactName(p.recipient);
  const saved = person ? loadContacts(me.address).find((c) => c.name === person && c.category === p.category) : undefined;
  const bill = CATEGORIES[p.category];

  const [provider, setProvider] = useState(p.provider || saved?.provider || "");
  const [meter, setMeter] = useState<string>(p.provider || !saved ? p.meterType : saved.plan || "prepaid");
  const [account, setAccount] = useState(p.account || saved?.account || "");
  const [amount, setAmount] = useState(p.amountUsd ? String(p.amountUsd) : "");
  const [interval, setIntervalKind] = useState<Interval>(p.interval);
  const [minutes, setMinutes] = useState(String(p.minutes));
  const [runs, setRuns] = useState(String(p.runs));
  const [remember, setRemember] = useState(true);
  const [stage, setStage] = useState<"confirm" | "paying" | "processing" | "done">("confirm");
  const [tx, setTx] = useState<Hex>();
  const [result, setResult] = useState<Settlement>();
  const [err, setErr] = useState("");

  const accountOk = p.category === "airtime" ? /^0\d{10}$/.test(account) : /^\d{5,20}$/.test(account);
  const runsNum = Number(runs);
  const ok = !!provider && accountOk && Number(amount) >= 0.05 && (!scheduled || (Number.isInteger(runsNum) && runsNum >= 1 && runsNum <= 60));
  const providerName = bill.providers.find((x) => x.id === provider)?.name ?? "";
  const usd = Number(amount || 0).toFixed(2);
  const input = { category: p.category, provider, plan: p.category === "electricity" ? meter : "", account, person, remember: remember && !!person };

  const go = async () => {
    setErr("");
    setStage("paying");
    try {
      if (scheduled) {
        setTx(await startSchedule(me, { ...input, perRun: amount, runs: runsNum, intervalSeconds: intervalSeconds(interval, Number(minutes)) }));
        setStage("done");
        onDone();
        return;
      }
      const opened = await payBill(me, { ...input, amount });
      setTx(opened.tx);
      setStage("processing");
      setResult(await waitForSettlement(me.address, opened.tx, opened.orderId));
      setStage("done");
      onDone();
    } catch (e) {
      setErr(fail(e, "Payment failed"));
      setStage("confirm");
    }
  };

  const who = person ? ` for ${person}` : "";
  const head = <CardHead icon={CATEGORY_ICON[p.category]} title={scheduled ? `Repeating ${bill.label.toLowerCase()}${who}` : `${bill.label}${who}`} sub={providerName || bill.providerLabel} />;

  if (scheduled && stage === "done")
    return (
      <div style={cardBox} className="anim-pop">
        <CardHead icon="repeat" title="Schedule started" sub={receipt(tx)} />
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          ${usd} {EVERY[interval].toLowerCase()}, {runsNum} times{who}. The first payment goes out in a few seconds and each one shows up in your activity. You approved ${(Number(amount) * runsNum).toFixed(2)} at most.
        </p>
      </div>
    );

  if (stage === "processing" || stage === "done") {
    const paid = stage === "done" && result?.status === "fulfilled";
    const back = stage === "done" && !paid;
    const steps: Step[] = [
      { label: "Held in escrow", detail: <>${usd} is locked in the contract, not sent to us. {receipt(tx)}</>, state: "done" },
      { label: back ? "Provider couldn't deliver" : stage === "processing" ? "Provider delivering…" : "Provider delivered", state: stage === "processing" ? "active" : paid ? "done" : "back" },
      {
        label: paid ? "Escrow paid out" : back ? "Refunded to you" : "Paid out only on delivery",
        detail:
          result?.status === "fulfilled" ? (
            <>
              Reference <code style={{ padding: "2px 6px", borderRadius: 6, background: "rgba(46,16,101,0.08)", fontWeight: 700 }}>{result.ref}</code>
            </>
          ) : back ? (
            "The money is back in your balance."
          ) : undefined,
        state: stage === "processing" ? "todo" : paid ? "done" : "back",
      },
    ];
    return (
      <div style={cardBox} className="anim-fade">
        {head}
        <Steps steps={steps} />
      </div>
    );
  }

  return (
    <div style={cardBox} className="anim-fade-up">
      {head}
      {saved && <p style={{ margin: "-4px 0 10px", fontSize: 12, fontWeight: 700, color: "#1a7f37" }}>Using your saved details for {person}.</p>}
      {person && !saved && <p style={{ margin: "-4px 0 10px", fontSize: 12, color: "#5b3fa3" }}>First time paying {person}: enter their details once.</p>}
      <div style={{ display: "grid", gridTemplateColumns: p.category === "electricity" ? "1fr 1fr" : "1fr", gap: 8 }}>
        <div>
          <Label htmlFor={`c-prov-${p.category}`}>{bill.providerLabel}</Label>
          <select id={`c-prov-${p.category}`} value={provider} onChange={(e) => setProvider(e.target.value)} style={select}>
            <option value="" disabled>
              Choose…
            </option>
            {bill.providers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        {p.category === "electricity" && (
          <div>
            <Label htmlFor="c-meter">Meter type</Label>
            <select id="c-meter" value={meter} onChange={(e) => setMeter(e.target.value)} style={select}>
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 8 }}>
        <div>
          <Label htmlFor="c-acct">{bill.field}</Label>
          <input id="c-acct" value={account} inputMode="numeric" onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} placeholder={p.category === "electricity" ? "13 digits" : "080…"} style={field} />
        </div>
        <div>
          <Label htmlFor="c-amount">{scheduled ? "Each $" : "Amount $"}</Label>
          <input id="c-amount" value={amount} inputMode="decimal" onChange={(e) => setAmount(cleanAmount(e.target.value))} style={field} />
        </div>
      </div>
      {scheduled && (
        <div style={{ display: "grid", gridTemplateColumns: interval === "minutes" ? "1.4fr 0.8fr 0.8fr" : "1.6fr 0.8fr", gap: 8 }}>
          <div>
            <Label htmlFor="c-every">How often</Label>
            <select id="c-every" value={interval} onChange={(e) => setIntervalKind(e.target.value as Interval)} style={select}>
              {(Object.keys(EVERY) as Interval[]).map((k) => (
                <option key={k} value={k}>
                  {EVERY[k]}
                </option>
              ))}
            </select>
          </div>
          {interval === "minutes" && (
            <div>
              <Label htmlFor="c-mins">Minutes</Label>
              <input id="c-mins" value={minutes} inputMode="numeric" onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 4))} style={field} />
            </div>
          )}
          <div>
            <Label htmlFor="c-runs">Times</Label>
            <input id="c-runs" value={runs} inputMode="numeric" onChange={(e) => setRuns(e.target.value.replace(/\D/g, "").slice(0, 2))} style={field} />
          </div>
        </div>
      )}
      {person && (!saved || saved.account !== account || saved.provider !== provider) && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 600, margin: "0 0 10px", cursor: "pointer" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "#4c1d95", width: 16, height: 16 }} />
          Remember {person} on this device
        </label>
      )}
      <p style={{ display: "flex", gap: 6, alignItems: "center", margin: "0 0 12px", fontSize: 12, color: "#5b3fa3" }}>
        <Icon name="shield" size={14} />
        {scheduled ? `You approve $${(Number(amount || 0) * (runsNum || 0)).toFixed(2)} at most. Cancel any time.` : "Held in escrow until delivered, refunded if not."}
      </p>
      {err && <p style={{ margin: "0 0 10px", fontSize: 12, color: "#b42318" }}>{err}</p>}
      <button className="btn" disabled={!ok || stage === "paying"} onClick={go} style={{ ...primaryBtn, opacity: ok ? 1 : 0.6 }}>
        {stage === "paying" ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : scheduled ? "Start schedule" : `Pay $${usd}${who}`}
      </button>
    </div>
  );
}

/** Chat view: say what you want, check a small card, confirm. Runs the same actions as the button screens. */
export default function Chat() {
  const { address, name, balance, exec, refresh, loaded } = useWallet();
  const { getAccessToken } = usePrivy();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const nextId = useRef(1);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, thinking]);

  const push = (m: Omit<Msg, "id">) => setMsgs((list) => [...list, { ...m, id: nextId.current++ }]);

  const ask = async (sentence: string) => {
    const t = sentence.trim();
    if (!t || thinking) return;
    setText("");
    push({ from: "you", text: t });
    setThinking(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: t, chat: true }),
      });
      const body = await res.json();
      if (!res.ok) push({ from: "klink", text: body.error ?? "Sorry, I didn't get that." });
      else {
        const intent = body.intent as Intent;
        push({ from: "klink", text: intent.kind === "send" ? "Here's the transfer. Check it and send:" : intent.kind === "bill" ? "Here's the bill. Check the details and pay:" : "Here's the repeating payment. Check it and start:" });
        push({ from: "klink", intent });
      }
    } catch {
      push({ from: "klink", text: "I can't reach the assistant right now. You can switch to Buttons and do it there." });
    } finally {
      setThinking(false);
    }
  };

  const me: Me | undefined = address ? { address, name, balance, exec } : undefined;
  const settled = () => {
    if (address) refresh().then((b) => setKnownBalance(address, b)); // our own payment is not "received funds"
  };

  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: -1 }}>
        <DotCanvas />
      </div>
      <div
        className="anim-fade-up chat-panel"
        style={{
          position: "absolute",
          left: "50%",
          translate: "-50% 0", // not `transform`: the entry animation owns transform and would knock the panel off-centre while it plays
          width: 620,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 24,
          background: "rgba(236, 224, 255, 0.55)",
          border: "1px solid rgba(255, 255, 255, 0.8)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          boxShadow: "0 24px 60px rgba(76, 29, 149, 0.22)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px dashed rgba(46, 16, 101, 0.25)" }}>
          <Avatar />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="font-[family-name:var(--font-bebas-neue)]" style={{ margin: 0, fontSize: 20, letterSpacing: 1.5, color: "#2e1065", lineHeight: 1 }}>
              KLINK
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#5b3fa3" }}>@{name || "…"}</p>
          </div>
          <span style={{ padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,0.7)", fontWeight: 800, fontSize: 14, color: "#2e1065" }}>{loaded ? fmtUsd(balance) : "…"}</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="anim-fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Avatar />
            <div style={bubble(false)}>
              Hi @{name || "there"}! I can <strong>send money</strong>, <strong>pay a bill</strong>, or set up a <strong>repeating payment</strong>. Just tell me in your own words. You don&apos;t need any crypto words: you hold dollars (USDC) and fees come out of them.
            </div>
          </div>
          {loaded && balance === BigInt(0) && address && (
            <div className="anim-fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end", animationDelay: "0.15s" }}>
              <Avatar />
              <div style={bubble(false)}>
                Your balance is <strong>$0.00</strong>. Add some testnet USDC first: copy your address, then paste it at the Circle faucet (choose <strong>Monad Testnet</strong>).
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(address).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      });
                    }}
                    style={{ padding: "8px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#fff", background: "linear-gradient(135deg, #4c1d95, #2e1065)" }}
                  >
                    {copied ? "Copied ✓" : "Copy my address"}
                  </button>
                  <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(76,29,149,0.3)", fontWeight: 700, fontSize: 13, color: "#2e1065", textDecoration: "none", background: "rgba(255,255,255,0.7)" }}>
                    Open the faucet ↗
                  </a>
                </div>
              </div>
            </div>
          )}
          {msgs.map((m) =>
            m.from === "you" ? (
              <div key={m.id} className="anim-fade-up" style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={bubble(true)}>{m.text}</div>
              </div>
            ) : (
              <div key={m.id} className="anim-fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                {m.intent ? <span style={{ width: 30, flexShrink: 0 }} /> : <Avatar />}
                {m.intent && me ? m.intent.kind === "send" ? <SendCard intent={m.intent} me={me} onDone={settled} /> : <PayCard intent={m.intent} me={me} onDone={settled} /> : <div style={bubble(false)}>{m.text}</div>}
              </div>
            ),
          )}
          {thinking && (
            <div className="anim-fade" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Avatar />
              <div style={{ ...bubble(false), display: "inline-flex", gap: 4 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="pulse-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#5b3fa3", animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={end} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
          style={{ display: "flex", gap: 8, padding: 14, borderTop: "1px dashed rgba(46, 16, 101, 0.25)", background: "rgba(255,255,255,0.35)" }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. pay my mum's electricity $5"
            maxLength={300}
            aria-label="Message"
            style={{ ...field, margin: 0, flex: 1, fontSize: 15, padding: "13px 16px", borderRadius: 14 }}
          />
          <button className="btn" type="submit" disabled={!text.trim() || thinking} aria-label="Send message" style={{ ...primaryBtn, width: 52, padding: 0, borderRadius: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: text.trim() && !thinking ? 1 : 0.6 }}>
            <Icon name="send" size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
