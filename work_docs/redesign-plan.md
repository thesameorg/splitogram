# Frontend Redesign Plan

## Source Material

- **Design brief:** `frontend_new/DESIGN.md` — token system, color architecture, typography, component rules
- **HTML mockups:** `frontend_new/` — one HTML per screen, visual reference only (not code)
- **React app exports:** `frontend_new_apps/` — same mockups wrapped in JSX, also visual reference only

## Fit-Gap Analysis Summary (2026-03-26)

### What's good in the new design
- Cleaner card hierarchy (surface layering instead of borders)
- Avatar with gradient ring + edit badge
- Better empty states
- Glassmorphism on floating elements (nav, modals)
- Grouped settings sections with uppercase label headers
- Pill-shaped chips for tags/status

### Critical gaps (must fix before adoption)
1. **Navigation:** Mockups inconsistently show 3 or 4 tabs. Production uses 3 (Groups/Feed/Account). "Friends" tab doesn't exist.
2. **Light theme missing:** All exports hardcode `<html class="dark">`. Telegram controls theme via CSS vars — light mode MUST work.
3. **Theming incompatible:** Mockups use Material You tokens (`bg-surface`, `text-on-surface`). Production uses TG CSS vars (`bg-tg-bg`, `text-tg-hint`). These systems don't overlap.
4. **Settlement currency wrong:** Celebration screens show TON amounts. Should show USDT/group-currency.
5. **No i18n:** All strings hardcoded English. Production uses react-i18next with 11 languages.
6. **No TG SDK:** No WebApp.ready(), back button, main button, initData, CloudStorage.
7. **No API integration:** All data hardcoded.
8. **Branding:** "The Ethereal Ledger" / "The Ledger" — should be Splitogram.

### Missing screens (no mockup exists)
- SettleManual (manual settlement flow)
- Stats tab (DonutChart, metrics)
- Placeholder claim banner (on Group page)
- Pending settlement yellow card (on Group page)
- Error states (auth failure, network error)

### Net-new features in mockups (no backend support)
- Per-expense chat/comments thread
- Per-event notification preferences (production: single mute toggle)
- Cross-group aggregate "Net Balance" on home
- Wallet TON/USDT balance display on Account page
- Feedback category chips (Bug Report / Feature Request)

### Wording differences
| Context | Mockup | Production |
|---|---|---|
| Balance button | "Settle on TON" | "Pay USDT" |
| Settlement confirm | "Confirm on TON Wallet" | "Confirm Payment" |
| Tab label | "Profile" | "Account" |
| Tab label | "Activity" | "Feed" |
| Placeholder badge | ghost emoji | "placeholder" badge |
| Add placeholder | "Add a Friend Without Telegram" | "Add Placeholder Member" |
| Delete account | "Delete Permanently" | "YES, I'M SURE -- DELETE" |

## Approach: DESIGN.md Tokens + Playwright Visual QA

### Step 1: Token migration
Translate `frontend_new/DESIGN.md` tokens into existing CSS var system:
- Map Material You surface hierarchy onto `tg-*` tokens
- Add new `--app-card`, `--app-card-nested` CSS vars for the 3-tier surface system
- Define BOTH light and dark variants (mockups only have dark; light must follow TG theme)
- Add Manrope font (self-hosted, not Google CDN) or decide to skip it
- Update `tailwind.config.js` + `index.css`

Key token mapping:
```
bg-surface           -> bg-tg-bg (controlled by Telegram)
bg-surface-container -> new --app-card var
bg-surface-container-highest -> new --app-card-nested var
text-on-surface      -> text-tg-text
text-on-surface-variant -> text-tg-hint
primary (#92CCFF)    -> bg-tg-button / text-tg-link (or custom --app-accent)
error (#FFB4AB)      -> existing --app-negative
```

### Step 2: Page-by-page reskin with Playwright verification
For each page:
1. Open matching HTML mockup in Playwright to see target visual
2. Update existing `.tsx` file classes to use new tokens
3. Open dev server (localhost:5173) in Playwright to compare
4. Iterate until visually close

Priority order:
1. Home (Groups list)
2. Group view (transactions + balances tabs)
3. AddExpense
4. Account page
5. SettleManual / SettleCrypto
6. Activity feed
7. Remaining screens

### Step 3: Visual QA pass
Screenshot each screen in both light and dark Telegram themes via Playwright. Fix inconsistencies.

## Constraints
- All implementation in existing `frontend/src/` — no new folder structure
- Keep all existing hooks, API calls, i18n, TG SDK integration
- Keep existing SVG icon system (`frontend/src/icons/`) — no Material Symbols font
- Keep existing component primitives (PageLayout, BottomSheet, Avatar, etc.)
- Light mode must work (Telegram controls it)
- No `dark:` prefixes — CSS vars handle both modes

## Prerequisites
- `bun run dev:frontend` running on localhost:5173
- Playwright MCP available for browser control
- Decision on Manrope font (self-host or skip)
- Decision on MCP export format (could provide structured tokens)

## Approach Verification (2026-03-26)

### Setup tested
- **Mockup serving:** `python3 -m http.server 8888 --directory frontend_new` — serves all mockup HTML files from `frontend_new/` subdirectories (each has `code.html`)
- **Live app:** `bun run dev:backend` (wrangler on :8787 with `DEV_AUTH_BYPASS_ENABLED=true`) + `bun run dev:frontend` (Vite on :5173, proxies API to backend)
- **Playwright MCP:** viewport set to 390×844 (iPhone 14 Pro), screenshots captured at CSS scale
- **Multi-tab:** Playwright supports multiple tabs — mockup in one tab, live app in another for side-by-side comparison

### What works
1. **Mockup rendering at mobile width** — All tested mockups (`groups_list_theme_aware`, `group_balances_refined`, `group_view_no_records`, `unified_account_hub_edit_icons`) render correctly at 390px. Tailwind CDN + Google Fonts + Material Symbols load fine. Responsive layout works.
2. **Live app with auth bypass** — Backend `DEV_AUTH_BYPASS_ENABLED=true` creates mock "DEV Developer" user automatically. App loads to Groups page with real data from local D1. All tabs (Groups/Feed/Account) navigable. Group detail with transactions/balances/feed/stats tabs works.
3. **Visual comparison is practical** — Screenshots clearly show the design gap: live app is flat white cards with blue accents, mockups use dark surface hierarchy with glassmorphism and layered cards. The delta is large but systematic — mostly CSS token changes, not structural.
4. **Playwright navigation** — Click-through works: tab switching, group card → group detail, all interactive. Accessibility snapshots provide structured DOM for verifying element presence.

### What doesn't work / limitations
1. **`file://` protocol blocked** — Playwright MCP blocks `file://` URLs. Must serve mockups via HTTP (trivial: `python3 -m http.server`).
2. **No pixel-diff tooling** — Comparison is visual/manual via screenshots, not automated pixel diffing. Sufficient for this use case since the redesign is a reskin, not pixel-perfect replication.
3. **TG WebApp warnings** — Live app logs `BackButton is not supported`, `HapticFeedback is not supported`, `CloudStorage is not supported` — all harmless in browser dev mode. No functional impact.
4. **Mockup `app_1.html` routes** — The React app in `frontend_new_apps/app_1.html` uses `MemoryRouter` with placeholder screens for Groups/Activity/Friends. The individual per-screen mockups in `frontend_new/` subdirectories are more useful for comparison.
5. **No automated A/B** — Can't programmatically overlay or diff mockup vs live. The workflow is: screenshot mockup → screenshot live → eyeball → iterate CSS → repeat.

### Verdict: MANAGEABLE

The approach is verified and practical. The workflow:
1. Open mockup in tab 1 (`:8888/{screen}/code.html`), take screenshot
2. Open live app in tab 0 (`:5173/{route}`), take screenshot
3. Compare visually, update CSS tokens in `.tsx` files
4. Vite HMR reloads instantly, take new screenshot, iterate

**Estimated effort per screen:** ~30-60 min for token remapping + card hierarchy changes. The structural HTML is already correct (same sections, same data). The work is purely visual: background colors, border-radius, card elevation, text colors, font weights.

**Key risk:** Light theme. Mockups are dark-only. Every token change must be verified in both themes. Suggest testing with `document.documentElement.dataset.theme = 'light'` / `'dark'` in Playwright console.

### Manual steps required from developer
- Start backend: `bun run dev:backend` (needs `.dev.vars` with `DEV_AUTH_BYPASS_ENABLED=true`)
- Start frontend: `bun run dev:frontend`
- Mockup server is ad-hoc (`python3 -m http.server 8888 --directory frontend_new`) — could be added as a script if this becomes frequent
