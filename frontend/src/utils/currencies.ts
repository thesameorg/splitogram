export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const CURRENCIES: Record<string, CurrencyConfig> = {
  // Major
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  EUR: { code: 'EUR', symbol: '\u20AC', name: 'Euro', decimals: 2 },
  GBP: { code: 'GBP', symbol: '\u00A3', name: 'British Pound', decimals: 2 },
  JPY: { code: 'JPY', symbol: '\u00A5', name: 'Japanese Yen', decimals: 0 },
  CHF: { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', decimals: 2 },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', decimals: 2 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', decimals: 2 },
  NZD: { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', decimals: 2 },
  CNY: { code: 'CNY', symbol: '\u00A5', name: 'Chinese Yuan', decimals: 2 },
  HKD: { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', decimals: 2 },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', decimals: 2 },

  // Europe
  SEK: { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', decimals: 2 },
  NOK: { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', decimals: 2 },
  DKK: { code: 'DKK', symbol: 'kr', name: 'Danish Krone', decimals: 2 },
  PLN: { code: 'PLN', symbol: 'z\u0142', name: 'Polish Zloty', decimals: 2 },
  CZK: { code: 'CZK', symbol: 'K\u010D', name: 'Czech Koruna', decimals: 2 },
  HUF: { code: 'HUF', symbol: 'Ft', name: 'Hungarian Forint', decimals: 2 },
  RON: { code: 'RON', symbol: 'lei', name: 'Romanian Leu', decimals: 2 },
  BGN: { code: 'BGN', symbol: '\u043B\u0432', name: 'Bulgarian Lev', decimals: 2 },
  HRK: { code: 'HRK', symbol: 'kn', name: 'Croatian Kuna', decimals: 2 },
  RSD: { code: 'RSD', symbol: 'din', name: 'Serbian Dinar', decimals: 2 },
  ISK: { code: 'ISK', symbol: 'kr', name: 'Icelandic Krona', decimals: 0 },
  ALL: { code: 'ALL', symbol: 'L', name: 'Albanian Lek', decimals: 2 },
  MKD: { code: 'MKD', symbol: 'den', name: 'Macedonian Denar', decimals: 2 },
  BAM: { code: 'BAM', symbol: 'KM', name: 'Bosnia-Herzegovina Mark', decimals: 2 },
  MDL: { code: 'MDL', symbol: 'L', name: 'Moldovan Leu', decimals: 2 },
  UAH: { code: 'UAH', symbol: '\u20B4', name: 'Ukrainian Hryvnia', decimals: 2 },
  RUB: { code: 'RUB', symbol: '\u20BD', name: 'Russian Ruble', decimals: 2 },
  BYN: { code: 'BYN', symbol: 'Br', name: 'Belarusian Ruble', decimals: 2 },
  GEL: { code: 'GEL', symbol: '\u20BE', name: 'Georgian Lari', decimals: 2 },
  AMD: { code: 'AMD', symbol: '\u058F', name: 'Armenian Dram', decimals: 2 },
  AZN: { code: 'AZN', symbol: '\u20BC', name: 'Azerbaijani Manat', decimals: 2 },
  TRY: { code: 'TRY', symbol: '\u20BA', name: 'Turkish Lira', decimals: 2 },

  // Asia
  INR: { code: 'INR', symbol: '\u20B9', name: 'Indian Rupee', decimals: 2 },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', decimals: 0 },
  THB: { code: 'THB', symbol: '\u0E3F', name: 'Thai Baht', decimals: 2 },
  VND: { code: 'VND', symbol: '\u20AB', name: 'Vietnamese Dong', decimals: 0 },
  PHP: { code: 'PHP', symbol: '\u20B1', name: 'Philippine Peso', decimals: 2 },
  MYR: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', decimals: 2 },
  KRW: { code: 'KRW', symbol: '\u20A9', name: 'South Korean Won', decimals: 0 },
  TWD: { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar', decimals: 2 },
  PKR: { code: 'PKR', symbol: '\u20A8', name: 'Pakistani Rupee', decimals: 2 },
  BDT: { code: 'BDT', symbol: '\u09F3', name: 'Bangladeshi Taka', decimals: 2 },
  LKR: { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', decimals: 2 },
  NPR: { code: 'NPR', symbol: 'Rs', name: 'Nepalese Rupee', decimals: 2 },
  MMK: { code: 'MMK', symbol: 'K', name: 'Myanmar Kyat', decimals: 2 },
  KHR: { code: 'KHR', symbol: '\u17DB', name: 'Cambodian Riel', decimals: 2 },
  LAK: { code: 'LAK', symbol: '\u20AD', name: 'Lao Kip', decimals: 2 },
  MNT: { code: 'MNT', symbol: '\u20AE', name: 'Mongolian Tugrik', decimals: 2 },
  KZT: { code: 'KZT', symbol: '\u20B8', name: 'Kazakhstani Tenge', decimals: 2 },
  UZS: { code: 'UZS', symbol: 'so\u02BBm', name: 'Uzbekistani Som', decimals: 2 },
  KGS: { code: 'KGS', symbol: 'som', name: 'Kyrgyzstani Som', decimals: 2 },
  TJS: { code: 'TJS', symbol: 'SM', name: 'Tajikistani Somoni', decimals: 2 },
  TMT: { code: 'TMT', symbol: 'T', name: 'Turkmenistani Manat', decimals: 2 },

  // Middle East
  AED: { code: 'AED', symbol: 'AED', name: 'UAE Dirham', decimals: 2 },
  SAR: { code: 'SAR', symbol: '\uFDFC', name: 'Saudi Riyal', decimals: 2 },
  QAR: { code: 'QAR', symbol: 'QR', name: 'Qatari Riyal', decimals: 2 },
  KWD: { code: 'KWD', symbol: 'KD', name: 'Kuwaiti Dinar', decimals: 3 },
  BHD: { code: 'BHD', symbol: 'BD', name: 'Bahraini Dinar', decimals: 3 },
  OMR: { code: 'OMR', symbol: 'OMR', name: 'Omani Rial', decimals: 3 },
  JOD: { code: 'JOD', symbol: 'JD', name: 'Jordanian Dinar', decimals: 3 },
  ILS: { code: 'ILS', symbol: '\u20AA', name: 'Israeli Shekel', decimals: 2 },
  LBP: { code: 'LBP', symbol: 'L\u00A3', name: 'Lebanese Pound', decimals: 2 },
  IQD: { code: 'IQD', symbol: 'IQD', name: 'Iraqi Dinar', decimals: 3 },
  IRR: { code: 'IRR', symbol: '\uFDFC', name: 'Iranian Rial', decimals: 2 },

  // Africa
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand', decimals: 2 },
  EGP: { code: 'EGP', symbol: 'E\u00A3', name: 'Egyptian Pound', decimals: 2 },
  NGN: { code: 'NGN', symbol: '\u20A6', name: 'Nigerian Naira', decimals: 2 },
  KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', decimals: 2 },
  GHS: { code: 'GHS', symbol: 'GH\u20B5', name: 'Ghanaian Cedi', decimals: 2 },
  TZS: { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', decimals: 2 },
  UGX: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimals: 0 },
  ETB: { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr', decimals: 2 },
  MAD: { code: 'MAD', symbol: 'MAD', name: 'Moroccan Dirham', decimals: 2 },
  TND: { code: 'TND', symbol: 'DT', name: 'Tunisian Dinar', decimals: 3 },
  DZD: { code: 'DZD', symbol: 'DA', name: 'Algerian Dinar', decimals: 2 },
  XOF: { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc', decimals: 0 },
  XAF: { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc', decimals: 0 },
  RWF: { code: 'RWF', symbol: 'RF', name: 'Rwandan Franc', decimals: 0 },
  MZN: { code: 'MZN', symbol: 'MT', name: 'Mozambican Metical', decimals: 2 },
  AOA: { code: 'AOA', symbol: 'Kz', name: 'Angolan Kwanza', decimals: 2 },
  ZMW: { code: 'ZMW', symbol: 'ZK', name: 'Zambian Kwacha', decimals: 2 },
  BWP: { code: 'BWP', symbol: 'P', name: 'Botswana Pula', decimals: 2 },
  MUR: { code: 'MUR', symbol: 'Rs', name: 'Mauritian Rupee', decimals: 2 },
  SCR: { code: 'SCR', symbol: 'Rs', name: 'Seychellois Rupee', decimals: 2 },
  NAD: { code: 'NAD', symbol: 'N$', name: 'Namibian Dollar', decimals: 2 },
  SZL: { code: 'SZL', symbol: 'E', name: 'Eswatini Lilangeni', decimals: 2 },
  LSL: { code: 'LSL', symbol: 'L', name: 'Lesotho Loti', decimals: 2 },
  MWK: { code: 'MWK', symbol: 'MK', name: 'Malawian Kwacha', decimals: 2 },
  CDF: { code: 'CDF', symbol: 'FC', name: 'Congolese Franc', decimals: 2 },
  SDG: { code: 'SDG', symbol: 'SDG', name: 'Sudanese Pound', decimals: 2 },
  LYD: { code: 'LYD', symbol: 'LD', name: 'Libyan Dinar', decimals: 3 },
  GMD: { code: 'GMD', symbol: 'D', name: 'Gambian Dalasi', decimals: 2 },
  CVE: { code: 'CVE', symbol: 'Esc', name: 'Cape Verdean Escudo', decimals: 2 },

  // Americas
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', decimals: 2 },
  MXN: { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', decimals: 2 },
  ARS: { code: 'ARS', symbol: 'AR$', name: 'Argentine Peso', decimals: 2 },
  CLP: { code: 'CLP', symbol: 'CL$', name: 'Chilean Peso', decimals: 0 },
  COP: { code: 'COP', symbol: 'CO$', name: 'Colombian Peso', decimals: 2 },
  PEN: { code: 'PEN', symbol: 'S/', name: 'Peruvian Sol', decimals: 2 },
  UYU: { code: 'UYU', symbol: '$U', name: 'Uruguayan Peso', decimals: 2 },
  PYG: { code: 'PYG', symbol: '\u20B2', name: 'Paraguayan Guarani', decimals: 0 },
  BOB: { code: 'BOB', symbol: 'Bs', name: 'Bolivian Boliviano', decimals: 2 },
  VES: { code: 'VES', symbol: 'Bs.S', name: 'Venezuelan Bolivar', decimals: 2 },
  CRC: { code: 'CRC', symbol: '\u20A1', name: 'Costa Rican Colon', decimals: 2 },
  PAB: { code: 'PAB', symbol: 'B/', name: 'Panamanian Balboa', decimals: 2 },
  DOP: { code: 'DOP', symbol: 'RD$', name: 'Dominican Peso', decimals: 2 },
  GTQ: { code: 'GTQ', symbol: 'Q', name: 'Guatemalan Quetzal', decimals: 2 },
  HNL: { code: 'HNL', symbol: 'L', name: 'Honduran Lempira', decimals: 2 },
  NIO: { code: 'NIO', symbol: 'C$', name: 'Nicaraguan Cordoba', decimals: 2 },
  JMD: { code: 'JMD', symbol: 'J$', name: 'Jamaican Dollar', decimals: 2 },
  TTD: { code: 'TTD', symbol: 'TT$', name: 'Trinidad & Tobago Dollar', decimals: 2 },
  BBD: { code: 'BBD', symbol: 'Bds$', name: 'Barbadian Dollar', decimals: 2 },
  BSD: { code: 'BSD', symbol: 'B$', name: 'Bahamian Dollar', decimals: 2 },
  BZD: { code: 'BZD', symbol: 'BZ$', name: 'Belize Dollar', decimals: 2 },
  SRD: { code: 'SRD', symbol: 'SR$', name: 'Surinamese Dollar', decimals: 2 },
  GYD: { code: 'GYD', symbol: 'G$', name: 'Guyanese Dollar', decimals: 2 },
  HTG: { code: 'HTG', symbol: 'G', name: 'Haitian Gourde', decimals: 2 },
  CUP: { code: 'CUP', symbol: '\u20B1', name: 'Cuban Peso', decimals: 2 },

  // Oceania
  FJD: { code: 'FJD', symbol: 'FJ$', name: 'Fijian Dollar', decimals: 2 },
  PGK: { code: 'PGK', symbol: 'K', name: 'Papua New Guinean Kina', decimals: 2 },
  WST: { code: 'WST', symbol: 'T', name: 'Samoan Tala', decimals: 2 },
  TOP: { code: 'TOP', symbol: 'T$', name: 'Tongan Pa\u02BBanga', decimals: 2 },
  VUV: { code: 'VUV', symbol: 'VT', name: 'Vanuatu Vatu', decimals: 0 },
  SBD: { code: 'SBD', symbol: 'SI$', name: 'Solomon Islands Dollar', decimals: 2 },

  // Caribbean & other
  AWG: { code: 'AWG', symbol: 'Afl', name: 'Aruban Florin', decimals: 2 },
  ANG: { code: 'ANG', symbol: 'NA\u0192', name: 'Netherlands Antillean Guilder', decimals: 2 },
  XCD: { code: 'XCD', symbol: 'EC$', name: 'East Caribbean Dollar', decimals: 2 },
  BMD: { code: 'BMD', symbol: 'BD$', name: 'Bermudian Dollar', decimals: 2 },
  KYD: { code: 'KYD', symbol: 'CI$', name: 'Cayman Islands Dollar', decimals: 2 },

  // Other
  XPF: { code: 'XPF', symbol: '\u20A3', name: 'CFP Franc', decimals: 0 },
  MVR: { code: 'MVR', symbol: 'Rf', name: 'Maldivian Rufiyaa', decimals: 2 },
  BND: { code: 'BND', symbol: 'B$', name: 'Brunei Dollar', decimals: 2 },
  MOP: { code: 'MOP', symbol: 'MOP$', name: 'Macanese Pataca', decimals: 2 },
  AFN: { code: 'AFN', symbol: '\u060B', name: 'Afghan Afghani', decimals: 2 },
  SYP: { code: 'SYP', symbol: 'SYP', name: 'Syrian Pound', decimals: 2 },
  YER: { code: 'YER', symbol: '\uFDFC', name: 'Yemeni Rial', decimals: 2 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

export function getCurrency(code: string): CurrencyConfig {
  return CURRENCIES[code] ?? CURRENCIES['USD'];
}

export const PINNED_CURRENCIES = ['USD'];

export const CURRENCY_LIST: CurrencyConfig[] = (() => {
  const pinned = PINNED_CURRENCIES.map((code) => CURRENCIES[code]);
  const rest = Object.values(CURRENCIES)
    .filter((c) => !PINNED_CURRENCIES.includes(c.code))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...pinned, ...rest];
})();

export function searchCurrencies(query: string): CurrencyConfig[] {
  if (!query.trim()) return CURRENCY_LIST;
  const q = query.toLowerCase().trim();
  return CURRENCY_LIST.filter(
    (c) =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.symbol.toLowerCase().includes(q),
  );
}
