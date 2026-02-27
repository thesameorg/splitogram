import { getCurrency } from './currencies';

export function formatAmount(microAmount: number, currencyCode: string = 'USD'): string {
  const currency = getCurrency(currencyCode);
  const amount = microAmount / 1_000_000;
  if (currency.decimals === 0) {
    return `${currency.symbol}${Math.round(amount).toLocaleString('en-US')}`;
  }
  return `${currency.symbol}${amount.toFixed(currency.decimals)}`;
}

export function formatSignedAmount(microAmount: number, currencyCode: string = 'USD'): string {
  const currency = getCurrency(currencyCode);
  const amount = microAmount / 1_000_000;
  if (amount === 0) return `${currency.symbol}0${currency.decimals > 0 ? '.' + '0'.repeat(currency.decimals) : ''}`;
  const absStr =
    currency.decimals === 0
      ? Math.round(Math.abs(amount)).toLocaleString('en-US')
      : Math.abs(amount).toFixed(currency.decimals);
  return amount > 0 ? `+${currency.symbol}${absStr}` : `-${currency.symbol}${absStr}`;
}
