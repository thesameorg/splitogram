# Environment Variables — TON Settlement

Where each TON-related variable lives, what it does, and what to set.

---

## Overview

| Variable                      | Secret? | Where it lives                              | Testnet value                                      |
| ----------------------------- | ------- | ------------------------------------------- | -------------------------------------------------- |
| `TONAPI_KEY`                  | Yes     | `.dev.vars`, GH secret, wrangler secret     | From [tonconsole.com](https://tonconsole.com)      |
| `TON_NETWORK`                 | No      | `.dev.vars`, `wrangler.toml [vars]`, GH var | `testnet`                                          |
| `USDT_MASTER_ADDRESS`         | No      | `.dev.vars`, `wrangler.toml [vars]`         | `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7` |
| `SETTLEMENT_CONTRACT_ADDRESS` | No      | `.dev.vars`, `wrangler.toml [vars]`         | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` |
| `VITE_TON_NETWORK`            | No      | `.env`, GH var (Pages build)                | `testnet`                                          |

---

## Backend (Cloudflare Worker)

### `TONAPI_KEY` — Secret

API key for [TONAPI](https://tonapi.io) REST API. Used to:

- Look up sender's USDT Jetton Wallet address (`GET /settlements/:id/tx`)
- Verify settlements on-chain (`GET /settlements/:id` lazy verification)

**Get one:** [tonconsole.com](https://tonconsole.com) -> sign up -> create project -> API key.

**Where to set:**

- Local: `.dev.vars` (already there)
- Production: GitHub repo Settings -> Secrets -> Actions -> `TONAPI_KEY`
- CI deploys it via `wrangler secret put TONAPI_KEY` (in `2-deploy-worker.yml`)

Note: testnet TONAPI works without auth, but mainnet requires a key. Set it in both environments for consistency.

### `TON_NETWORK` — Var

Switches between testnet and mainnet TONAPI base URLs:

- `testnet` -> `https://testnet.tonapi.io`
- `mainnet` -> `https://tonapi.io`

**Where to set:**

- Local: `.dev.vars`
- Production: `wrangler.toml` `[vars]` section (committed to repo)
- Optionally as GH variable `TON_NETWORK` if you want to override without a code change

### `USDT_MASTER_ADDRESS` — Var

The Jetton Master contract address for USDT (or tUSDT on testnet). Used to identify which Jetton is USDT when looking up wallet balances via TONAPI.

| Network         | Address                                            |
| --------------- | -------------------------------------------------- |
| Testnet (tUSDT) | `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7` |
| Mainnet (USDT)  | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` |

**Where to set:**

- Local: `.dev.vars`
- Production: `wrangler.toml` `[vars]` section

This is a public on-chain address — not a secret.

### `SETTLEMENT_CONTRACT_ADDRESS` — Var

The deployed Splitogram settlement smart contract. Receives USDT, takes 1% commission (min 0.1, max 1.0 USDT), forwards remainder to recipient.

| Network    | Address                                            | Notes                            |
| ---------- | -------------------------------------------------- | -------------------------------- |
| Testnet v4 | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` | Current, validated               |
| Mainnet    | TBD                                                | Deploy with mainnet owner wallet |

**Where to set:**

- Local: `.dev.vars`
- Production: `wrangler.toml` `[vars]` section

This is a public on-chain address — not a secret.

---

## Frontend (Vite / Cloudflare Pages)

### `VITE_TON_NETWORK` — Var

Controls:

- Testnet badge display on Account page wallet section
- Could be used for future frontend TONAPI calls

| Value     | Effect                                       |
| --------- | -------------------------------------------- |
| `testnet` | Shows "testnet" badge next to wallet address |
| `mainnet` | No badge                                     |

**Where to set:**

- Local: `.env`
- Production: GH variable `TON_NETWORK` -> flows into Pages build as `VITE_TON_NETWORK` (see `3-deploy-pages.yml`)
- Falls back to `testnet` if not set

### `VITE_TON_CONNECT_MANIFEST_URL` — Optional Var

URL to `tonconnect-manifest.json`. Falls back to `{window.location.origin}/tonconnect-manifest.json` which works because the manifest is in `frontend/public/`.

Only set this if the manifest is hosted elsewhere. Normally not needed.

---

## Switching to Mainnet

When ready to go live:

1. **Deploy the contract to mainnet** (new address)
2. **Update `wrangler.toml`:**
   ```toml
   TON_NETWORK = "mainnet"
   USDT_MASTER_ADDRESS = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"
   SETTLEMENT_CONTRACT_ADDRESS = "<new mainnet contract address>"
   ```
3. **Update GH variable** `TON_NETWORK` to `mainnet` (for frontend build)
4. **Ensure `TONAPI_KEY`** in GH secrets works for mainnet (it should — same key)
5. Deploy. Done.

No code changes needed. Just config.

---

## File Reference

| File                     | What's in it                                                  |
| ------------------------ | ------------------------------------------------------------- |
| `.dev.vars`              | Local dev overrides for wrangler (all backend vars + secrets) |
| `.env`                   | Local dev vars for frontend (Vite) + shared                   |
| `.env.example`           | Template with all vars documented                             |
| `wrangler.toml` `[vars]` | Production non-secret vars (committed)                        |
| `2-deploy-worker.yml`    | Deploys secrets via `wrangler secret put`                     |
| `3-deploy-pages.yml`     | Passes `VITE_*` vars to frontend build                        |
