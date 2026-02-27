export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const CURRENCIES: Record<string, CurrencyConfig> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  EUR: { code: 'EUR', symbol: '\u20AC', name: 'Euro', decimals: 2 },
  GBP: { code: 'GBP', symbol: '\u00A3', name: 'British Pound', decimals: 2 },
  RUB: { code: 'RUB', symbol: '\u20BD', name: 'Russian Ruble', decimals: 2 },
  THB: { code: 'THB', symbol: '\u0E3F', name: 'Thai Baht', decimals: 2 },
  VND: { code: 'VND', symbol: '\u20AB', name: 'Vietnamese Dong', decimals: 0 },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', decimals: 0 },
  PHP: { code: 'PHP', symbol: '\u20B1', name: 'Philippine Peso', decimals: 2 },
  MYR: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', decimals: 2 },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', decimals: 2 },
  AED: { code: 'AED', symbol: 'AED', name: 'UAE Dirham', decimals: 2 },
  TRY: { code: 'TRY', symbol: '\u20BA', name: 'Turkish Lira', decimals: 2 },
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', decimals: 2 },
  INR: { code: 'INR', symbol: '\u20B9', name: 'Indian Rupee', decimals: 2 },
  JPY: { code: 'JPY', symbol: '\u00A5', name: 'Japanese Yen', decimals: 0 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

export function getCurrency(code: string): CurrencyConfig {
  return CURRENCIES[code] ?? CURRENCIES['USD'];
}
