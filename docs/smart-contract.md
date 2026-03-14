# Splitogram TWA — Smart Contract Settlement Manual

> A practical guide to building, testing, and deploying a TON smart contract that handles P2P settlements with a service commission for a Splitwise-like Telegram Mini App.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How Jettons (USDT) Work on TON](#2-how-jettons-usdt-work-on-ton)
3. [Settlement Flow](#3-settlement-flow)
4. [Development Environment Setup](#4-development-environment-setup)
5. [Contract Design](#5-contract-design)
6. [Contract Implementation (Tact)](#6-contract-implementation-tact)
7. [Testing Strategy](#7-testing-strategy)
8. [Testnet Deployment](#8-testnet-deployment)
9. [Frontend Integration (TON Connect)](#9-frontend-integration-ton-connect)
10. [Mainnet Deployment](#10-mainnet-deployment)
11. [Security Checklist](#11-security-checklist)
12. [Reference Links](#12-reference-links)

---

## 1. Architecture Overview

The system consists of three layers:

```
┌─────────────────────────────────────────────────┐
│              Telegram Mini App (TWA)             │
│         React/TS frontend inside Telegram        │
│              TON Connect UI for wallet           │
└──────────────────┬──────────────────────────────┘
                   │ signs & sends transactions
                   ▼
┌─────────────────────────────────────────────────┐
│           Splitogram Settlement Contract          │
│                  (on TON blockchain)             │
│                                                  │
│  Receives USDT → takes commission → forwards     │
│  the remainder to the recipient                  │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   Commission              Recipient
   (owner wallet)          (debtor pays creditor)
```

**Why a smart contract instead of direct P2P transfers?**

- Trustless: the commission logic is on-chain, transparent and verifiable.
- Atomic: either both the commission and the forwarding happen, or neither does.
- Auditable: every settlement is recorded on-chain with full trace.

---

## 2. How Jettons (USDT) Work on TON

Unlike EVM chains where a single ERC-20 contract holds all balances, TON uses a **sharded architecture** for tokens (called Jettons):

```
┌──────────────────┐
│   Jetton Master   │  ← stores metadata (name, symbol, total supply)
│   (USDT Master)   │
└────────┬─────────┘
         │ deploys
    ┌────┴────┬──────────┬──────────┐
    ▼         ▼          ▼          ▼
┌────────┐┌────────┐┌────────┐┌────────┐
│Wallet A││Wallet B││Wallet C││Wallet D│  ← individual Jetton Wallets
│(User)  ││(User)  ││(Contract)│(User) │     each holds its own balance
└────────┘└────────┘└────────┘└────────┘
```

Key points:

- Each address that holds USDT has its own **Jetton Wallet** smart contract.
- Your settlement contract will also get its own Jetton Wallet automatically when it first receives USDT.
- Transfers go: Sender's Jetton Wallet → Recipient's Jetton Wallet (deploying it if needed).
- When your contract receives Jettons, it gets a `TokenNotification` message (opcode `0x7362d09c`).
- USDT on TON uses **6 decimals** (1 USDT = 1,000,000 units). Regular Jettons and TON itself use 9 decimals.

---

## 3. Settlement Flow

Step-by-step flow for a single settlement:

```
User A owes User B 100 USDT. Commission: 1%.

1. Frontend builds a Jetton transfer message:
   - amount: 100 USDT (100_000_000 units)
   - destination: Settlement Contract address
   - forward_payload: User B's address (encoded)
   - forward_ton_amount: enough TON to cover gas for two outgoing transfers

2. User A confirms in their wallet (Tonkeeper/MyTonWallet/etc.)

3. User A's USDT Jetton Wallet sends the transfer

4. Settlement Contract's Jetton Wallet receives 100 USDT
   and forwards a TokenNotification to the Settlement Contract

5. Settlement Contract processes the notification:
   - Reads forward_payload → extracts User B's address
   - Calculates commission: 1 USDT (1_000_000 units)
   - Calculates remainder: 99 USDT (99_000_000 units)

6. Contract sends two Jetton transfers from its own Jetton Wallet:
   a) 99 USDT → User B's address
   b) 1 USDT  → Owner (your) address

7. Excess TON gas is returned to User A's regular wallet (response_destination)
```

**Important: `response_destination`** must be set to the sender's **regular wallet address** (not their Jetton Wallet). The recipient's Jetton Wallet sends an `Excesses` message (opcode `0xd53276db`) to `response_destination` with leftover TON. If this points to a Jetton Wallet contract, the Jetton Wallet has no handler for `Excesses` → exit code 65535 and the excess TON is lost.

**Gas considerations:** each Jetton transfer on TON costs ~0.05-0.1 TON in gas. Since the contract sends two outgoing transfers, User A needs to attach ~0.3 TON as `forward_ton_amount` to cover gas. This is standard practice in TON DeFi.

---

## 4. Development Environment Setup

### Prerequisites

- Node.js ≥ 18 (recommended: 22+)
- npm or yarn
- A TON wallet app with testnet support (Tonkeeper recommended)

### Create a Blueprint project

```bash
npm create ton@latest

# Interactive prompts:
# Project name: splitogram-contract
# Template: tact-empty
```

This generates:

```
splitogram-contract/
├── contracts/         # .tact smart contract files
├── scripts/           # deploy and interaction scripts
├── tests/             # Jest test files
├── wrappers/          # auto-generated TS wrappers
├── tact.config.json
└── package.json
```

### Install dependencies

```bash
cd splitogram-contract
npm install
```

### IDE support

- VS Code: install "Tact Language" extension
- JetBrains: install TON plugin

---

## 5. Contract Design

### State variables

| Variable             | Type            | Description                           |
| -------------------- | --------------- | ------------------------------------- |
| `owner`              | `Address`       | Your address — receives commission    |
| `commission_percent` | `Int as uint16` | Commission in basis points (100 = 1%) |
| `usdt_master`        | `Address`       | USDT Jetton Master address on TON     |
| `total_processed`    | `Int as coins`  | Running total of processed volume     |
| `total_commission`   | `Int as coins`  | Running total of earned commission    |

### Messages

| Message             | Direction | Description                                             |
| ------------------- | --------- | ------------------------------------------------------- |
| `TokenNotification` | Incoming  | Jetton arrived, contains forward_payload with recipient |
| `JettonTransfer`    | Outgoing  | Send Jettons to recipient and to owner                  |
| `UpdateCommission`  | Incoming  | Owner updates commission rate                           |
| `Withdraw`          | Incoming  | Owner withdraws accumulated TON (gas leftovers)         |

### Encoding the recipient in forward_payload

When the frontend constructs the Jetton transfer, it encodes the recipient address in `forward_payload`. The contract reads this to know where to send the remainder.

Payload structure (simple):

```
forward_payload = beginCell()
  .storeUint(0, 32)           // op: 0 = settlement
  .storeAddress(recipientAddr) // who gets the remainder
  .endCell()
  .asSlice();
```

---

## 6. Contract Implementation (Tact)

The deployed contract is in `contracts/splitogram-contract/contracts/SplitogramSettlement.tact`. Key design points:

- **Commission:** configurable basis points (100 = 1%), clamped between min 0.1 USDT and max 1 USDT
- **Jetton Wallet trust:** must be set via `SetJettonWallet` (owner only) before the contract accepts any settlements. No trust-on-first-use — contract rejects `TokenNotification` if `usdt_wallet` is null.
- **Gas:** 0.15 TON per outgoing Jetton transfer (two per settlement = 0.30 TON). Sender attaches 0.5 TON total (0.35 forward_ton_amount + overhead). Excess TON returns to sender's regular wallet via `response_destination` (must NOT be the sender's Jetton Wallet — Jetton Wallets can't handle `Excesses` messages).
- **Stats:** `total_processed`, `total_commission`, `settlement_count` — accumulated on each settlement
- **Bounce handler:** present — bounced jettons stay in the contract's jetton wallet for owner to recover manually. Stats are already incremented (treat as exception).
- **WithdrawTon:** uses mode 0 (sends exact `msg.amount` from contract balance)
- **Constants:** `MIN_COMMISSION` (100,000 = 0.1 USDT), `MAX_COMMISSION` (1,000,000 = 1.0 USDT), `MAX_BPS` (1,000 = 10%), `GAS_PER_TRANSFER` (150,000,000 = 0.15 TON)

### Security notes

- **No trust-on-first-use:** Owner must call `SetJettonWallet` with the correct USDT Jetton Wallet address before going live. Query USDT Master's `get_wallet_address(contract_address)` to get the right address.
- **Bounce handler:** If outgoing Jetton transfers fail, stats are already updated but no automatic refund occurs. Bounced tokens stay in the contract's jetton wallet. Owner monitors and resolves manually.
- **Gas management:** Contract needs TON for outgoing messages. Settlement sender's `forward_ton_amount` covers this (0.4 TON), but monitor balance.
- The contract sends two outgoing messages per settlement.

### Testnet Gas Profiling

Measured on testnet (contract v3, 3 settlements + 3 owner ops):

| Transaction             | Total Fee (TON) | Fee (USDT @ 1.31) | Message Chain |
| ----------------------- | --------------- | ----------------- | ------------- |
| Settlement (any amount) | ~0.0346         | ~$0.045           | 11 messages   |
| UpdateCommission        | ~0.0042         | ~$0.005           | 2 messages    |
| WithdrawTon             | ~0.0053         | ~$0.007           | 3 messages    |
| Deploy                  | ~0.0119         | ~$0.016           | 3 messages    |

Settlement gas is constant regardless of USDT amount (5, 100, or 500 tUSDT all cost ~0.0346 TON). The sender attaches 0.5 TON and receives ~0.33-0.34 TON back as excess.

---

## 7. Testing Strategy

### Local testing with Sandbox

Blueprint uses `@ton/sandbox` — a local in-process blockchain emulator. No network, no testnet, instant execution.

Create `tests/SplitogramSettlement.spec.ts`:

```typescript
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { SplitogramSettlement } from '../wrappers/SplitogramSettlement';

describe('SplitogramSettlement', () => {
  let blockchain: Blockchain;
  let contract: SandboxContract<SplitogramSettlement>;
  let owner: SandboxContract<TreasuryContract>;
  let userA: SandboxContract<TreasuryContract>;
  let userB: SandboxContract<TreasuryContract>;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    owner = await blockchain.treasury('owner');
    userA = await blockchain.treasury('userA');
    userB = await blockchain.treasury('userB');

    // Deploy contract
    contract = blockchain.openContract(
      await SplitogramSettlement.fromInit(
        owner.address,
        100n, // 1% commission in basis points
      ),
    );

    const deployResult = await contract.send(
      owner.getSender(),
      { value: toNano('0.5') },
      { $$type: 'Deploy', queryId: 0n },
    );
    expect(deployResult.transactions).toHaveTransaction({
      from: owner.address,
      to: contract.address,
      deploy: true,
      success: true,
    });
  });

  // Test cases to implement:

  it('should deploy correctly', async () => {
    const commission = await contract.getCommission();
    expect(commission).toBe(100n);
  });

  // Test: happy path settlement
  // Test: commission calculation (1% of 100 USDT = 1 USDT)
  // Test: minimum commission (0.1 USDT)
  // Test: amount too small (reject if remainder <= 0)
  // Test: unknown sender Jetton Wallet (reject)
  // Test: owner can update commission
  // Test: non-owner cannot update commission
  // Test: owner can withdraw excess TON
  // Test: invalid forward_payload (reject)
});
```

Run tests:

```bash
npx blueprint test
```

### What to test thoroughly

| Scenario                               | Expected behavior                                 |
| -------------------------------------- | ------------------------------------------------- |
| Normal settlement (100 USDT, 1%)       | 99 USDT → recipient, 1 USDT → owner               |
| Small amount (0.5 USDT)                | Minimum commission 0.1 USDT, 0.4 USDT → recipient |
| Too small amount (0.05 USDT)           | Rejected — remainder would be ≤ 0                 |
| Unknown Jetton Wallet sender           | Rejected                                          |
| Invalid forward_payload (no recipient) | Rejected                                          |
| Owner updates commission to 2%         | State updated, next settlement uses 2%            |
| Non-owner tries to update commission   | Rejected                                          |
| Commission > 10% (1000 bps)            | Rejected                                          |
| Concurrent settlements                 | Each processed independently (TON is async)       |
| Bounced outgoing transfer              | Funds should be recoverable (add bounce handler)  |

---

## 8. Testnet Deployment

### Step 1: Switch Tonkeeper to Testnet

Open Tonkeeper → Settings → tap the Tonkeeper icon 6-7 times rapidly → Developer Menu appears → enable "Dev mode" → switch to Testnet.

### Step 2: Get test TON

Message `@test_giver_ton_bot` on Telegram with your testnet wallet address. You'll receive ~2 test TON.

Alternative faucets: Chainstack TON Faucet, TonX Faucet.

### Step 3: Deploy

```bash
npx blueprint run --testnet

# Select the deploy script
# A QR code or link will appear
# Scan/open with Tonkeeper → confirm the transaction
```

### Step 4: Test Jetton (tUSDT) — DONE

Test USDT already minted on testnet:

- **Jetton Master:** `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7`
- **Name:** test USDT SPLIT (tUSDT), 6 decimals
- **Supply:** 1,000 tUSDT, held by Wallet C (`0QAoBJzd06D3xzxrdCiF38ZnVyOVDCTZPKmQnrWO-2RfU9pq`)
- **Minted via:** https://minter.ton.org?testnet=true
- **Tonviewer:** https://testnet.tonviewer.com/0QAoBJzd06D3xzxrdCiF38ZnVyOVDCTZPKmQnrWO-2RfU9pq?section=tokens

### Step 5: Contract Deployed — DONE

- **Contract address:** `EQC7KPpOr-FJgcvA9mw7kIWF9FLAiWapBc74QH1Kx2kFY5nV`
- **Deployed from:** Wallet C (owner)
- **Commission:** 100 bps (1%), min 0.1 USDT, max 1 USDT
- **Tonviewer:** https://testnet.tonviewer.com/EQC7KPpOr-FJgcvA9mw7kIWF9FLAiWapBc74QH1Kx2kFY5nV

### Step 5: Test the full flow

1. Send test Jettons to the contract with proper forward_payload
2. Verify on testnet explorer (testnet.tonviewer.com) that commission and remainder were split correctly
3. Check contract getters for updated stats

---

## 9. Frontend Integration (TON Connect)

### Install SDK

```bash
npm install @tonconnect/ui-react
```

### Create manifest.json

Host this file at your app's URL (e.g., `https://your-app.com/tonconnect-manifest.json`):

```json
{
  "url": "https://your-app.com",
  "name": "Splitogram",
  "iconUrl": "https://your-app.com/icon.png"
}
```

### Connect wallet

```tsx
import { TonConnectUIProvider, useTonConnectUI } from '@tonconnect/ui-react';

// Wrap your app
<TonConnectUIProvider manifestUrl="https://your-app.com/tonconnect-manifest.json">
  <App />
</TonConnectUIProvider>;
```

### Send a settlement transaction

```typescript
import { beginCell, Address, toNano } from '@ton/core';

async function sendSettlement(
  tonConnectUI: TonConnectUI,
  senderAddress: string, // sender's regular wallet address
  userJettonWalletAddress: string, // sender's USDT Jetton Wallet
  contractAddress: string, // Splitogram contract
  recipientAddress: string, // who receives the remainder
  amountInUSDT: number, // e.g. 100.0
) {
  const amount = BigInt(Math.round(amountInUSDT * 1_000_000)); // 6 decimals

  // Build Jetton transfer body
  // IMPORTANT: response_destination MUST be the sender's regular wallet address,
  // NOT their Jetton Wallet. The Excesses message (0xd53276db) with leftover TON
  // is sent to response_destination — Jetton Wallets can't handle it (exit code 65535).
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton transfer
    .storeUint(0, 64) // query_id
    .storeCoins(amount) // jetton amount
    .storeAddress(Address.parse(contractAddress)) // destination: settlement contract
    .storeAddress(Address.parse(senderAddress)) // response_destination: excess TON back to sender's wallet
    .storeBit(false) // no custom_payload
    .storeCoins(toNano('0.35')) // forward_ton_amount (gas for contract's 2 outgoing transfers)
    // inline forward_payload (no Either bit, no ref — validated on testnet)
    .storeUint(0, 32) // op = 0 (settlement)
    .storeAddress(Address.parse(recipientAddress)) // who receives remainder
    .endCell();

  await tonConnectUI.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [
      {
        address: userJettonWalletAddress,
        amount: toNano('0.5').toString(), // TON for gas (forward_ton_amount + overhead)
        payload: body.toBoc().toString('base64'),
      },
    ],
  });
}
```

### Getting the user's Jetton Wallet address

Before sending a transfer, you need to know the user's USDT Jetton Wallet address. Query the USDT Master contract:

```typescript
import { JettonMaster } from '@ton/ton';

const USDT_MASTER = Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');

async function getUserJettonWallet(userAddress: Address, client: TonClient): Promise<Address> {
  const master = client.open(JettonMaster.create(USDT_MASTER));
  return await master.getWalletAddress(userAddress);
}
```

---

## 10. Mainnet Deployment — DONE (2026-03-12)

### Deployed

- [x] All test cases pass (17 sandbox tests)
- [x] Gas consumption profiled and forward_ton_amount values are correct
- [x] Bounced message handling implemented
- [x] Contract verified on testnet with real-like scenarios
- [x] Commission rate: 1% (100 bps), min 0.1, max 1.0 USDT
- [x] First production settlement completed

### Mainnet addresses

| Entity                 | Address                                            |
| ---------------------- | -------------------------------------------------- |
| Contract               | `EQBVVph-sYX2BI165SLXHdqluawmjXx5RWZZymeGvQ5hTDgq` |
| Contract Jetton Wallet | `EQAjosp5oiyrp9yClBOcPT2fFxOwO8t1LLJW7z79evsYUZGn` |
| USDT Jetton Master     | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` |
| Owner (W5R1)           | `UQCZRBAItQRFbE3HkfTZerfOgcGiucYSL3ZAd3x0eyAIfxqe` |

### USDT Master addresses

```
Mainnet: EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
Testnet: kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7  (tUSDT — "test USDT SPLIT", 6 decimals)
```

### Deploy scripts

Mainnet deploy scripts live in `contracts/splitogram-contract/scripts/mainnet/`:

- `deploySplitogramSettlement.ts` — deploy with mainnet owner
- `setJettonWallet.ts` — configure trusted USDT jetton wallet
- `verifyState.ts` — read contract state
- Set up alerts for unusual activity

---

## 11. Security

### What we did

- **Jetton Wallet verification**: `SetJettonWallet` (owner-only) must be called before the contract accepts any settlements. Every `TokenNotification` checks `sender() == self.usdt_wallet`. No trust-on-first-use.
- **Bounce handler**: `bounced(src: bounced<TokenTransfer>)` catches failed outgoing transfers. Tokens stay in the contract's jetton wallet for manual owner recovery. Stats are already incremented — treat as exception.
- **Safe integer types**: all amounts use `as coins`, commission uses `as uint16`, settlement count uses `as uint32`. No bare `Int` for money.
- **Commission guard**: `require(remainder > 0)` rejects amounts too small to settle after commission. Min/max clamp (0.1–1.0 USDT) applied before the check.
- **State-before-send**: stats are updated (lines 98-100) before outgoing sends (lines 103-106). TON's actor model means no traditional reentrancy, and ordering is safe.
- **Gas management**: `GAS_PER_TRANSFER` constant (0.15 TON per outgoing message), `WithdrawTon` for owner to reclaim excess TON, backend gas estimation via TONAPI trace emulation with empirical fallback.
- **Payload validation**: `require(op == 0)` + `loadAddress()` rejects malformed or unexpected `forward_payload` structures.

### What we decided not to do (and why)

- **Hardware wallet / multisig for owner**: overkill at current volume. Owner is a W5R1 wallet. Revisit when monthly volume exceeds $10K.
- **Upgrade / proxy pattern**: not needed. TON contracts are immutable by design. Upgrade path is deploying a new contract + updating `SETTLEMENT_CONTRACT_ADDRESS` in wrangler.toml (already done once: v3→v4).
- **Rate limiting**: economically self-protecting. Each settlement costs the sender ~0.035 TON in gas, and the contract always profits via min commission (0.1 USDT). Flooding is unprofitable for attackers.
- **On-chain events**: redundant. Off-chain tracking via TONAPI event verification + `activity_log` DB + admin dashboard with Tonviewer links covers all needs.
- **Admin pause**: `SetJettonWallet` to a bogus address effectively pauses the contract. A dedicated `paused` flag would be cleaner but isn't worth a redeploy.
- **Professional audit**: not yet justified. 17 sandbox tests cover critical paths. Revisit when volume exceeds $10K/month (audit cost: $5–15K for TON).

---

## 12. Reference Links

### TON Smart Contract Development

| Resource                     | URL                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Tact Language Docs           | https://docs.tact-lang.org/                                                                 |
| Tact by Example (Jettons)    | https://tact-by-example.org/07-jetton-standard                                              |
| Tact DeFi Cookbook           | https://github.com/tact-lang/defi-cookbook                                                  |
| Tact Jetton Cookbook         | https://docs.tact-lang.org/cookbook/jettons/                                                |
| Blueprint SDK                | https://github.com/ton-org/blueprint                                                        |
| TON Sandbox (testing)        | https://github.com/ton-org/sandbox                                                          |
| TON Smart Contracts Overview | https://docs.ton.org/v3/documentation/smart-contracts/overview                              |
| Setup Environment Guide      | https://docs.ton.org/v3/guidelines/quick-start/developing-smart-contracts/setup-environment |

### Jetton / USDT Specifics

| Resource                     | URL                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Deep Dive into USDT on TON   | https://blog.ton.org/deep-dive-into-usdt-on-ton                                  |
| TEP-74 (Jetton Standard)     | https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md |
| Jetton Transfer Guide        | https://docs.ton.org/v3/guidelines/ton-connect/cookbook/jetton-transfer          |
| Jetton Implementation (Tact) | https://github.com/howardpen9/jetton-implementation-in-tact                      |

### Security

| Resource                         | URL                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Secure Tact Programming (CertiK) | https://www.certik.com/resources/blog/secure-smart-contract-programming-in-tact-popular-mistakes-in-the-ton |
| TON Security Best Practices      | https://docs.ton.org/v3/guidelines/smart-contracts/security/overview                                        |

### Testing & Deployment

| Resource             | URL                                                                  |
| -------------------- | -------------------------------------------------------------------- |
| Testing Mini Apps    | https://docs.ton.org/v3/guidelines/dapps/tma/guidelines/testing-apps |
| TON Testnet Explorer | https://testnet.tonviewer.com                                        |
| TON Mainnet Explorer | https://tonviewer.com                                                |
| Testnet Faucet Bot   | https://t.me/test_giver_ton_bot                                      |

### TON Connect (Wallet Integration)

| Resource                       | URL                                                  |
| ------------------------------ | ---------------------------------------------------- |
| TON Connect Overview           | https://docs.ton.org/ecosystem/ton-connect/overview  |
| TON Connect UI React           | https://github.com/nickolay-aspect/ton-connect-react |
| Wallets List (TON Connect)     | https://github.com/ton-connect/wallets-list          |
| Telegram Blockchain Guidelines | https://core.telegram.org/bots/blockchain-guidelines |

---

## Appendix A: Commission Economics

| Settlement | Amount    | Commission (1%) | Min/Max Clamp | Actual Commission | Recipient Gets |
| ---------- | --------- | --------------- | ------------- | ----------------- | -------------- |
| Small      | 5 USDT    | 0.05 USDT       | min 0.10 USDT | 0.10 USDT         | 4.90 USDT      |
| Medium     | 50 USDT   | 0.50 USDT       | —             | 0.50 USDT         | 49.50 USDT     |
| Standard   | 100 USDT  | 1.00 USDT       | = max cap     | 1.00 USDT         | 99.00 USDT     |
| Large      | 500 USDT  | 5.00 USDT       | max 1.00 USDT | 1.00 USDT         | 499.00 USDT    |
| Very Large | 1000 USDT | 10.00 USDT      | max 1.00 USDT | 1.00 USDT         | 999.00 USDT    |

Gas costs per settlement: approximately 0.25-0.35 TON (~$0.08-0.12 at current prices), paid by the sender.

## Appendix B: Settlement Economics & Direct Transfer Fallback

### The problem

On-chain settlement via the Splitogram contract costs ~0.25-0.35 TON in gas (~$0.08-0.12). For small debts, this gas cost can be a significant percentage of the settlement amount — e.g., settling $1 with $0.10 in gas is a 10% overhead. That's unfair to the user.

### Decision: direct transfer fallback for small amounts

If the estimated gas cost exceeds **N%** of the settlement amount, the app should offer a **direct wallet-to-wallet USDT transfer** instead of routing through the contract. This skips the commission but also skips the gas overhead of the contract's two outgoing messages.

**Direct transfer flow:**

1. Frontend calculates: `gasCostUSD / settlementAmountUSD > threshold`
2. If above threshold → build a standard Jetton transfer directly to the recipient (no contract)
3. User confirms in wallet → USDT goes straight from sender to recipient
4. Backend marks settlement as `settled_onchain` with `direct: true` flag
5. No commission collected on direct transfers

**Contract flow (normal):**

1. Gas ratio below threshold → route through Splitogram contract as designed
2. Contract splits: commission → owner, remainder → recipient
3. Commission collected

### Open questions (resolve during development)

- **Threshold value:** What % is fair? 5%? 10%? Need to profile actual gas costs on testnet to decide. At ~$0.10 gas, 5% threshold means direct transfer for settlements under ~$2, 10% threshold means under ~$1.
- **Gas estimation accuracy:** Is 0.25-0.35 TON stable, or does it vary significantly with network load? Profile on testnet across multiple scenarios.
- **TON price volatility:** Gas is in TON but settlement is in USDT. A TON price spike could push the gas ratio above threshold for larger amounts. Should the threshold use a cached TON/USD rate?
- **UX:** Should the user see "Direct transfer (no fee)" vs "Via Splitogram (1% commission)"? Or just handle it silently?
- **Tracking:** Direct transfers bypass the contract, so `total_processed` / `total_commission` getters won't reflect them. Backend must track direct settlements separately for analytics.
- **Verification:** Direct transfers are standard Jetton transfers — verify via TONAPI the same way, just check sender→recipient instead of sender→contract→recipient chain.

### Settlement type matrix

| Settlement amount | Gas ratio | Path            | Commission | Gas cost                    |
| ----------------- | --------- | --------------- | ---------- | --------------------------- |
| $0.50             | ~20%      | Direct transfer | None       | ~0.05 TON (single transfer) |
| $1.00             | ~10%      | Direct transfer | None       | ~0.05 TON                   |
| $5.00             | ~2%       | Via contract    | $0.05 (1%) | ~0.30 TON                   |
| $50.00            | ~0.2%     | Via contract    | $0.50 (1%) | ~0.30 TON                   |
| $100.00           | ~0.1%     | Via contract    | $1.00 (1%) | ~0.30 TON                   |

_Note: Gas estimates are approximate. Direct transfers cost less (~0.05 TON) because they involve one Jetton transfer message instead of three (transfer + two outgoing splits). Exact values TBD during testnet profiling._

### Currency scope

**USDT only for Phase 10.** Rationale:

- Debts are in fiat (USD, EUR, etc.) — USDT maps ~1:1 to USD, simple conversion
- USDT is the dominant stablecoin on TON (~$1B+ circulating)
- No price oracle needed (USD ≈ USDT)
- One contract, one Jetton Wallet, minimal attack surface
- Native TON settlement would require a price oracle and slippage handling — deferred to Phase 11

If TON coin settlement is added later, it's a second `receive()` handler in the same contract (not a new contract). Multi-Jetton support would use an `accepted_jettons` map — also same contract. No need for per-Jetton contracts in any scenario.

## Appendix C: Glossary

| Term                   | Meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| **Jetton**             | Fungible token standard on TON (like ERC-20 on Ethereum)            |
| **Jetton Master**      | Central contract storing token metadata and minting logic           |
| **Jetton Wallet**      | Per-user contract holding token balance                             |
| **TON Connect**        | Standard protocol for connecting wallets to dApps on TON            |
| **Blueprint**          | All-in-one dev environment for TON smart contracts                  |
| **Tact**               | High-level language for TON smart contracts                         |
| **TVM**                | TON Virtual Machine — executes smart contract bytecode              |
| **Basis points (bps)** | 1/100th of a percent (100 bps = 1%)                                 |
| **forward_payload**    | Data attached to a Jetton transfer, forwarded to the recipient      |
| **Bounce**             | When a message to a contract fails, it "bounces" back to the sender |

---

_Document prepared for Dmitry / Quberas — Splitogram TWA project. March 2026._
