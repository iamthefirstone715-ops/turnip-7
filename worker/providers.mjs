// A provider takes an order and returns one of:
//   { ok: true, ref }          bill delivered   -> operator calls fulfill
//   { ok: false, reason }      definitively failed -> operator calls refund
//   { pending: true }          unknown yet      -> leave escrowed (payer can reclaim after TIMEOUT)

import { CATEGORIES } from "../app/lib/bills.ts"; // the same provider list the app offers

const NGN_PER_USD = Number(process.env.NGN_PER_USD ?? 1500); // ponytail: fixed demo rate, use a live FX feed for production

// billType on-chain is "category:provider[:plan]", e.g. "airtime:glo" or "data:mtn-data:mtn-10mb-100"
// (built by app/lib/bills.ts). A bare category still works and falls back to a default provider.
const DEFAULT_SERVICE = { airtime: "mtn", data: "mtn-data", electricity: "ikeja-electric", tv: "dstv" };
const PHONE = /^0d{10}$/;

export function parseBill(billType) {
  const [category, serviceID, variation] = String(billType).split(":");
  return { category, serviceID: serviceID || DEFAULT_SERVICE[category], variation };
}

// VTpass requires request_id to start with YYYYMMDDHHmm in Africa/Lagos time (and the date must be today's).
const lagos = (unixSeconds) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(unixSeconds * 1000))
      .map((x) => [x.type, x.value]),
  );
const day = (p) => `${p.year}${p.month}${p.day}`;

// Built only from the order itself, so every worker (and every retry) derives the same id for the same order:
// VTpass then refuses a second purchase (code 014) and /requery finds the first one.
const vtpassRequestId = (orderId, p) => `${day(p)}${p.hour}${p.minute}o${orderId}`;

export function vtpass({ baseUrl = "https://sandbox.vtpass.com/api", apiKey, secretKey, fetchImpl = fetch, pollMs = 3000 }) {
  const call = async (path, body) => {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": apiKey, "secret-key": secretKey },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  // Public endpoint; VTpass has shipped this key with both spellings.
  const planFor = async (serviceID, code) => {
    const res = await fetchImpl(`${baseUrl}/service-variations?serviceID=${serviceID}`);
    const c = (await res.json())?.content ?? {};
    const matches = (c.variations ?? c.varations ?? []).filter((x) => x.variation_code === code);
    // Reused codes are ambiguous (different products, different prices), so refuse them.
    return matches.length === 1 ? { ngn: Number(matches[0].variation_amount) } : undefined;
  };

  const classify = (j) => {
    const status = j?.content?.transactions?.status;
    if (j?.code === "000" && status === "delivered") {
      return { ok: true, ref: j.purchased_code || j.content.transactions.transactionId || j.requestId };
    }
    if (j?.code === "000" && (status === "pending" || status === "initiated")) return { pending: true };
    if (j?.code === "099" || j?.code === "089") return { pending: true }; // processing
    if (j?.code === "014") return { pending: true }; // request id already used: another worker bought it, requery gives the result
    if (status === "failed" || status === "reversed") return { ok: false, reason: `vtpass ${status}` };
    // Any other code is a definitive rejection (bad number, low wallet, etc.).
    return { ok: false, reason: `vtpass code ${j?.code ?? "unknown"}: ${j?.response_description ?? ""}` };
  };

  return {
    async fulfill(order) {
      const { category, serviceID, variation } = parseBill(order.billType);
      if (!DEFAULT_SERVICE[category]) return { ok: false, reason: `unsupported bill type ${order.billType}` };
      // billType is free text anyone can write on-chain: only buy products the app itself offers.
      if (!CATEGORIES[category].providers.some((p) => p.id === serviceID)) return { ok: false, reason: `unknown provider ${serviceID} for ${category}` };
      if (category === "electricity" && variation && variation !== "prepaid" && variation !== "postpaid") return { ok: false, reason: `unknown meter type ${variation}` };
      const created = lagos(order.createdAt ?? Math.floor(Date.now() / 1000));
      // An order from an earlier day can't get a valid id today. Leave it escrowed: the payer can reclaim after an hour.
      if (day(created) !== day(lagos(Math.floor(Date.now() / 1000)))) return { pending: true };
      const request_id = vtpassRequestId(order.id, created);
      // Ask first: if VTpass already has this order (a restart, or another worker), use its answer and never buy twice.
      let known;
      try {
        known = await call("/requery", { request_id });
      } catch {
        return { pending: true };
      }
      if (known?.code !== "015") return known?.content?.transactions?.status ? classify(known) : { pending: true }; // 015 = never used; anything unclear = wait
      const paidNgn = Math.max(1, Math.round(order.usd * NGN_PER_USD));
      // VTpass wants a contact phone on every purchase; meter and smartcard orders have a different account.
      const phone = PHONE.test(order.account) ? order.account : (process.env.VTPASS_PHONE ?? "08011111111");
      let body = { request_id, serviceID, phone };

      if (category === "airtime") body = { ...body, amount: paidNgn };
      else if (category === "electricity") {
        body = { ...body, billersCode: order.account, variation_code: variation || "prepaid", amount: paidNgn };
      } else {
        // Data and TV plans have a fixed price: charge exactly the plan, and refund if the payer sent less.
        let plan;
        try {
          plan = await planFor(serviceID, variation);
        } catch {
          return { ok: false, reason: "could not look up the plan" }; // nothing was sent to the provider yet
        }
        if (!plan) return { ok: false, reason: `unknown plan ${variation}` };
        if (paidNgn < plan.ngn - 1) return { ok: false, reason: `underpaid: sent ₦${paidNgn}, plan costs ₦${plan.ngn}` };
        body = { ...body, billersCode: order.account, variation_code: variation, amount: plan.ngn };
        if (category === "tv") body.subscription_type = "change";
      }
      let j;
      try {
        j = await call("/pay", body);
      } catch {
        return { pending: true }; // network error: the request may have gone through, never refund blindly
      }
      let r = classify(j);
      for (let i = 0; r.pending && i < 5; i++) {
        await new Promise((x) => setTimeout(x, pollMs));
        try {
          const q = await call("/requery", { request_id });
          if (q?.content?.transactions?.status) r = classify(q); // an answer without a transaction in it tells us nothing: keep waiting
        } catch {}
      }
      return r;
    },
  };
}

export function mock() {
  return {
    async fulfill(order) {
      await new Promise((x) => setTimeout(x, 1500));
      if (order.account.startsWith("000")) return { ok: false, reason: "mock: number rejected" };
      const ref =
        order.billType.startsWith("electricity")
          ? `Token: ${Math.floor(1e15 + Math.random() * 9e15)}`
          : `MOCK-${order.id}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      return { ok: true, ref };
    },
  };
}
