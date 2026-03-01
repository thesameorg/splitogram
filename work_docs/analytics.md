# Analytics — Decision & Implementation

## Decision

Two layers, each solving a different problem:

| Layer                 | Tool                                     | Purpose                                                                                                              |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Catalog ranking**   | `@telegram-apps/analytics` (tganalytics) | Feeds data to TG app catalog. Required for visibility/ranking. Tracks launches + TON Connect automatically.          |
| **Product analytics** | Server-side D1 events                    | Track actual user behavior (funnels, retention, feature usage). Own the data. Zero client weight. 100% capture rate. |

### Why not Google Analytics / GTM?

- iOS WKWebView aggressively restricts cookies — GA4 loses users constantly
- gtag.js + GTM container is 80-100KB+ payload for a Mini App that should load instantly
- Blocked by ad blockers (common among Telegram power users)
- No understanding of TG-specific context (telegram_id, groups, bot_started)
- Server-side D1 events solve the same problem with zero client deps

### Why not Amplitude / Mixpanel?

- Overkill at current stage, $$$ at scale
- Another client dependency + data leaving our infra
- Can migrate later if needed — server-side events are the source of truth either way

### Why not Telemetree?

- Small company, longevity risk
- tganalytics covers catalog ranking, D1 covers product analytics — no gap to fill

---

## Implementation

### Part 1: tganalytics (client-side, ~30min)

Init the SDK before React renders. It auto-tracks ~99% of events (launches, TON Connect).

**In `frontend/src/main.tsx`** (before `createRoot`):

```ts
import telegramAnalytics from '@telegram-apps/analytics';

if (import.meta.env.PROD) {
  telegramAnalytics.init({
    token: import.meta.env.VITE_TG_ANALYTICS_TOKEN,
    appName: 'splitogram',
  });
}
```

**Env var:** add `VITE_TG_ANALYTICS_TOKEN` to `.env` / Cloudflare Pages env.

**Note on package weight:** `@telegram-apps/analytics@1.6.4` pulls `@telegram-apps/sdk`, `@tonconnect/ui`, and `http-server` as deps. The `http-server` dep is a dev artifact and won't be bundled by Vite (it's Node-only). Tree-shaking should keep the actual bundle addition small, but verify with `bun run build:frontend && ls -la frontend/dist/assets/` before and after. If it adds >50KB gzipped, consider the CDN script tag approach instead:

```html
<!-- in frontend/index.html, before app script -->
<script
  async
  src="https://tganalytics.xyz/index.js"
  onload="window.telegramAnalytics.init({
    token: '%VITE_TG_ANALYTICS_TOKEN%',
    appName: 'splitogram'
  })"
></script>
```

CDN approach: zero bundle impact, but token is visible in HTML source (acceptable — it's a write-only analytics token, not a secret).

### Part 2: Server-side product events (D1)

#### 2a. New table: `analytics_events`

```sql
CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  properties TEXT,          -- JSON, nullable
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX analytics_events_event_idx ON analytics_events(event);
CREATE INDEX analytics_events_created_at_idx ON analytics_events(created_at);
CREATE INDEX analytics_events_user_idx ON analytics_events(user_id);
```

Drizzle schema addition in `backend/src/db/schema.ts`:

```ts
export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    event: text('event').notNull(),
    properties: text('properties'), // JSON
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('analytics_events_event_idx').on(table.event),
    index('analytics_events_created_at_idx').on(table.createdAt),
    index('analytics_events_user_idx').on(table.userId),
  ],
);
```

#### 2b. Tracking service: `backend/src/services/analytics.ts`

```ts
import { analyticsEvents } from '../db/schema';
import type { Database } from '../db';

export function trackEvent(
  db: Database,
  userId: number,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  return db
    .insert(analyticsEvents)
    .values({
      userId,
      event,
      properties: properties ? JSON.stringify(properties) : null,
    })
    .then(() => {});
}
```

Use inline (not `waitUntil`) — D1 writes are fast, same pattern as `logActivity()`.

#### 2c. Events to instrument

Instrument in the corresponding route handlers alongside existing `logActivity()` calls:

| Event                    | Where                                                              | Properties                                            |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `app_open`               | `POST /api/v1/auth`                                                | `{ deepLink, returning: bool }`                       |
| `group_created`          | `POST /groups`                                                     | `{ currency, isPair }`                                |
| `group_joined`           | `POST /groups/:id/join`                                            | `{ viaDeepLink: bool }`                               |
| `expense_created`        | `POST /groups/:id/expenses`                                        | `{ splitMode, amount, hasReceipt, participantCount }` |
| `expense_edited`         | `PUT /groups/:id/expenses/:eid`                                    | `{ changedFields[] }`                                 |
| `expense_deleted`        | `DELETE /groups/:id/expenses/:eid`                                 | `{}`                                                  |
| `settlement_created`     | `POST /groups/:id/settlements`                                     | `{ amount }`                                          |
| `settlement_completed`   | `POST /settlements/:id/settle`                                     | `{ method: 'external' }`                              |
| `reminder_sent`          | `POST /groups/:id/reminders`                                       | `{ debtAmount }`                                      |
| `avatar_uploaded`        | `POST /users/me/avatar`, `POST /groups/:id/avatar`                 | `{ type: 'user'\|'group' }`                           |
| `language_changed`       | via client-side (no backend call) — skip or add dedicated endpoint | `{ from, to }`                                        |
| `group_settings_changed` | `PUT /groups/:id`                                                  | `{ changedFields[] }`                                 |

#### 2d. Stats endpoint: `GET /api/v1/admin/stats`

Simple SQL queries over `analytics_events` for quick dashboards. Protected by a separate admin check (e.g., hardcoded telegram_id allowlist or env var `ADMIN_TELEGRAM_IDS`).

Key queries to support:

- DAU/WAU/MAU (distinct `user_id` by `created_at` range)
- Event counts by type (last 7d / 30d)
- Retention: D1/D7/D30 (users with `app_open` on day N after first `app_open`)
- Funnel: `app_open` → `group_created` → `expense_created` → `settlement_completed`
- Top users by event count

No need to build a full dashboard UI initially — query via D1 console, `wrangler d1 execute`, or a minimal JSON endpoint.

---

## Manual Actions (human required)

### tganalytics setup

1. **Register at [TON Builders](https://builders.ton.org)** — create account, add your Mini App
2. **Generate analytics token** — in the TON Builders dashboard, go to analytics section, create a token for your app
3. **Set `appName`** — choose an identifier (e.g., `splitogram`), this is used in the tganalytics dashboard
4. **Add env var** — set `VITE_TG_ANALYTICS_TOKEN=<token>` in:
   - `.env` (local dev)
   - Cloudflare Pages environment variables (production)

### D1 migration

5. **Generate migration** — after adding the schema, run `bun run db:generate`
6. **Apply locally** — `bun run db:migrate:local`
7. **Production** — migration runs automatically via CI deploy pipeline (`wrangler d1 migrations apply`)

### Admin stats access

8. **Set `ADMIN_TELEGRAM_IDS`** — add to `.dev.vars` (local) and Cloudflare Worker secrets (production). Comma-separated telegram IDs that can access `/api/v1/admin/stats`.

### Verification

9. **After deploy** — open the Mini App, check tganalytics dashboard (may take a few hours for first data to appear)
10. **Check D1 events** — `wrangler d1 execute splitogram-db --command "SELECT event, count(*) FROM analytics_events GROUP BY event"` to verify server-side events are flowing

---

## What we're NOT doing

- No Google Analytics / GTM (WebView issues, heavy, blocked)
- No client-side product analytics SDK (Amplitude, Mixpanel, PostHog)
- No custom dashboard UI (query D1 directly for now)
- No real-time analytics (batch query is fine at current scale)
- No A/B testing framework (premature)
