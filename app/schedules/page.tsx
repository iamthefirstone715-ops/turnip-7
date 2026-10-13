"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { encodeFunctionData, zeroAddress } from "viem";
import DotCanvas from "../components/DotCanvas";
import { CATEGORY_ICON, Icon, IconTile, Label, Pill, panel } from "../components/Kit";
import { useWallet } from "../providers";
import { ADDR, cleanAmount, fmtUsd, publicClient, registryAbi, schedulerAbi, toUnits, usdcAbi } from "../lib/web3";
import { CATEGORIES, type Category } from "../lib/bills";
import { SCHEDULABLE, intervalSeconds, type Interval, type Proposal } from "../lib/schedule";
import { contactName, loadContacts, removeContact } from "../lib/contacts";
import { startSchedule } from "../lib/actions";
import { card, field, primaryBtn, select } from "../lib/ui";

type Row = { id: bigint; amount: bigint; interval: number; nextDue: number; runsLeft: number; billType: string; account: string; beneficiary: string };

const EXAMPLES = ["pay my mum's electricity $20 monthly", "send Tobi airtime $2 every week for 8 weeks", "send my brother airtime $1 every 2 minutes"];

const heading: CSSProperties = {
  display: "block",
  fontSize: 18,
  letterSpacing: 2,
  color: "#2e1065",
  marginBottom: 14,
  paddingBottom: 14,
  borderBottom: "1px dashed rgba(46, 16, 101, 0.3)",
};
const small: CSSProperties = { margin: "0 0 12px", fontSize: 12, lineHeight: 1.45, color: "#5b3fa3" };
const linkBtn: CSSProperties = { border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontWeight: 700, color: "rgba(46, 16, 101, 0.5)", textTransform: "uppercase" };

const every = (sec: number) => (sec === 2_592_000 ? "month" : sec === 604_800 ? "week" : sec === 86_400 ? "day" : sec % 60 === 0 ? `${sec / 60} min` : `${sec}s`);

function when(due: number, now: number) {
  const s = due - Math.floor(now / 1000);
  if (s <= 5) return "due now";
  if (s < 90) return `in ${s}s`;
  if (s < 5400) return `in ${Math.round(s / 60)} min`;
  if (s < 172_800) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86_400)} days`;
}

async function loadSchedules(owner: string): Promise<Row[]> {
  const next = await publicClient.readContract({ address: ADDR.scheduler, abi: schedulerAbi, functionName: "nextId" });
  const from = next > BigInt(60) ? next - BigInt(60) : BigInt(1);
  const ids: bigint[] = [];
  for (let id = from; id < next; id++) ids.push(id);
  const all = await Promise.all(ids.map((id) => publicClient.readContract({ address: ADDR.scheduler, abi: schedulerAbi, functionName: "get", args: [id] }).then((s) => ({ id, s }))));
  return all
    .filter(({ s }) => s.owner.toLowerCase() === owner.toLowerCase() && s.runsLeft > 0)
    .map(({ id, s }) => ({ id, amount: s.amount, interval: s.interval, nextDue: Number(s.nextDue), runsLeft: s.runsLeft, billType: s.billType, account: s.account, beneficiary: s.beneficiary }));
}

export default function Schedules() {
  const router = useRouter();
  const { address, authenticated, ready, balance, exec } = useWallet();
  const { getAccessToken } = usePrivy();

  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");

  const [category, setCategory] = useState<Category>("electricity");
  const [provider, setProvider] = useState("");
  const [meterType, setMeterType] = useState<"prepaid" | "postpaid">("prepaid");
  const [recipient, setRecipient] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setIntervalKind] = useState<Interval>("monthly");
  const [minutes, setMinutes] = useState("2");
  const [runs, setRuns] = useState("12");
  const [remember, setRemember] = useState(true);

  const [rows, setRows] = useState<Row[]>([]);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [nameCheck, setNameCheck] = useState<{ key: string; exists: boolean }>({ key: "", exists: true });

  // People whose details you've entered before. They live on this device only.
  const contacts = useMemo(() => {
    void version; // re-read after a person is saved or removed
    return address ? loadContacts(address) : [];
  }, [address, version]);
  const bill = CATEGORIES[category];
  const personKey = contactName(recipient); // "@tobi", "mum", or "" for yourself
  const handle = personKey.startsWith("@") ? personKey.slice(1) : "";
  const handleOk = /^[a-z0-9_]{3,20}$/.test(handle);
  const checking = handleOk && nameCheck.key !== handle;
  const noUser = handleOk && !checking && !nameCheck.exists;
  const nameValid = !personKey || (personKey.startsWith("@") ? handleOk && !checking && !noUser : /^[\p{L} ]{1,30}$/u.test(personKey));
  const savedContact = personKey ? contacts.find((c) => c.name === personKey && c.category === category) : undefined;

  const accountOk = category === "airtime" ? /^0\d{10}$/.test(account) : /^\d{5,20}$/.test(account);
  const amountNum = Number(amount);
  const runsNum = Number(runs);
  const minsNum = Number(minutes);
  const formOk =
    !!provider &&
    accountOk &&
    amountNum >= 0.05 &&
    Number.isInteger(runsNum) &&
    runsNum >= 1 &&
    runsNum <= 60 &&
    (interval !== "minutes" || (Number.isInteger(minsNum) && minsNum >= 1 && minsNum <= 1440)) &&
    nameValid;
  const total = amountNum * runsNum;
  const unchangedContact = !!savedContact && savedContact.provider === provider && savedContact.account === account && (category !== "electricity" || savedContact.plan === meterType);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/auth");
  }, [ready, authenticated, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!address) return;
    let live = true;
    loadSchedules(address)
      .then((r) => live && setRows(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [address, version]);

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

  // Copy a saved person's details into the form (typing their name is enough the second time).
  const fillFrom = (name: string, cat: Category) => {
    const c = address ? loadContacts(address).find((x) => x.name === contactName(name) && x.category === cat) : undefined;
    if (!c) return;
    setProvider(c.provider);
    setMeterType(c.plan === "postpaid" ? "postpaid" : "prepaid");
    setAccount(c.account);
  };

  const apply = (p: Proposal) => {
    const c = p.recipient && address ? loadContacts(address).find((x) => x.name === contactName(p.recipient) && x.category === p.category) : undefined;
    setCategory(p.category);
    setProvider(p.provider || c?.provider || "");
    setMeterType(p.provider || !c ? p.meterType : c.plan === "postpaid" ? "postpaid" : "prepaid");
    setRecipient(p.recipient);
    setAccount(p.account || c?.account || "");
    setRemember(true);
    setAmount(p.amountUsd ? String(p.amountUsd) : "");
    setIntervalKind(p.interval);
    setMinutes(String(p.minutes));
    setRuns(String(p.runs));
    setNote(p.summary);
    setFormOpen(true);
  };

  const understand = async (sentence = text) => {
    setError("");
    setDone("");
    setThinking(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: sentence }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't understand that.");
      apply(body.proposal as Proposal);
    } catch (e) {
      setFormOpen(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setThinking(false);
    }
  };

  const allowanceNow = () => publicClient.readContract({ address: ADDR.usdc, abi: usdcAbi, functionName: "allowance", args: [address!, ADDR.billPay] });

  const start = async () => {
    setError("");
    setBusy("start");
    try {
      if (!address) return;
      await startSchedule(
        { address, name: "", balance, exec },
        { category, provider, plan: category === "electricity" ? meterType : "", account, person: personKey, remember, perRun: amount, runs: runsNum, intervalSeconds: intervalSeconds(interval, minsNum) },
      );
      setDone("Schedule started. The first payment goes out within a few seconds.");
      setFormOpen(false);
      setText("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Couldn't start the schedule.");
    } finally {
      setBusy("");
    }
  };

  const cancel = async (row: Row) => {
    setError("");
    setBusy(`cancel-${row.id}`);
    try {
      // Take back the spending room this schedule had left, so cancelling really stops the money.
      const allowance = await allowanceNow();
      const release = row.amount * BigInt(row.runsLeft);
      await exec([
        { to: ADDR.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ADDR.billPay, allowance > release ? allowance - release : BigInt(0)] }) },
        { to: ADDR.scheduler, data: encodeFunctionData({ abi: schedulerAbi, functionName: "cancel", args: [row.id] }) },
      ]);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Couldn't cancel.");
    } finally {
      setBusy("");
    }
  };

  const pick = (c: Category) => {
    setCategory(c);
    setProvider("");
    setAccount("");
    fillFrom(recipient, c);
  };

  const providerName = (id: string) => Object.values(CATEGORIES).flatMap((c) => c.providers).find((p) => p.id === id)?.name ?? id;
  const describe = (r: Row) => {
    const [cat, prov] = r.billType.split(":");
    const who = contacts.find((c) => c.account === r.account)?.name; // names live only on this device
    return `${providerName(prov)} ${CATEGORIES[cat as Category]?.label.toLowerCase() ?? cat}${who ? ` for ${who}` : ""}`;
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: -1 }}>
        <DotCanvas />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "48px 16px 80px" }}>
        <div className="anim-fade-up" style={card}>
          <span className="font-[family-name:var(--font-bebas-neue)]" style={heading}>
            SCHEDULED PAYMENTS
          </span>
          <p style={small}>Describe it in a sentence. You check the details before anything starts, and you can cancel any time.</p>

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && text.trim() && !thinking && understand()}
              placeholder="e.g. pay my mum's electricity $20 monthly"
              maxLength={300}
              style={{ ...field, marginBottom: 0, flex: 1, minWidth: 0 }}
            />
            <button className="btn" disabled={!text.trim() || thinking} onClick={() => understand()} style={{ ...primaryBtn, width: "auto", padding: "0 18px", fontSize: 14, opacity: text.trim() && !thinking ? 1 : 0.65 }}>
              {thinking ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : "Set up"}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setText(ex);
                  understand(ex);
                }}
                disabled={thinking}
                style={{ padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(76,29,149,0.25)", background: "rgba(255,255,255,0.65)", cursor: "pointer", fontSize: 11, color: "#2e1065" }}
              >
                {ex}
              </button>
            ))}
          </div>
          {error && <p style={{ margin: "12px 0 0", fontSize: 12, color: "#b42318" }}>{error}</p>}
          {done && <p className="anim-fade" style={{ margin: "12px 0 0", fontSize: 12, color: "#1a7f37", fontWeight: 600 }}>✓ {done}</p>}
        </div>

        {formOpen && (
          <div className="anim-fade-up" style={card}>
            <span className="font-[family-name:var(--font-bebas-neue)]" style={heading}>
              CHECK THE DETAILS
            </span>
            {note && (
              <p style={{ ...small, display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.4)", color: "#2e1065" }}>
                <Icon name="repeat" size={16} color="#5b3fa3" />
                <span>
                  <strong>{note}</strong>
                  <span style={{ display: "block", color: "#5b3fa3" }}>Filled in from your sentence. Fix anything that&apos;s wrong or missing.</span>
                </span>
              </p>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 14 }}>
              {SCHEDULABLE.map((id) => {
                const on = category === id;
                return (
                  <button
                    key={id}
                    onClick={() => pick(id)}
                    aria-pressed={on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "10px 0",
                      borderRadius: 14,
                      border: `1px solid ${on ? "#2e1065" : "rgba(76,29,149,0.2)"}`,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      background: on ? "linear-gradient(135deg, #4c1d95, #2e1065)" : "rgba(255,255,255,0.55)",
                      color: on ? "#fff" : "#2e1065",
                      boxShadow: on ? "0 8px 18px rgba(76, 29, 149, 0.28)" : "none",
                    }}
                  >
                    <Icon name={CATEGORY_ICON[id]} size={16} />
                    {CATEGORIES[id].label}
                  </button>
                );
              })}
            </div>

            <Label htmlFor="s-who">Who it&apos;s for</Label>
            <input
              id="s-who"
              value={recipient}
              onChange={(e) => {
                const v = e.target.value.slice(0, 30);
                const next = address ? loadContacts(address).find((x) => x.name === contactName(v) && x.category === category) : undefined;
                setRecipient(v);
                if (next) fillFrom(v, category);
                else if (savedContact) {
                  // don't leave the previous person's number in the form
                  setAccount("");
                  setProvider("");
                }
              }}
              placeholder="@username, or a name like mum"
              style={{ ...field, marginBottom: 4 }}
            />
            <p style={{ ...small, margin: "0 0 10px", minHeight: 16, color: noUser || (personKey && !nameValid && !checking) ? "#b42318" : savedContact ? "#1a7f37" : "#5b3fa3", fontWeight: savedContact ? 600 : 400 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: category === "electricity" ? "1fr 1fr" : "1fr", gap: 8 }}>
                <div>
                  <Label htmlFor="s-provider">{bill.providerLabel}</Label>
                  <select id="s-provider" value={provider} onChange={(e) => setProvider(e.target.value)} style={select}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {bill.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {category === "electricity" && (
                  <div>
                    <Label htmlFor="s-meter">Meter type</Label>
                    <select id="s-meter" value={meterType} onChange={(e) => setMeterType(e.target.value as "prepaid" | "postpaid")} style={select}>
                      <option value="prepaid">Prepaid</option>
                      <option value="postpaid">Postpaid</option>
                    </select>
                  </div>
                )}
              </div>
              <Label htmlFor="s-account">{bill.field}</Label>
              <input id="s-account" value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={category === "electricity" ? "13 digits" : "080…"} style={field} />
              {personKey && nameValid && !unchangedContact && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 600, color: "#2e1065", margin: "0 0 10px", cursor: "pointer" }}>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "#4c1d95", width: 16, height: 16 }} />
                  {savedContact ? `Update ${personKey}'s saved details` : `Remember ${personKey} on this device`}
                </label>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 0.7fr", gap: 8 }}>
              <div>
                <Label htmlFor="s-amount">Each time</Label>
                <div style={{ ...field, display: "flex", alignItems: "center", padding: "0 0 0 12px" }}>
                  <span className="font-[family-name:var(--font-bebas-neue)]" style={{ fontSize: 20, color: "#5b3fa3" }}>
                    $
                  </span>
                  <input id="s-amount" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} inputMode="decimal" placeholder="0.00" className="font-[family-name:var(--font-bebas-neue)]" style={{ ...field, margin: 0, border: "none", background: "transparent", fontSize: 20, padding: "8px 6px" }} />
                </div>
              </div>
              <div>
                <Label htmlFor="s-every">How often</Label>
                <select id="s-every" value={interval} onChange={(e) => setIntervalKind(e.target.value as Interval)} style={select}>
                  <option value="monthly">Every month</option>
                  <option value="weekly">Every week</option>
                  <option value="daily">Every day</option>
                  <option value="minutes">Every few minutes (demo)</option>
                </select>
              </div>
              <div>
                <Label htmlFor="s-runs">Times</Label>
                <input id="s-runs" value={runs} onChange={(e) => setRuns(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" style={field} />
              </div>
            </div>
            {interval === "minutes" && (
              <>
                <Label htmlFor="s-mins">Minutes between payments</Label>
                <input id="s-mins" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" style={field} />
              </>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "4px 0 14px", padding: "12px 14px", borderRadius: 14, background: formOk ? "rgba(26, 127, 55, 0.08)" : "rgba(46, 16, 101, 0.06)", border: `1px solid ${formOk ? "rgba(26, 127, 55, 0.25)" : "rgba(46, 16, 101, 0.1)"}` }}>
              <Icon name={formOk ? "shield" : "lock"} size={18} color={formOk ? "#1a7f37" : "#5b3fa3"} />
              <p style={{ margin: 0, fontSize: 13, color: "#2e1065", fontWeight: 600, lineHeight: 1.5 }}>
                {formOk ? (
                  <>
                    ${amountNum.toFixed(2)} every {every(intervalSeconds(interval, minsNum))}, {runsNum} times. You approve up to <strong>${total.toFixed(2)}</strong> and it can never spend more. The first payment goes out right away.
                  </>
                ) : (
                  "Fill in the missing details to continue."
                )}
                {formOk && balance < toUnits(amount) && <span style={{ display: "block", color: "#b42318", fontWeight: 400 }}>Your balance is {fmtUsd(balance)}, less than the first payment.</span>}
              </p>
            </div>

            <button className="btn" disabled={!formOk || !!busy} onClick={start} style={{ ...primaryBtn, opacity: formOk ? 1 : 0.6, cursor: formOk && !busy ? "pointer" : "not-allowed" }}>
              {busy === "start" ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : "Start schedule"}
            </button>
          </div>
        )}

        <div className="anim-fade-up" style={{ ...card, animationDelay: "0.1s" }}>
          <span className="font-[family-name:var(--font-bebas-neue)]" style={heading}>
            ACTIVE SCHEDULES
          </span>
          {rows.length === 0 ? (
            <p style={{ ...small, margin: 0 }}>Nothing scheduled yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rows.map((r) => (
                <div key={String(r.id)} className="anim-fade-up" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <IconTile name={CATEGORY_ICON[r.billType.split(":")[0]] ?? "repeat"} tone="good" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2e1065", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(r)}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(46, 16, 101, 0.6)" }}>
                      {fmtUsd(r.amount)} every {every(r.interval)} · {r.runsLeft} left · next {when(r.nextDue, now)}
                    </p>
                  </div>
                  <Pill tone="good">Active</Pill>
                  <button onClick={() => cancel(r)} disabled={!!busy} style={{ ...linkBtn, color: "#b42318", flexShrink: 0 }}>
                    {busy === `cancel-${r.id}` ? "…" : "Cancel"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {contacts.length > 0 && (
          <div className="anim-fade-up" style={{ ...card, animationDelay: "0.2s" }}>
            <span className="font-[family-name:var(--font-bebas-neue)]" style={heading}>
              SAVED PEOPLE
            </span>
            <p style={small}>Details you filled in once. They stay on this device and are never put on-chain under a name.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {contacts.map((c) => (
                <div key={`${c.name}:${c.category}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#2e1065", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong>{c.name}</strong> · {CATEGORIES[c.category].label.toLowerCase()} · {providerName(c.provider)} ····{c.account.slice(-4)}
                  </p>
                  <button
                    onClick={() => {
                      if (address) removeContact(address, c.name, c.category);
                      setVersion((v) => v + 1);
                    }}
                    style={{ ...linkBtn, color: "#b42318", flexShrink: 0 }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => router.push("/dashboard")} style={{ ...linkBtn, fontSize: 12, color: "#5b3fa3" }}>
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
