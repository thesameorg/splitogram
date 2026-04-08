# Reskin Log (2026-03-26)

## Context

Design mockups in `frontend_new/` (per-screen HTML) and `frontend_new_apps/app_1.html` (React app). Design system spec in `frontend_new/DESIGN.md`. All mockups are dark-only, use Material You tokens, Manrope font, Material Symbols icons, and hardcoded English — none of that maps 1:1 to production.

## Approach Pivot

Original plan: pixel-perfect Playwright screenshot comparison loop (mockup vs live app, iterate per screen). Verified it works but estimated high token/time cost for marginal gain.

**Pivoted to:** DESIGN.md token-based reskin. Extract the design principles (surface hierarchy, no-border rule, gradient CTAs, glassmorphism, font) and apply them to existing components via CSS token changes. "Close enough" visual, not pixel-perfect.

## What Was Done

### Infrastructure

- **Manrope font** self-hosted in `frontend/public/fonts/` (24KB latin + 2.5KB latin-ext woff2). `@font-face` in `index.css` with `font-display: swap` and `unicode-range`.
- **6 new CSS custom properties** in `index.css` with light/dark variants:
  - `--app-card` (card surface), `--app-card-nested` (input/chip fill)
  - `--app-glass` (glassmorphism bg), `--app-glow` (ambient shadow)
  - `--app-ghost-border` (ultra-subtle card edge)
- **`.card` utility class** in `index.css` — combines bg + shadow + ghost-border. Used across all card containers.
- **Tailwind config** — added `app.card`, `app.card-nested`, `app.glass`, `app.glow` colors; `shadow-glow`; `border-ghost`; `fontFamily.sans` with Manrope.
- **Dark theme dev fallback** — `[data-theme='dark']` now sets all `--tg-theme-*` vars so toggling theme works in browser dev.

### Component Sweep (26 files)

| Change                  | Count | Description                                                                   |
| ----------------------- | ----- | ----------------------------------------------------------------------------- |
| Borders removed         | ~80   | `border border-tg-separator` on cards → `.card` class                         |
| Inputs restyled         | ~30   | `bg-transparent border-tg-separator` → `bg-app-card-nested border-ghost`      |
| Dividers removed        | ~8    | `divide-y divide-tg-separator` → `space-y-2`                                  |
| Card radius bumped      | ~40   | `rounded-xl` → `rounded-2xl` on cards                                         |
| CTA gradient            | ~12   | `bg-tg-button` → `bg-gradient-to-br from-[#92ccff] to-[#2b98dd]`              |
| Glassmorphism           | 3     | BottomTabs, BottomSheet, LanguagePickerModal: `bg-app-glass backdrop-blur-xl` |
| `bg-tg-section` removed | all   | Replaced with `.card` class or `bg-app-card-nested`                           |

### Files Modified

**Pages:** Home, Group, GroupSettings, AddExpense, SettleManual, SettleCrypto, Activity, Account
**Components:** BottomTabs, BottomSheet, LanguagePickerModal, CurrencyPicker, ReportImage, MonthSelector, Avatar (unchanged), PageLayout (unchanged)
**Account components:** ProfileSection, WalletSection, LinksSection, PaymentInfoSection, FeedbackSheet, DeleteAccountSheet, DebugPanel
**Config:** `index.css`, `tailwind.config.js`
**Assets:** `frontend/public/fonts/Manrope-Variable.woff2`, `frontend/public/fonts/Manrope-Variable-ext.woff2`

### Verification

- Typecheck: clean
- Tests: 86/86 pass (22 backend + 64 frontend)
- Visual: checked Home, Group detail, Account at 390x844 in both light and dark via Playwright

## What's Remaining

### Completed (2026-03-27)

- [x] **Ambient glow on header** — `.header-glow` CSS class with `rgba(0,136,204,0.08)` shadow. Applied to Group page header card.
- [x] **"Editorial" spacing** — Increased `mb-6` → `mb-8` on balance summaries/headers, `mb-4` → `mb-6` on tab sections. Empty states padded to `py-16`.
- [x] **Letter-spacing on labels** — Added `tracking-label` Tailwind token (`0.05rem`). Applied to all form labels, metadata text, timestamps, month selector, and stats section headers across all pages.
- [x] **Pill chips for tags/status** — Balance pills on Home → `rounded-full`. Split mode toggle on AddExpense → `rounded-full`. Participant chips already `rounded-full`.
- [x] **Font weight hierarchy** — All page titles `font-bold` → `font-extrabold` (Home, Group, AddExpense, Account, Activity, SettleManual, SettleCrypto, GroupSettings). Stats key metrics → `font-extrabold`.
- [x] **Group header reskin** — Group page header wrapped in `card p-4 rounded-2xl header-glow` — glassmorphic card with primary-tinted ambient shadow.
- [x] **Empty state illustrations** — Added decorative emoji (📋 groups, 📝 transactions, 📰 feed/activity) with increased padding.
- [x] **Button radius consistency** — All balance action buttons, invite nudge buttons, info boxes → `rounded-xl` (was `rounded-lg`).
- [x] **Add Expense FAB** — Gradient CTA + `shadow-glow` (matching Home FAB style).

### Intentionally skipped

- Material Symbols icon font (keeping existing SVG icon system)
- Pixel-perfect mockup matching (design-token approach instead)
- "Balance hiding" blur effect from mockups (no backend support)
- "Friends" tab (doesn't exist in production)
- Per-expense comments thread (no backend support)
- Cross-group net balance widget on home (partially exists as balance pills)
- Wallet TON/USDT balance display (no backend support for balance fetch)

### Known rough edges

- Gradient CTA color (`#92ccff → #2b98dd`) is hardcoded, not from TG theme vars. Will look the same regardless of Telegram theme customization. Acceptable since it's the brand accent.
- `.card` class uses plain CSS, not Tailwind utility. Works but is a slight pattern break. Could be converted to `@apply` or a Tailwind plugin if preferred.
- In Telegram production, `[data-theme]` is set from `webApp.colorScheme`. The dark fallback vars are only used in dev outside Telegram.
