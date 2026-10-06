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
