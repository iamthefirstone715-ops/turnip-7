// node --test worker/vtpass.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { vtpass } from "./providers.mjs";

const order = { id: 7n, billType: "electricity", account: "45012345678", usd: 10 };
const reply = (body) => async () => ({ json: async () => body });
const make = (fetchImpl) => vtpass({ apiKey: "k", secretKey: "s", fetchImpl });

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

test("request id starts with Lagos YYYYMMDDHHmm and body carries naira amount", async () => {
  let body;
  await make(async (_u, init) => {
    body = JSON.parse(init.body);
    return { json: async () => ({ code: "000", content: { transactions: { status: "delivered", transactionId: "t" } } }) };
  }).fulfill(order);
  assert.match(body.request_id, /^\d{12}o7x/);
  assert.equal(body.amount, 15000); // $10 at 1500 NGN/USD
  assert.equal(body.serviceID, "ikeja-electric");
});

// Fake VTpass: plan list on GET, purchase on POST. Records every POST body.
const fakeVtpass = (plans) => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("service-variations")) return { json: async () => ({ content: { variations: plans } }) };
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
