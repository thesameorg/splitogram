# Cloudflare Billing Risk Audit

## Cloudflare Pricing Summary

### Workers (Paid plan — $5/month base)

- **Requests**: 10M included/month, then $0.30/million
- **CPU time**: 30M CPU-ms included/month, then $0.02/million CPU-ms
- **Subrequests**: count toward CPU; external fetch calls add CPU time

### D1 (Serverless SQLite)

- **Free tier**: 5M rows read/day, 100K rows written/day, 500 MB storage
- **Paid**: 25B rows read included/month, 50M rows written included/month, then $0.001/million reads, $1.00/million writes
- **Key insight**: Every Drizzle `.select()` / `.update()` / `.insert()` call = rows touched. A query that scans 10 rows = 10 rows read.

### R2 (Object Storage)

- **Free tier**: 10 GB storage, 1M Class A ops/month, 10M Class B ops/month
- **Paid**: $0.015/GB-month (storage), $4.50/million Class A ops (PUT/POST), $0.36/million Class B ops (GET)
- **Egress**: FREE — no data transfer charges
- **Class A = writes** (PUT, POST, multipart), **Class B = reads** (GET)

### Pages

- **Static assets**: free, unlimited requests — no Worker invocation cost
- **Pages Functions** (dynamic): billed as Workers requests
- **Builds**: 500/month free

### KV

- **Free tier**: 100K reads/day, 1K writes/day
- **Paid**: $0.50/million reads, $5.00/million writes (much more expensive per write than D1)

---

## Critical Risks (Can directly inflate bill)

### CR-1: `/webhook` is unauthenticated and triggers D1 reads on every call ✅ FIXED

**File**: `backend/src/index.ts:50`, `backend/src/webhook.ts`

**Description**: `POST /webhook` has no authentication. Telegram does sign webhooks with a bot token, but there is no signature verification in the handler. The bot is registered globally in `getOrCreateBot()` using `webhookCallback(bot, 'hono')` — grammY's `webhookCallback` does NOT validate the secret token by default unless explicitly configured with `secretToken`. Any internet user can POST arbitrary JSON to this endpoint and trigger full Worker execution.

More critically: the `bot.on('message:text')` handler at `webhook.ts:300-315` fires for every text message sent to the bot. If the bot is added to a Telegram group, **every message in that group** triggers a Worker invocation. This is a structural spam vector.

**Cost impact**: 1M spam POST requests × 1 Worker invocation = $0.30 (Workers). But each webhook hit also runs `dbMiddleware` (D1 `PRAGMA` or connection init) — low row cost but real CPU. If the text handler triggers: zero extra D1 reads, just the Telegram API reply call. The join flow on `/start join_*` does 4-6 D1 reads per call.

**Worst case**: Bot added to a high-traffic public group → thousands of webhook calls/day for free from Telegram's side, each burning Worker CPU.

**Fix**: Add Telegram webhook secret token validation. Set a random secret when calling `setWebhook` and verify it on every incoming request:

```ts
// In handleWebhook, before getOrCreateBot:
const secret = c.env.WEBHOOK_SECRET;
if (secret) {
  const incoming = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (incoming !== secret) return c.json({ error: 'forbidden' }, 403);
}
```

Set `WEBHOOK_SECRET` in `.dev.vars` and `wrangler.toml`. Pass it when setting webhook:

```bash
?secret_token=<WEBHOOK_SECRET>
```

This is a one-liner and stops all non-Telegram webhook spam cold.

---

### CR-2: `/r2/*` serving does NOT use Cloudflare Cache API — every image fetch hits R2 ✅ FIXED

**File**: `backend/src/api/r2.ts:7-28`

**Description**: The Worker sets `Cache-Control: public, max-age=31536000, immutable` headers, but **Cloudflare's CDN cache does not automatically cache Worker responses** unless you explicitly use the Cache API or configure a Cache Rule. The browser will cache images after the first hit per device, but every new user, every incognito session, every bot, and every admin page load that renders `<img src="/r2/...">` triggers a full Worker invocation + R2 `GET` (Class B op).

The admin group detail page (`admin.ts:287-303`) renders all group/member/expense images inline — one admin page load for a group with 50 expenses + 20 members = ~70 R2 GETs + 70 Worker subrequests.

**Cost impact**:

- 10M Class B R2 ops free, then $0.36/million
- Each image fetch = 1 Worker invocation + 1 R2 Class B op
- At 1,000 DAU × 10 image loads/day = 10M/day → well into paid territory fast
- Currently mitigated somewhat by browser caching, but zero CDN edge caching

**Fix**: Use Cloudflare Cache API to cache R2 responses at the edge:

```ts
r2App.get('/*', async (c) => {
  const cacheKey = new Request(c.req.url);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();

  const response = new Response(object.body as ReadableStream, { headers });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});
```

This eliminates the R2 read and Worker CPU on subsequent requests for the same image from the same PoP. Given the `immutable` cache header already set, this is safe for all images (they use content-addressed keys with timestamps).

---

### CR-3: `/settlements/:id/confirm` is a polling endpoint — every poll hits D1 3+ times

**File**: `backend/src/api/settlements.ts:553-731`

**Description**: The frontend polls `POST /settlements/:id/confirm` every 3 seconds for up to 90 seconds during on-chain settlement (SettleUp.tsx:233-267). Each `/confirm` call performs:

1. D1 read: look up user by telegramId (auth middleware)
2. D1 read: look up user by telegramId again (`currentUser` query, line 562)
3. D1 read: look up settlement (line 572)
4. If `payment_pending`: 3 more parallel D1 reads (debtorInfo, creditorInfo, group) + external TONAPI fetch + potentially D1 read for exchange rates

That's 3-7 D1 reads per poll, every 3 seconds, for up to 90 seconds = up to 30 polls × 7 reads = **210 D1 reads per settlement attempt**. With TONAPI latency (10s timeout), each confirm call can consume significant CPU time.

**Cost impact**: At 100 concurrent settlement flows = 3,000 polls/minute = 21,000 D1 reads/minute. Low absolute cost but scales linearly with usage and burns CPU time on external I/O.

**Fix**: Separate the TONAPI verification from the status check. On the first poll, transition to verifying. If TONAPI returns within 1 call, great. Add a server-side delay/debounce — return `payment_pending` immediately if last check was < 5 seconds ago (store `lastCheckedAt` in the settlement row or use a simple in-memory dedup for the same Worker isolate). This is also where a Durable Object or a scheduled Cron would shine architecturally (fire webhook when TX confirms).

---

## High Risks (Significant cost under load)

### HR-1: Auth middleware performs D1 lookup on every protected request

**File**: `backend/src/middleware/auth.ts:80`

**Description**: Every authenticated API request (all `/api/v1/*` routes) performs `db.select().from(users).where(eq(users.telegramId, tgUser.id)).limit(1)` — a D1 read. This is on top of whatever D1 reads the route handler itself performs.

A typical Group page load triggers: auth (1 read) + group detail (2-3 reads) + expenses (2 reads, N+1 issue separately) + balances (1 read) = 5-7 D1 reads minimum, of which 1 is pure auth overhead for every request.

**Cost impact**: 1M authenticated requests/month × 1 extra D1 read = 1M extra reads (still within free tier at small scale, but a pure overhead tax that accumulates).

**Fix option A** (KV session cache): After validating initData HMAC (CPU-only, no I/O), cache `{ id, displayName }` in Workers KV with TTL = `auth_date` max age (86400s). Key = `session:{telegramId}`. KV reads are $0.50/million vs D1's $0.001/million — **KV is actually more expensive per-op**. Skip this.

**Fix option B** (JWT/stateless): Encode `{id, displayName}` in a signed JWT after first auth. All subsequent requests verify the JWT signature (CPU only, zero D1). The current `POST /api/v1/auth` already validates and returns user data — add a signed token to that response. This is the right long-term direction.

**Fix option C** (short-term): Pass `userId` from auth context into route handlers to eliminate the duplicate `resolveCurrentUser` D1 read that most handlers do on top of auth. Currently auth puts `telegramId` in session, but every handler then does another D1 query to get the internal `id`. Store both in session.

---

### HR-2: `GET /api/v1/groups/:id/expenses` has N+1 query on participants ✅ FIXED

**File**: `backend/src/api/expenses.ts:330-344`

**Description**: The expense list endpoint fetches expenses with a JOIN on the payer (one query), then for each expense does a separate query to fetch participants:

```ts
const result = await Promise.all(
  expenseList.map(async (exp) => {
    const participants = await db.select()...where(eq(expenseParticipants.expenseId, exp.id));
    return { ...exp, participants };
  }),
);
```

With `limit=50` (default), this is **1 query + 50 parallel D1 queries = 51 D1 reads** per request. D1 does not support true batching of arbitrary SELECT statements via `db.batch()` (only writes), but the pattern should be rewritten to a single JOIN or a single `inArray` fetch:

```ts
const expenseIds = expenseList.map((e) => e.id);
const allParticipants = await db
  .select()
  .from(expenseParticipants)
  .innerJoin(users, eq(expenseParticipants.userId, users.id))
  .where(inArray(expenseParticipants.expenseId, expenseIds));
// Group by expenseId in memory
```

**Cost impact**: Every Group page load fetches the expense list. 1,000 DAU × 3 group views/day × 50 expenses/group = 153,000 D1 reads/day from participants alone, vs 3,000 with the fix.

---

### HR-3: `refreshGroupBalances` runs a heavy correlated subquery UPDATE on every mutation

**File**: `backend/src/api/balances.ts:230-258`

**Description**: Every expense create/edit/delete and every settlement completion calls `refreshGroupBalances(db, groupId)`. This runs a single SQL `UPDATE group_members SET net_balance = (subquery)` that executes 4 correlated subqueries across `expenses`, `expense_participants`, and `settlements` tables — one per member row. For a group with 10 members, this is effectively 40 subquery executions per mutation.

This is correct and atomic (good!), but it burns D1 rows-read proportional to group size × expense count on every write. A group with 50 expenses and 10 members = ~100 rows scanned per `refreshGroupBalances` call.

**Cost impact**: Acceptable at current scale, but note that every expense add triggers: auth read + 4 membership reads + 1 insert + 1 participants insert + `refreshGroupBalances` (heavy) + `logActivity` (1 write). The write amplification is real.

**Fix**: No change needed now, but as scale grows, consider making `refreshGroupBalances` async (via `waitUntil`) so it doesn't block the response. The current blocking call adds latency for the user.

---

### HR-4: `POST /api/v1/auth` is unauthenticated and does D1 reads + writes on every call ✅ FIXED

**File**: `backend/src/api/auth.ts:21-137`

**Description**: The auth endpoint is called every time the Mini App loads (no session persistence — stateless design). It does:

1. HMAC validation (CPU)
2. D1 SELECT to check if user exists
3. D1 UPDATE (if exists) or INSERT + SELECT (if new)

The `UPDATE` on every auth call (`updatedAt`, `username`, `displayName`) means every app open = 1 D1 write. A user who opens the app 20 times/day = 20 D1 writes for display name sync that rarely changes.

**Cost impact**: 1,000 DAU × 20 sessions/day = 20,000 D1 writes/day from auth alone. At $1.00/million writes, this is $0.02/day → $0.60/month at this scale. Scales linearly.

**Fix**: Only write on actual field changes. Compare `existing.displayName === displayName && existing.username === username` before updating. This is a common optimization for upsert patterns:

```ts
const needsUpdate = existing[0].displayName !== displayName || existing[0].username !== (tgUser.username ?? null);
if (needsUpdate) {
  await db.update(users).set({ username: ..., displayName: ..., updatedAt: ... }).where(...);
}
```

---

### HR-5: `/settlements/:id/tx` fetches TONAPI (external call) on every tap of "Pay with USDT"

**File**: `backend/src/api/settlements.ts:279-463`

**Description**: Every time the user taps "Pay with USDT", the frontend calls `GET /settlements/:id/tx?senderAddress=...`. This endpoint:

1. 2 D1 reads (user, settlement)
2. 2 more D1 reads (creditor, group)
3. Possibly 1 D1 read + 1 external fetch for exchange rates
4. 1 external TONAPI fetch (10s timeout) — looks up sender's USDT jetton wallet

The TONAPI call is a subrequest that consumes significant CPU time. If TONAPI is slow or down, the Worker holds the connection for up to 10 seconds while Cloudflare meters CPU time. This is also an unauthenticated-ish vector — any authenticated user can call this endpoint repeatedly.

**Fix**: Cache the jetton wallet address per (user, usdtMasterAddress) in D1 or in the user's wallet_address field once looked up. It doesn't change unless the user creates a new wallet.

---

### HR-6: Exchange rates endpoint can trigger external fetch on every request when stale

**File**: `backend/src/services/exchange-rates.ts:19-50`

**Description**: `getExchangeRates()` is called from multiple places: `/settlements/:id/tx`, `/settlements/:id/confirm`, and `GET /api/v1/exchange-rates`. The 24-hour staleness check means the first request after 24h triggers an external fetch (up to 8s on primary + 8s on fallback = 16s worst case) that blocks the response. Under load, **multiple concurrent requests can all find the cache stale at the same moment** and all simultaneously fetch from the external API — a thundering herd to open.er-api.com.

**Cost impact**: External API rate limiting risk, not billing risk. But the Worker CPU consumed waiting on 16s of I/O is a billing risk.

**Fix**: Add a simple lock/flag: after the first request detects staleness and starts fetching, subsequent requests should return the stale data rather than also fetching. A `fetchInProgress` module-level boolean works within an isolate. Alternatively, use a Cron Trigger to refresh rates on a schedule, completely decoupling the update from request paths.

---

## Medium Risks (Optimization opportunities)

### MR-1: `POST /api/v1/auth` UPDATE on every app open without checking for changes ✅ FIXED

Already covered in HR-4. Dirty-check added — only writes when displayName or username actually changed.

---

### MR-2: Auth middleware does a second user lookup that most handlers also do ✅ FIXED

**File**: `backend/src/middleware/auth.ts:80`, most route handlers

**Description**: Auth sets `session.telegramId`. Every handler then does:

```ts
const [currentUser] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.telegramId, session.telegramId))
  .limit(1);
```

This is a redundant D1 read — the auth middleware already fetched the user from D1, but only stored `telegramId`, `username`, `displayName` in session (not the internal `id`).

**Fix**: Store `userId` (internal integer PK) in `SessionData` during auth. The middleware already has it from `existing[0]`:

```ts
// In auth.ts session setup:
c.set('session', {
  telegramId: existing[0].telegramId,
  userId: existing[0].id, // add this
  username: existing[0].username ?? undefined,
  displayName: existing[0].displayName,
});
```

This eliminates 1 D1 read from every authenticated endpoint. Rough count across routes: every groups, expenses, balances, stats, settlements, users, activity, reports handler has this pattern. That's ~15+ handlers, each burning 1 extra D1 read per call.

---

### MR-3: `/admin` dashboard loads Tailwind from CDN on every page view

**File**: `backend/src/api/admin.ts:57`

```html
<script src="https://cdn.tailwindcss.com"></script>
```

This is a subrequest on every admin page load. Minor billing impact (Worker subrequests count toward CPU time), but this is also a supply-chain risk — the CDN going down breaks admin. Use the Tailwind CDN Play build or inline critical styles.

---

### MR-4: `verifySettlementOnChain` fetches last 20 contract events every poll — no time window

**File**: `backend/src/api/settlements.ts:1102`

```ts
const resp = await fetch(`${baseUrl}/v2/accounts/${contractAddress}/events?limit=20`, ...);
```

This endpoint is called on every `/confirm` poll (every 3 seconds). It always fetches the last 20 events from TONAPI with no time filter — even when the transaction happened 5 minutes ago and the event would not be in the last 20 anymore (already noted as critical security issue in CODE_REVIEW.md). There's no `after_lt` or timestamp filter to limit the scan to recent events.

From a billing perspective: each confirm poll = 1 TONAPI fetch = Worker CPU time for the HTTP round-trip. Already covered in CR-3.

---

### MR-5: `/privacy` and `/terms` are served by the Worker, not Pages static

**File**: `backend/src/api/legal.ts:58-59`

The legal pages are served as Worker HTML responses. The HTML is pre-generated at module init (good — `marked.parse()` runs once), but every visit to `/privacy` or `/terms` is still a **paid Worker invocation** ($0.30/million). If these pages were served as static files from Cloudflare Pages, they'd be **free** (Pages static assets = unlimited, no Worker cost).

**Fix**: Generate `privacy.html` and `terms.html` at build time (add a small build script that runs `marked` on the markdown files) and include them in the Pages deployment. Move the `/privacy` and `/terms` routes to be handled by Pages, not the Worker. Very low priority unless you expect significant organic traffic to these pages.

---

### MR-6: `POST /api/v1/reports` fetches the reported image from R2 during the request (not async)

**File**: `backend/src/api/reports.ts:62-70`

The `sendReport()` function is wrapped in `waitUntil()` (good — non-blocking). But inside `sendReport()`, it does:

```ts
const r2Object = await c.env.IMAGES.get(imageKey);
const blob = await r2Object.arrayBuffer();
```

This is a full R2 GET + read of the entire file into memory, then forwarded to Telegram via multipart POST. For a 5MB image, this means: 1 R2 Class B op + ~5MB bandwidth through the Worker memory. This is fine since R2 egress is free, but loading 5MB into Worker memory per report could hit memory limits under concurrent reports.

**Fix**: Use R2's `createPresignedUrl()` or serve via a Worker URL and pass the URL to Telegram's `sendPhoto` with a URL instead of uploading the binary. This removes the memory pressure entirely.

---

### MR-7: `GET /api/v1/groups/:id/stats` runs 5 parallel aggregation queries on every tab switch

**File**: `backend/src/api/stats.ts:69-123`

Five queries run in parallel via `Promise.all()` on every stats tab open: total spent, member shares, paid for, settlements, and available months. These are proper aggregation queries with GROUP BY and SUM — they scan all expenses and participants in the group. For a group with 500 expenses and 20 participants, this scans thousands of rows per stats load.

The "available months" query (`DISTINCT substr(created_at, 1, 7)`) scans the entire expenses table for the group.

**Fix**: Add an HTTP response cache header (`Cache-Control: max-age=60`) so the browser doesn't re-fetch on every tab re-entry within a minute. Add `ETag` or `Last-Modified` based on the most recent expense/settlement `updatedAt`. This doesn't fix the query cost but reduces call frequency significantly.

---

## Low Risks / Nice-to-Have

### LR-1: `/api/health` is public and runs `dbMiddleware` unnecessarily

**File**: `backend/src/index.ts:27,49`, `backend/src/middleware/db.ts`

The health endpoint is mounted after `app.use('*', dbMiddleware)`, so every `/api/health` GET creates a D1 Drizzle instance (likely just object instantiation, no actual D1 call). Harmless but worth noting.

---

### LR-2: `image_reports` table has no index on `reporter_telegram_id`

**File**: `backend/src/db/schema.ts:187-199`

If `imageReports` grows large and you add a "view my reports" endpoint, the lookup by `reporterTelegramId` will scan the whole table. Low risk now given low report volume.

---

### LR-3: `settlements` table has no index on `(groupId, status)`

**File**: `backend/src/db/schema.ts:243-248`

The `GET /groups/:id/settlements` query filters by `groupId` AND `status IN ('settled_external', 'settled_onchain')`. There's a `settlements_group_idx` on `groupId` and `settlements_status_idx` on `status` separately, but no compound index. D1 will use one index and scan for the other. Fine at low volume.

---

### LR-4: `GET /api/v1/activity` (cross-group) fetches all user's group IDs before querying activity

**File**: `backend/src/api/activity.ts:29-32`

Two D1 reads: first get user's group IDs, then query activity with `inArray(activityLog.groupId, groupIds)`. For a user in many groups, the `inArray` clause grows large. An index-covered join would be more efficient but is an SQLite limitation.

---

### LR-5: No upload count limit per user

**File**: `backend/src/utils/r2.ts:20-32`

`validateUpload()` checks file size (5MB max) and type, but there is no limit on how many uploads a single user can perform. An authenticated user could upload thousands of avatars in a loop (5MB × 1000 = 5GB R2 storage = $0.075 in storage cost + 1000 Class A R2 ops = negligible). The old keys are deleted via `waitUntil`, so storage churn is self-limiting. But CPU cost is real: each upload does 2 R2 PUTs (image + thumbnail) synchronously in the request. Rate limiting at the user level (e.g., 10 uploads/hour via KV counter) would close this.

---

## Architecture Recommendations

### 1. Store `userId` in auth session (highest leverage, lowest effort) ✅ DONE

`SessionData` now includes `userId`. All 46 redundant D1 lookups across 8 handler files eliminated.

### 2. Skip user `UPDATE` in auth if nothing changed ✅ DONE

Dirty-check added: compares `displayName` and `username` before writing. Cuts auth D1 writes by ~90%.

### 3. Fix the N+1 in expense list ✅ DONE

Replaced `Promise.all(map)` with a single `inArray` batch query + in-memory grouping. 50 queries → 1.

### 4. Add Cloudflare Cache API to the R2 serving endpoint ✅ DONE

Edge caching via `caches.default` added. Cache hit returns directly; cache miss stores response via `waitUntil(cache.put())`.

### 5. Add Telegram webhook secret token validation ✅ DONE (pre-existing)

Already implemented: HMAC-SHA256 derived secret in `webhook.ts`, validated via `X-Telegram-Bot-Api-Secret-Token` header. Setup script passes `secret_token` to Telegram.

### 6. Decouple on-chain confirmation from polling

The `/confirm` endpoint is expensive because it chains: D1 reads → TONAPI fetch → conditional D1 writes. At scale, consider a Cloudflare Cron Trigger that periodically sweeps `payment_pending` settlements and confirms them server-side. The frontend can then poll a cheap status-only endpoint that does 1-2 D1 reads with no external calls.

### 7. Consider Cron for exchange rate refresh

A Cron Trigger running once per hour to refresh exchange rates eliminates the stale-on-first-request thundering herd entirely. The trigger runs a single Worker invocation at a predictable time rather than betting that concurrent users won't all hit the stale check at once.

---

## Implementation Priority Plan

Categorized by urgency — what matters regardless of user count vs. what can wait for scale.

### Do now (security + code quality, user-count-independent)

| #   | Item                          | Ref  | Effort | Status  | Why now                                         |
| --- | ----------------------------- | ---- | ------ | ------- | ----------------------------------------------- |
| 1   | Webhook secret token          | CR-1 | 15 min | ✅ DONE | Security hole — unauthenticated endpoint        |
| 2   | Store `userId` in session     | MR-2 | 30 min | ✅ DONE | Eliminates redundant D1 read from every handler |
| 3   | Skip auth UPDATE if unchanged | HR-4 | 5 min  | ✅ DONE | Free win — trivial dirty-check                  |

### Do before launch (latency fixes noticeable even at 5 users)

| #   | Item                         | Ref  | Effort | Status  | Why soon                                              |
| --- | ---------------------------- | ---- | ------ | ------- | ----------------------------------------------------- |
| 4   | Fix N+1 expense participants | HR-2 | 1 hr   | ✅ DONE | 50 queries → 1 on every group page load               |
| 5   | R2 Cache API                 | CR-2 | 15 min | ✅ DONE | 5 lines of code, eliminates R2 hits for cached images |

### Can wait (only matters at 1,000+ DAU)

| #   | Item                                  | Ref   | Why it can wait                                |
| --- | ------------------------------------- | ----- | ---------------------------------------------- |
| 6   | Settlement polling optimization       | CR-3  | Near-zero crypto settlements happening         |
| 7   | Auth middleware JWT path              | HR-1  | Addressed partially by #2 (userId in session)  |
| 8   | refreshGroupBalances async            | HR-3  | Correct and atomic, only slow with huge groups |
| 9   | TONAPI jetton wallet caching          | HR-5  | Near-zero crypto usage                         |
| 10  | Exchange rate thundering herd         | HR-6  | No concurrent stale hits with 5 users          |
| 11  | Stats query caching                   | MR-7  | Low traffic                                    |
| 12  | Legal pages on Pages (not Worker)     | MR-5  | Negligible traffic                             |
| 13  | Admin Tailwind CDN → inline           | MR-3  | Admin-only, single user                        |
| 14  | Report image streaming                | MR-6  | Near-zero reports                              |
| 15  | All LR items (indexes, upload limits) | LR-\* | Nice-to-have at scale                          |
