// Checks a lead's public website. Only facts observed in the HTTP response are
// returned. Protects the server against SSRF: http(s) only, standard ports,
// public IP addresses only (checked on every redirect hop), size and time limits.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface WebsiteCheck {
  source_url: string;
  final_url: string | null;
  http_status: number | null;
  is_live: boolean;
  uses_https: boolean | null;
  mobile_friendly: boolean | null;
  page_title: string | null;
  meta_description: string | null;
  facebook_link: string | null;
  has_ecommerce_signals: boolean | null;
  error: string | null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9")
    || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https websites can be checked");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Non-standard ports are not checked");
  if (url.username || url.password) throw new Error("URLs with credentials are not checked");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Private address");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("The website resolves to a private address");
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export function parseHtml(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1];
  const fb = /href=["'](https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[^"'?#\s]+)/i.exec(html)?.[1];
  return {
    page_title: title ? decode(title).slice(0, 300) : null,
    meta_description: desc ? decode(desc).slice(0, 500) : null,
    mobile_friendly: /<meta[^>]+name=["']viewport["'][^>]*width\s*=\s*device-width/i.test(html),
    facebook_link: fb ? fb.slice(0, 300) : null,
    has_ecommerce_signals: /add[\s-]to[\s-]cart|woocommerce|shopify|\/checkout|\/cart\b|data-product-id|"@type"\s*:\s*"Product"/i.test(html),
  };
}

export async function checkWebsite(rawUrl: string): Promise<WebsiteCheck> {
  const base: WebsiteCheck = {
    source_url: rawUrl, final_url: null, http_status: null, is_live: false, uses_https: null, mobile_friendly: null,
    page_title: null, meta_description: null, facebook_link: null, has_ecommerce_signals: null, error: null,
  };
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ...base, error: "Invalid URL" }; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(url);
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CRMWebsiteCheck/1.0)", Accept: "text/html,application/xhtml+xml" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        url = new URL(loc, url);
        continue;
      }
      break;
    }
    if (!res) throw new Error("No response");
    if (res.status >= 300 && res.status < 400) throw new Error("Too many redirects");

    const out: WebsiteCheck = { ...base, final_url: url.toString().slice(0, 500), http_status: res.status, is_live: res.ok, uses_https: url.protocol === "https:" };
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("html") && res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); size += value.length;
      }
      await reader.cancel().catch(() => undefined);
      const html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
      Object.assign(out, parseHtml(html));
    } else {
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) out.error = `HTTP ${res.status}`;
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Timed out after 8 seconds" : e.message) : "Check failed";
    return { ...base, final_url: url.toString().slice(0, 500), error: msg.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}
