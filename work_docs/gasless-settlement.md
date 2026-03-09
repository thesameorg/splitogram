# Phase 11: Gasless Settlement (W5 Wallet Support)

## Status: RESEARCH COMPLETE — SPIKE TESTING NEEDED

## Goal

Enable users with W5 wallets to settle USDT debts **without holding TON for gas**. Users with v4r2 wallets continue using the existing flow (self-pay gas).

## Actor / Wallet Version Matrix

Only the debtor's wallet version determines the settlement flow. All other actors are irrelevant.

| Actor                        | What it is                           | Wallet version                | Affects flow?                                           |
| ---------------------------- | ------------------------------------ | ----------------------------- | ------------------------------------------------------- |
| **SplitogramSettlement**     | Custom Tact contract (not a wallet)  | N/A — it's a smart contract   | No. Processes any incoming Jetton transfer identically. |
| **Debtor (payer)**           | User's TON wallet                    | **v4r2 or W5**                | **YES — the only actor that matters.**                  |
| **Creditor (recipient)**     | User's TON wallet                    | Any (v3r2, v4r2, W5)          | No. Receives Jetton transfer from contract.             |
| **Contract owner**           | Our admin wallet (`0QAoBJzd06D3...`) | v4r2 (required for admin ops) | No. Only used for UpdateCommission, WithdrawTon.        |
| **Debtor's Jetton wallet**   | Standard Jetton wallet contract      | N/A — TEP-74 standard         | No.                                                     |
| **Contract's Jetton wallet** | Standard Jetton wallet contract      | N/A                           | No.                                                     |
| **Creditor's Jetton wallet** | Standard Jetton wallet contract      | N/A                           | No.                                                     |
| **TONAPI Gas Proxy**         | Internal TONAPI relay contract       | N/A — managed by TONAPI       | Only involved in gasless flow.                          |

**Bottom line:** The settlement contract has no wallet version — it's a custom Tact contract. A W5 debtor sending USDT to it works identically to a v4r2 debtor. The contract just sees "incoming Jetton transfer" either way.

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

**W5 debtor (gasless, if feasible):**

```
TONAPI Gas Proxy
  → (internal msg, proxy pays gas in TON, recoups via Jetton fee)
  → Debtor's W5 wallet (executes signed action)
  → Debtor's Jetton Wallet (TokenTransfer)
  → SplitogramSettlement contract (receives USDT)  ← IDENTICAL FROM HERE
  → takes 1% commission
  → forwards remainder to Creditor's Jetton Wallet
```

---

## Research Findings

### Tonkeeper Gasless vs Battery (two separate features)

|                           | Gasless                                                                             | Battery                       |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| Requires Battery balance? | **No** — independent feature                                                        | Yes — prepaid balance         |
| Wallet versions           | W5 only                                                                             | All versions                  |
| Token support             | Limited list: USDT, jUSDT, NOT, tsTON, DOGS, CATI, HMSTR, CATS, X, MAJOR, PX, BUILD | Any token, any tx type        |
| How fee is paid           | Deducted from the token being transferred                                           | Deducted from Battery balance |
| User action needed        | None — fee option shown at transfer confirmation                                    | Top up Battery first          |

**Key:** Gasless should work for USDT on W5 wallets with zero Battery balance. Fee deducted from the USDT transfer itself.

### Path A: Wallet-Handled Gasless (Tonkeeper does the relay)

**Theory:** When a dApp sends a standard `sendTransaction()` via TON Connect to a W5 Tonkeeper wallet, Tonkeeper offers a "pay fee in USDT" option at the approval screen. The relay is handled by Tonkeeper internally. The dApp doesn't need to change anything.

**Status: UNCONFIRMED — needs testing.**

**Potential blocker:** Our settlement transaction sends USDT through a custom smart contract (SplitogramSettlement), not a direct wallet-to-wallet transfer. Tonkeeper might only recognize direct Jetton transfers as gasless-eligible:

```
# Direct transfer (Tonkeeper likely recognizes as gasless-eligible):
User Wallet → User's Jetton Wallet → Recipient's Jetton Wallet

# Our settlement (Tonkeeper might NOT recognize):
User Wallet → User's Jetton Wallet → SplitogramSettlement → Creditor's Jetton Wallet
```

The `forward_payload` in our transaction points to a custom contract address with settlement-specific data. Tonkeeper may not be able to classify this as a simple Jetton transfer eligible for gasless.

### Path B: dApp-Side Relay via TONAPI Gasless API

**Finding: NOT FEASIBLE with TON Connect.**

TONAPI Gasless API documentation explicitly states: **"Gasless transactions are currently not supported through TonConnect."**

The TONAPI cookbook examples use raw private key signing (`mnemonicToPrivateKey()`). This is designed for backends/bots that hold private keys — not for dApps where the user's keys live in a wallet app (TON Connect).

TONAPI Gasless endpoints:

- `GET /v2/gasless/config` — check supported tokens
- `POST /v2/gasless/estimate/{master_id}` — estimate relay fee
- `POST /v2/gasless/send` — submit signed BOC

All require a signed external message built with the user's private key. TON Connect's `sendTransaction()` signs AND broadcasts — there's no "sign-only" mode.

### Path C: Direct Transfer (Skip Settlement Contract)

**Unexplored alternative:** For gasless-eligible users, skip the settlement contract entirely. Do a direct user-to-user USDT transfer, take commission separately (or forgo it for gasless settlements).

**Tradeoffs:**

- Pro: Would definitely be gasless-eligible (simple Jetton transfer)
- Con: No on-chain commission enforcement — trust-based or separate commission collection
- Con: Different on-chain verification logic
- Con: Architectural split between gasless and non-gasless flows

**Status: NOT YET EVALUATED — only worth exploring if Path A fails.**

---

## Spike Testing Plan

### Test 1: Does Tonkeeper Gasless work for direct USDT transfers?

**Setup:** Tonkeeper with W5 wallet, some USDT balance, zero TON balance (or very low).

**Steps:**

1. Open Tonkeeper directly (not through our app)
2. Send a small amount of USDT to any address
3. At the confirmation screen, check: is there a "pay fee in USDT" / "pay fee in TON" option?

**Expected result:** Gasless option should appear (this is the baseline — confirms gasless works at all on your wallet).

**If NO gasless option appears:**

- Check wallet version is W5 (Settings → Wallet Version)
- Try on mainnet (gasless relay might not run on testnet)
- Check Tonkeeper version is up to date

### Test 2: Does Tonkeeper Gasless work for dApp transactions via TON Connect?

**Setup:** Same W5 wallet connected to Splitogram via TON Connect.

**Steps:**

1. Create a settlement in Splitogram
2. Tap "Pay with USDT" to trigger `sendTransaction()` via TON Connect
3. When Tonkeeper shows the approval screen, check: is there a gasless fee option?

**Expected result:** Either gasless option appears (Path A works!) or it doesn't (custom contract blocker confirmed).

### Test 3: Mainnet vs Testnet

**If Test 1 fails on testnet:**

- Repeat Test 1 on mainnet with real USDT
- Gasless relay infrastructure might only run on mainnet

### Test 4: Battery as alternative

**If gasless doesn't work for our dApp transactions:**

1. Top up Battery in Tonkeeper (pay with TON or in-app purchase)
2. Retry our settlement `sendTransaction()`
3. Does Battery cover the gas for dApp transactions even if Gasless doesn't?

**If YES:** Battery is a user-side solution. We could add a hint in the UI: "Top up your Tonkeeper Battery to avoid needing TON for gas." Not as clean as true gasless, but removes the blocker for users willing to set it up.

---

## What We Can Build Regardless (No Gasless Dependency)

Even if gasless settlement is blocked, wallet version detection + stats are independently valuable:

### Step 1: Wallet Version Detection + DB

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
  Response includes `interfaces` array (e.g., `["wallet_v5r1"]`). Parse to determine version.
- Store `walletVersion` in `users` table alongside `walletAddress`.
- Return `walletVersion` in auth response and `GET /api/v1/users/me`.
- On `DELETE /api/v1/users/me/wallet` — clear both fields.

**Frontend:**

- Account page — show wallet version badge next to address (e.g., "W5", "v4r2").
- If W5: show "Gasless-capable" indicator (once gasless is confirmed working).

**Files to modify:**

- `backend/src/db/schema.ts` — add `walletVersion` column
- `backend/src/api/users.ts` — update wallet PUT endpoint
- `backend/src/api/auth.ts` — include `walletVersion` in response
- `frontend/src/pages/Account.tsx` — display version badge
- New migration: `backend/migrations/0012_wallet_version.sql`

### Step 2: Admin Stats + Bot Command

**Backend:**

- Bot `/stats` command + admin dashboard — add wallet version breakdown:
  ```
  Wallets: 340 total | W5: 180 | v4r2: 140 | other: 20
  ```
- Query: `SELECT wallet_version, COUNT(*) FROM users WHERE is_dummy = false AND wallet_address IS NOT NULL GROUP BY wallet_version`

**Files to modify:**

- `backend/src/api/admin.ts` — add wallet stats
- `backend/src/webhook.ts` — add to `/stats` bot response

---

## Decision Tree After Spike

```
Test 1: Direct USDT send in Tonkeeper — gasless option?
├── NO → Gasless not working on your wallet. Check version/network/Tonkeeper update.
│         Dead end until resolved.
│
└── YES → Gasless works for direct transfers.
          │
          Test 2: Settlement via our dApp — gasless option?
          ├── YES → PATH A CONFIRMED! 🎉
          │         Implement: wallet version detection + info banners + stats.
          │         Settlement flow unchanged. Tonkeeper handles relay.
          │
          └── NO → Custom contract blocks gasless eligibility.
                    │
                    Test 4: Does Battery work for our dApp txs?
                    ├── YES → Document "top up Battery" as user-side workaround.
                    │         Add UI hint. Not true gasless but removes friction.
                    │
                    └── NO → Evaluate Path C (direct transfer, skip contract).
                              If too complex / breaks commission model → defer.
                              Implement wallet version + stats only.
```

## References

- [TONAPI Gasless API Docs](https://docs.tonconsole.com/tonapi/rest-api/gasless)
- [TONAPI Gasless Cookbook](https://docs.tonconsole.com/tonapi/cookbook)
- [W5 Wallet Contract (GitHub)](https://github.com/ton-blockchain/wallet-contract-v5)
- [W5 Announcement (ton.org)](https://ton.org/en/introducing-the-w5-smart-wallet-evolving-transactions-on-ton-blockchain)
- [TON Wallet Contracts Spec](https://docs.ton.org/v3/documentation/smart-contracts/contracts-specs/wallet-contracts)
- [Tonkeeper Gasless FAQ](https://tonkeeper.helpscoutdocs.com/article/144-gasless)
- [Tonkeeper W5 FAQ](https://tonkeeper.helpscoutdocs.com/article/102-w5)
