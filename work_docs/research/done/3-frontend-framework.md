# Frontend Framework / UI Library

**Phase:** 3 (before building new UI)
**Type:** RESEARCH → decision
**Status:** DECIDED — stay with React + Tailwind, no component library

---

## Context

Current stack: React 19 + Vite + Tailwind CSS. No component library. All components are hand-built.

Upcoming needs that stress this setup:

- Bottom tab navigation (3 tabs, persistent)
- Dark/light/system theme switching (Phase 5)
- i18n across all components (Phase 5)
- Form components (currency search, split mode selector, amount inputs)
- Image upload UI (Phase 6)
- Activity feed with pagination/pull-to-load (Phase 7)

## Question

Should we adopt a component library or UI framework, or stay with plain React + Tailwind?

## Options Evaluated

### 1. `@telegram-apps/telegram-ui`

**Verdict: Rejected — unmaintained, React 19 incompatible.**

- Last release: October 2024 (16+ months stale)
- Peer dependency `react: "^18.2.0"` — does not support React 19 (issue #95, labeled "help wanted," no one working on it)
- Maintainer confirmed the project was grant-funded, now seeking a "next grant" to continue (issue #99). Community consensus: project is dead.
- Known broken components: Select doesn't work on iOS (#75), Multiselect broken inside Modal (#100), dark theme uses hardcoded greys instead of Telegram palette (#114)
- No tree-shaking — monolithic 2.6 MB package, all-or-nothing import
- No confirmed production Mini Apps using the React library (the Figma design kit is separate)

### 2. shadcn/ui

**Verdict: Rejected — wrong tool for this context.**

- Copy-paste components (not an npm dependency), built on Radix UI primitives + Tailwind
- **No bottom navigation component** — the #1 thing needed for Phase 3. Multiple open GitHub issues (#4398, #8847, #5730) for 1-2 years with no resolution.
- Radix `Select` has confirmed non-opening issues on real iOS WebViews. Workaround (NativeSelect) defeats the purpose of the library.
- Default theme uses `oklch()` color format — can break on older Telegram WebView builds
- `vaul` Drawer (used by `Drawer` component) manipulates `body` scroll, which conflicts with Telegram's WebView scroll handling
- Pulls in Radix UI primitives, class-variance-authority, clsx, tailwind-merge, lucide-react — significant dependency weight for components that are simple lists, cards, and forms
- Looks like a generic web app, not a Telegram Mini App — no Telegram design language

### 3. Stay with React + Tailwind (no library) — CHOSEN

**Why this wins for Splitogram:**

- **Components are simple.** The entire frontend is lists, cards, forms, and modals. No complex accessible widgets (data tables, drag-and-drop, rich text). Hand-built components are 20-50 lines each.
- **Telegram theming already works.** App.tsx reads `colorScheme` from WebApp API, applies dark class, sets CSS variables. Expanding this to a full theme system is ~20 CSS variables, not a library.
- **Neither library provides bottom nav anyway.** Both require building it from scratch. shadcn/ui has had the request open for 2 years.
- **Bundle size matters for Mini Apps.** Users open them inside Telegram on mobile. Current dependencies are minimal. Adding Radix UI primitives or a dead Telegram library adds weight without improving UX.
- **Full control over WebView quirks.** Telegram's WebView has unique scroll, viewport, and keyboard behavior. Owning components means fixing issues instantly instead of waiting on upstream.
- **No migration cost.** Current code doesn't need rewriting.

## Decision

**Stay with React 19 + Tailwind CSS. No component library.**

Instead, build a small set of reusable primitives as needed:

- `<BottomTabs>` — fixed bottom bar, 3 tabs, active state
- `<BottomSheet>` — extract from existing Home.tsx pattern
- `<PageLayout>` — consistent padding, scroll area, bottom safe area
- CSS variable theme system — map `--tg-theme-*` to `--app-*` tokens

Re-evaluate if a mature, React 19-compatible, tree-shakeable Telegram UI library emerges. As of Feb 2026, none exists.
