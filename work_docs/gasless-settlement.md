# Phase 11: Gasless Settlement (W5 Wallet Support)

## Goal

Enable users with W5 wallets to settle USDT debts **without holding TON for gas**. The app relays their signed transaction via TONAPI Gasless API. Users with v4r2 wallets continue using the existing flow (self-pay gas). The settlement contract itself doesn't change — only the submission method differs.

## Key Insight

The existing `SplitogramSettlement` contract works for both flows. It receives a Jetton transfer regardless of how it was submitted. The difference:

| | v4r2 (current) | W5 (gasless) |
|---|---|---|
| Who pays gas | User (attaches ~0.5 TON) | TONAPI relay (gas proxy contract) |
| How tx is sent | TON Connect `sendTransaction` | User signs → backend relays via TONAPI `/v2/gasless/send` |
| User needs TON? | Yes | No |
| Contract change? | N/A | None — same contract |

**No new smart contract deployment needed.** The SplitogramSettlement contract is the recipient — it doesn't care who paid gas.

## Actor / Wallet Version Matrix

Important: wallet versions of different actors are **completely independent**. Only the debtor's wallet version determines the settlement flow.

| Actor | What it is | Wallet version | Affects flow? |
|---|---|---|---|
| **SplitogramSettlement** | Custom Tact contract (not a wallet) | N/A — it's a smart contract | No. Processes any incoming Jetton transfer identically. |
| **Debtor (payer)** | User's TON wallet | **v4r2 or W5** | **YES — the only actor that matters.** W5 → gasless. v4r2 → standard. |
| **Creditor (recipient)** | User's TON wallet | Any (v3r2, v4r2, W5) | No. Receives Jetton transfer from contract. Wallet version irrelevant. |
| **Contract owner** | Our admin wallet (`0QAoBJzd06D3...`) | v4r2 (currently) | No. Only used for admin ops (UpdateCommission, WithdrawTon). |
| **Debtor's Jetton wallet** | Standard Jetton wallet contract | N/A — Jetton standard, not a user wallet | No. Holds debtor's USDT. Fixed by TEP-74 standard. |
| **Contract's Jetton wallet** | Standard Jetton wallet contract | N/A | No. Set via `SetJettonWallet`. |
| **Creditor's Jetton wallet** | Standard Jetton wallet contract | N/A | No. Receives forwarded USDT. |
| **TONAPI Gas Proxy** | Internal TONAPI relay contract | N/A — managed by TONAPI | No. Only involved in W5 gasless flow. We don't deploy/control this. |

**Bottom line:** W5 is a *user wallet* standard. The settlement contract is a *custom smart contract* — it has no wallet version. A W5 debtor sending USDT to our v4-era Tact contract works perfectly. A v4r2 debtor sending to the same contract also works. The contract just sees "incoming Jetton transfer" either way.

### Flow comparison by debtor wallet version

**v4r2 debtor (standard, current):**
```
Debtor's v4r2 wallet
  → (external msg, debtor pays ~0.5 TON gas)
  → Debtor's Jetton Wallet (TokenTransfer)
  → SplitogramSettlement contract (receives USDT)
  → takes 1% commission
  → forwards remainder to Creditor's Jetton Wallet
```

**W5 debtor (gasless, new):**
```
TONAPI Gas Proxy
  → (internal msg, proxy pays gas in TON, recoups via Jetton fee)
  → Debtor's W5 wallet (executes signed action)
  → Debtor's Jetton Wallet (TokenTransfer)
  → SplitogramSettlement contract (receives USDT)  ← IDENTICAL FROM HERE
  → takes 1% commission
  → forwards remainder to Creditor's Jetton Wallet
```

The contract sees the exact same Jetton transfer in both cases. The difference is upstream (how the debtor's wallet was triggered).

## What the User Missed

1. **No new contract needed** — the settlement contract is the same. Only the *submission path* differs.
2. **Relayer wallet not needed on our side** — TONAPI's Gasless API *is* the relayer. They run gas proxy contracts. We just call their API. Cost covered by deducting a small Jetton fee from the user's transfer (TONAPI handles this).
3. **TONAPI Gasless pricing** — TONAPI charges via their gas proxy. The fee is deducted from the Jetton transfer itself (e.g., user sends 50.2 USDT instead of 50 USDT — extra covers gas). We need to estimate this via `/v2/gasless/estimate/{master_id}` and show it to the user.
4. **Frontend signing flow is different** — W5 gasless doesn't use `tonConnectUI.sendTransaction()`. Instead: build the internal message → call TONAPI estimate → get the relay payload → sign via TON Connect → send signed BOC to TONAPI `/v2/gasless/send`.
5. **Wallet version can change** — user might switch from v4r2 to W5 in their wallet app. Need to re-detect on each wallet connect, not just once.
6. **TONAPI key required** — Gasless API needs a TONAPI API key (already have `TONAPI_KEY` in env).
7. **Supported Jettons** — Not all Jettons support gasless. Need to check via `/v2/gasless/config` that tUSDT/USDT is supported.
8. **Admin monitoring** — track gas costs vs commission revenue per settlement type.

## Implementation Plan

### Step 1: Wallet Version Detection

**Goal:** When user connects wallet via TON Connect, detect whether it's W5 or v4r2 and store it.

**DB Migration (0012):**
```sql
ALTER TABLE users ADD COLUMN wallet_version TEXT;
-- Values: 'W5', 'v4r2', 'v4r1', 'v3r2', or NULL (no wallet)
```

**Backend:**
- `PUT /api/v1/users/me/wallet` — after receiving wallet address, call TONAPI to detect version:
  ```
  GET /v2/accounts/{address}
  ```
  Response includes `interfaces` array (e.g., `["wallet_v5r1"]`) or wallet contract info. Parse to determine version.
- Store `walletVersion` in `users` table alongside `walletAddress`.
- Return `walletVersion` in auth response and `GET /api/v1/users/me`.
- On `DELETE /api/v1/users/me/wallet` — clear both `walletAddress` and `walletVersion`.

**Frontend:**
- `useTonWallet.ts` — no change to connect flow, version comes from backend response.
- Account page — show wallet version label next to address (e.g., "W5" badge or "v4r2" badge).
- If W5: show small "Gasless" indicator.

**Files to modify:**
- `backend/src/db/schema.ts` — add `walletVersion` column
- `backend/src/api/users.ts` — update wallet PUT endpoint to detect version via TONAPI
- `backend/src/api/auth.ts` — include `walletVersion` in auth response
- `frontend/src/pages/Account.tsx` — display version badge
- `frontend/src/hooks/useTonWallet.ts` — handle `walletVersion` from API response
- New migration: `backend/migrations/0012_wallet_version.sql`

---

### Step 2: Stats & Admin Dashboard Updates

**Goal:** Show wallet version distribution in admin stats.

**Backend:**
- `GET /api/v1/admin/stats` (or bot `/stats` command) — add wallet version breakdown:
  ```json
  {
    "walletStats": {
      "total": 1200,
      "withWallet": 340,
      "w5": 180,
      "v4r2": 140,
      "other": 20
    }
  }
  ```
- Query: `SELECT wallet_version, COUNT(*) FROM users WHERE is_dummy = false GROUP BY wallet_version`

**Frontend (Stats page per-group):**
- No change — group stats don't need wallet info.

**Admin dashboard:**
- Add wallet version breakdown to metrics section.

**Files to modify:**
- `backend/src/api/admin.ts` — add wallet stats query
- `backend/src/webhook.ts` — add wallet stats to `/stats` bot command

---

### Step 3: Gasless Settlement Flow (Backend)

**Goal:** Add backend endpoints to support W5 gasless transaction relay.

**New/modified endpoints:**

1. **`GET /api/v1/settlements/:id/tx`** (existing) — modify to return different payloads based on payer's wallet version:
   - **v4r2:** current behavior (return `validUntil`, `messages[]` for TON Connect `sendTransaction`)
   - **W5:** return the unsigned internal message body that the user will sign, plus the estimated gas relay fee from TONAPI

2. **`POST /api/v1/settlements/:id/gasless-estimate`** (new) — calls TONAPI Gasless API:
   ```
   POST https://tonapi.io/v2/gasless/estimate/{usdt_master_address}
   Body: { wallet_address, wallet_public_key, messages: [...] }
   ```
   Returns: relay fee amount, signed payload for user to approve.

3. **`POST /api/v1/settlements/:id/gasless-send`** (new) — receives signed BOC from frontend, relays to TONAPI:
   ```
   POST https://tonapi.io/v2/gasless/send
   Body: { wallet_public_key, boc }
   ```
   Then marks settlement as `payment_pending` (same as current verify flow).

4. **`POST /api/v1/settlements/:id/confirm`** (existing) — no change. On-chain verification is identical regardless of how tx was submitted.

**Files to modify:**
- `backend/src/api/settlements.ts` — modify `/tx`, add `/gasless-estimate`, `/gasless-send`
- `backend/src/env.ts` — no change (TONAPI_KEY already exists)

---

### Step 4: Gasless Settlement Flow (Frontend)

**Goal:** Branch the SettleUp UI based on payer's wallet version.

**Settlement dialog changes (`SettleUp.tsx`):**

1. Detect payer's wallet version from user context / settlement data.
2. **If v4r2 (current flow):**
   - "Pay with USDT" button → TON Connect `sendTransaction()` → verify → poll confirm
   - Show: "You'll attach ~0.5 TON for gas (refunded ~0.33)"
3. **If W5 (gasless flow):**
   - "Pay with USDT (Gasless)" button → call `/gasless-estimate` → show relay fee → user approves → sign via TON Connect → send signed BOC to `/gasless-send` → poll confirm
   - Show: "No TON needed. Relay fee: ~X USDT deducted from transfer"
   - The relay fee is *in addition to* the 1% commission — make this clear in UI

**TON Connect signing for gasless:**
- TON Connect UI's `sendTransaction` won't work for gasless (it broadcasts itself).
- Need to use lower-level TON Connect to **sign without broadcasting**: `tonConnectUI.sendTransaction()` with `network` param but intercept before broadcast... OR use the raw connector's `sendTransaction` which returns the signed BOC.
- **Alternative (simpler):** TONAPI's gasless flow might handle this differently — the estimate endpoint returns a message that the wallet signs as a regular internal transaction. Need to verify exact flow from TONAPI docs.

**Key UX considerations:**
- Show clear label: "Gasless (W5)" vs "Standard (v4r2)"
- Show gas/relay fee breakdown before confirming
- If TONAPI gasless is temporarily unavailable, fall back gracefully with message

**Files to modify:**
- `frontend/src/pages/SettleUp.tsx` — branch payment flow
- `frontend/src/services/api.ts` — add `gaslessEstimate()`, `gaslessSend()` API calls
- `frontend/src/utils/ton.ts` — add gasless message building helpers

---

### Step 5: Settlement Metadata & Notifications

**Goal:** Record which settlement method was used and show it everywhere.

**DB:**
- `settlements` table already has `status` (open/payment_pending/settled_onchain/settled_external).
- Add column: `settlement_method TEXT` — values: `'standard'`, `'gasless'`, `'external'`
- Migration 0012 (same migration as wallet_version).

**Backend:**
- Set `settlement_method` when settlement completes (confirm or mark-external endpoints).
- Include in settlement GET response.

**Notifications (`services/notifications.ts`):**
- Update `settlementCompleted()` message to include method:
  - "settled on-chain (USDT, gasless)" vs "settled on-chain (USDT)" vs "settled externally"

**Activity feed:**
- Activity log already stores settlement events. Add `method` to metadata JSON.
- Frontend activity text: include "(gasless)" label where relevant.

**Files to modify:**
- `backend/src/db/schema.ts` — add `settlementMethod` column
- `backend/migrations/0012_wallet_version.sql` — include both columns
- `backend/src/api/settlements.ts` — set method on completion
- `backend/src/services/notifications.ts` — update message text
- `frontend/src/utils/activity.ts` — update activity display text

---

### Step 6: Info & Documentation Updates

**Goal:** Update all user-facing text about settlement.

**i18n keys to add/update (all 11 locales):**
- `settle.gasless_label` — "Gasless (no TON needed)"
- `settle.standard_label` — "Standard (requires TON for gas)"
- `settle.relay_fee` — "Relay fee: {{amount}} USDT"
- `settle.gasless_info` — "Your W5 wallet supports gasless transactions. USDT relay fee covers gas."
- `settle.method_gasless` — "settled on-chain (gasless)"
- `settle.method_standard` — "settled on-chain"
- `account.wallet_version` — "Wallet: {{version}}"
- `account.gasless_badge` — "Gasless"

**Files to modify:**
- `frontend/src/locales/*.json` (11 files)

---

### Step 7: Testing

**Backend tests:**
- Wallet version detection (mock TONAPI response → assert correct version stored)
- Gasless estimate endpoint (mock TONAPI → assert correct relay fee returned)
- Gasless send endpoint (mock TONAPI → assert settlement marked payment_pending)
- Settlement method stored correctly for each flow

**Frontend tests:**
- Activity text includes gasless label
- Settlement method display logic

**Manual testing (testnet):**
- Connect W5 wallet (Tonkeeper default) → verify version detected as W5
- Connect v4r2 wallet → verify version detected as v4r2
- Settle via gasless → verify full flow: estimate → sign → relay → confirm
- Settle via standard → verify existing flow still works
- Check notifications show correct method
- Check activity feed shows correct method

---

## Migration (0012)

```sql
-- Add wallet version tracking
ALTER TABLE users ADD COLUMN wallet_version TEXT;

-- Add settlement method tracking
ALTER TABLE settlements ADD COLUMN settlement_method TEXT;
```

## Risk Assessment

| Risk | Mitigation |
|---|---|
| TONAPI Gasless API downtime | Graceful fallback: show "Gasless unavailable, use standard method" (v4r2 users unaffected) |
| TONAPI doesn't support tUSDT gasless | Check `/v2/gasless/config` on startup; disable gasless UI if not supported |
| Relay fee too high | Show fee clearly before user confirms; user can always switch to v4r2 wallet |
| User switches wallet version between sessions | Re-detect on every wallet connect, not cached permanently |
| W5 TON Connect signing compatibility | Test with Tonkeeper (default W5); may need raw connector API |
| TONAPI rate limits | Already using TONAPI for verification; gasless adds 2 calls per settlement (estimate + send) — should be fine |

## Open Questions

1. **TONAPI Gasless pricing** — Is the relay fee fixed or dynamic? Need to check `/v2/gasless/config` response format.
2. **TON Connect + gasless signing** — Can `sendTransaction()` return a signed BOC without broadcasting? Or do we need a different signing approach? The TONAPI cookbook examples use raw wallet signing (private key), but we're using TON Connect (no private key access). This is the **hardest technical question** — needs a spike/prototype.
3. **Commission stacking** — Our 1% commission + TONAPI relay fee = user pays both. Is this acceptable UX? Alternative: absorb relay fee into our commission (reduces margin but cleaner UX).
4. **Mainnet gasless support** — Is TONAPI Gasless available on mainnet for USDT? Testnet only? Need to verify.

## Estimated Scope

- Migration: 1 file
- Backend: ~4 files modified, ~200 lines new code
- Frontend: ~5 files modified, ~150 lines new code
- i18n: 11 locale files
- Tests: ~6 new test cases

## Order of Implementation

1. **Step 1** — Wallet version detection + DB (foundation, low risk)
2. **Step 2** — Admin stats (quick win, validates Step 1 data)
3. **Spike** — Prototype gasless flow end-to-end on testnet (resolve Open Question #2)
4. **Step 3** — Backend gasless endpoints
5. **Step 4** — Frontend gasless flow
6. **Step 5** — Settlement metadata + notifications
7. **Step 6** — i18n
8. **Step 7** — Testing

## References

- [TONAPI Gasless API Docs](https://docs.tonconsole.com/tonapi/rest-api/gasless)
- [TONAPI Gasless Cookbook](https://docs.tonconsole.com/tonapi/cookbook)
- [W5 Wallet Contract (GitHub)](https://github.com/ton-blockchain/wallet-contract-v5)
- [W5 Announcement (ton.org)](https://ton.org/en/introducing-the-w5-smart-wallet-evolving-transactions-on-ton-blockchain)
- [TON Wallet Contracts Spec](https://docs.ton.org/v3/documentation/smart-contracts/contracts-specs/wallet-contracts)
- [Tonkeeper W5 FAQ](https://tonkeeper.helpscoutdocs.com/article/102-w5)
