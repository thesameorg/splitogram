# GDPR Compliance Audit — Splitogram

**Date:** 2026-03-12
**Audited by:** Claude Code (automated review)

## Summary

| # | Area | Status | Risk |
|---|------|--------|------|
| 1 | Privacy Policy | Compliant | Low |
| 2 | User Deletion | Partial | Medium |
| 3 | Data Collection | Compliant | Low |
| 4 | **Consent** | **Non-compliant** | **Critical** |
| 5 | Data Retention | Non-compliant | High |
| 6 | Third-party Services | Partial | Medium |
| 7 | Data Portability | Partial | Medium |
| 8 | Right to be Forgotten | Partial | High |
| 9 | Security | Compliant | Low |
| 10 | Terms of Service | Compliant | Low |

---

## 1. Privacy Policy

**Status: COMPLIANT (with caveats)**

`docs/privacy-policy.md` covers most GDPR elements:

- Data controller identity: Yes ("Quberas operator")
- Data collected: Yes (TG ID, name, username, language, wallet, expenses, activity)
- Legal basis: Implied but **not explicitly stated per Article 6**
- Data retention: Vague ("persists as long as you use the service", indefinite activity logs)
- User rights: Yes (access, correct, delete, leave, mute, export)
- Third-party sharing: Yes (group members, Telegram Bot API, TONAPI, exchange rate API)
- International transfers: **Not mentioned** (Cloudflare global network)
- DPA contact: Only "Feedback" feature, no dedicated DPA contact
- Cookies/tracking: Yes ("no external tracking")
- Children: Yes ("not intended for users under 13")

### Issues

1. No explicit legal basis per Article 6(1) — should state contract performance + legitimate interest
2. Activity log retention is indefinite — violates Article 5(1)(e) storage limitation
3. No DPA with Cloudflare mentioned
4. No mention of international data transfers
5. Missing DPIA reference for blockchain settlement (high-risk processing)

### Recommendations

- Add explicit legal basis: "Contract (Art. 6(1)(b)) for service provision; Legitimate interest (Art. 6(1)(f)) for audit/fraud prevention"
- Define activity log retention: "7 years for accounting/audit, then deleted"
- Add DPA sentence: "We have a DPA with Cloudflare under Standard Contractual Clauses"
- Add international transfers section
- Reference DPIA for on-chain settlement

---

## 2. User Deletion

**Status: PARTIALLY COMPLIANT**

### What gets deleted

- User row from `users` table
- All group memberships from `group_members`
- User's avatar from R2
- Image reports filed by user
- Debt reminders

### What persists (by design)

- Expenses (FK references transferred to dummy user)
- Settlements (transferred to dummy)
- Activity logs (transferred to dummy)
- Groups created by deleted user (transferred to dummy)
- On-chain settlements (retained indefinitely — documented, justified for audit)

### How it works

1. Checks sole-admin groups with real members → blocks deletion until resolved
2. Creates deterministic dummy: `telegramId = -Math.abs(original)`, `displayName = "(OriginalName)"`, `isDummy = true`, no avatar, no wallet
3. Transfers ALL FK references to dummy (expenses.paidBy, expense_participants, settlements, activity_log)
4. Deletes user from all groups

### Issues

1. **Dummy user persists indefinitely** — never cleaned up even with zero memberships
2. **Display name is semi-identifiable** — `(John Smith)` in activity logs may still identify the user
3. **Activity logs with dummy are searchable** — correlatable via timestamps + amounts
4. **Wallet address cleared but on-chain tx records remain** — wallet visible on blockchain forever
5. **No data export before deletion** — Art. 20 (data portability)

### Recommendations

- [ ] Change dummy display name to generic `(Deleted User)` instead of `(OriginalName)`
- [ ] Delete dummy when it has zero remaining memberships
- [ ] Add full data export before deletion flow
- [ ] Document on-chain wallet permanence in Privacy Policy

---

## 3. Data Collection

**Status: COMPLIANT**

Minimal, necessary collection only:

- **Users:** telegram_id, username, display_name, wallet_address, created_at, bot_started, avatar_key, is_dummy
- **Auth flow:** extracts only TG-provided fields (user_id, first_name, last_name, username, language_code)
- HMAC-SHA256 validation per request, no session tokens stored
- No phone number, no contacts, no message history, no device IDs, no tracking

No issues found.

---

## 4. Consent

**Status: NON-COMPLIANT (Critical)**

### Problem

Users are **NOT asked to accept Privacy Policy or Terms of Service** before data processing begins.

**Current flow:**
1. User opens Mini App
2. Frontend immediately calls `POST /api/v1/auth` → upserts user into D1
3. Data processing starts **without any consent**
4. Links to Privacy Policy and ToS only appear on Account page (after signup)

### GDPR requires (Art. 4(11), Art. 7)

- Freely given, specific, informed, unambiguous consent
- Affirmative action (opt-in)
- Clear, separate consent for different purposes
- Evidence of consent (timestamp, acceptance flag)

### Issues

1. No consent banner on first load
2. Terms/Privacy links only accessible AFTER signup
3. No consent database tracking — no `terms_accepted_at` column
4. Notification consent absent — users receive debt reminders without opt-in
5. Crypto settlement has no special consent — on-chain transfers without warning about permanence

### Recommendations

- [ ] Add consent BottomSheet on first load (before `POST /auth`):
  - "Accept our Terms and Privacy Policy to continue"
  - Checkboxes: ToS acceptance + Privacy Policy acceptance
  - [Continue] button disabled until checked
- [ ] Add DB columns: `terms_accepted_at`, `terms_accepted_version`, `privacy_accepted_at`
- [ ] Track consent via `POST /api/v1/auth/accept-consent`
- [ ] Add crypto settlement warning before first on-chain tx:
  - "This transaction is IRREVERSIBLE and PUBLIC on the blockchain"
  - "Your wallet address and amount will be permanently visible"
  - [I understand, proceed] / [Use manual settlement instead]

---

## 5. Data Retention

**Status: NON-COMPLIANT**

### Current state

- **Expenses:** deleted on group deletion, otherwise indefinite
- **Settlements:** retained indefinitely (on-chain never deleted)
- **Activity logs:** indexed, never deleted
- **Debt reminders:** deleted on user/group deletion, else indefinite
- **Image reports:** retained indefinitely
- **Deleted groups:** soft-deleted, on-chain settlements retained

Privacy Policy says "Activity logs are retained indefinitely for audit purposes" — violates Art. 5(1)(e) (storage limitation).

### Recommendations

- [ ] Define and document retention schedule:

| Data Type | Retention | Reason |
|-----------|-----------|--------|
| User Profile | Deleted immediately on account deletion | User request |
| Expenses (active groups) | Group lifetime + 7 years | Tax/accounting |
| Expense Receipts | 7 years | Tax audit trail |
| Settlements (manual) | 7 years | Accounting/dispute |
| Settlements (on-chain) | Indefinite | Blockchain immutable record |
| Activity Logs | 7 years | Audit trail |
| Debt Reminders | Deleted on user/group deletion | No separate need |
| Image Reports | 1 year | Moderation records |

- [ ] Implement periodic cleanup job (monthly):
  - Delete activity_log entries older than 7 years
  - Delete resolved image_reports older than 1 year
- [ ] Update Privacy Policy with retention schedule

---

## 6. Third-party Services

**Status: PARTIALLY COMPLIANT**

| Service | Data Sent | DPA Status |
|---------|-----------|-----------|
| Telegram Bot API | User ID, group name, amounts | Telegram ToS applies |
| TONAPI | Wallet address, tx hashes, balances | **No DPA documented** |
| open.er-api.com | Currency codes only (no PII) | No DPA needed |
| Cloudflare (D1/R2/Pages) | All data | Standard DPA |
| jsdelivr | Currency codes only | No DPA needed |

### Issues

1. **TONAPI lacks DPA documentation** — sends wallet addresses (PII), tx hashes, balance queries
2. **No audit trail** for TONAPI calls — hard to comply with data portability requests
3. **Cloudflare sub-processors not listed** in Privacy Policy

### Recommendations

- [ ] Document TONAPI data handling in Privacy Policy
- [ ] Add audit logging for TONAPI settlement verifications (sanitized)
- [ ] List Cloudflare as explicit sub-processor with DPA reference

---

## 7. Data Portability

**Status: PARTIALLY COMPLIANT**

### What exists

- `GET /groups/:id/export` — CSV export per group (expenses + settlements)
- Member-only access

### What's missing

1. No full-user data export across all groups
2. No JSON format (Art. 20 encourages "structured, commonly used, machine-readable")
3. No profile/preferences export
4. No activity log export
5. No on-chain settlement details in export

### Recommendations

- [ ] Add `GET /api/v1/users/me/data-export` returning JSON:
  - Profile (name, username, wallet, created_at)
  - All groups (name, currency, role, joined_at)
  - All expenses (amounts, descriptions, participants)
  - All settlements (amounts, status, tx_hash, commission)
  - Activity log
- [ ] Add "Export my data" button on Account page
- [ ] Document in Privacy Policy

---

## 8. Right to be Forgotten

**Status: PARTIALLY COMPLIANT**

### What works

- Account deletion pseudonymizes data (dummy user)
- Avatar deleted from R2, wallet cleared
- Profile removed from visibility

### What doesn't work

1. **On-chain settlements are PERMANENT** — tx hash, wallet addresses, amounts immutable on TON blockchain
2. **Activity logs reference dummy indefinitely** — `(Alice)` in logs is reconstructible
3. **No full data purge** for off-chain data either

### GDPR Art. 17 exceptions that may apply

- Legal obligation (tax/accounting) — supports 7-year retention
- Blockchain records — arguably "public interest" or "legitimate interest", but stretching it

### Recommendations

- [ ] Update Privacy Policy Right to be Forgotten section:
  - What CAN be deleted (profile, memberships, images)
  - What CANNOT be deleted (on-chain settlements — permanent, public)
  - How data is protected after deletion
- [ ] Add blockchain permanence warning before first on-chain settlement
- [ ] Use `(Deleted User)` instead of `(OriginalName)` for dummy display names

---

## 9. Security

**Status: COMPLIANT**

### Strengths

- Stateless HMAC-SHA256 auth per request (no session hijacking)
- 24h auth_date max age
- Membership checks on every group endpoint
- HTTPS enforced (Cloudflare)
- D1 encryption at rest
- R2 images served via Worker (access-controlled)
- EXIF stripped client-side
- Zod validation on all inputs
- `AbortSignal.timeout()` on all external I/O

### Gaps

1. **No rate limiting** — export, feedback, settlement endpoints could be spammed
2. **TONAPI_KEY exposure risk** — if leaked, can enumerate settlement history
3. **No API key rotation policy**

### Recommendations

- [ ] Add per-user rate limiting (export: 5/hr, feedback: 10/day, settlement confirm: 30/hr)
- [ ] Use Cloudflare Secrets for API keys
- [ ] Document key rotation policy

---

## 10. Terms of Service

**Status: COMPLIANT**

`docs/terms-of-service.md` covers:

- Acceptance & governing law
- Account responsibility
- Acceptable use (no fraud, laundering, harassment)
- User content ownership
- Expense tracking disclaimer
- On-chain settlement disclaimer (irreversible, commissions, non-refundable gas)
- Placeholder member rules
- Availability warranty disclaimer
- Limitation of liability
- Changes to terms

### Minor gaps

1. No explicit consent enforcement before signup (see Section 4)
2. ToS doesn't reference Privacy Policy
3. No indemnity clause

### Recommendations

- [ ] Add: "By accepting these Terms, you also accept our Privacy Policy"
- [ ] Add indemnity clause for on-chain settlement disputes

---

## Priority Action Plan

### CRITICAL (implement immediately)

- [ ] **Consent flow** — BottomSheet on first load with PP+ToS checkboxes + `terms_accepted_at` DB column
- [ ] **Data retention policy** — define schedule, add to Privacy Policy
- [ ] **Blockchain data warning** — explicit warning before first on-chain settlement
- [ ] **Privacy Policy legal basis** — add explicit Art. 6(1) references

### HIGH (within 30 days)

- [ ] **Full data export** — `GET /users/me/data-export` (JSON) + Account page button
- [ ] **Anonymous dummy names** — `(Deleted User)` instead of `(OriginalName)`
- [ ] **TONAPI DPA** — document in Privacy Policy
- [ ] **Rate limiting** — per-user limits on export/feedback/settlement endpoints

### MEDIUM (within 90 days)

- [ ] Cleanup dummy users with zero memberships
- [ ] Audit logging for TONAPI calls
- [ ] Consent version tracking
- [ ] Periodic data cleanup job (7-year activity log purge)

### LOW (future)

- [ ] Separate crypto settlement consent opt-in
- [ ] DPA with Cloudflare documented
- [ ] DPIA for blockchain settlement
- [ ] International data transfers section in Privacy Policy
