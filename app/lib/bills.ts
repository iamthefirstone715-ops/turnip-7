// Bill catalogue shared by the UI and the plans API route.
// The chosen product travels on-chain inside the billType string: "category:provider[:plan]",
// e.g. "airtime:glo", "data:mtn-data:mtn-10mb-100", "electricity:eko-electric:postpaid", "tv:dstv:dstv-padi".
// The worker decodes it (worker/providers.mjs), so keep both sides in sync.

export const NGN_PER_USD = Number(process.env.NEXT_PUBLIC_NGN_PER_USD ?? 1500);

export type Category = "airtime" | "data" | "electricity" | "tv";
export type Provider = { id: string; name: string };
export type Plan = { code: string; name: string; ngn: number };

type CategoryConfig = {
  label: string;
  field: string;
  providerLabel: string;
  providers: Provider[];
  /** "fetch": plans (and prices) come from VTpass. "static": fixed choices, free amount. none: free amount. */
  plans?: "fetch" | "static";
  staticPlans?: Plan[];
};

const NETWORKS = (suffix: string): Provider[] => [
  { id: `mtn${suffix}`, name: "MTN" },
  { id: `airtel${suffix}`, name: "Airtel" },
  { id: `glo${suffix}`, name: "Glo" },
  { id: `etisalat${suffix}`, name: "9mobile" },
];

export const CATEGORIES: Record<Category, CategoryConfig> = {
  airtime: { label: "Airtime", field: "Phone number", providerLabel: "Network", providers: NETWORKS("") },
  data: { label: "Data", field: "Phone number", providerLabel: "Network", providers: NETWORKS("-data"), plans: "fetch" },
  electricity: {
    label: "Electricity",
    field: "Meter number",
    providerLabel: "Distribution company",
    providers: [
      { id: "ikeja-electric", name: "Ikeja Electric" },
      { id: "eko-electric", name: "Eko Electric" },
      { id: "abuja-electric", name: "Abuja (AEDC)" },
      { id: "ibadan-electric", name: "Ibadan (IBEDC)" },
      { id: "enugu-electric", name: "Enugu (EEDC)" },
      { id: "portharcourt-electric", name: "Port Harcourt (PHED)" },
      { id: "kano-electric", name: "Kano (KEDCO)" },
      { id: "kaduna-electric", name: "Kaduna (KAEDCO)" },
      { id: "jos-electric", name: "Jos (JED)" },
      { id: "benin-electric", name: "Benin (BEDC)" },
      { id: "aba-electric", name: "Aba" },
      { id: "yola-electric", name: "Yola" },
    ],
    plans: "static",
    staticPlans: [
      { code: "prepaid", name: "Prepaid", ngn: 0 },
      { code: "postpaid", name: "Postpaid", ngn: 0 },
    ],
  },
  tv: {
    label: "TV",
    field: "Smartcard number",
    providerLabel: "Provider",
    providers: [
      { id: "dstv", name: "DStv" },
      { id: "gotv", name: "GOtv" },
      { id: "startimes", name: "Startimes" },
    ],
    plans: "fetch",
  },
};

export const encodeBill = (category: Category, provider: string, plan?: string) =>
  [category, provider, plan].filter(Boolean).join(":");

/** Plans that need a price from VTpass are the ones the plans API route may be asked about. */
export const FETCHABLE_SERVICES = new Set(
  (Object.values(CATEGORIES) as CategoryConfig[]).filter((c) => c.plans === "fetch").flatMap((c) => c.providers.map((p) => p.id)),
);

/** USD to charge for a plan priced in naira, rounded up to the cent so the worker never sees an underpayment. */
export const usdForNgn = (ngn: number) => Math.ceil((ngn / NGN_PER_USD) * 100) / 100;
