import { Hono } from 'hono';
import { getExchangeRates } from '../services/exchange-rates';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type RatesEnv = AuthContext & DBContext;

const exchangeRatesApp = new Hono<RatesEnv>();

exchangeRatesApp.get('/', async (c) => {
  const db = c.get('db');
  const result = await getExchangeRates(db);

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
