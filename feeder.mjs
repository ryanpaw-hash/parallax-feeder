// Pushes raw DexScreener pool data to the PARALLAX worker.
// Why this exists: DexScreener and GeckoTerminal answer HTTP 429 to Cloudflare Workers' shared egress IPs,
// so the worker cannot fetch them reliably. This runs elsewhere (GitHub Actions), fetches, and POSTs to
// /api/internal/feed, which does the processing. No secrets in this repo; FEED_SECRET comes from the environment.
const BASE = (process.env.PARALLAX_URL ?? "https://parallax.pawww.sbs").replace(/\/$/, "");
const SECRET = process.env.FEED_SECRET;
if (!SECRET) {
  console.error("FEED_SECRET is not set");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "parallax-feeder/1.0" } }).catch(() => null);
    if (res?.ok) return res.json();
    if (res && res.status !== 429 && res.status < 500) return null;
    await sleep(2000 * (i + 1));
  }
  return null;
}

async function push(payload) {
  const res = await fetch(`${BASE}/api/internal/feed`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`feed ${payload.kind} -> HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
}

/** Pairs for each token, one request per token (the batch endpoint truncates), spaced to stay under the rate limit. */
async function pairsFor(addr) {
  const d = await getJson(`https://api.dexscreener.com/token-pairs/v1/robinhood/${addr}`);
  await sleep(250);
  return Array.isArray(d) ? d : null;
}

const radar = await getJson(`${BASE}/api/radar`);
const vaults = await getJson(`${BASE}/api/vaults`);
if (!radar?.rows?.length) throw new Error("could not read the stock list from the worker");

let ok = 0, failed = 0;
let batch = [];
for (const { sym, addr } of radar.rows) {
  const pairs = await pairsFor(addr);
  if (pairs) batch.push({ sym, pairs });
  else failed++;
  if (batch.length === 20) {
    await push({ kind: "pools", items: batch });
    ok += batch.length;
    batch = [];
  }
}
if (batch.length) {
  await push({ kind: "pools", items: batch });
  ok += batch.length;
}

const addrs = (vaults?.rows ?? []).map((v) => v.tax_token);
if (addrs.length) {
  const all = new Map();
  for (const a of addrs) for (const p of (await pairsFor(a)) ?? []) all.set(p.pairAddress, p);
  await push({ kind: "vaultmkt", addrs, pairs: [...all.values()] });
}

console.log(JSON.stringify({ stocks: ok, failed, vaults: addrs.length }));
// A run where most tokens failed should show up red in the Actions tab.
if (failed > radar.rows.length / 4) process.exit(1);
