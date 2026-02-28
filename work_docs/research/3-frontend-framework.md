# Frontend Framework / UI Library

**Phase:** 3 (before building new UI)
**Type:** RESEARCH → decision
**Status:** open

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

## Options to evaluate

1. **Stay with React + Tailwind (no library)**
   - Pros: zero dependencies, full control, smallest bundle
   - Cons: every component hand-built, theming requires manual CSS variable setup

2. **Telegram UI kit (`@telegram-apps/telegram-ui`)**
   - Pros: looks native to Telegram, built for Mini Apps, handles TG theme variables
   - Cons: may be limiting for custom designs, check maturity and maintenance status
   - Research: https://github.com/Telegram-Mini-Apps/TelegramUI

3. **shadcn/ui**
   - Pros: copy-paste components (not a dependency), Tailwind-native, accessible, themeable
   - Cons: designed for web apps not Mini Apps, may not feel native to Telegram

4. **Other** (Radix UI, Headless UI, etc.)

## Research tasks

- [ ] Check `@telegram-apps/telegram-ui` — maturity, component coverage, theming support, bundle size
- [ ] Check if shadcn/ui components work well in TG WebView (no viewport issues, touch-friendly)
- [ ] Look at what other production Telegram Mini Apps use
- [ ] Evaluate bundle size impact of each option
- [ ] Check dark/light theme support in each option

## Decision

_To be filled after research._
