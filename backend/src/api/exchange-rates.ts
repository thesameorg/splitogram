import { Hono } from 'hono';
import { getExchangeRates } from '../services/exchange-rates';
import type { AuthContext } from '../middleware/auth';
import type { Env } from '../env';

type RatesEnv = AuthContext & { Bindings: Env };

const exchangeRatesApp = new Hono<RatesEnv>();

exchangeRatesApp.get('/', async (c) => {
  const result = await getExchangeRates(c.env.KV);

  if (!result) {
    return c.json({ error: 'rates_unavailable', detail: 'Exchange rates unavailable' }, 503);
  }

  return c.json({
    base: 'USD',
    rates: result.rates,
    fetchedAt: result.fetchedAt,
  });
});

export { exchangeRatesApp };
