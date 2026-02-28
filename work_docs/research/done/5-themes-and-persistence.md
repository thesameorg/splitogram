# Themes & User Preference Persistence

**Phase:** 5
**Type:** RESEARCH → Q&A → decision
**Status:** DECIDED

---

## Theme System — DECIDED: Follow Telegram's Theme (No User Toggle)

Telegram Mini Apps already have dark/light mode controlled by the user's Telegram settings. Adding a separate theme picker in the app is redundant and creates confusion (app says "light" but Telegram is dark).

**Approach:** Map Telegram's CSS variables to Tailwind custom colors. Theme follows Telegram automatically.

### What Telegram provides

Telegram injects 15 CSS variables (`--tg-theme-*`) into the Mini App WebView:

| CSS Variable                           | Use                       |
| -------------------------------------- | ------------------------- |
| `--tg-theme-bg-color`                  | Main background           |
| `--tg-theme-text-color`                | Main text                 |
| `--tg-theme-hint-color`                | Secondary/hint text       |
| `--tg-theme-link-color`                | Links                     |
| `--tg-theme-button-color`              | Primary button bg         |
| `--tg-theme-button-text-color`         | Primary button text       |
| `--tg-theme-secondary-bg-color`        | Card/secondary background |
| `--tg-theme-header-bg-color`           | Header background         |
| `--tg-theme-accent-text-color`         | Accent text               |
| `--tg-theme-section-bg-color`          | Section background        |
| `--tg-theme-section-header-text-color` | Section headers           |
| `--tg-theme-subtitle-text-color`       | Subtitles                 |
| `--tg-theme-destructive-text-color`    | Destructive actions (red) |
| `--tg-theme-section-separator-color`   | Divider lines             |
| `--tg-theme-bottom-bar-bg-color`       | Bottom bar bg             |

Plus `--tg-color-scheme` ("light" or "dark") and viewport/safe-area insets.

### Tailwind integration

Map TG variables to Tailwind tokens in `tailwind.config.js`:

```js
colors: {
  tg: {
    bg: 'var(--tg-theme-bg-color)',
    'secondary-bg': 'var(--tg-theme-secondary-bg-color)',
    text: 'var(--tg-theme-text-color)',
    hint: 'var(--tg-theme-hint-color)',
    link: 'var(--tg-theme-link-color)',
    button: 'var(--tg-theme-button-color)',
    'button-text': 'var(--tg-theme-button-text-color)',
    accent: 'var(--tg-theme-accent-text-color)',
    destructive: 'var(--tg-theme-destructive-text-color)',
    subtitle: 'var(--tg-theme-subtitle-text-color)',
    section: 'var(--tg-theme-section-bg-color)',
    'section-header': 'var(--tg-theme-section-header-text-color)',
    separator: 'var(--tg-theme-section-separator-color)',
    header: 'var(--tg-theme-header-bg-color)',
    'bottom-bar': 'var(--tg-theme-bottom-bar-bg-color)',
  }
}
```

Usage: `<div className="bg-tg-bg text-tg-text">` — automatically adapts to dark/light. No `dark:` prefixes needed.

### Theme change event

Telegram fires `themeChanged` when user switches. The injected CSS variables update automatically — if using `@twa-dev/sdk` or `@telegram-apps/sdk`, the SDK handles this. No manual listener needed for CSS-variable-based theming.

### What we DON'T need

- No dark/light/system toggle in UI — Telegram controls this
- No theme persistence — follows Telegram automatically
- No `dark:` Tailwind classes — CSS variables handle both modes
- No custom color palette design — use Telegram's native colors for a native feel

---

## Persistence Strategy — DECIDED: CloudStorage for Language Only

### Why not localStorage

localStorage is **not reliably persistent** in Telegram Mini Apps:

- iOS WKWebView can clear localStorage between app restarts or under memory pressure
- Clearing TG app cache may wipe Mini App localStorage (undocumented, platform-dependent)
- No cross-device sync

### Telegram's built-in storage APIs

| API               | Sync                 | Limit            | Since       | Use For           |
| ----------------- | -------------------- | ---------------- | ----------- | ----------------- |
| **CloudStorage**  | Cross-device (cloud) | 1024 items × 4KB | Bot API 6.9 | User prefs        |
| **DeviceStorage** | Local only           | 5 MB             | Bot API 8.0 | Larger local data |
| **SecureStorage** | Local encrypted      | 10 items         | Bot API 8.0 | Secrets           |

### Decision: CloudStorage for language preference

- **Theme:** No persistence needed — follows Telegram.
- **Language:** Save to Telegram CloudStorage on change, read on init.
  - If CloudStorage has a value → use it
  - Otherwise → detect from `initData.user.language_code`
  - Falls back to English if detection fails
- **No DB column** for preferences. No extra API endpoint. CloudStorage is cross-device and free.

### CloudStorage API usage

```js
const cs = window.Telegram.WebApp.CloudStorage;

// Save
cs.setItem('lang', 'ru', (err) => {
  /* fire-and-forget */
});

// Read on init
cs.getItem('lang', (err, value) => {
  if (value) i18n.changeLanguage(value);
  else i18n.changeLanguage(detectFromTelegram());
});
```

### What this eliminates

- No `users.theme` or `users.language` DB columns
- No `PUT /api/v1/users/preferences` endpoint
- No localStorage read/write for prefs
- No conflict resolution (localStorage vs DB)
- No Option B complexity (the research doc's localStorage + D1 approach)

---

## Impact on Phase 5

Phase 5 simplifies significantly:

- ~~Theme selector on Account page~~ → removed (follows Telegram)
- ~~Two color palettes~~ → Telegram provides both via CSS vars
- ~~Persistence Q&A~~ → decided (CloudStorage for language)
- Keep: i18n with react-i18next, language selector on Account page, 3 languages
