# D. TON Wallet & Settlement

On-chain settlement on testnet. The core differentiator.

**Frontend:** `@tonconnect/ui-react` for wallet connection + transaction sending
**Backend:** TONAPI REST API for tx verification (plain `fetch()`, no `@ton/ton` SDK needed in Worker)
**Reference:** TON docs on Jetton transfers: https://docs.ton.org/v3/guidelines/ton-connect/cookbook/jetton-transfer

---

## D1. TON Connect Integration (Frontend)

- Add `@tonconnect/ui-react` to frontend dependencies
- Wrap App in `TonConnectUIProvider` with manifest URL
- Create `tonconnect-manifest.json` (served from Pages):
  ```json
  {
    "url": "https://splitogram.pages.dev",
    "name": "Splitogram",
    "iconUrl": "https://splitogram.pages.dev/icon.png"
  }
  ```
- Wallet connection flow: `useTonConnectUI()` hook → `tonConnectUI.openModal()` → user selects wallet
- Store wallet address in backend: `PUT /api/v1/users/me/wallet` with `{ address }` after connection
- `user_wallets` not needed as separate table — store `wallet_address` directly on `users` table (one active wallet)
- Handle disconnect: clear `wallet_address` on backend
- **No manual wallet address validation** — trust TON Connect / Telegram Wallet integrations to provide valid addresses
- **Testnet config:** Set `network` to testnet in TonConnectUIProvider options

**Output:** User connects their TON wallet in the mini app. Address stored in backend.

---

## D2. Transaction Construction (Frontend + Backend)

When user taps "Settle up" on a debt:

1. **Frontend** calls `POST /api/v1/groups/:id/settlements` — **creates settlement on demand** from the debt graph. Returns settlement ID. Idempotent by (group_id, from_user, to_user, status=open).
2. **Frontend** calls `GET /api/v1/settlements/:id/tx` — backend returns transaction parameters
3. **Backend** constructs the Jetton transfer payload:
   - Looks up creditor's wallet address from `users` table
   - USDT Jetton contract address from `USDT_MASTER_ADDRESS` env var (different for testnet/mainnet)
   - **Derives sender's Jetton wallet address** from their main wallet + USDT master contract (TEP-74 standard, via TONAPI)
   - Amount in micro-USDT (6 decimals: 1 USDT = 1,000,000)
   - Forward payload comment: `splitogram:{settlement_id}`
   - Returns: `{ to, amount, payload_boc_base64 }`
4. **Frontend** sends transaction via TON Connect:
   ```typescript
   const tx = {
     validUntil: Math.floor(Date.now() / 1000) + 360,
     messages: [{
       address: jettonWalletContract,     // debtor's jetton wallet
       amount: toNano("0.05").toString(), // gas fees
       payload: body.toBoc().toString("base64")
     }]
   }
   const result = await tonConnectUI.sendTransaction(tx)
   ```
5. **Frontend** receives result (BOC or tx hash), sends to backend: `POST /api/v1/settlements/:id/verify`
6. **Backend** updates settlement status: `open → payment_pending`

**Note on Jetton transfers:** USDT on TON uses TEP-74 standard. Amount uses 6 decimals (not 9 like TON coin). The `@ton/ton` library is needed on frontend to construct the Cell/BOC payload. This runs in the browser — no Worker compatibility concern.

**Output:** Backend constructs transaction, user approves in wallet, tx hash captured.

---

## D3. On-Chain Verification (Backend)

After frontend sends tx hash/BOC, backend verifies via **TONAPI REST API**.

- Endpoint: `POST /api/v1/settlements/:id/verify` with `{ boc }` or `{ tx_hash }`
- Backend calls TONAPI:
  - `GET https://testnet.tonapi.io/v2/blockchain/transactions/{tx_hash}` (or parse from BOC)
  - Verify: transaction exists, correct sender, correct recipient, correct amount, confirmed
- Verification checks:
  1. Transaction exists on testnet
  2. Sender = debtor's wallet address
  3. Recipient = creditor's wallet address (via Jetton transfer destination)
  4. Amount matches settlement amount
  5. Forward comment contains `splitogram:{settlement_id}`
- On success: update settlement `payment_pending → settled_onchain`, record tx_hash, set `settled_at`
- On failure: return clear error, user can tap "Refresh status" to re-check
- **Stuck `payment_pending` recovery (Phase 1):** No cron job. Add a "Refresh status" button on settlement detail. Backend re-checks TONAPI on tap. If still unverified after 10 minutes, allow manual rollback to `open`.
- **Timeout:** `AbortSignal.timeout(10000)` on TONAPI calls (playbook: explicit timeout on every I/O)
- **Polling:** If tx not immediately confirmed, return "pending" to frontend. Frontend polls `GET /api/v1/settlements/:id` every 3s for up to 60s.

**No `@ton/ton` needed on backend.** TONAPI is a REST API — plain `fetch()` works in Workers.

**Output:** Debt is settled only when on-chain confirmation is verified. No false positives.

---

## D4. "Mark as Settled Externally"

For users without wallets or who settle via other means (cash, bank transfer, etc.).

- Endpoint: `POST /api/v1/settlements/:id/mark-external`
- Only the **creditor** can mark a debt as settled externally (they confirm they received payment)
- Status: `open → settled_external`
- No on-chain verification needed
- `tx_hash` stays null, `settled_at` set to now
- Triggers notification to debtor: "Bob marked your debt as settled"
- UI: secondary button below the primary "Pay with TON wallet" option
- Clearly labeled in UI as "settled externally" (distinct visual from on-chain settlement)

**Output:** Non-wallet users can still close debts. Clearly distinguished from on-chain settlement.
