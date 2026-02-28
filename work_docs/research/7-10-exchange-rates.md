# Exchange Rates

**Phase:** 7 (cross-group balance), also relevant to Phase 10 (crypto)
**Type:** RESEARCH → decision
**Status:** open

---

## Context

Two separate needs for exchange rates:

### 1. Cross-group balance summary (Phase 7)

Home screen shows total balance across all groups. If user is in groups with different currencies (USD, EUR, THB), we need to convert all to USD for a single total. Approximate rate is fine — this is informational.

### 2. Currency → USDT conversion (Phase 10)

When settling on-chain, convert group currency to USDT. User sees: "You owe €15.00 → ~15.82 USDT." Rate is informational, fetched once at tx time, no locking.

## Requirements

- Single `fetch()` call, no SDK
- Free tier sufficient for MVP usage
- Fiat-to-fiat rates (Phase 7)
- Fiat-to-USDT rates (Phase 10)
- Acceptable staleness: 1-hour cache is fine for Phase 7, fresher for Phase 10

## Options to evaluate

| API                  | Free tier             | Fiat | Crypto | Notes                       |
| -------------------- | --------------------- | ---- | ------ | --------------------------- |
| exchangerate-api.com | 1500 req/month        | yes  | no     | Simple, reliable            |
| open.er-api.com      | Unlimited (open data) | yes  | no     | No API key needed           |
| frankfurter.app      | Unlimited (ECB data)  | yes  | no     | No API key, EUR-based       |
| CoinGecko            | 10K req/month         | yes  | yes    | Has USDT, good for Phase 10 |
| Binance public API   | Generous              | no   | yes    | Crypto only, no fiat pairs  |

## Research tasks

- [ ] Test each API: latency, reliability, response format
- [ ] Can we use one API for both fiat and crypto, or do we need two?
- [ ] Caching strategy: cache in KV? In-memory (per-request)? Cache in D1?
- [ ] How to handle API downtime gracefully (show stale rate? Hide total? Show "rate unavailable"?)
- [ ] Do we need to show "last updated" timestamp to users?

## Decision

_To be filled after research. Phase 7 fiat rates and Phase 10 crypto rates may use different sources._
