// node --test worker/vtpass.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { vtpass } from "./providers.mjs";

const order = { id: 7n, billType: "electricity", account: "45012345678", usd: 10 };
const NEW = { code: "015" }; // what /requery says about a request id VTpass has never seen
const reply = (body) => async (url) => ({ json: async () => (String(url).includes("/requery") ? NEW : body) });
const now = Math.floor(Date.now() / 1000);
const fresh = { ...order, createdAt: now };
const make = (fetchImpl) => vtpass({ apiKey: "k", secretKey: "s", fetchImpl, pollMs: 0 });

test("delivered returns token as reference", async () => {
  const r = await make(reply({ code: "000", purchased_code: "Token : 1234", content: { transactions: { status: "delivered" } } })).fulfill(order);
  assert.deepEqual(r, { ok: true, ref: "Token : 1234" });
});

test("rejection code means refund", async () => {
  const r = await make(reply({ code: "016", response_description: "TRANSACTION FAILED" })).fulfill(order);
  assert.equal(r.ok, false);
});

test("network error never refunds", async () => {
  const r = await make(async () => {
    throw new Error("ECONNRESET");
  }).fulfill(order);
  assert.deepEqual(r, { pending: true });
});

test("request id is Lagos YYYYMMDDHHmm of the order plus its id, so every worker derives the same one", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("/requery")) return { json: async () => NEW };
    bodies.push(JSON.parse(init.body));
    return { json: async () => ({ code: "000", content: { transactions: { status: "delivered", transactionId: "t" } } }) };
  };
  await make(fetchImpl).fulfill(fresh);
  await make(fetchImpl).fulfill(fresh);
  assert.match(bodies[0].request_id, /^\d{12}o7$/);
  assert.equal(bodies[0].request_id, bodies[1].request_id);
  assert.equal(bodies[0].amount, 15000); // $10 at 1500 NGN/USD
  assert.equal(bodies[0].serviceID, "ikeja-electric");
});

test("an order VTpass already knows is never bought again", async () => {
  let paid = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("/requery")) return { json: async () => ({ code: "000", purchased_code: "Token : 99", content: { transactions: { status: "delivered" } } }) };
    paid++;
    return { json: async () => ({ code: "000", content: { transactions: { status: "delivered" } } }) };
  };
  const r = await make(fetchImpl).fulfill(fresh);
  assert.deepEqual(r, { ok: true, ref: "Token : 99" });
  assert.equal(paid, 0);
});

test("a duplicate-id reply (another worker got there first) leaves the order escrowed, never refunds", async () => {
  const fetchImpl = async (url) => ({ json: async () => (String(url).includes("/requery") ? NEW : { code: "014", response_description: "REQUEST ID ALREADY EXIST" }) });
  assert.deepEqual(await make(fetchImpl).fulfill(fresh), { pending: true });
});

test("a requery answer we do not understand is treated as pending", async () => {
  const fetchImpl = async () => ({ json: async () => ({ code: "083" }) });
  assert.deepEqual(await make(fetchImpl).fulfill(fresh), { pending: true });
});

test("an order from an earlier Lagos day is left for the payer to reclaim", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { json: async () => NEW };
  };
  const r = await make(fetchImpl).fulfill({ ...order, createdAt: now - 3 * 86_400 });
  assert.deepEqual(r, { pending: true });
  assert.equal(calls, 0);
});

// Fake VTpass: plan list on GET, purchase on POST. Records every POST body.
const fakeVtpass = (plans) => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("service-variations")) return { json: async () => ({ content: { variations: plans } }) };
    if (String(url).includes("/requery")) return { json: async () => NEW };
    posts.push(JSON.parse(init.body));
    return { json: async () => ({ code: "000", content: { transactions: { status: "delivered", transactionId: "t1" } } }) };
  };
  return { posts, provider: vtpass({ apiKey: "k", secretKey: "s", fetchImpl }) };
};

test("encoded airtime picks the chosen network", async () => {
  const { posts, provider } = fakeVtpass([]);
  await provider.fulfill({ id: 1n, billType: "airtime:glo", account: "08011111111", usd: 2 });
  assert.equal(posts[0].serviceID, "glo");
  assert.equal(posts[0].amount, 3000);
});

test("data plan is charged at the plan price, not the dollar amount", async () => {
  const { posts, provider } = fakeVtpass([{ variation_code: "mtn-10mb-100", name: "N100", variation_amount: "100.00" }]);
  const r = await provider.fulfill({ id: 2n, billType: "data:mtn-data:mtn-10mb-100", account: "08011111111", usd: 0.07 });
  assert.equal(r.ok, true);
  assert.equal(posts[0].serviceID, "mtn-data");
  assert.equal(posts[0].variation_code, "mtn-10mb-100");
  assert.equal(posts[0].amount, 100);
  assert.equal(posts[0].billersCode, "08011111111");
});

test("underpaid TV plan is refunded and nothing is sent to the provider", async () => {
  const { posts, provider } = fakeVtpass([{ variation_code: "dstv-padi", name: "Padi", variation_amount: "1850.00" }]);
  const r = await provider.fulfill({ id: 3n, billType: "tv:dstv:dstv-padi", account: "1212121212", usd: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /underpaid/);
  assert.equal(posts.length, 0);
});

test("TV plan paid in full is bought as a change subscription with a fallback phone", async () => {
  const { posts, provider } = fakeVtpass([{ variation_code: "dstv-padi", name: "Padi", variation_amount: "1850.00" }]);
  const r = await provider.fulfill({ id: 4n, billType: "tv:dstv:dstv-padi", account: "1212121212", usd: 1.24 }); // 1.24 * 1500 = 1860
  assert.equal(r.ok, true);
  assert.equal(posts[0].billersCode, "1212121212");
  assert.equal(posts[0].subscription_type, "change");
  assert.match(posts[0].phone, /^0\d{10}$/);
  assert.equal(posts[0].amount, 1850);
});

test("unknown plan is refunded", async () => {
  const { posts, provider } = fakeVtpass([]);
  const r = await provider.fulfill({ id: 5n, billType: "data:mtn-data:nope", account: "08011111111", usd: 1 });
  assert.equal(r.ok, false);
  assert.equal(posts.length, 0);
});

test("electricity honours the chosen disco and meter type", async () => {
  const { posts, provider } = fakeVtpass([]);
  await provider.fulfill({ id: 6n, billType: "electricity:eko-electric:postpaid", account: "1111111111111", usd: 2 });
  assert.equal(posts[0].serviceID, "eko-electric");
  assert.equal(posts[0].variation_code, "postpaid");
  assert.equal(posts[0].billersCode, "1111111111111");
});

test("a plan code that VTpass reuses for two products is refused", async () => {
  const { posts, provider } = fakeVtpass([
    { variation_code: "mtn-xtratalk-300", name: "N300 weekly", variation_amount: "300.00" },
    { variation_code: "mtn-xtratalk-300", name: "N200 3 days", variation_amount: "200.00" },
  ]);
  const r = await provider.fulfill({ id: 7n, billType: "data:mtn-data:mtn-xtratalk-300", account: "08011111111", usd: 1 });
  assert.equal(r.ok, false);
  assert.equal(posts.length, 0);
});

test("a provider the app does not offer is refused, even if the chain says so", async () => {
  const { posts, provider } = fakeVtpass([]);
  for (const billType of ["airtime:dstv", "airtime:foreign-airtime", "electricity:ikeja-electric:free"]) {
    const r = await provider.fulfill({ id: 8n, billType, account: "08011111111", usd: 1 });
    assert.equal(r.ok, false, billType);
  }
  assert.equal(posts.length, 0);
});
