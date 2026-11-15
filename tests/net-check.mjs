// Network check: fires parallel requests at Supabase with Node's default connection
// handling, then with the CRM's pooled agent (few keep-alive connections, reused).
// Usage: node tests/net-check.mjs [parallel=8]
import fs from "node:fs";
import { Agent, fetch as ufetch } from "undici";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const n = Number(process.argv[2] || 8);
const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/services?select=slug&limit=1`;
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };

async function run(label, doFetch) {
  const t0 = performance.now();
  const res = await Promise.all(Array.from({ length: n }, async () => {
    const t = performance.now();
    try { const r = await doFetch(url, { headers }); await r.text(); return { ok: r.ok, ms: performance.now() - t }; }
    catch (e) { return { ok: false, ms: performance.now() - t, err: e.cause?.code ?? e.message }; }
  }));
  const ok = res.filter((r) => r.ok).length;
  console.log(`${label}: ${ok}/${n} ok, slowest ${Math.round(Math.max(...res.map((r) => r.ms)))}ms, total ${Math.round(performance.now() - t0)}ms` +
    (ok < n ? ` — errors: ${[...new Set(res.filter((r) => !r.ok).map((r) => r.err))].join(", ")}` : ""));
}

await run("default", fetch);
const agent = new Agent({ connections: 2, pipelining: 1, keepAliveTimeout: 60_000, connect: { timeout: 4_000 } });
await run("pooled (cold)", (u, o) => ufetch(u, { ...o, dispatcher: agent }));
await run("pooled (warm)", (u, o) => ufetch(u, { ...o, dispatcher: agent }));
