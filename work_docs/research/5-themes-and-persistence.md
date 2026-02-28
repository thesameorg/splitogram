# Themes & User Preference Persistence

**Phase:** 5
**Type:** RESEARCH → Q&A → decision
**Status:** open

---

## Theme System

Three modes: dark, light, system (default). System reads from Telegram's current theme.

### Research: Telegram Mini App theme API

- [ ] What CSS variables does Telegram inject into the WebView? (`--tg-theme-bg-color`, etc.)
- [ ] How to detect current theme (dark/light) programmatically from `window.Telegram.WebApp`
- [ ] Does Telegram notify the Mini App when the user switches system theme? (callback/event?)
- [ ] How do production Mini Apps handle theming? (check 3-4 popular ones)
- [ ] Does Tailwind's `dark:` class strategy work with TG's theme, or do we need CSS variables?

### Color palette approach
- Option A: Use Telegram's built-in CSS variables directly (native look, less control)
- Option B: Define our own CSS variables, initialize from TG theme on load (custom look, full control)
- Option C: Tailwind `dark:` class with TG theme detection toggling a class on `<html>`

---

## Persistence Strategy

Both theme and language need to be saved. The question is where.

### Research: localStorage in TG WebView

- [ ] Is localStorage persistent across Mini App opens on iOS TG app?
- [ ] Is localStorage persistent across Mini App opens on Android TG app?
- [ ] Does TG desktop app share localStorage with mobile?
- [ ] Does clearing TG app cache wipe Mini App localStorage?
- [ ] Are cookies a viable alternative? Do they persist?

### Candidate approaches

#### A: localStorage only
- Save on change, read on app init
- **Pro:** instant, zero API calls, works offline
- **Con:** wiped if user clears cache or switches device. No cross-device sync.

#### B: localStorage + D1 (`users` table)
- Save to localStorage (instant) + fire API call to persist in DB
- On app init, read localStorage first (instant), then fetch from DB and reconcile
- **Pro:** cross-device, survives cache clear
- **Con:** extra API call, need to handle conflicts (localStorage says "dark", DB says "light")

#### C: Cookies
- Set via response header or JS
- **Pro:** sent automatically with every request, server can read
- **Con:** persistence varies in WebView, 4KB limit, not great UX for client-side reads

### Recommendation

_Leaning toward B (localStorage + DB) but need to verify localStorage reliability in TG WebView first. If localStorage is reliably persistent, option A might be sufficient._

## Decision

_To be filled after research._
