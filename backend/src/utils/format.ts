import { getCurrency } from './currencies';

export function formatAmount(microAmount: number, currencyCode: string = 'USD'): string {
  const currency = getCurrency(currencyCode);
  const amount = microAmount / 1_000_000;
  if (currency.decimals === 0) {
    return `${currency.symbol}${Math.round(amount).toLocaleString('en-US')}`;
  }
  return `${currency.symbol}${amount.toFixed(currency.decimals)}`;
}
