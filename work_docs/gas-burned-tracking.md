# TON Gas Burned Tracking

## Problem

We don't store TON gas fees in the DB. The settlement flow estimates gas at preflight time (`estimateSettlementGas()` in `services/tonapi.ts`) but doesn't persist it.

## Current State

- `settlements` table has: `usdtAmount`, `commission` (both micro-USDT)
- No column for TON gas burned
- Gas estimation happens in preflight, result is used for `gasAttach` sent to frontend
- Actual gas burned = attached TON - excess refunded (not tracked)

## Options

### Option A: New column `ton_gas_burned` on settlements

- Add `integer('ton_gas_burned')` to settlements (nanoTON)
- Populate during `confirm` step: after verifying on-chain via TONAPI events, fetch the transaction trace and sum `total_fees`
- Pro: accurate, source of truth
- Con: requires extra TONAPI call during confirm, new migration

### Option B: Populate from TONAPI at admin dashboard load time

- For each on-chain settlement with a `txHash`, fetch trace from TONAPI and compute gas
- Pro: no schema change
- Con: slow (1 API call per TX), rate limits, fragile

### Option C: Store estimated gas at preflight time

- Add column, populate with the emulated gas estimate during preflight or verify step
- Pro: simple, already computed
- Con: estimate != actual (though usually close with emulation)

## Recommendation

**Option A** — store actual gas burned during the `confirm` step. The TONAPI event response already contains fee data in the trace. Minimal extra work since we're already calling TONAPI to verify the settlement.

### Implementation Steps

1. Migration: `ALTER TABLE settlements ADD COLUMN ton_gas_burned INTEGER`
2. In `confirm` handler (`settlements.ts`): after `verifySettlementOnChain` succeeds, extract `total_fees` from the event trace and store it
3. Admin dashboard: add "TON Burned" column to on-chain TX table, sum for total metric card
4. Bot stats: add "Gas burned: ~X TON" line

## Data to Backfill

Existing on-chain settlements can be backfilled via a one-time script that fetches each `txHash` from TONAPI and extracts fees from the trace.
