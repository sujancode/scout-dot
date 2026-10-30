import { defineTools, type ToolContext } from "polka-cli";

// Scout's sources. Each tool calls a real API with a key from the environment's variables
// (`polka vars set FINNHUB_KEY`, `… TAVILY_KEY`): no key is ever in this code or in the
// deployment. A tool answers in short text (the model reads at most 2 000 characters of it);
// one that throws tells the model it did not work, and the model carries on without it.

const FINNHUB = "https://finnhub.io/api/v1";
const DAY_S = 86_400;

export default defineTools({
  stock_snapshot: {
    description: "A stock now: its price and today's move, its 52-week range, valuation and growth, and what the company does. Use it for any question about a price.",
    args: { company: "The company's name or ticker, e.g. Nvidia or NVDA." },
    async run({ company }, ctx) {
      const s = await tickerOf(ctx, company);
      const [quote, profile, metrics] = await Promise.all([
        finnhub<{ c: number; d: number | null; dp: number | null; h: number; l: number; pc: number; t: number }>(ctx, "/quote", { symbol: s }),
        finnhub<{ name?: string; finnhubIndustry?: string; marketCapitalization?: number; country?: string; exchange?: string; weburl?: string }>(ctx, "/stock/profile2", { symbol: s }),
        finnhub<{ metric?: Record<string, number | null> }>(ctx, "/stock/metric", { symbol: s, metric: "all" }),
      ]);
      if (!quote.c) return `No price for ${s}.`;
      const m = metrics.metric ?? {};
      return [
        `${profile.name ?? s} (${s}${profile.exchange ? `, ${profile.exchange}` : ""}), ${profile.finnhubIndustry ?? "industry unknown"}${profile.country ? `, ${profile.country}` : ""}.`,
        `Price $${money(quote.c)}, ${signed(quote.d)} (${signed(quote.dp)}%) today; day range $${money(quote.l)}–$${money(quote.h)}; previous close $${money(quote.pc)}; as of ${new Date(quote.t * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
        profile.marketCapitalization ? `Market cap $${billions(profile.marketCapitalization * 1e6)}.` : "",
        line("52-week range", m["52WeekLow"], m["52WeekHigh"], (lo, hi) => `$${money(lo)}–$${money(hi)}`),
        line("P/E (TTM)", m.peTTM ?? m.peBasicExclExtraTTM, null, (pe) => money(pe)),
        line("Revenue growth (TTM, year on year)", m.revenueGrowthTTMYoy, null, (g) => `${money(g)}%`),
        line("Net margin (TTM)", m.netProfitMarginTTM, null, (n) => `${money(n)}%`),
        line("Beta", m.beta, null, (b) => money(b)),
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  company_news: {
    description: "A company's latest news headlines from the financial press, newest first, each with its date, source and gist.",
    args: { company: "The company's name or ticker, e.g. Nvidia or NVDA.", days: "How many days back, 1 to 30 (default 14)." },
    async run({ company, days }, ctx) {
      const symbol = await tickerOf(ctx, company);
      const back = Math.min(30, Math.max(1, Number(days) || 14));
      const to = new Date();
      const from = new Date(to.getTime() - back * DAY_S * 1000);
      const [news, profile] = await Promise.all([
        finnhub<{ datetime: number; headline: string; source: string; summary: string; url: string }[]>(ctx, "/company-news", {
          symbol,
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
        }),
        finnhub<{ name?: string }>(ctx, "/stock/profile2", { symbol }),
      ]);
      if (!Array.isArray(news) || news.length === 0) return `No news for ${symbol} in the last ${back} days.`;
      // Finnhub's feed for a ticker carries market pieces that only mention it in passing: keep the
      // articles that name the company, those with it in the headline first.
      const name = (profile.name ?? "").replace(/[,.]|\b(corporation|corp|incorporated|inc|holdings|ltd|plc|co|company|class [a-z])\b/gi, "").trim();
      const about = new RegExp(`\\b(${[symbol, name, name.split(" ")[0]].filter((t) => t && t.length > 1).map((t) => t.replace(/[^\w ]/g, "")).join("|")})\\b`, "i");
      const seen = new Set<string>();
      const unique = news.filter((n) => n.headline && !seen.has(n.headline) && seen.add(n.headline));
      const items = [...unique.filter((n) => about.test(n.headline)), ...unique.filter((n) => !about.test(n.headline) && about.test(n.summary ?? ""))].slice(0, 8);
      if (items.length === 0) return `${news.length} articles in the last ${back} days mention ${symbol} in passing; none is about ${name || symbol}.`;
      return [
        `${unique.length} articles in the last ${back} days; the ${items.length} most about ${name || symbol}:`,
        ...items.map((n) => `- ${day(n.datetime)} · ${n.source}: ${n.headline}${n.summary ? ` — ${clip(n.summary, 120)}` : ""} (${n.url})`),
      ].join("\n");
    },
  },

  web_search: {
    description: "Search the last month of news on the web for what is being said about something (analysts, reviews, controversies, launches). Answers a short summary and the top sources, each dated.",
    args: { query: "What to search for, e.g. 'Nvidia Blackwell delays analyst views'.", days: "How many days back, 1 to 90 (default 30)." },
    async run({ query, days }, ctx) {
      const key = keyOf(ctx, "TAVILY_KEY");
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        // News only, and recent: a general search answers with years-old articles as if they were today's.
        body: JSON.stringify({ query, topic: "news", days: Math.min(90, Math.max(1, Number(days) || 30)), search_depth: "basic", max_results: 5, include_answer: true }),
        signal: AbortSignal.timeout(7_000),
      });
      if (!response.ok) throw new Error(`Tavily answered ${response.status}`);
      const found = (await response.json()) as { answer?: string; results?: { title: string; url: string; content: string; published_date?: string }[] };
      return [
        found.answer ? `Summary: ${clip(found.answer, 500)}` : "",
        ...(found.results ?? []).map((r) => `- ${r.published_date ? `${dateOf(r.published_date)} · ` : ""}${clip(r.title, 140)}: ${clip(r.content, 160)} (${r.url})`),
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  hn_mentions: {
    description: "What developers and founders on Hacker News said about something in the last 30 days: the most discussed stories.",
    args: { query: "A company or product name, e.g. Nvidia." },
    async run({ query }) {
      // Hacker News's search (Algolia) needs no key.
      const since = Math.floor(Date.now() / 1000) - 30 * DAY_S;
      const url = `https://hn.algolia.com/api/v1/search?${new URLSearchParams({ query: query ?? "", tags: "story", numericFilters: `created_at_i>${since}`, hitsPerPage: "20" })}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error(`Hacker News search answered ${response.status}`);
      const { hits = [], nbHits = 0 } = (await response.json()) as { nbHits?: number; hits?: { title: string; points: number; num_comments: number; objectID: string; created_at_i: number }[] };
      if (hits.length === 0) return `No Hacker News stories about "${query}" in the last 30 days.`;
      const top = [...hits].sort((a, b) => b.points - a.points).slice(0, 6);
      return [
        `${nbHits} stories in the last 30 days; the most discussed:`,
        ...top.map((h) => `- ${day(h.created_at_i)} · ${h.points} points, ${h.num_comments} comments: ${h.title} (https://news.ycombinator.com/item?id=${h.objectID})`),
      ].join("\n");
    },
  },
});

/**
 * A ticker as given (NVDA, BRK.B), or a name's: its first US-listed common stock on Finnhub. So no
 * tool waits on another to know what to look up.
 */
async function tickerOf(ctx: ToolContext, company: string | undefined): Promise<string> {
  const given = (company ?? "").trim();
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(given)) return given;
  const found = await finnhub<{ result?: { symbol: string; type: string }[] }>(ctx, "/search", { q: given });
  const stock = (found.result ?? []).find((r) => r.type === "Common Stock" && !r.symbol.includes("."));
  if (!stock) throw new Error(`No US-listed stock found for "${given}": it may be private, or listed elsewhere`);
  return stock.symbol;
}

async function finnhub<T>(ctx: ToolContext, path: string, query: Record<string, string>): Promise<T> {
  const key = keyOf(ctx, "FINNHUB_KEY");
  const response = await fetch(`${FINNHUB}${path}?${new URLSearchParams(query)}`, { headers: { "X-Finnhub-Token": key }, signal: AbortSignal.timeout(6_000) });
  if (response.status === 429) throw new Error("Finnhub's rate limit: try again in a minute");
  if (!response.ok) throw new Error(`Finnhub answered ${response.status} for ${path}`);
  return (await response.json()) as T;
}

function keyOf(ctx: ToolContext, name: string): string {
  const key = ctx.env[name];
  if (!key) throw new Error(`${name} is not set: polka vars set ${name}`);
  return key;
}

function line(label: string, a: number | null | undefined, b: number | null | undefined, show: (a: number, b: number) => string): string {
  if (typeof a !== "number" || (b !== null && typeof b !== "number")) return "";
  return `${label}: ${show(a, b ?? 0)}.`;
}

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const signed = (n: number | null) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${money(n)}` : "—");
const billions = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(2)} trillion` : `${(n / 1e9).toFixed(1)} billion`);
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
/** Tavily's dates ("Wed, 29 Oct 2026 14:02:11 GMT") as 2026-10-29; one it cannot read, as it came. */
const dateOf = (text: string) => (Number.isNaN(Date.parse(text)) ? text.slice(0, 16) : new Date(text).toISOString().slice(0, 10));
/** A page's excerpt as one plain line (no markup, comments or page furniture), at most `max` characters. */
function clip(raw: string, max: number): string {
  const text = raw
    .replace(/<!--[\s\S]*?-->|<[^>]+>/g, "")
    .replace(/\b(SHARE THIS ARTICLE|TEXT SIZE)\b/g, "")
    .replace(/[#*_>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
