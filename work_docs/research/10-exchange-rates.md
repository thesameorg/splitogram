# Exchange Rates

**Phase:** 7 (cross-group balance), also relevant to Phase 10 (crypto)
**Type:** RESEARCH → decision
**Status:** DECIDED

---

## Context

Two separate needs for exchange rates:

### 1. Cross-group balance summary (Phase 7+)

Home screen shows total balance across all groups. If user is in groups with different currencies (USD, EUR, THB), we need to convert all to USD for a single total. Approximate rate is fine — this is informational only.

### 2. Currency → USDT conversion (Phase 10)

When settling on-chain via TON Connect SDK, user sees: "You owe €15.00 → ~15.82 USDT." Rate is informational, fetched once at settlement screen load. USD = USDT (stablecoin, ~1:1). For non-USD currencies, convert to USD first using cached rates, then display as USDT equivalent.

---

## API Comparison

Tested 4 free APIs on March 2, 2026:

| Criteria                | open.er-api.com            | fawazahmed0 (jsDelivr) | frankfurter.app     | exchangerate-api.com (v6)  |
| ----------------------- | -------------------------- | ---------------------- | ------------------- | -------------------------- |
| **API Key**             | Not required               | Not required           | Not required        | **REQUIRED** (403 without) |
| **Currencies**          | 166                        | 341 (fiat + crypto)    | 30 (ECB only)       | N/A (blocked)              |
| **Splitogram coverage** | **137/137 (100%)**         | **137/137 (100%)**     | 30/137 (22%)        | N/A                        |
| **Base currency**       | USD (configurable)         | USD (lowercase keys)   | EUR only            | N/A                        |
| **Key format**          | Uppercase (`EUR`)          | Lowercase (`eur`)      | Uppercase           | N/A                        |
| **Update frequency**    | Daily (~00:00 UTC)         | Daily                  | Weekdays only (ECB) | N/A                        |
| **Response size**       | ~3 KB                      | ~7.5 KB                | ~434 bytes          | N/A                        |
| **Rate limit**          | Soft (429 resets in 20min) | Unlimited (CDN)        | None documented     | 1500 req/month             |
| **CORS**                | Yes                        | Yes                    | Yes                 | N/A                        |

### Eliminated

- **exchangerate-api.com** — requires API key, 1500 req/month free tier. Overkill for daily fetch.
- **frankfurter.app** — only 30 currencies (ECB data). Missing 107 of our 137 currencies (no VND, RUB, UAH, PKR, etc.). No weekend updates.

### Viable

- **open.er-api.com** — perfect fit. 100% coverage, uppercase keys match our `CURRENCIES` record directly, USD base, ~3KB.
- **fawazahmed0** — strong fallback. 100% coverage, but lowercase keys require mapping. CDN-hosted (unlimited). Has crypto rates too.

---

## Rate Cross-Sanity Check

Compared rates from open.er-api, fawazahmed0, frankfurter, XE.com, X-Rates, FloatRates, Wise (March 1-2, 2026):

| Currency | open.er-api | XE.com   | X-Rates | FloatRates | Max divergence |
| -------- | ----------- | -------- | ------- | ---------- | -------------- |
| EUR      | 0.8470      | 0.8464   | 0.8468  | 0.85       | < 0.4%         |
| GBP      | 0.7420      | 0.7416   | 0.7415  | 0.74       | < 0.3%         |
| THB      | 31.069      | 31.081   | 31.009  | 31.05      | < 0.2%         |
| JPY      | 156.04      | 156.05   | 155.48  | 155.93     | < 0.4%         |
| IDR      | 16,792      | 16,778   | 16,780  | 16,801     | < 0.1%         |
| RUB      | 77.01       | 77.28    | 77.26   | 77.42      | < 0.5%         |
| INR      | 91.11       | 91.08    | 90.95   | 91.04      | < 0.2%         |
| KRW      | 1,441       | 1,439    | 1,442   | 1,439      | < 0.2%         |
| BRL      | 5.143       | 5.136    | 5.128   | 5.15       | < 0.4%         |
| VND      | 26,053      | 25,620\* | —       | 26,051     | ~0.5%\*\*      |

\*XE.com VND figure appears to be a stale off-hours snapshot. Wise, FloatRates, and open.er-api all agree around 26,045-26,058.

**All sources agree within <0.5% for all tested currencies.** open.er-api rates are accurate and consistent with premium sources.

---

## Decision

### Fiat rates: `open.er-api.com`

**Endpoint:** `https://open.er-api.com/v6/latest/USD`

```json
{
  "result": "success",
  "base_code": "USD",
  "time_last_update_utc": "Mon, 02 Mar 2026 00:00:01 +0000",
  "rates": {
    "EUR": 0.846965,
    "GBP": 0.741974,
    "THB": 31.069475,
    ...
  }
}
```

**Why:**

- 100% coverage of all 137 Splitogram currencies
- Uppercase keys match our `CURRENCIES` record — zero mapping needed: `rates[currencyCode]`
- USD base out of the box — no conversion math
- ~3 KB response — trivial for a Worker fetch
- No API key, no signup
- Hosted on Cloudflare (same infra)

**Fallback:** `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` (requires `.toUpperCase()` on lookup)

### Crypto rates: not needed separately

- **USD = USDT** (stablecoin, pegged ~1:1). No conversion API needed.
- For non-USD group currencies: convert to USD using cached fiat rates, display as "~X USDT".
- If user's group is in EUR and they owe €15, show: "€15.00 → ~$17.72 USDT" using `amount / rates.EUR`.
- Actual on-chain settlement amount is in USDT micro-units — the rate is informational only, no locking.
- TON Connect SDK handles the actual wallet interaction and transaction signing.
- If we ever need TON coin rates (not USDT), TONAPI or a single CoinGecko call at settlement time.

### Caching strategy: fetch once daily, store in D1

Dead simple approach — no KV, no in-memory caching:

1. **D1 table** `exchange_rates`: single row with `base` (always 'USD'), `rates` (JSON blob), `fetched_at` (timestamp).
2. **On API request that needs rates** (cross-group balance, settlement screen): read from D1. If `fetched_at` is older than 24h or missing, fetch fresh from open.er-api, upsert into D1, return.
3. **If fetch fails** (API down, timeout): use stale D1 data. Show "Rates from [date]" hint if older than 48h. Never block the UI.
4. **Conversion math**: `amountInUSD = amountInLocal / rates[currencyCode]`. For USD groups, rate is 1 — no conversion.

This means:

- ~1 external API call per day (first request after midnight UTC triggers refresh)
- Zero KV cost
- Rates survive Worker restarts (persisted in D1)
- Graceful degradation — stale rates are better than no rates

### Downtime handling

- If D1 has rates (even stale): use them. Approximate rates don't go bad overnight.
- If D1 is empty AND fetch fails: show per-currency balances without USD total (current behavior). No crash.
- No "last updated" timestamp in UI — rates are informational, not financial-grade. Exception: if rates are >48h old, show subtle "(approximate)" label.

---

## Implementation scope

### New DB table

```sql
CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY DEFAULT 1,  -- single row
  base TEXT NOT NULL DEFAULT 'USD',
  rates TEXT NOT NULL,                -- JSON: {"EUR": 0.847, "GBP": 0.742, ...}
  fetched_at INTEGER NOT NULL         -- unix timestamp
);
```

### New backend service

`backend/src/services/exchange-rates.ts`:

- `getExchangeRates(db): Promise<{ rates: Record<string, number>, fetchedAt: number }>`
- Reads D1, refreshes if stale (>24h), returns rates map
- `convertToUSD(amount: number, currencyCode: string, rates: Record<string, number>): number`

### API endpoint

- `GET /api/v1/exchange-rates` — returns current rates + fetchedAt (for frontend cross-group balance)
- Or: backend computes USD totals server-side and returns them in existing balance endpoints

### Frontend changes

- Home page: after fetching per-group balances, convert each to USD using rates, sum for total
- Settlement screen (Phase 10): show "€15.00 → ~17.72 USDT" using rates

---

## What this does NOT cover

- Real-time trading rates (not needed — we're an expense splitter, not a forex platform)
- Rate locking or guarantees (USDT settlement is informational rate only)
- Multiple rate sources blended together (one source is accurate enough at <0.5% divergence)
- Crypto coin rates (TON, BTC etc.) — deferred until needed, single CoinGecko call if so
