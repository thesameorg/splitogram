# Image Storage — Cloudflare R2

**Phase:** 6
**Type:** RESEARCH → decision
**Status:** DECIDED

---

## Context

Need image storage for:

- User avatars (custom upload, replacing Telegram default)
- Group avatars (emoji or custom image)
- Transaction image attachments (receipts, proof — JPG, PNG only)

Cloudflare R2 is the natural choice (same platform, S3-compatible, free egress).

Reference implementation studied: `telegram-webapp-cloudflare-template` (same stack — Hono + R2 + D1 + Vite).

## Research Findings

### R2 Setup & Access Patterns

**Binding config** — add to `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "IMAGES"
bucket_name = "splitogram-images"
```

Add `IMAGES: R2Bucket` to `Env` interface. `R2Bucket` type comes from `@cloudflare/workers-types` (already in devDependencies). Local dev: wrangler auto-provides a local R2 bucket, no extra setup.

**One bucket with path prefixes** — best practice. R2 keys are flat strings; prefixes are just conventions:

```
splitogram-images/
  avatars/{userId}/{hash}.jpg
  groups/{groupId}/{hash}.jpg
  receipts/{expenseId}/{hash}.jpg
  receipts/{expenseId}/{hash}-thumb.jpg
```

Separate buckets add config overhead for no benefit.

**Worker-served, not public bucket** — serve all images through the Worker via `/r2/*` route. Reasons:

- `r2.dev` subdomain is rate-limited (few hundred req/s), no Cloudflare CDN cache — never use in production
- Public custom domain works but loses auth flexibility
- Worker-served gives us: CDN caching (automatic via Worker domain), `Cache-Control` headers we control, auth checks for receipts, single deployment surface

Pattern: `GET /r2/:key+` → `R2.get(key)` → stream `object.body` directly to Response (zero-copy, no buffering). Set `Cache-Control: public, max-age=31536000, immutable` for content-addressed keys.

**Upload size** — Cloudflare free plan allows 100MB request body. R2 single PUT allows 5GB. Real constraint is Worker memory (128MB per isolate). For our images (< 5MB after client processing), all well within limits.

### Client-Side Image Processing

**HEIC handling** — iOS WKWebView (Telegram Mini App runtime) auto-converts HEIC → JPEG from the photo picker. The `<input type="file" accept="image/*">` always receives JPEG. No `heic2any` library needed for mobile. Desktop paste could theoretically send HEIC, but this is an extreme edge case — skip for now, revisit if it surfaces.

**EXIF stripping** — Canvas redraw strips ALL EXIF metadata (GPS, camera, orientation). Modern browsers (iOS 13.4+) auto-apply EXIF orientation before drawing, so the output is correctly oriented with no metadata. No library needed.

**Resize + compress** — `createImageBitmap()` + Canvas `drawImage()` + `canvas.toBlob()`. Zero dependencies. Pipeline:

1. Load file → `createImageBitmap(file)`
2. Calculate target dimensions (maintain aspect ratio, cap max dimension)
3. Draw to Canvas (strips EXIF)
4. Export as JPEG blob via `canvas.toBlob('image/jpeg', quality)`

Target sizes:

| Type              | Max dimension | Quality | Typical output |
| ----------------- | ------------- | ------- | -------------- |
| Avatar            | 256px         | 0.80    | 30–80 KB       |
| Receipt full      | 1200px        | 0.85    | 200–400 KB     |
| Receipt thumbnail | 200px         | 0.75    | 10–30 KB       |

**OffscreenCanvas** — available iOS 16.4+. Fallback to `document.createElement('canvas')` for older versions. The template uses regular Canvas throughout — safe and proven.

**Input limit** — accept files up to 20MB raw (phones can produce 10-12MB JPEGs), but output after client processing is always < 1MB. Server enforces 5MB hard limit as safety net.

### Thumbnail Generation

**Client-side generation is the right approach.** Reasons:

- No Canvas API in Cloudflare Workers runtime (confirmed — V8 isolate, no DOM)
- Cloudflare Image Transformations ($9/mo, 5K free transforms/month) is overkill for a small app and adds complexity (custom domain, `cf.image` subrequest pattern, `--remote` required for local dev)
- WASM (`@cf-wasm/photon`) adds 2MB to Worker bundle — unnecessary
- Client-side Canvas handles 96-200px thumbnails trivially
- The template does exactly this: compress full + compress thumbnail client-side, upload both via FormData

**Approach:** generate thumbnail on client, upload both original + thumbnail as multipart FormData. Worker stores both in R2 as separate keys. List views use thumbnail key, detail views use original key.

For avatars: the "original" is already small (256px), so no separate thumbnail needed — one image per avatar.

### Cleanup

**Delete from R2 when entity is deleted.** Best-effort: log errors, don't block DB deletion. Pattern from template:

```ts
try {
  await env.IMAGES.delete(key);
} catch (e) {
  console.error('R2 cleanup failed:', e);
}
// Always proceed with DB deletion
```

For group deletion (cascade): query expenses with receipt keys, delete from R2, then delete group (D1 cascade handles DB records).

## Decisions

### 1. Access pattern: Worker-served for everything

All images served through `GET /r2/:path+` route on the existing Worker. Avatars get `Cache-Control: public, max-age=31536000, immutable` (content-addressed keys). Receipts get the same — all group members can see receipts for expenses in their group (no per-user access control needed for receipts).

No public R2 bucket. No signed URLs. No separate custom domain.

### 2. Upload flow: client processes → upload through Worker

Client pipeline: resize → compress → strip EXIF (all via Canvas, zero deps). Upload via multipart FormData to Worker endpoint. Worker validates size/type, stores in R2, saves key in D1.

No direct-to-R2 uploads (presigned URLs). Images are small enough (< 1MB after processing) that Worker proxying is fine.

### 3. Thumbnail strategy: client-side generation

Client generates thumbnail alongside original, uploads both. No server-side image processing. No Cloudflare Image Transformations.

- Receipts: upload original (1200px) + thumbnail (200px)
- Avatars: upload single image (256px) — small enough, no thumbnail needed
- Groups: upload single image (256px) — same as avatars

### 4. DB schema: columns on existing tables

```sql
-- Migration 0004
ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE groups ADD COLUMN avatar_key TEXT;
ALTER TABLE groups ADD COLUMN avatar_emoji TEXT;
ALTER TABLE expenses ADD COLUMN receipt_key TEXT;
ALTER TABLE expenses ADD COLUMN receipt_thumb_key TEXT;
```

No separate `images` table — each entity has at most one image. Simpler queries, no joins.

### 5. Max file size and accepted types

| Limit                                  | Value                          |
| -------------------------------------- | ------------------------------ |
| Raw input (before processing)          | 20 MB                          |
| Processed output (after client resize) | < 1 MB typical                 |
| Server hard limit                      | 5 MB                           |
| Accepted input types                   | JPEG, PNG, WebP                |
| Output format                          | JPEG (universal compatibility) |

### 6. R2 key naming

Content-addressed with user/entity context:

```
avatars/{userId}/{timestamp}_{8-char-random}.jpg
groups/{groupId}/{timestamp}_{8-char-random}.jpg
receipts/{expenseId}/{timestamp}_{8-char-random}.jpg
receipts/{expenseId}/{timestamp}_{8-char-random}-thumb.jpg
```

Timestamp + random suffix ensures uniqueness and enables immutable caching. When avatar is updated, old key is deleted, new key is stored.

### 7. Dev setup

Vite proxy: add `/r2` to existing proxy config (points to wrangler on :8787, same as `/api`). Wrangler local dev auto-provides R2 bucket. No additional setup.

### 8. No new dependencies

Zero new npm packages for image handling. Everything uses native browser Canvas API on frontend and R2 binding API on backend. The template uses `browser-image-compression` + `react-easy-crop`, but Splitogram's needs are simpler (no multi-image galleries, no complex crop UI) — native Canvas suffices.

### Architecture summary

```
User picks image
  → Client: resize + compress + strip EXIF (Canvas API, zero deps)
  → Client: generate thumbnail if receipt (Canvas API)
  → Client: upload via multipart FormData to Worker
    → Worker: validate size/type
    → Worker: store in R2 (avatars/{id}/..., receipts/{id}/...)
    → Worker: save R2 key in D1
  → Frontend: display via /r2/{key} URL (Worker streams from R2, CDN caches)
```
