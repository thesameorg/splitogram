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

### Settlement economics & gas threshold

- [ ] Profile actual gas costs on testnet: contract settlement (3-message chain) vs direct transfer (1 message)
- [ ] Determine threshold N% — if gas > N% of settlement amount, use direct transfer instead of contract
- [ ] Measure gas variability under different network loads
- [ ] TON/USD rate for gas estimation — use cached rate from exchange-rates service or TONAPI?
- [ ] Track direct settlements separately (they bypass the contract's `total_processed` counter)
- [ ] UX: silent fallback or explicit "Direct transfer (no fee)" vs "Via SplitBill (1% commission)" choice?

### Currency scope

- [ ] Confirm USDT-only for Phase 10 (no native TON, no other Jettons)
- [ ] If TON coin settlement is ever added: needs price oracle, slippage, second `receive()` handler — same contract, no new deployment
- [ ] Multi-Jetton: same contract with `accepted_jettons` map — evaluate demand before building

## Q&A decisions needed

1. **Rate API source** — CoinGecko, Binance, or other
2. **Conversion display** — show rate? Show USDT amount only? Show both?
3. **Timeout for pending payments** — auto-rollback after N minutes?
4. **Multiple wallets** — support multiple connected wallets per user, or just one at a time?
5. **Direct transfer threshold** — what % of settlement amount makes gas "too expensive"? (5%? 10%?)
6. **Direct transfer UX** — silent fallback or user choice?

## Decision

- **Currency:** USDT only for Phase 10. TON coin and multi-Jetton deferred to Phase 11.
- **Economics:** Direct transfer fallback for small amounts where gas > N% of settlement. Threshold TBD after testnet gas profiling. See `smart-contract.md` Appendix B for full economics.
- _Other decisions deferred. Revisit when ready to start Phase 10._
