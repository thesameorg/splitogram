# Environment Variables — TON Settlement

Where each TON-related variable lives, what it does, and what to set.

---

## Overview

| Variable                      | Secret? | Where it lives                              | Production value (mainnet)                         |
| ----------------------------- | ------- | ------------------------------------------- | -------------------------------------------------- |
| `TONAPI_KEY`                  | Yes     | `.dev.vars`, GH secret, wrangler secret     | From [tonconsole.com](https://tonconsole.com)      |
| `TON_NETWORK`                 | No      | `.dev.vars`, `wrangler.toml [vars]`, GH var | `mainnet`                                          |
| `USDT_MASTER_ADDRESS`         | No      | `.dev.vars`, `wrangler.toml [vars]`         | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` |
| `SETTLEMENT_CONTRACT_ADDRESS` | No      | `.dev.vars`, `wrangler.toml [vars]`         | `EQBVVph-sYX2BI165SLXHdqluawmjXx5RWZZymeGvQ5hTDgq` |
| `VITE_TON_NETWORK`            | No      | `.env`, GH var (Pages build)                | `mainnet`                                          |

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

| Network    | Address                                            | Notes                 |
| ---------- | -------------------------------------------------- | --------------------- |
| Testnet v4 | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` | Testnet, validated    |
| Mainnet    | `EQBVVph-sYX2BI165SLXHdqluawmjXx5RWZZymeGvQ5hTDgq` | Live since 2026-03-12 |

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

## Switching Networks

Switching between mainnet and testnet is config-only — no code changes needed.

| Variable                      | Mainnet                                            | Testnet                                            |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `TON_NETWORK`                 | `mainnet`                                          | `testnet`                                          |
| `USDT_MASTER_ADDRESS`         | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` | `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7` |
| `SETTLEMENT_CONTRACT_ADDRESS` | `EQBVVph-sYX2BI165SLXHdqluawmjXx5RWZZymeGvQ5hTDgq` | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` |

What each variable controls:

- `TON_NETWORK` — TONAPI base URL (`tonapi.io` vs `testnet.tonapi.io`), explorer URLs (`tonviewer.com` vs `testnet.tonviewer.com`), TON Connect chain ID (`-239` vs `-3`)
- `USDT_MASTER_ADDRESS` — Jetton Master for USDT balance lookups
- `SETTLEMENT_CONTRACT_ADDRESS` — contract for settlement routing
- `VITE_TON_NETWORK` (derived from GH variable `TON_NETWORK`) — testnet badge on frontend

To switch, update all three in `wrangler.toml` `[vars]` + `.dev.vars` (local) + GH variable `TON_NETWORK` (CI/Pages build). Deploy. Done.

Address files: `.envs/mainnet_addresses.json`, `.envs/testnet_addresses.json`.

**Current production: mainnet** (live since 2026-03-12).

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
