# Go Live!
- add real settlement transactions to admin stats page, with tonviewer links
- stats admin page:
  - if group was deleted, TON settlements should stay in a some table - so we have consistent sums in commissions wallet & stats page
  - maybe just mark group as deleted? is that GDPR complian? or somehow make deletion not-recursive for TON-settlements? 
  - add "placeholder" marker to user if so ongroup page
  - generally actualize stats pages to current fuctions
  - should mention "testnet" if so
  - show deleted (x members) -> show deleted (x groups)
  - 
- feedback does not actaully forward images, only text - just silently, no error logs. same for 1 and 6 files.
- align TON fees - maybe no need for 0.5 TON, as 
- personalized invite links to placeholder users
  - check-claim
  - race check? already claimed - just join
  - callback button data length
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
