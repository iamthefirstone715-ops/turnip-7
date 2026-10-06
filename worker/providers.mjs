// A provider takes an order and returns one of:
//   { ok: true, ref }          bill delivered   -> operator calls fulfill
//   { ok: false, reason }      definitively failed -> operator calls refund
//   { pending: true }          unknown yet      -> leave escrowed (payer can reclaim after TIMEOUT)

const NGN_PER_USD = Number(process.env.NGN_PER_USD ?? 1500); // ponytail: fixed demo rate, use a live FX feed for production

// ponytail: one default product per bill type; extend with a lookup table for more networks/discos/bouquets
const VTPASS_PRODUCTS = {
  airtime: { serviceID: "mtn" },
  data: { serviceID: "mtn-data", variation_code: "mtn-10mb-100" },
  electricity: { serviceID: "ikeja-electric", variation_code: "prepaid" },
  tv: { serviceID: "dstv", variation_code: "dstv-padi", subscription_type: "change" },
};

// VTpass requires request_id to start with YYYYMMDDHHmm in Africa/Lagos time.
function vtpassRequestId(orderId) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}o${orderId}x${Math.random().toString(36).slice(2, 8)}`;
}

export function vtpass({ baseUrl = "https://sandbox.vtpass.com/api", apiKey, secretKey, fetchImpl = fetch }) {
  const call = async (path, body) => {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": apiKey, "secret-key": secretKey },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const classify = (j) => {
    const status = j?.content?.transactions?.status;
    if (j?.code === "000" && status === "delivered") {
      return { ok: true, ref: j.purchased_code || j.content.transactions.transactionId || j.requestId };
    }
    if (j?.code === "000" && (status === "pending" || status === "initiated")) return { pending: true };
    if (j?.code === "099") return { pending: true }; // processing
    if (status === "failed" || status === "reversed") return { ok: false, reason: `vtpass ${status}` };
    // Any other code is a definitive rejection (bad number, low wallet, etc.).
    return { ok: false, reason: `vtpass code ${j?.code ?? "unknown"}: ${j?.response_description ?? ""}` };
  };

  return {
    async fulfill(order) {
      const product = VTPASS_PRODUCTS[order.billType];
      if (!product) return { ok: false, reason: `unsupported bill type ${order.billType}` };
      const request_id = vtpassRequestId(order.id);
      const amount = Math.max(1, Math.round(order.usd * NGN_PER_USD));
      const body = { request_id, ...product, amount, phone: order.account, billersCode: order.account };
      let j;
      try {
        j = await call("/pay", body);
      } catch {
        return { pending: true }; // network error: the request may have gone through, never refund blindly
      }
      let r = classify(j);
      for (let i = 0; r.pending && i < 5; i++) {
        await new Promise((x) => setTimeout(x, 3000));
        try {
          r = classify(await call("/requery", { request_id }));
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
        order.billType === "electricity"
          ? `Token: ${Math.floor(1e15 + Math.random() * 9e15)}`
          : `MOCK-${order.id}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      return { ok: true, ref };
    },
  };
}
