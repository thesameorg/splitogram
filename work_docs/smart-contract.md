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

7. Excess TON gas is returned to User A (response_destination)
```

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

Below is a reference implementation. Place this in `contracts/SplitogramSettlement.tact`:

```tact
import "@stdlib/deploy";
import "@stdlib/ownable";

// Standard Jetton messages (TEP-74)
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forward_payload: Slice as remaining;
}

message(0xf8a7ea5) TokenTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    response_destination: Address;
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

message UpdateCommission {
    new_commission: Int as uint16; // basis points, e.g. 100 = 1%
}

message WithdrawTon {
    amount: Int as coins;
}

contract SplitogramSettlement with Deployable, Ownable {

    owner: Address;
    commission_bps: Int as uint16;    // basis points (100 = 1%)
    usdt_wallet: Address?;            // this contract's USDT Jetton Wallet
    total_processed: Int as coins;
    total_commission: Int as coins;

    init(owner: Address, commission_bps: Int) {
        self.owner = owner;
        self.commission_bps = commission_bps;
        self.usdt_wallet = null;
        self.total_processed = 0;
        self.total_commission = 0;
    }

    // ── Receive Jetton notification ─────────────────────────────
    receive(msg: TokenNotification) {

        // Only accept from our known Jetton Wallet (set on first use)
        // or set it on first incoming transfer
        if (self.usdt_wallet == null) {
            // First time: remember the Jetton Wallet address
            // In production, verify this against the USDT Master
            self.usdt_wallet = sender();
        } else {
            require(sender() == self.usdt_wallet!!, "Unknown Jetton Wallet");
        }

        // Decode forward_payload: op(32 bits) + recipient address
        let op: Int = msg.forward_payload.loadUint(32);
        require(op == 0, "Unknown operation");
        let recipient: Address = msg.forward_payload.loadAddress();

        // Calculate commission
        let commission: Int = (msg.amount * self.commission_bps) / 10000;
        if (commission < 100000) {  // minimum 0.1 USDT = 100_000 units
            commission = 100000;
        }
        let remainder: Int = msg.amount - commission;
        require(remainder > 0, "Amount too small after commission");

        // Update stats
        self.total_processed = self.total_processed + msg.amount;
        self.total_commission = self.total_commission + commission;

        // Send remainder to recipient
        self.sendJetton(
            recipient,
            remainder,
            msg.from,  // excess gas goes back to original sender
            0
        );

        // Send commission to owner
        self.sendJetton(
            self.owner,
            commission,
            self.owner,
            0
        );
    }

    // ── Internal: send Jettons via our Jetton Wallet ────────────
    fun sendJetton(to: Address, amount: Int, responseAddr: Address, queryId: Int) {
        send(SendParameters{
            to: self.usdt_wallet!!,
            value: ton("0.1"),     // gas for Jetton transfer
            mode: 0,
            body: TokenTransfer{
                queryId: queryId,
                amount: amount,
                destination: to,
                response_destination: responseAddr,
                custom_payload: null,
                forward_ton_amount: 0,
                forward_payload: emptySlice()
            }.toCell()
        });
    }

    // ── Owner: update commission ─────────────────────────────────
    receive(msg: UpdateCommission) {
        self.requireOwner();
        require(msg.new_commission <= 1000, "Max 10%");
        self.commission_bps = msg.new_commission;
    }

    // ── Owner: withdraw excess TON from contract ─────────────────
    receive(msg: WithdrawTon) {
        self.requireOwner();
        send(SendParameters{
            to: self.owner,
            value: msg.amount,
            mode: SendRemainingValue,
            body: "withdraw".asComment()
        });
    }

    // ── Getters ──────────────────────────────────────────────────
    get fun commission(): Int {
        return self.commission_bps;
    }

    get fun stats(): Stats {
        return Stats{
            total_processed: self.total_processed,
            total_commission: self.total_commission
        };
    }

    get fun jetton_wallet(): Address? {
        return self.usdt_wallet;
    }
}

struct Stats {
    total_processed: Int as coins;
    total_commission: Int as coins;
}
```

### Important notes on this implementation

- **This is a starting point, not production-ready code.** Before mainnet deployment, it needs a full audit.
- The `usdt_wallet` is set on the first incoming Jetton transfer. In production, you should verify this address by querying the USDT Jetton Master with `get_wallet_address(my_address)` and comparing.
- Gas values (`ton("0.1")`) are estimates. Profile actual gas consumption during testing.
- Bounced message handling is not shown here but is critical for production — see Security Checklist.
- The contract sends two outgoing messages, so it needs enough TON balance to cover gas.

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

### Step 4: Deploy a test Jetton

Since real USDT doesn't exist on testnet, deploy your own test Jetton with 6 decimals to simulate USDT:

- Use the Jetton template from `tact-by-example.org/07-jetton-standard`
- Set decimals to 6 in metadata
- Mint test tokens to your test wallets

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
  userJettonWalletAddress: string, // sender's USDT Jetton Wallet
  contractAddress: string, // Splitogram contract
  recipientAddress: string, // who receives the remainder
  amountInUSDT: number, // e.g. 100.0
) {
  const amount = BigInt(Math.round(amountInUSDT * 1_000_000)); // 6 decimals

  // Encode recipient in forward_payload
  const forwardPayload = beginCell()
    .storeUint(0, 32) // op = 0 (settlement)
    .storeAddress(Address.parse(recipientAddress))
    .endCell();

  // Build Jetton transfer body
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton transfer
    .storeUint(0, 64) // query_id
    .storeCoins(amount) // jetton amount
    .storeAddress(Address.parse(contractAddress)) // destination
    .storeAddress(Address.parse(recipientAddress)) // response_destination
    .storeBit(false) // no custom_payload
    .storeCoins(toNano('0.25')) // forward_ton_amount (gas for contract)
    .storeBit(true) // forward_payload in ref
    .storeRef(forwardPayload)
    .endCell();

  await tonConnectUI.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [
      {
        address: userJettonWalletAddress,
        amount: toNano('0.35').toString(), // TON for gas
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

## 10. Mainnet Deployment

### Pre-deployment checklist

- [ ] All test cases pass
- [ ] Gas consumption profiled and forward_ton_amount values are correct
- [ ] Bounced message handling implemented
- [ ] Contract verified on testnet with real-like scenarios
- [ ] Owner address is a secure wallet (ideally multisig)
- [ ] Commission rate is set correctly
- [ ] Consider a professional security audit for contracts handling significant value

### Deploy

```bash
npx blueprint run
# Same flow as testnet but with mainnet wallet
# Confirm transaction in Tonkeeper (mainnet mode)
```

### USDT Master address on mainnet

```
EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
```

### Post-deployment

- Verify contract on tonviewer.com
- Test with a small real settlement (e.g. 1 USDT)
- Monitor the first few transactions
- Set up alerts for unusual activity

---

## 11. Security Checklist

### Critical

- [ ] **Verify Jetton Wallet sender**: on first transfer, verify the sender is the real Jetton Wallet for this contract by querying the Jetton Master's `get_wallet_address`. Do not blindly trust the first sender.
- [ ] **Handle bounced messages**: if the outgoing transfer to the recipient fails (wrong address, contract doesn't accept), the Jettons bounce back. Implement `bounced(msg: Slice)` handler to refund the original sender or at least not lose the funds.
- [ ] **Integer overflow/underflow**: always use `as coins` or explicit serialization types. Never use bare `Int` for amounts.
- [ ] **Commission calculation**: ensure `remainder > 0` after commission. Guard against amounts smaller than minimum commission.
- [ ] **Reentrancy-like issues**: TON is async (actor model), so traditional reentrancy doesn't apply. But concurrent messages can arrive in any order — ensure state updates are safe.
- [ ] **Gas management**: each outgoing message costs TON. If the contract runs out of TON, it can't send outgoing messages. Keep a TON reserve and monitor balance.

### Important

- [ ] **Owner key security**: owner can change commission and withdraw TON. Use a hardware wallet or multisig.
- [ ] **Upgrade path**: TON contracts are immutable once deployed. If you need upgradeability, implement a proxy pattern or a migration mechanism (new contract + redirect).
- [ ] **Rate limiting**: consider if you need protection against someone flooding the contract with tiny settlements.
- [ ] **Forward_payload validation**: strictly validate the payload structure. Reject anything unexpected.

### Nice to have

- [ ] **Events/logging**: emit events (external messages) for off-chain indexing.
- [ ] **Admin pause**: ability for owner to pause the contract in case of emergency.
- [ ] **Professional audit**: for contracts handling >$10K, strongly recommended.

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

| Settlement | Amount   | Commission (1%) | Min Commission | Actual Commission | Recipient Gets |
| ---------- | -------- | --------------- | -------------- | ----------------- | -------------- |
| Small      | 5 USDT   | 0.05 USDT       | 0.10 USDT      | 0.10 USDT         | 4.90 USDT      |
| Medium     | 50 USDT  | 0.50 USDT       | 0.10 USDT      | 0.50 USDT         | 49.50 USDT     |
| Standard   | 100 USDT | 1.00 USDT       | 0.10 USDT      | 1.00 USDT         | 99.00 USDT     |
| Large      | 500 USDT | 5.00 USDT       | 0.10 USDT      | 5.00 USDT         | 495.00 USDT    |

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

| Settlement amount | Gas ratio | Path | Commission | Gas cost |
|---|---|---|---|---|
| $0.50 | ~20% | Direct transfer | None | ~0.05 TON (single transfer) |
| $1.00 | ~10% | Direct transfer | None | ~0.05 TON |
| $5.00 | ~2% | Via contract | $0.05 (1%) | ~0.30 TON |
| $50.00 | ~0.2% | Via contract | $0.50 (1%) | ~0.30 TON |
| $100.00 | ~0.1% | Via contract | $1.00 (1%) | ~0.30 TON |

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
