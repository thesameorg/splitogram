import type { KVNamespace } from '@cloudflare/workers-types';

const KV_KEY_FRESH = 'exchange_rates:usd';
const KV_KEY_STALE = 'exchange_rates:usd:stale';
const FRESH_TTL = 86400; // 24h
const STALE_TTL = 7 * 86400; // 7 days — fallback if API is down
const API_URL = 'https://open.er-api.com/v6/latest/USD';
const FALLBACK_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';

interface RatesResult {
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * Get exchange rates (USD-based). Reads from KV, refreshes if expired (>24h).
 * Falls back to stale KV entry (up to 7 days) if both APIs fail.
 * Returns null only if KV and APIs are all unavailable.
 */
export async function getExchangeRates(kv: KVNamespace): Promise<RatesResult | null> {
  // Try fresh KV key first
  const cached = await kv.get<RatesResult>(KV_KEY_FRESH, 'json');
  if (cached) return cached;

  // Fresh key expired — fetch from API
  const freshRates = await fetchRates();
  if (freshRates) {
    const result: RatesResult = { rates: freshRates, fetchedAt: Math.floor(Date.now() / 1000) };
    // Write both fresh (24h TTL) and stale (7d TTL) keys
    await Promise.all([
      kv.put(KV_KEY_FRESH, JSON.stringify(result), { expirationTtl: FRESH_TTL }),
      kv.put(KV_KEY_STALE, JSON.stringify(result), { expirationTtl: STALE_TTL }),
    ]);
    return result;
  }

  // API failed — try stale fallback (up to 7 days old)
  const stale = await kv.get<RatesResult>(KV_KEY_STALE, 'json');
  if (stale) return stale;

  return null;
}

/**
 * Convert a micro-unit amount from a given currency to micro-USDT (USD).
 * Returns null if rate is unavailable.
 */
export function convertToMicroUsdt(
  microAmount: number,
  currencyCode: string,
  rates: Record<string, number>,
): number | null {
  if (currencyCode === 'USD') return microAmount;

  const rate = rates[currencyCode];
  if (!rate || rate <= 0) return null;

  // microAmount is in micro-units of the source currency
  // rate = how many units of currencyCode per 1 USD
  // microUSDT = microAmount / rate
  return Math.round(microAmount / rate);
}

async function fetchRates(): Promise<Record<string, number> | null> {
  // Try primary API
  try {
    const resp = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = (await resp.json()) as { result: string; rates: Record<string, number> };
      if (data.result === 'success' && data.rates) {
        return data.rates;
      }
    }
  } catch {
    // Primary failed, try fallback
  }

  // Try fallback
  try {
    const resp = await fetch(FALLBACK_URL, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = (await resp.json()) as { usd: Record<string, number> };
      if (data.usd) {
        // Fallback uses lowercase keys — convert to uppercase
        const rates: Record<string, number> = {};
        for (const [key, value] of Object.entries(data.usd)) {
          rates[key.toUpperCase()] = value;
        }
        return rates;
      }
    }
  } catch {
    // Both failed
  }

  return null;
}
