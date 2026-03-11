# Go Live!

- выверить русский + ширину элементов поправить
- сделать картинки, описания, скрины
- добавить СВОЮ аналитику таки, чтобы понимать что вообще происходит.
-

# Later | manual

- **Cron: pending settlement checker** — Add a Cloudflare Workers [scheduled trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (e.g. every 5 min) that queries all `payment_pending` settlements and verifies them on-chain via TONAPI. Safety net for cases where the user closes the app before confirmation completes. Would catch stuck settlements that neither polling nor manual tx link verification resolved.

- check naming everywhere
- update APP icons
- update icon link at frontend/public/tonconnect-manifest.json
- branding \ animations \
  - loading screen
  - successfully settled screen

- add a user's personal image for QR code usage - so others can save his QR code & pay using it
- add user's payment link(s) for same reason
- add group color as setting for "groups" page
- add bot notification language: off, en, ru ...
- add "image loading" placeholder
- who should be able to edit \ delete whose records?
