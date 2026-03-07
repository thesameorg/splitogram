# Phase 10: Wallet Settlement Integration — Implementation Plan

> Testnet-first. All addresses/URLs are testnet. Mainnet is a config switch later.

---

## Architecture

```
User (debtor)                    Frontend                         Backend                      TON Blockchain
    |                               |                                |                              |
    |  taps "Pay with USDT"         |                                |                              |
    |------------------------------>|                                |                              |
    |                               |  GET /settlements/:id/tx       |                              |
    |                               |------------------------------->|                              |
    |                               |  { contract, recipient,        |                              |
    |                               |    amount, senderJettonWallet }|                              |
    |                               |<-------------------------------|                              |
    |                               |                                |                              |
    |                               |  build Jetton transfer msg     |                              |
    |                               |  tonConnectUI.sendTransaction()|                              |
    |  wallet confirmation prompt   |                                |                              |
    |<------------------------------|                                |                              |
    |  confirms in Tonkeeper        |                                |                              |
    |------------------------------>|                                |                              |
    |                               |  POST /settlements/:id/verify  |                              |
    |                               |  { boc }                       |                              |
    |                               |------------------------------->|  broadcast boc               |
    |                               |                                |----------------------------->|
    |                               |  { status: payment_pending }   |                              |
    |                               |<-------------------------------|                              |
    |                               |                                |                              |
    |                               |  poll GET /settlements/:id     |                              |
    |                               |  every 3s, max 60s             |                              |
    |                               |------------------------------->|  check TONAPI trace          |
    |                               |                                |----------------------------->|
    |                               |  { status: settled_onchain }   |                              |
    |                               |<-------------------------------|                              |
    |  "Payment confirmed!"         |                                |                              |
    |<------------------------------|                                |                              |
```

---

## Env Vars

### Backend (`.dev.vars` / wrangler secrets)

| Var                           | Testnet Value                                      | Purpose                  |
| ----------------------------- | -------------------------------------------------- | ------------------------ |
| `USDT_MASTER_ADDRESS`         | `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7` | tUSDT Jetton Master      |
| `SETTLEMENT_CONTRACT_ADDRESS` | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` | Settlement contract v4   |
| `TONAPI_KEY`                  | (already set)                                      | For tx verification      |
| `TON_NETWORK`                 | `testnet`                                          | Switches TONAPI base URL |

### Frontend (`.env` / Vite env)

| Var                             | Testnet Value                                     | Purpose                                                   |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `VITE_TON_CONNECT_MANIFEST_URL` | `https://{pages-domain}/tonconnect-manifest.json` | TON Connect manifest                                      |
| `VITE_TON_NETWORK`              | `testnet`                                         | Show testnet badge, use testnet TONAPI for balance checks |

---

## Step 1: TON Connect Setup (Frontend)

### 1.1 Install SDK

```bash
cd frontend && bun add @tonconnect/ui-react @ton/core @ton/ton
```

### 1.2 Create manifest

`frontend/public/tonconnect-manifest.json`:

```json
{
  "url": "https://splitogram.pages.dev",
  "name": "Splitogram",
  "iconUrl": "https://splitogram.pages.dev/icon-192.png"
}
```

### 1.3 Wrap App with TonConnectUIProvider

In `App.tsx`, wrap the router with:

```tsx
<TonConnectUIProvider manifestUrl={import.meta.env.VITE_TON_CONNECT_MANIFEST_URL}>
  ...
</TonConnectUIProvider>
```

### 1.4 Account page — wallet section

- Show "Connect Wallet" button (uses `useTonConnectUI()` → `tonConnectUI.openModal()`)
- When connected: show truncated address + "Disconnect" button
- On connect: `PUT /users/me/wallet` with the address (endpoint already exists)
- On disconnect: `DELETE /users/me/wallet` (endpoint already exists)
- Testnet badge: small "Testnet" label when `VITE_TON_NETWORK === 'testnet'`

---

## Step 2: Backend — TX Endpoint & Pre-flight

### 2.1 Add env vars

Add to `Env` interface:

```ts
SETTLEMENT_CONTRACT_ADDRESS?: string;
TON_NETWORK?: string; // 'testnet' | 'mainnet'
```

Helper:

```ts
function tonapiBaseUrl(env: Env): string {
  return env.TON_NETWORK === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io';
}
```

### 2.2 Update `GET /settlements/:id/tx`

Current: returns `recipientAddress` (creditor's wallet).
New: returns everything the frontend needs to build the Jetton transfer.

**Response:**

```json
{
  "settlementId": 1,
  "amount": 100000000,
  "recipientAddress": "0QBMs...",
  "contractAddress": "EQBWECX8nJ3lk...",
  "senderJettonWallet": "0:002d244...",
  "usdtMasterAddress": "kQBDzVl...",
  "gasAttach": "500000000",
  "forwardTonAmount": "400000000"
}
```

**New logic:**

1. Validate settlement is `open`, debtor is current user
2. Get creditor's `walletAddress` — if null, return `{ error: 'no_wallet', detail: 'Creditor has not connected a wallet' }`
3. Look up sender's USDT Jetton Wallet via TONAPI:
   `GET {tonapi}/v2/accounts/{senderWalletAddress}/jettons?currencies=usd`
   Find the entry matching `USDT_MASTER_ADDRESS`, extract the jetton wallet address.
   If sender has no USDT jetton wallet → `{ error: 'no_usdt', detail: 'You have no USDT wallet' }`
4. Return contract address + recipient + sender jetton wallet + amounts

### 2.3 Add `GET /settlements/:id/preflight`

Pre-flight check endpoint (called before showing "Pay with USDT"):

**Request:** `GET /settlements/:id/preflight?senderAddress={tonAddress}`

**Response:**

```json
{
  "ready": true,
  "usdtBalance": 100000000,
  "tonBalance": 2000000000,
  "estimatedGas": 500000000,
  "creditorHasWallet": true,
  "warnings": []
}
```

or:

```json
{
  "ready": false,
  "warnings": ["insufficient_usdt", "creditor_no_wallet"]
}
```

**Checks:**

1. Creditor has wallet address in DB
2. Sender's USDT balance >= settlement amount (via TONAPI)
3. Sender's TON balance >= 0.5 TON for gas (via TONAPI)
4. TONAPI is reachable (if not, `warnings: ["api_unavailable"]` but still `ready: true` — let user try)

---

## Step 3: Backend — Verification

### 3.1 Rewrite `verifyTransaction()`

The current stub only checks tx hash exists. Proper verification:

```
POST /settlements/:id/verify  { boc }

1. Mark settlement as `payment_pending`
2. If boc provided, broadcast via TONAPI:
   POST {tonapi}/v2/blockchain/message { boc }
3. Return { status: 'payment_pending' }
```

### 3.2 Add `GET /settlements/:id` status polling

The existing `GET /settlements/:id` already returns status. Add verification logic:

When a settlement is `payment_pending`, the backend should try to verify on each GET:

1. Look up recent transactions on the settlement contract via TONAPI
2. Find a trace where:
   - The contract received a `TokenNotification`
   - The `forward_payload` contains the correct recipient address
   - The amount matches (within 1% tolerance for rounding)
   - One outgoing transfer went to the recipient
   - One outgoing transfer went to the owner (commission)
3. If found → update to `settled_onchain` with `txHash`
4. If not found and < 5 min since `payment_pending` → stay pending
5. If not found and > 5 min → rollback to `open` (tx likely failed/expired)

**TONAPI verification approach:**

```
GET {tonapi}/v2/accounts/{contractAddress}/events?limit=20
```

Look through recent events for one matching our settlement. Check:

- Event contains Jetton transfer TO the contract
- Amount matches settlement amount
- Recipient in forward_payload matches creditor wallet
- Event is successful (not bounced)

This is simpler and more robust than trying to trace a specific boc/tx hash. We look for the EFFECT (contract received correct amount, forwarded correctly) rather than tracking a specific transaction ID.

### 3.3 Rollback mechanism

- Settlements in `payment_pending` for > 5 minutes without on-chain confirmation → rollback to `open`
- This happens lazily on the next GET /settlements/:id call (no cron needed)
- Frontend shows "Payment not confirmed. You can try again." when status returns to `open`

---

## Step 4: Frontend — Settlement Flow

### 4.1 SettleUp page changes

Current: single "Mark as Settled" button.
New: two paths side by side.

```
+------------------------------------------+
|          You owe Alice $50.00            |
|              $50.00                       |
+------------------------------------------+

+------------------------------------------+
|  Pay with USDT                           |
|  ~50.00 USDT + ~0.05 TON gas            |
|  [Connect Wallet] or [Pay Now]           |
+------------------------------------------+

       — or settle manually —

+------------------------------------------+
|  Amount: [50.00]                         |
|  Note: [_______________]                 |
|  [Attach receipt]                        |
|  [Mark as Settled]                       |
+------------------------------------------+
```

### 4.2 "Pay with USDT" flow — states

```
IDLE
  → user taps "Pay with USDT"
  → if no wallet connected → open TON Connect modal → return to IDLE after connect

PREFLIGHT
  → call GET /settlements/:id/preflight?senderAddress={addr}
  → show loading spinner on button
  → if !ready:
    - creditor_no_wallet → "Recipient hasn't connected a wallet yet. Send them a reminder?"
    - insufficient_usdt → "Not enough USDT. You have X, need Y."
    - insufficient_ton → "Not enough TON for gas. You need ~0.5 TON."
    - api_unavailable → show warning but allow to proceed
  → if ready → CONFIRM

CONFIRM
  → show clear explanation:
    "You're sending {amount} USDT to the Splitogram settlement contract.
     The contract will forward {amount - commission} USDT to {creditor name}.
     1% commission ({commission} USDT) goes to Splitogram.
     You'll be asked to confirm this in your wallet."
  → show [Confirm Payment] button
  → user taps → SENDING

SENDING
  → build Jetton transfer message (see below)
  → call tonConnectUI.sendTransaction()
  → show spinner: "Waiting for wallet confirmation..."
  → if user rejects → ERROR ("Transaction declined. Try again when ready.")
  → if timeout (2 min) → ERROR ("Wallet didn't respond. Check your wallet app.")
  → if success → call POST /settlements/:id/verify { boc }
  → → POLLING

POLLING
  → show spinner: "Confirming on blockchain..."
  → poll GET /settlements/:id every 3 seconds
  → max 60 seconds
  → if status === 'settled_onchain' → SUCCESS
  → if status === 'open' (rollback) → ERROR ("Transaction not confirmed. Please try again.")
  → if timeout → show "Taking longer than expected" + [Refresh Status] button

SUCCESS
  → green checkmark, "Payment confirmed!"
  → auto-navigate back after 2s

ERROR
  → show error message with [Try Again] or [Go Back] buttons
```

### 4.3 Building the Jetton transfer message

```typescript
import { beginCell, Address, toNano } from '@ton/core';

function buildSettlementMessage(params: {
  contractAddress: string;
  recipientAddress: string;
  amount: bigint; // micro-USDT (6 decimals)
  forwardTonAmount: string; // nanoTON
}) {
  // forward_payload: op=0 (settlement) + recipient address
  // MUST be inline (not ref) — learned from testnet debugging
  const forwardPayload = beginCell()
    .storeUint(0, 32) // op = 0 (settlement)
    .storeAddress(Address.parse(params.recipientAddress))
    .endCell();

  // Jetton transfer body (TEP-74)
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
    .storeUint(0, 64) // query_id
    .storeCoins(params.amount) // jetton amount
    .storeAddress(Address.parse(params.contractAddress)) // destination
    .storeAddress(Address.parse(params.contractAddress)) // response_destination (excess gas back)
    .storeBit(false) // no custom_payload
    .storeCoins(BigInt(params.forwardTonAmount)) // forward_ton_amount
    .storeBit(true) // forward_payload in ref
    .storeRef(forwardPayload)
    .endCell();

  return body;
}
```

Wait — testnet debugging showed `forward_payload` must be inline, not ref. But the contract test scripts used ref successfully? Let me re-read...

Actually, looking at the testnet debugging log: the FIRST attempt used ref and failed. The fix was to store inline. But then the contract was redeployed and worked with inline. However, the `smart-contract.md` section 9 shows `storeBit(true) + storeRef()` — this is what the standard recommends for large payloads.

The issue was specifically about how the Jetton wallet passes the payload to the contract. The standard FunC Jetton wallet handles BOTH forms (inline and ref). The problem was elsewhere (the Either bit issue). So either form should work with the current contract.

**Decision:** Use inline (no ref) to match what was validated on testnet. It's simpler and we know it works.

```typescript
// Inline forward_payload (validated on testnet)
const body = beginCell()
  .storeUint(0xf8a7ea5, 32)
  .storeUint(0, 64)
  .storeCoins(params.amount)
  .storeAddress(Address.parse(params.contractAddress)) // destination
  .storeAddress(Address.parse(params.contractAddress)) // response_destination
  .storeBit(false) // no custom_payload
  .storeCoins(BigInt(params.forwardTonAmount))
  // inline forward_payload (no storeBit, no storeRef)
  .storeUint(0, 32) // op = 0
  .storeAddress(Address.parse(params.recipientAddress))
  .endCell();
```

Actually wait, re-reading the testnet plan more carefully:

> **Fix:** Store `forward_payload` inline in the transfer body (no `storeBit`/`storeRef`, just append op + address after `forward_ton_amount`).

But this contradicts TEP-74 which requires an Either bit before the forward_payload. Let me check what the testSettlement.ts script actually does...

The working test script likely stores it correctly. The key insight was: the Jetton wallet passes the remaining slice as-is. If you use `storeBit(true) + storeRef()`, the contract receives a slice with 1 bit (the Either flag) + a ref. If you use inline, the contract receives the actual data bits directly.

For TON Connect, the safest approach: use the same encoding that worked on testnet. I'll note this as something to verify during implementation.

### 4.4 TON Connect `sendTransaction` call

```typescript
const tx = {
  validUntil: Math.floor(Date.now() / 1000) + 300, // 5 min
  messages: [
    {
      address: senderJettonWallet, // user's USDT Jetton Wallet
      amount: gasAttach, // "500000000" (0.5 TON)
      payload: body.toBoc().toString('base64'),
    },
  ],
};

const result = await tonConnectUI.sendTransaction(tx);
// result.boc contains the signed transaction
```

---

## Step 5: Error Scenarios (from comments.md)

| Scenario                  | Detection                                   | User sees                                      | What we do                                           |
| ------------------------- | ------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Wallet not connected      | `useTonConnectUI().connected === false`     | "Connect your wallet to pay" + connect button  | Open TON Connect modal                               |
| Creditor no wallet        | preflight `creditor_no_wallet`              | "Recipient hasn't connected a wallet"          | Offer to send reminder (existing debt reminder flow) |
| Not enough USDT           | preflight `insufficient_usdt`               | "Not enough USDT. Balance: X, Need: Y"         | Block payment button                                 |
| Not enough TON (gas)      | preflight `insufficient_ton`                | "Need ~0.5 TON for gas fees"                   | Block payment button                                 |
| TONAPI down               | preflight timeout/error                     | Warning banner, but allow to try               | Proceed, verification will retry                     |
| User declines in wallet   | `sendTransaction()` throws                  | "Transaction declined"                         | Show "Try Again" button                              |
| Wallet app not responding | `sendTransaction()` timeout (2 min)         | "Wallet not responding. Open your wallet app." | Show "Try Again"                                     |
| TX broadcast fails        | `verify` endpoint returns error             | "Failed to submit. Try again."                 | Return to CONFIRM state                              |
| TX pending too long       | polling > 60s, still `payment_pending`      | "Taking longer than expected"                  | Show "Refresh Status" button                         |
| TX failed on-chain        | status rolls back to `open` (5 min timeout) | "Payment not confirmed on chain"               | Show "Try Again"                                     |
| TX confirmed              | polling returns `settled_onchain`           | "Payment confirmed!"                           | Auto-navigate back                                   |

---

## Step 6: Files to Create/Modify

### New files:

- `frontend/public/tonconnect-manifest.json`
- `frontend/src/hooks/useTonConnect.ts` — thin wrapper around `useTonConnectUI` + `useTonAddress`
- `frontend/src/utils/ton.ts` — `buildSettlementMessage()`, TON amount formatting

### Modified files:

- `frontend/package.json` — add `@tonconnect/ui-react`, `@ton/core`, `@ton/ton`
- `frontend/src/App.tsx` — add `TonConnectUIProvider`
- `frontend/src/config.ts` — add `tonConnectManifestUrl`, `tonNetwork`
- `frontend/src/pages/Account.tsx` — wallet connect/disconnect section
- `frontend/src/pages/SettleUp.tsx` — "Pay with USDT" flow (major changes)
- `frontend/src/services/api.ts` — add `getSettlementPreflight()`, `verifySettlement()` types
- `frontend/src/locales/*.json` (11 files) — new i18n keys for crypto settlement
- `backend/src/env.ts` — add `SETTLEMENT_CONTRACT_ADDRESS`, `TON_NETWORK`
- `backend/src/api/settlements.ts` — update `/tx`, add `/preflight`, rewrite verification
- `backend/.dev.vars` — add new env vars

### NOT changing:

- DB schema — no migration needed (wallet_address and settlement statuses already exist)
- Settlement creation flow — unchanged
- Manual settlement flow — unchanged
- Contract code — already deployed and validated

---

## Implementation Order

1. **TON Connect setup** — install, manifest, provider, Account page wallet UI. Testable independently.
2. **Backend env + `/tx` + `/preflight`** — new env vars, update tx endpoint, add preflight. Testable via curl.
3. **Backend verification rewrite** — proper TONAPI trace verification. Testable via curl with known testnet txs.
4. **Frontend settlement flow** — the big one. Wire up SettleUp page with all states.
5. **Error handling + i18n** — all 11 locales, all error scenarios.
6. **Manual testnet e2e** — connect wallet in dev, trigger settlement, confirm in Tonkeeper testnet, verify confirmation.

---

## What We're NOT Doing (scope cut for testnet)

- **No direct transfer fallback** — all settlements go through contract. Optimize later for mainnet.
- **No currency conversion display** — debts are in group currency, USDT amount = same number. Real conversion UX deferred.
- **No automatic gas estimation** — hardcoded 0.5 TON (validated on testnet). Dynamic estimation later.
- **No multi-jetton** — USDT only.
- **No cron for stuck settlements** — lazy rollback on GET is sufficient.
- **No Telegram Wallet integration** — TON Connect with external wallets only (Tonkeeper, MyTonWallet).
