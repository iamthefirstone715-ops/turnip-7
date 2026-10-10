import { FETCHABLE_SERVICES, type Plan } from "../../lib/bills";

const BASE = process.env.VTPASS_BASE_URL ?? "https://sandbox.vtpass.com/api";

// Proxies VTpass's public plan list so the browser doesn't need CORS access.
export async function GET(request: Request) {
  const serviceID = new URL(request.url).searchParams.get("serviceID") ?? "";
  if (!FETCHABLE_SERVICES.has(serviceID)) return Response.json({ error: "unknown service" }, { status: 400 });

  try {
    const res = await fetch(`${BASE}/service-variations?serviceID=${serviceID}`);
    const body = await res.json();
    // VTpass has shipped this key with both spellings.
    const list: { variation_code: string; name: string; variation_amount: string }[] =
      body?.content?.variations ?? body?.content?.varations ?? [];
    // A few VTpass codes are reused by different products at different prices; an order by code would be ambiguous.
    const counts = new Map<string, number>();
    for (const v of list) counts.set(v.variation_code, (counts.get(v.variation_code) ?? 0) + 1);
    const plans: Plan[] = list
      .filter((v) => counts.get(v.variation_code) === 1)
      .map((v) => ({ code: v.variation_code, name: v.name, ngn: Number(v.variation_amount) }))
      .filter((p) => p.ngn > 0);
    return Response.json(plans);
  } catch {
    return Response.json({ error: "provider unavailable" }, { status: 502 });
  }
}
