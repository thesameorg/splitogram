# Privacy Policy

**Splitogram — Telegram Mini App for Group Expense Splitting**

_Last updated: March 2026_

## 1. Who We Are

Splitogram is a Telegram Mini App operated by Quberas ("we", "us", "our"). This policy explains how we collect, use, and protect your data when you use Splitogram.

## 2. Data We Collect

### 2.1 Data from Telegram

When you open Splitogram, Telegram provides us with:

- **Telegram user ID** — unique numeric identifier
- **Display name** (first name, last name)
- **Username** (if set)
- **Language code** — for interface localization
- **Profile photo URL** — for display purposes only

We do not have access to your phone number, contacts, or message history.

### 2.2 Data You Provide

- **Group names** and invite codes you create
- **Expense descriptions and amounts** you enter
- **Settlement records** between group members
- **Profile avatar** and **group avatar** images you upload
- **Receipt images** attached to expenses
- **Feedback messages** and attachments you send through the app
- **TON wallet address** if you connect a wallet for on-chain settlement

### 2.3 Data We Generate

- **Activity logs** — records of actions within groups (expense created, settlement completed, member joined/left)
- **Debt calculations** — computed balances between group members
- **Exchange rates** — cached currency conversion rates

## 3. How We Use Your Data

We use your data exclusively to:

- Provide the expense-splitting service (create groups, track expenses, calculate balances, process settlements)
- Send you notifications via Telegram bot (expense updates, settlement confirmations, debt reminders)
- Display your name and avatar to other group members
- Localize the interface to your preferred language
- Process on-chain USDT settlements when you initiate them
- Respond to feedback and support requests
- Monitor service health and prevent abuse (admin dashboard, usage metrics)

We do **not**:

- Sell your data to third parties
- Use your data for advertising or profiling
- Share your data outside of the groups you belong to
- Track your activity across other apps or websites

## 4. Data Storage and Security

- All data is stored on **Cloudflare infrastructure** (D1 database, R2 object storage) within Cloudflare's global network
- Images (avatars, receipts) are stored in Cloudflare R2 with immutable caching
- Authentication uses **stateless HMAC verification** of Telegram's `initData` — we do not store sessions, passwords, or tokens
- On-chain settlement data (transaction hashes, wallet addresses) is recorded for verification purposes
- We do not store private keys or wallet mnemonics

## 5. Data Sharing

Your data is visible to:

- **Group members** — can see your name, avatar, expenses, and balances within shared groups
- **Telegram Bot API** — used to send notifications and process webhook events
- **TONAPI** — used to verify on-chain transactions (only transaction hashes and wallet addresses)
- **Exchange rate API** (open.er-api.com) — no personal data is sent, only currency pair requests

We may disclose data if required by law or to protect the safety of our users.

## 6. Data Retention

- Your account data persists as long as you use the service
- Group data persists as long as the group exists
- Activity logs are retained indefinitely for audit purposes
- Uploaded images are deleted when the associated entity is deleted (expense, group, or user avatar updated)
- You can delete your expenses and leave groups at any time

## 7. Your Rights

You have the right to:

- **Access** your data — visible in the app (groups, expenses, balances, activity)
- **Correct** your data — edit your display name and avatar in Account settings
- **Delete** your expenses and settlements within groups
- **Leave** any group, removing your membership
- **Mute** notifications per group
- **Request** full data export or account deletion by contacting us

## 8. Children

Splitogram is not intended for users under 13 years of age. We do not knowingly collect data from children.

## 9. Changes to This Policy

We may update this policy from time to time. Material changes will be communicated through the app or Telegram bot.

## 10. Contact

For privacy-related questions or data requests, use the **Feedback** feature in the app (Account → Send Feedback) or contact us through our Telegram bot.
