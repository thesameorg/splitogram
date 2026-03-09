import { eq } from 'drizzle-orm';
import { exchangeRates } from '../db/schema';
import type { Database } from '../db';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours — triggers refresh
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — refuse to use older rates
const API_URL = 'https://open.er-api.com/v6/latest/USD';
const FALLBACK_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';

interface RatesResult {
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * Get exchange rates (USD-based). Reads from D1, refreshes if stale (>24h).
 * Returns null only if both D1 and API are unavailable.
 */
export async function getExchangeRates(db: Database): Promise<RatesResult | null> {
  // Read from D1
  const [row] = await db.select().from(exchangeRates).where(eq(exchangeRates.id, 1)).limit(1);

  const now = Date.now();
  if (row && now - row.fetchedAt * 1000 < STALE_THRESHOLD_MS) {
    return { rates: JSON.parse(row.rates), fetchedAt: row.fetchedAt };
  }

  // Stale or missing — fetch fresh
  const freshRates = await fetchRates();
  if (freshRates) {
    const fetchedAt = Math.floor(now / 1000);
    const ratesJson = JSON.stringify(freshRates);
    if (row) {
      await db
        .update(exchangeRates)
        .set({ rates: ratesJson, fetchedAt })
        .where(eq(exchangeRates.id, 1));
    } else {
      await db.insert(exchangeRates).values({ id: 1, base: 'USD', rates: ratesJson, fetchedAt });
    }
    return { rates: freshRates, fetchedAt };
  }

  // API failed — return stale data if not too old (max 7 days)
  if (row && now - row.fetchedAt * 1000 < MAX_STALE_MS) {
    return { rates: JSON.parse(row.rates), fetchedAt: row.fetchedAt };
  }

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
