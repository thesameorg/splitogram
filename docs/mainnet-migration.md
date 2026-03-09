# Mainnet Migration — TON Settlement

Checklist for switching Splitogram's on-chain USDT settlement from TON testnet to mainnet.

---

## Pre-migration

- [ ] Review open CODE_REVIEW items (especially #9 response_destination, #10 fixed gas, #11 dedup)
- [ ] Decide on `response_destination` fix — set to sender's address so excess gas refunds correctly
- [ ] Decide on gas display — show expected refund in confirmation UI, or keep simple "~0.5 TON for gas"

---

## 1. Deploy Contract to Mainnet

### 1.1 Prepare owner wallet

- [ ] Choose a mainnet wallet for the contract owner (receives commission + can admin the contract)
- [ ] Fund it with ~2 TON for deploy + SetJettonWallet gas
- [ ] **Record the owner address** — this is permanent (contract is immutable)

### 1.2 Build & deploy

```bash
cd contracts/splitogram-contract
npx blueprint build
npx blueprint run deploySplitogramSettlement --tonconnect
# Mainnet mode (no --testnet flag)
# Confirm in wallet app
```

- [ ] **Save the new mainnet contract address**

### 1.3 Configure Jetton Wallet

The contract rejects settlements until `SetJettonWallet` is called.

```bash
# Query the USDT Master to get the contract's Jetton Wallet address:
# GET https://tonapi.io/v2/accounts/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs/methods/get_wallet_address?args=<contract_address_cell>
#
# Or use the Blueprint script:
npx blueprint run setJettonWallet --tonconnect
# Confirm with owner wallet
```

- [ ] Call `SetJettonWallet` with the correct USDT Jetton Wallet address
- [ ] Verify via contract getter that `usdt_wallet` is set

### 1.4 Validate with small settlement

- [ ] Send 1 USDT through the contract manually (owner → contract → recipient)
- [ ] Verify on [tonviewer.com](https://tonviewer.com): commission split correct, recipient received funds
- [ ] Check contract getters: `total_processed`, `total_commission`, `settlement_count`

---

## 2. Update Config

### 2.1 Backend (`wrangler.toml`)

```toml
[vars]
TON_NETWORK = "mainnet"
USDT_MASTER_ADDRESS = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"
SETTLEMENT_CONTRACT_ADDRESS = "<new mainnet contract address>"
```

### 2.2 GitHub variables

- [ ] Set `TON_NETWORK` = `mainnet` (GitHub repo → Settings → Variables → Actions)
- [ ] This flows into frontend build as `VITE_TON_NETWORK`

### 2.3 Verify TONAPI key

- [ ] Confirm `TONAPI_KEY` in GitHub Secrets works for mainnet (same key should work for both)
- [ ] Mainnet TONAPI **requires** auth — testnet didn't

### 2.4 TON Connect manifest

- [ ] Verify `frontend/public/tonconnect-manifest.json` has correct production URL and icon
- [ ] `VITE_TON_CONNECT_MANIFEST_URL` — usually not needed (defaults to `{origin}/tonconnect-manifest.json`)

---

## 3. Deploy

```bash
# Standard deploy — no code changes needed
bun run deploy                    # Worker
# Pages deploys automatically via CI on push to main
```

Or just push to `main` — CI handles everything.

---

## 4. Post-deploy Validation

- [ ] Open the app → Account → Connect Wallet (should show mainnet, no "testnet" badge)
- [ ] Create a test settlement → "Pay with USDT" → confirm in wallet
- [ ] Verify on [tonviewer.com](https://tonviewer.com): settlement processed, commission correct
- [ ] Check that manual settlement still works (unaffected)
- [ ] Check bot notifications include correct explorer URL (`tonviewer.com` not `testnet.tonviewer.com`)

---

## Key Addresses

| Item                | Testnet                                            | Mainnet                                            |
| ------------------- | -------------------------------------------------- | -------------------------------------------------- |
| USDT Jetton Master  | `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7` | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` |
| Settlement Contract | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` | TBD                                                |
| Owner Wallet        | `0QAoBJzd06D3xzxrdCiF38ZnVyOVDCTZPKmQnrWO-2RfU9pq` | TBD                                                |
| Commission          | 1% (100 bps), min 0.1, max 1.0 USDT                | Same                                               |

---

## No Code Changes Needed

The entire migration is config-only:

- `TON_NETWORK` switches TONAPI base URL (`tonapi.io` vs `testnet.tonapi.io`)
- `USDT_MASTER_ADDRESS` switches the Jetton Master for balance lookups
- `SETTLEMENT_CONTRACT_ADDRESS` switches the contract for settlement routing
- `VITE_TON_NETWORK` hides the testnet badge on frontend
- Explorer URLs in notifications/activity derive from `TON_NETWORK` automatically
