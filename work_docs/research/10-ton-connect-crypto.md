# TON Connect & Crypto Settlement

**Phase:** 10
**Type:** RESEARCH → Q&A → implementation
**Status:** open (deferred)

---

## Context

Phase 1 had a basic TON Connect integration with testnet USDT. Code exists but was disabled in Phase 2 (crypto UI removed). Phase 10 re-enables and polishes it.

## Research tasks (do before Phase 10 starts)

### TON Connect SDK state

- [ ] Current version of `@tonconnect/ui-react` — check for breaking changes since Phase 1
- [ ] Wallet compatibility: Tonkeeper, Telegram Wallet, MyTonWallet — which support USDT jettons?
- [ ] Does Telegram Wallet work as a TON Connect provider inside Mini Apps now?
- [ ] Any new official guidance from Telegram on wallet integration in Mini Apps?

### USDT on TON

- [ ] USDT jetton master address (mainnet vs testnet)
- [ ] Transaction construction: jetton transfer message format
- [ ] How to verify a USDT transfer completed via TONAPI
- [ ] Gas estimation for jetton transfers
- [ ] Testnet faucet for testing

### Conversion UX

- [ ] Which API for fiat → USDT rate? (see `exchange-rates.md`)
- [ ] Display format: "You owe €15.00 → ~15.82 USDT at current rate"
- [ ] Store on settlement record: conversion rate, USDT amount, fiat amount, timestamp
- [ ] How to handle rate changes between showing the conversion and user confirming?

### Payment state machine

- [ ] States: `open → payment_pending → settled_onchain` with timeout/rollback
- [ ] How long to wait for on-chain confirmation before showing "pending"?
- [ ] Background polling for confirmation, or user-triggered "refresh"?
- [ ] What if user closes the app mid-payment?

## Q&A decisions needed

1. **Rate API source** — CoinGecko, Binance, or other
2. **Conversion display** — show rate? Show USDT amount only? Show both?
3. **Timeout for pending payments** — auto-rollback after N minutes?
4. **Multiple wallets** — support multiple connected wallets per user, or just one at a time?

## Decision

_Deferred. Revisit when Phases 3-8 are complete._
