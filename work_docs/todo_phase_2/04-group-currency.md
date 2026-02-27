# Group Currency

Priority: **Phase 2 deliverable**. Do this before or alongside formatAmount refactor (T4).

---

## Goal

Each group has a currency. All expenses in the group display in that currency. Purely cosmetic in Phase 2 — no exchange rates, no on-chain implications.

---

## GC1. Database changes

- Add `currency` column to `groups` table (TEXT, default `'USD'`)
- Migration to add column with default value
- Predefined list of ~15 currencies: USD, EUR, GBP, RUB, THB, VND, IDR, PHP, MYR, SGD, AED, TRY, BRL, INR, JPY

---

## GC2. Currency data model

Create a currencies config (not a DB table — it's static):
```ts
const CURRENCIES = {
  USD: { symbol: '$', code: 'USD', name: 'US Dollar', decimals: 2 },
  EUR: { symbol: '€', code: 'EUR', name: 'Euro', decimals: 2 },
  VND: { symbol: '₫', code: 'VND', name: 'Vietnamese Dong', decimals: 0 },
  // ...
};
```

Key: some currencies (VND, IDR, JPY) don't use decimals. Display `₫350,000` not `₫350,000.00`.

---

## GC3. Backend changes

- Group create: accept optional `currency` field (default USD)
- Group settings: `PATCH /api/v1/groups/:id` — allow changing currency
- Group response includes `currency` field
- `formatAmount` on backend (notifications) uses group currency

---

## GC4. Frontend changes

- Group creation form: currency selector (dropdown or picker)
- Group settings page: currency changeable
- All amount displays use group currency format
- Replace hardcoded `$` with dynamic symbol
- `formatAmount(amount, currency)` signature — refactor T4 feeds into this

---

## GC5. Amount storage unchanged

Amounts stay as integers in micro-units (1 USD = 1,000,000 micro). The "micro" unit is currency-agnostic — it's just an integer representing the smallest trackable unit. Display formatting handles decimals based on currency config.

Open question: for currencies like VND where 1 VND = 1 micro-VND, the micro-unit concept is redundant. Keep it uniform anyway? Probably yes for simplicity.
