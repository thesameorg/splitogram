# Image Storage — Cloudflare R2

**Phase:** 6
**Type:** RESEARCH → decision
**Status:** open

---

## Context

Need image storage for:

- User avatars (custom upload, replacing Telegram default)
- Group avatars (emoji or custom image)
- Transaction image attachments (receipts, proof — JPG, PNG, SVG only)

Cloudflare R2 is the natural choice (same platform, S3-compatible, free egress).

## Research tasks

### R2 setup & access patterns

- [ ] How to bind R2 bucket to a Cloudflare Worker (wrangler config)
- [ ] Public bucket vs signed URLs — which is appropriate for avatars (public) vs receipts (possibly private)?
- [ ] Can we use one bucket with path prefixes (`avatars/`, `receipts/`) or should we use separate buckets?
- [ ] What's the upload size limit for Workers? (128MB request body limit, but we'll cap at ~5MB for images)
- [ ] How to serve R2 objects via the Worker (stream vs buffer)

### Client-side image processing

- [ ] HEIC → JPG conversion in browser: which library? (`heic2any`? Browser-native?)
- [ ] Does the TG WebView on iOS expose HEIC files, or does it auto-convert to JPG?
- [ ] Client-side EXIF stripping: library or manual? (`piexifjs`? Canvas redraw?)
- [ ] Client-side image resize before upload (to avoid uploading 12MP photos for a 96px avatar)
- [ ] What's the max practical upload size we should allow? (2MB? 5MB?)

### Thumbnail generation

- [ ] Generate on upload (Worker) vs on-demand (lazy, with caching)?
- [ ] Can we use Cloudflare Image Resizing with R2, or do we need to do it ourselves?
- [ ] If doing it in Worker: use Canvas API? (not available in Workers) External service? Store pre-generated thumbs?
- [ ] Target: 96px square thumbnail for lists, original for detail view

### Cleanup

- [ ] When a user deletes an expense with an image, delete from R2 immediately or batch?
- [ ] When a group is deleted (cascade), how to find and delete all associated images?
- [ ] DB column design: store R2 key in `expenses` / `users` / `groups` table? Separate `images` table?

## Decisions needed

1. **Access pattern:** public bucket vs signed URLs (or mixed)
2. **Upload flow:** direct to R2 from client (presigned URL) vs upload through Worker
3. **Thumbnail strategy:** pre-generate on upload vs on-demand resize
4. **DB schema:** where to store image references
5. **Max file size and dimensions**

## Decision

_To be filled after research._
