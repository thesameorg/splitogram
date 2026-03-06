# Smart Contract Testnet Plan — Step by Step

> First-time deployment of a Jetton (test USDT) + Splitogram settlement contract on TON testnet.
> Goal: deploy, mint, send test transactions between 3 wallets, inspect everything on-chain.

---

## Phase 0: Tooling Setup

### 0.1 Install TON MCP Server (for Claude to inspect on-chain data)

Two MCP servers exist. **Install both** — they complement each other:

| MCP Server                                                                          | Language       | Key Tools                                                        | Best For            |
| ----------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------- | ------------------- |
| [kriuchkov/ton-mcp](https://github.com/kriuchkov/ton-mcp)                           | TypeScript/Bun | Send transactions, check balances                                | Wallet ops, sending |
| [devonmojito/ton-blockchain-mcp](https://github.com/devonmojito/ton-blockchain-mcp) | Python 3.10+   | `analyze_address`, `get_transaction_details`, `get_jetton_price` | Reading chain state |

**Setup steps:**

```bash
# 1. Clone kriuchkov/ton-mcp (TypeScript)
cd ~/repos
git clone https://github.com/kriuchkov/ton-mcp.git
cd ton-mcp
bun install

# 2. Clone devonmojito/ton-blockchain-mcp (Python)
cd ~/repos
git clone https://github.com/devonmojito/ton-blockchain-mcp.git
cd ton-blockchain-mcp
pip install -r requirements.txt   # or use uv/pipx
```

**Get a TONAPI key** (free, needed for both):

- Go to https://tonconsole.com → sign up → create project → get API key
- Or message `@tonapibot` on Telegram

**Add to Claude Code MCP config** (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "ton-mcp": {
      "command": "bun",
      "args": ["run", "start"],
      "cwd": "/Users/dmitrykozlov/repos/ton-mcp",
      "env": {
        "LOG_LEVEL": "3"
      }
    },
    "ton-blockchain-mcp": {
      "command": "python",
      "args": ["-m", "ton_mcp"],
      "cwd": "/Users/dmitrykozlov/repos/ton-blockchain-mcp",
      "env": {
        "TONAPI_KEY": "<your-tonapi-key>"
      }
    }
  }
}
```

> **NOTE:** These MCP servers may or may not support testnet out of the box. Verify after install. If they don't, we'll fall back to direct TONAPI REST calls via `curl`/`fetch` against `https://testnet.tonapi.io`.

**Fallback CLI inspection (always works):**

```bash
# Check any testnet address via TONAPI REST
curl "https://testnet.tonapi.io/v2/accounts/<ADDRESS>" -H "Authorization: Bearer <TONAPI_KEY>"

# Check jetton balance
curl "https://testnet.tonapi.io/v2/accounts/<ADDRESS>/jettons" -H "Authorization: Bearer <TONAPI_KEY>"

# Check transaction
curl "https://testnet.tonapi.io/v2/blockchain/transactions/<TX_HASH>" -H "Authorization: Bearer <TONAPI_KEY>"
```

### 0.2 Web-Based Diagnostic Tools (bookmark these)

| Tool                     | URL                                 | Purpose                                            |
| ------------------------ | ----------------------------------- | -------------------------------------------------- |
| **Tonviewer (testnet)**  | https://testnet.tonviewer.com       | Primary explorer — contracts, txs, jetton balances |
| **Tonscan (testnet)**    | https://testnet.tonscan.org         | Alternative explorer                               |
| **TON Minter (testnet)** | https://minter.ton.org?testnet=true | Deploy/manage Jettons via browser (no code)        |
| **TON Verifier**         | https://verifier.ton.org            | Verify contract source code on-chain               |
| **TONAPI Swagger**       | https://tonapi.io/api-v2            | REST API playground                                |
| **Testnet Faucet (web)** | https://faucet.tonxapi.com          | Get free testnet TON                               |
| **Testnet Faucet (bot)** | https://t.me/testgiver_ton_bot      | Get free testnet TON via Telegram                  |

### 0.3 Wallet Setup (3 wallets) — 🧑 MANUAL

You need **3 separate testnet wallets**. Use **Tonkeeper** (mobile) or **MyTonWallet** (browser extension).

#### Option A: Tonkeeper (mobile, recommended)

1. Open Tonkeeper → Settings → tap the Tonkeeper logo at the bottom **5 times quickly**
2. "Dev Menu" appears → tap "Switch to Testnet"
3. Create **3 separate wallets** (use "Add Wallet" → "New Wallet") and label them:
   - **Wallet A** — "Sender" (the person paying a debt)
   - **Wallet B** — "Receiver" (the creditor receiving payment)
   - **Wallet C** — "Fee Collector" (the Splitogram service owner, receives commission)
4. **Write down all 3 addresses** — you'll need them throughout

#### Option B: MyTonWallet (Chrome extension)

1. Install from https://mytonwallet.io
2. Open Settings → click on your address **5 times** to enable testnet
3. Create 3 wallets (or use 3 browser profiles)

#### Fund all 3 wallets — 🧑 MANUAL

Send a message to `@testgiver_ton_bot` on Telegram with each wallet address (one at a time). You'll get ~2 TON per request. Alternatively use https://faucet.tonxapi.com.

Need at least:

- **Wallet A (Sender):** 5 TON (for gas during settlements)
- **Wallet B (Receiver):** 2 TON (for gas to receive jettons)
- **Wallet C (Fee Collector):** 2 TON (for gas)

**Verify:** Open https://testnet.tonviewer.com and paste each address to confirm balances.

---

## Phase 1: Create a Test Jetton (fake USDT)

Real USDT doesn't exist on testnet. We'll mint our own "Test USDT" (tUSDT) with 6 decimals.

### Option A: No-Code via Minter (fastest) — 🧑 MANUAL

1. Open https://minter.ton.org?testnet=true
2. Connect **Wallet C** (Fee Collector — this will be the Jetton owner)
3. Fill in:
   - **Name:** `Test USDT`
   - **Symbol:** `tUSDT`
   - **Decimals:** `6` ← critical, must match real USDT
   - **Amount to mint:** `1000000000` (= 1,000 tUSDT since 6 decimals)
   - **Description:** `Test USDT for Splitogram testnet`
4. Click Deploy → confirm transaction in wallet
5. **Save the Jetton Master address** — you'll need it everywhere

After minting, all 1,000 tUSDT will be in Wallet C.

### Option B: Via Blueprint Project (more control) — 🤖 Claude can help

If Option A doesn't work or you want more control:

```bash
cd ~/repos
npm create ton@latest
# Project name: test-jetton
# Template: tact-empty

cd test-jetton
npm install
```

Then Claude can write a standard Jetton Tact contract, build it, and you deploy via:

```bash
npx blueprint run --testnet --tonconnect
```

### Distribute tUSDT to test wallets — 🧑 MANUAL

After minting, send tUSDT from Wallet C to other wallets:

1. In Tonkeeper/MyTonWallet (connected as Wallet C), send:
   - **500 tUSDT → Wallet A** (Sender)
   - **100 tUSDT → Wallet B** (Receiver)
   - Keep 400 tUSDT in Wallet C

2. **Verify on Tonviewer:** check each address → "Jettons" tab should show tUSDT balance

---

## Phase 2: Build & Test the Splitogram Settlement Contract

### 2.1 Create Blueprint Project — 🤖 Claude does this

```bash
cd ~/repos/splitogram
mkdir -p contracts
cd contracts
npm create ton@latest
# Project name: splitogram-contract
# Template: tact-empty

cd splitogram-contract
npm install
```

### 2.2 Write the Contract — 🤖 Claude does this

Claude writes `contracts/SplitogramSettlement.tact` based on the reference in `smart-contract.md`:

- Receives Jetton (tUSDT) via `TokenNotification`
- Splits: commission → Wallet C, remainder → recipient from `forward_payload`
- Owner can update commission rate
- Owner can withdraw excess TON
- Getters for stats and commission

### 2.3 Write Tests — 🤖 Claude does this

Claude writes `tests/SplitogramSettlement.spec.ts` using `@ton/sandbox` (local blockchain emulator):

- Deploy correctly
- Happy path: 100 tUSDT → 99 to recipient, 1 to owner
- Minimum commission enforcement (0.1 tUSDT)
- Amount too small (reject)
- Unknown Jetton wallet (reject)
- Owner can update commission
- Non-owner cannot update commission
- Invalid payload (reject)

```bash
npx blueprint test
# All tests must pass before deployment
```

### 2.4 Build — 🤖 Claude does this

```bash
npx blueprint build
```

---

## Phase 3: Deploy to Testnet

### 3.1 Write Deploy Script — 🤖 Claude does this

Claude writes `scripts/deploySplitogramSettlement.ts`:

- Sets `owner` = Wallet C address
- Sets `commission_bps` = 100 (1%)
- Deploys via TON Connect

### 3.2 Deploy — 🧑 MANUAL (wallet confirmation required)

```bash
npx blueprint run deploySplitogramSettlement --testnet --tonconnect
```

1. A QR code / deep link appears
2. Scan with Tonkeeper (connected as **Wallet C**) → confirm transaction
3. Wait for deployment confirmation
4. **Save the contract address**

### 3.3 Verify Deployment

- Open https://testnet.tonviewer.com/`<CONTRACT_ADDRESS>`
- Confirm: contract exists, has code, initial state looks correct
- Claude can also query via MCP or TONAPI REST:
  ```bash
  curl "https://testnet.tonapi.io/v2/accounts/<CONTRACT_ADDRESS>" \
    -H "Authorization: Bearer <TONAPI_KEY>"
  ```

---

## Phase 4: End-to-End Test Transactions

### 4.1 Scenario 1: Basic Settlement (100 tUSDT, 1% commission)

**What happens:**

- Wallet A sends 100 tUSDT to the Splitogram contract with Wallet B as recipient
- Contract splits: 99 tUSDT → Wallet B, 1 tUSDT → Wallet C

**How to execute — 🧑 MANUAL + 🤖 Claude writes the script**

Claude writes `scripts/testSettlement.ts`:

```typescript
// Pseudocode — Claude will write the real version
// 1. Build Jetton transfer message:
//    - amount: 100_000_000 (100 tUSDT)
//    - destination: Splitogram contract
//    - forward_payload: op=0 + Wallet B address
//    - forward_ton_amount: 0.3 TON (gas)
// 2. Send via TON Connect (Wallet A confirms)
```

```bash
npx blueprint run testSettlement --testnet --tonconnect
# Connect as Wallet A → confirm transaction
```

**Verify — 🧑 + 🤖:**

1. Open https://testnet.tonviewer.com/`<CONTRACT_ADDRESS>` → check transaction history
2. Check Wallet B's tUSDT balance: should increase by 99 tUSDT
3. Check Wallet C's tUSDT balance: should increase by 1 tUSDT
4. Check contract getters (stats):
   ```bash
   # Claude can run this via script or MCP
   npx blueprint run getContractStats --testnet
   ```

### 4.2 Scenario 2: Small Amount (minimum commission)

- Wallet A sends **5 tUSDT** to contract → recipient Wallet B
- Expected: 0.1 tUSDT commission (minimum), 4.9 tUSDT to Wallet B

### 4.3 Scenario 3: Multiple Settlements

- Run 3-5 settlements in sequence
- Verify `total_processed` and `total_commission` getters accumulate correctly

### 4.4 Scenario 4: Owner Operations

- **Update commission** to 200 bps (2%) from Wallet C → verify next settlement uses 2%
- **Withdraw TON** from contract to Wallet C → verify contract TON balance decreases

---

## Phase 5: Validation Checklist

### On-Chain Verification — 🧑 MANUAL (web browsers)

| Check               | Tool                               | What to Look For                                                                              |
| ------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Contract deployed   | testnet.tonviewer.com              | Contract exists with code                                                                     |
| Contract state      | testnet.tonviewer.com              | `commission_bps`, `total_processed` values                                                    |
| Settlement tx trace | testnet.tonviewer.com → tx details | See the full message chain: Jetton transfer → TokenNotification → 2 outgoing Jetton transfers |
| Wallet A balance    | testnet.tonviewer.com              | tUSDT decreased by sent amount                                                                |
| Wallet B balance    | testnet.tonviewer.com              | tUSDT increased by (amount - commission)                                                      |
| Wallet C balance    | testnet.tonviewer.com              | tUSDT increased by commission                                                                 |
| Gas costs           | testnet.tonviewer.com → tx details | How much TON each settlement costs                                                            |

### Programmatic Verification — 🤖 Claude does this

Claude writes `scripts/verifyState.ts` that:

1. Reads contract getters (commission, stats, jetton_wallet)
2. Reads tUSDT balances of all 3 wallets via TONAPI
3. Prints a summary table
4. Asserts expected values

```bash
npx blueprint run verifyState --testnet
```

---

## Summary: Who Does What

| Step                            | Who                                          | What |
| ------------------------------- | -------------------------------------------- | ---- |
| Install & configure MCP servers | 🧑 Manual (clone, install, add config)       |
| Create 3 testnet wallets        | 🧑 Manual (Tonkeeper/MyTonWallet)            |
| Fund wallets with test TON      | 🧑 Manual (Telegram bot / faucet)            |
| Mint test Jetton (tUSDT)        | 🧑 Manual (minter.ton.org?testnet=true)      |
| Distribute tUSDT to wallets     | 🧑 Manual (wallet app)                       |
| Create Blueprint project        | 🤖 Claude                                    |
| Write Splitogram Tact contract   | 🤖 Claude                                    |
| Write Sandbox tests             | 🤖 Claude                                    |
| Run tests locally               | 🤖 Claude (runs `npx blueprint test`)        |
| Write deploy script             | 🤖 Claude                                    |
| Deploy to testnet               | 🧑 Manual (confirm tx in wallet)             |
| Write settlement test scripts   | 🤖 Claude                                    |
| Execute test settlements        | 🧑 Manual (confirm txs in wallet)            |
| Write verification script       | 🤖 Claude                                    |
| Inspect on-chain results        | 🧑 Manual (Tonviewer) + 🤖 Claude (MCP/API)  |
| Iterate on bugs                 | 🤖 Claude (fix) + 🧑 (redeploy confirmation) |

---

## Order of Operations (checklist)

- [x] **0.1** Get TONAPI key from tonconsole.com
- [x] **0.2** Clone & install TON MCP servers (or decide to use TONAPI REST fallback) — `ton-blockchain-mcp` installed & working (mainnet only); `kriuchkov/ton-mcp` skipped. Testnet → TONAPI REST fallback.
- [x] **0.3** Configure MCP in Claude Code settings — `ton-blockchain-mcp` configured globally
- [ ] **0.4** Bookmark all diagnostic URLs
- [x] **0.5** Create 3 testnet wallets (W5), addresses in `.envs/ton_wallets.json`
- [x] **0.6** Fund wallets — all 3 wallets funded with TON and tUSDT.
- [x] **0.7** Verify wallet balances on testnet — confirmed via `testnet.tonapi.io` REST + tonviewer
- [x] **1.1** Mint tUSDT via minter.ton.org?testnet=true — minted from Wallet C (W5/v5r1), 1,000,000,000 tUSDT (= 1,000 tUSDT with 6 decimals). Name: "test USDT SPLIT", symbol: tUSDT.
- [x] **1.2** Save Jetton Master address → `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7`
- [x] **1.3** Send tUSDT: 500 → Wallet A, 100 → Wallet B — done (Wallet A: 5000, Wallet B: 3000, Wallet C: ~999,992 tUSDT)
- [x] **1.4** Verify tUSDT balances on Tonviewer — confirmed via TONAPI REST
- [x] **2.1** Claude creates Blueprint project
- [x] **2.2** Claude writes Splitogram Tact contract
- [x] **2.3** Claude writes Sandbox tests
- [x] **2.4** Run tests → all 16 pass
- [x] **2.5** Build contract
- [x] **3.1** Claude writes deploy script
- [x] **3.2** Deploy to testnet — initial contract at `EQC7KPpOr-FJgcvA9mw7kIWF9FLAiWapBc74QH1Kx2kFY5nV` (v1, had bugs)
- [x] **3.3** Verify deployment — confirmed active via TONAPI REST
- [x] **3.4** Bug fixes required 2 redeploys (see Testnet Debugging Log below). Final working contract: `EQB1n108XegTE8HOtg2YHxHaYi6Llh_h9bgaeEYww0IjnUK4`
- [x] **4.1** Test settlement: 100 tUSDT (C→B via contract) — SUCCESS
- [x] **4.2** Verify balances: B got +99 tUSDT, C got +1 tUSDT commission — confirmed via TONAPI REST
- [ ] **4.3** Test small settlement: 5 tUSDT (minimum commission)
- [ ] **4.4** Test multiple settlements
- [ ] **4.5** Test owner operations (update commission, withdraw TON)
- [ ] **5.1** Full verification via script + manual Tonviewer inspection

---

## Useful Addresses

```
Wallet A (Sender):     0QAx3Tq4s87tAVa0e4JlJNNNIM29NlTIY7hUcWdRSSFro8v7
Wallet B (Receiver):   0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS
Wallet C (Fee Owner):  0QAoBJzd06D3xzxrdCiF38ZnVyOVDCTZPKmQnrWO-2RfU9pq

All wallets: W5 (v5r1), testnet
Wallet file: .envs/ton_wallets.json

tUSDT Jetton Master:   kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7 (testnet)

Splitogram Contract v1 (BROKEN):  EQC7KPpOr-FJgcvA9mw7kIWF9FLAiWapBc74QH1Kx2kFY5nV (200 tUSDT stuck)
Splitogram Contract v2 (BROKEN):  EQC3ITB97KJ7q1TiICbsJyheN1_qFt5ryeY2iIaar_4F5P0G (100 tUSDT stuck)
Splitogram Contract v3 (WORKING): EQB1n108XegTE8HOtg2YHxHaYi6Llh_h9bgaeEYww0IjnUK4

Jetton Wallet Addresses (tUSDT):
  Wallet A: 0:002d244350f97a3f3f9befd979825c2b8959cf6004429199c0a9badd5847fb44
  Wallet B: 0:b6c189a77c6212441d923485796947f0923dd06caee7b59cc286a5580d2324be
  Wallet C: 0:c0265ce987e860efd650270bdd0da41156307c9378e8db703cdb69874584955f

All addresses also saved in: .envs/testnet_addresses.json
TONAPI Key:            (in .dev.vars)
```

---

## Testnet Debugging Log

### Deploy v1 → `EQC7KPpOr-FJgcvA9mw7kIWF9FLAiWapBc74QH1Kx2kFY5nV`

**Issue 1: exit_code=9 (Cell underflow) on TokenNotification**

The `forward_payload` in the Jetton transfer was stored as a reference cell (`storeBit(true) + storeRef(payload)`). The standard Jetton wallet passes remaining bits as-is in the `transfer_notification` — it doesn't unwrap the Either flag. So the contract received a slice with just 1 bit (the Either flag) instead of the actual payload data (op + recipient address). `loadUint(32)` failed because only 1 bit was available.

**Fix:** Store `forward_payload` inline in the transfer body (no `storeBit`/`storeRef`, just append op + address after `forward_ton_amount`).

**Issue 2: exit_code=708 on outgoing TokenTransfer**

After fixing the payload encoding, the contract successfully processed the `TokenNotification` and sent two `TokenTransfer` messages to its Jetton Wallet. Both were rejected with exit 708.

Exit 708 in the standard FunC Jetton wallet = `slice_bits(in_msg_body) >= 1` — after parsing all fields up to `forward_ton_amount`, the wallet requires at least 1 remaining bit for the `Either forward_payload` flag. The Tact contract used `forward_payload: emptySlice()` which serializes to 0 remaining bits.

**Fix:** Changed `emptySlice()` to `beginCell().storeUint(0, 1).asSlice()` — adds a single `0` bit (meaning "inline empty payload").

**Issue 3: Gas too low (0.06 TON per transfer)**

While debugging issue 2, also increased `_sendJetton` value from `ton("0.06")` to `ton("0.15")` per outgoing transfer, and test script `forward_ton_amount` from 0.25 to 0.4 TON, total gas from 0.35 to 0.5 TON. The 0.06 amount may have been marginal.

### Deploy v3 → `EQB1n108XegTE8HOtg2YHxHaYi6Llh_h9bgaeEYww0IjnUK4` (WORKING)

First successful end-to-end settlement:
- Wallet C sent 100 tUSDT to contract with Wallet B as recipient
- Contract took 1 tUSDT commission (1%), forwarded 99 tUSDT to Wallet B
- Contract balance: 0 tUSDT (pure pass-through, no stuck funds)
- Full transaction trace: all nodes success=True, exit=0

### Key Learnings for TON Jetton Integration

1. **forward_payload must be inline** — don't use `storeBit(true) + storeRef()` for the Jetton transfer's forward_payload. Store op + data directly after `forward_ton_amount`.
2. **TokenTransfer needs an Either bit** — the standard FunC Jetton wallet requires at least 1 bit after `forward_ton_amount` for the `Either forward_payload` flag. In Tact, use `beginCell().storeUint(0, 1).asSlice()` instead of `emptySlice()`.
3. **Gas budget: 0.15 TON per Jetton transfer** — 0.06 TON was insufficient on testnet. Use 0.15 TON per outgoing transfer, 0.4 TON forward_ton_amount, 0.5 TON total attached.
4. **TON contracts are immutable** — code changes require redeployment to a new address. StateInit sent to an existing address is silently ignored.
5. **TONAPI testnet requires no auth token** — `testnet.tonapi.io` works without Bearer token (unlike mainnet).
6. **Testnet TONAPI for verification** — `GET /v2/accounts/{addr}/jettons` for balances, `GET /v2/traces/{event_id}` for full transaction traces.

### Stuck Funds (recoverable)

- Contract v1 (`EQC7KPp...`): 200 tUSDT stuck (2 failed settlements)
- Contract v2 (`EQC3ITB...`): 100 tUSDT stuck (1 failed settlement)
- Recovery: write a script using `SetJettonWallet` + manual TokenTransfer from the contract's jetton wallet (owner operations still work on old contracts).

---

## References

- [smart-contract.md](./smart-contract.md) — Full contract design doc
- [TON Blueprint SDK](https://github.com/ton-org/blueprint)
- [Tact Language Docs](https://docs.tact-lang.org/)
- [TON Sandbox (testing)](https://github.com/ton-org/sandbox)
- [Testnet Tonviewer](https://testnet.tonviewer.com)
- [Testnet Tonscan](https://testnet.tonscan.org)
- [TON Minter (testnet)](https://minter.ton.org?testnet=true)
- [Testnet Faucet (web)](https://faucet.tonxapi.com)
- [Testnet Faucet (bot)](https://t.me/testgiver_ton_bot)
- [TONAPI Docs](https://docs.tonconsole.com/tonapi)
- [kriuchkov/ton-mcp](https://github.com/kriuchkov/ton-mcp) — MCP server (TypeScript)
- [devonmojito/ton-blockchain-mcp](https://github.com/devonmojito/ton-blockchain-mcp) — MCP server (Python)
- [Sample Jetton Contract](https://github.com/nikandr-surkov/Sample-Ton-Jetton-Contract) — Reference Blueprint+Tact Jetton
- [TON Deploy Guide](https://docs.ton.org/v3/guidelines/quick-start/developing-smart-contracts/tact-folder/tact-deploying-to-network)
- [Mint Your First Jetton](https://docs.ton.org/v3/guidelines/dapps/tutorials/mint-your-first-token)
