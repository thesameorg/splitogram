import { getCurrency } from './currencies';

function addThousandsSeparator(numStr: string): string {
  const [intPart, decPart] = numStr.split('.');
  const separated = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${separated}.${decPart}` : separated;
}

export function formatAmount(microAmount: number, currencyCode: string = 'USD'): string {
  const currency = getCurrency(currencyCode);
  const amount = microAmount / 1_000_000;
  const numStr =
    currency.decimals === 0 ? Math.round(amount).toString() : amount.toFixed(currency.decimals);
  return `${currency.symbol}${addThousandsSeparator(numStr)}`;
}

export function formatSignedAmount(microAmount: number, currencyCode: string = 'USD'): string {
  const currency = getCurrency(currencyCode);
  const amount = microAmount / 1_000_000;
  if (amount === 0)
    return `${currency.symbol}0${currency.decimals > 0 ? '.' + '0'.repeat(currency.decimals) : ''}`;
  const absStr = addThousandsSeparator(
    currency.decimals === 0
      ? Math.round(Math.abs(amount)).toString()
      : Math.abs(amount).toFixed(currency.decimals),
  );
  return amount > 0 ? `+${currency.symbol}${absStr}` : `-${currency.symbol}${absStr}`;
}
