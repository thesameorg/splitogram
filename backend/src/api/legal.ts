import { Hono } from 'hono';
import type { Env } from '../env';

const app = new Hono<{ Bindings: Env }>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} — Splitogram</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 20px 48px;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e0e0e0; background: #1a1a1a; }
      a { color: #6cb4ff; }
      h1, h2, h3 { color: #f0f0f0; }
    }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 4px; }
    .updated { color: #999; font-size: 0.85rem; font-style: italic; margin-bottom: 28px; }
    h2 { font-size: 1.15rem; margin-top: 28px; margin-bottom: 10px; }
    h3 { font-size: 1rem; margin-top: 20px; margin-bottom: 8px; }
    p { margin-bottom: 12px; }
    ul { margin-bottom: 12px; padding-left: 24px; }
    li { margin-bottom: 4px; }
    strong { font-weight: 600; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
    @media (prefers-color-scheme: dark) {
      .subtitle { color: #aaa; }
      .updated { color: #888; }
      code { background: #2a2a2a; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

app.get('/privacy', (c) => {
  const html = layout(
    'Privacy Policy',
    `
<h1>Privacy Policy</h1>
<p class="subtitle"><strong>Splitogram</strong> — Telegram Mini App for Group Expense Splitting</p>
<p class="updated">Last updated: March 2026</p>

<h2>1. Who We Are</h2>
<p>Splitogram is a Telegram Mini App operated by Quberas ("we", "us", "our"). This policy explains how we collect, use, and protect your data when you use Splitogram.</p>

<h2>2. Data We Collect</h2>

<h3>2.1 Data from Telegram</h3>
<p>When you open Splitogram, Telegram provides us with:</p>
<ul>
  <li><strong>Telegram user ID</strong> — unique numeric identifier</li>
  <li><strong>Display name</strong> (first name, last name)</li>
  <li><strong>Username</strong> (if set)</li>
  <li><strong>Language code</strong> — for interface localization</li>
  <li><strong>Profile photo URL</strong> — for display purposes only</li>
</ul>
<p>We do not have access to your phone number, contacts, or message history.</p>

<h3>2.2 Data You Provide</h3>
<ul>
  <li><strong>Group names</strong> and invite codes you create</li>
  <li><strong>Expense descriptions and amounts</strong> you enter</li>
  <li><strong>Settlement records</strong> between group members</li>
  <li><strong>Profile avatar</strong> and <strong>group avatar</strong> images you upload</li>
  <li><strong>Receipt images</strong> attached to expenses</li>
  <li><strong>Feedback messages</strong> and attachments you send through the app</li>
  <li><strong>TON wallet address</strong> if you connect a wallet for on-chain settlement</li>
</ul>

<h3>2.3 Data We Generate</h3>
<ul>
  <li><strong>Activity logs</strong> — records of actions within groups (expense created, settlement completed, member joined/left)</li>
  <li><strong>Debt calculations</strong> — computed balances between group members</li>
  <li><strong>Exchange rates</strong> — cached currency conversion rates</li>
</ul>

<h2>3. How We Use Your Data</h2>
<p>We use your data exclusively to:</p>
<ul>
  <li>Provide the expense-splitting service (create groups, track expenses, calculate balances, process settlements)</li>
  <li>Send you notifications via Telegram bot (expense updates, settlement confirmations, debt reminders)</li>
  <li>Display your name and avatar to other group members</li>
  <li>Localize the interface to your preferred language</li>
  <li>Process on-chain USDT settlements when you initiate them</li>
  <li>Respond to feedback and support requests</li>
  <li>Monitor service health and prevent abuse</li>
</ul>
<p>We do <strong>not</strong>:</p>
<ul>
  <li>Sell your data to third parties</li>
  <li>Use your data for advertising or profiling</li>
  <li>Share your data outside of the groups you belong to</li>
  <li>Track your activity across other apps or websites</li>
</ul>

<h2>4. Data Storage and Security</h2>
<ul>
  <li>All data is stored on <strong>Cloudflare infrastructure</strong> (D1 database, R2 object storage) within Cloudflare's global network</li>
  <li>Images (avatars, receipts) are stored in Cloudflare R2 with immutable caching</li>
  <li>Authentication uses <strong>stateless HMAC verification</strong> of Telegram's <code>initData</code> — we do not store sessions, passwords, or tokens</li>
  <li>On-chain settlement data (transaction hashes, wallet addresses) is recorded for verification purposes</li>
  <li>We do not store private keys or wallet mnemonics</li>
</ul>

<h2>5. Data Sharing</h2>
<p>Your data is visible to:</p>
<ul>
  <li><strong>Group members</strong> — can see your name, avatar, expenses, and balances within shared groups</li>
  <li><strong>Telegram Bot API</strong> — used to send notifications and process webhook events</li>
  <li><strong>TONAPI</strong> — used to verify on-chain transactions (only transaction hashes and wallet addresses)</li>
  <li><strong>Exchange rate API</strong> (open.er-api.com) — no personal data is sent, only currency pair requests</li>
</ul>
<p>We may disclose data if required by law or to protect the safety of our users.</p>

<h2>6. Data Retention</h2>
<ul>
  <li>Your account data persists as long as you use the service</li>
  <li>Group data persists as long as the group exists</li>
  <li>Activity logs are retained indefinitely for audit purposes</li>
  <li>Uploaded images are deleted when the associated entity is deleted</li>
  <li>You can delete your expenses and leave groups at any time</li>
</ul>

<h2>7. Your Rights</h2>
<p>You have the right to:</p>
<ul>
  <li><strong>Access</strong> your data — visible in the app (groups, expenses, balances, activity)</li>
  <li><strong>Correct</strong> your data — edit your display name and avatar in Account settings</li>
  <li><strong>Delete</strong> your expenses and settlements within groups</li>
  <li><strong>Leave</strong> any group, removing your membership</li>
  <li><strong>Mute</strong> notifications per group</li>
  <li><strong>Request</strong> full data export or account deletion by contacting us</li>
</ul>

<h2>8. Children</h2>
<p>Splitogram is not intended for users under 13 years of age. We do not knowingly collect data from children.</p>

<h2>9. Changes to This Policy</h2>
<p>We may update this policy from time to time. Material changes will be communicated through the app or Telegram bot.</p>

<h2>10. Contact</h2>
<p>For privacy-related questions or data requests, use the <strong>Feedback</strong> feature in the app (Account → Send Feedback) or contact us through our Telegram bot.</p>
`,
  );
  return c.html(html);
});

app.get('/terms', (c) => {
  const html = layout(
    'Terms of Service',
    `
<h1>Terms of Service</h1>
<p class="subtitle"><strong>Splitogram</strong> — Telegram Mini App for Group Expense Splitting</p>
<p class="updated">Last updated: March 2026</p>

<h2>1. Acceptance</h2>
<p>By using Splitogram ("the App"), you agree to these Terms of Service. If you do not agree, do not use the App. The App is a Telegram Mini App — by using it, you also agree to <a href="https://telegram.org/tos">Telegram's Terms of Service</a> and <a href="https://telegram.org/tos/mini-apps">Mini Apps Terms</a>.</p>

<h2>2. What Splitogram Does</h2>
<p>Splitogram helps groups of people track shared expenses and settle debts. The App allows you to:</p>
<ul>
  <li>Create groups and invite members via Telegram</li>
  <li>Record expenses and split them among participants (equal, percentage, or manual splits)</li>
  <li>Track balances and simplified debts between group members</li>
  <li>Settle debts manually or via on-chain USDT transfers on the TON blockchain</li>
  <li>View activity history and group statistics</li>
</ul>

<h2>3. Your Account</h2>
<ul>
  <li>Your Splitogram account is tied to your Telegram account</li>
  <li>You are responsible for all activity under your account</li>
  <li>You must not impersonate other users or create misleading placeholder member names</li>
  <li>We may suspend or terminate accounts that violate these terms</li>
</ul>

<h2>4. Acceptable Use</h2>
<p>You agree <strong>not</strong> to:</p>
<ul>
  <li>Use the App for money laundering, fraud, or any illegal activity</li>
  <li>Submit false or misleading expense records</li>
  <li>Upload offensive, illegal, or infringing content (avatars, receipts, descriptions)</li>
  <li>Abuse the notification or reminder system to harass other users</li>
  <li>Attempt to exploit, reverse-engineer, or interfere with the App's infrastructure</li>
  <li>Use automated tools or bots to interact with the App (beyond the official Telegram bot)</li>
</ul>

<h2>5. User Content</h2>
<ul>
  <li>You retain ownership of content you create (expense descriptions, images, group names)</li>
  <li>You grant us a license to store, display, and transmit your content as necessary to operate the App</li>
  <li>We may remove content that violates these terms or applicable law</li>
  <li>Other group members can view your content within shared groups</li>
  <li>Reported content may be reviewed by an administrator and removed if it violates these terms</li>
</ul>

<h2>6. Expense Tracking and Settlements</h2>
<ul>
  <li><strong>Splitogram is a tracking tool, not a financial institution.</strong> We record what users enter — we do not verify the accuracy of expense amounts or descriptions</li>
  <li>Debt calculations are based on user-entered data. We are not responsible for disputes between group members about actual amounts owed</li>
  <li><strong>Manual settlements</strong> ("Mark as Settled") are recorded based on user confirmation. We do not verify that actual payment occurred</li>
  <li>Settlement amounts can be edited by either party (debtor or creditor). Both parties should verify amounts before confirming</li>
  <li>Currency amounts are stored in micro-units (integers). Minor rounding differences may occur during display</li>
</ul>

<h2>7. On-Chain Settlements (TON Blockchain)</h2>
<ul>
  <li>On-chain USDT settlements are processed via a smart contract on the TON blockchain</li>
  <li><strong>Blockchain transactions are irreversible.</strong> Once confirmed, we cannot reverse or modify an on-chain settlement</li>
  <li>A commission of 1% (minimum 0.1 USDT, maximum 1.0 USDT) is deducted from each on-chain settlement</li>
  <li>Gas fees (TON network fees) are paid by the sender and are non-refundable</li>
  <li>We are not responsible for losses due to incorrect wallet addresses, network congestion, or blockchain downtime</li>
  <li>Exchange rates for currency-to-USDT conversion are indicative and may differ from actual market rates at the time of settlement</li>
  <li>You are solely responsible for complying with any tax obligations arising from on-chain transactions</li>
</ul>

<h2>8. Placeholder Members</h2>
<ul>
  <li>Group administrators can create placeholder members for people not yet on the App</li>
  <li>Placeholders participate in expense tracking and manual settlements only (no on-chain)</li>
  <li>Real users can claim a placeholder to inherit its expenses and balances</li>
  <li>Claiming a placeholder is irreversible — all associated data is transferred permanently</li>
</ul>

<h2>9. Privacy</h2>
<p>Your use of the App is also governed by our <a href="/privacy">Privacy Policy</a>. Key points:</p>
<ul>
  <li>We collect data from Telegram (user ID, name, username, language) and data you provide (expenses, images, groups)</li>
  <li>Data is stored on Cloudflare infrastructure</li>
  <li>We do not sell your data or use it for advertising</li>
</ul>

<h2>10. Availability and Warranties</h2>
<ul>
  <li>The App is provided <strong>"as is"</strong> without warranties of any kind</li>
  <li>We do not guarantee uninterrupted or error-free service</li>
  <li>We may modify, suspend, or discontinue the App at any time</li>
  <li>We are not liable for data loss — while we take reasonable measures to protect your data, you should keep your own records of important financial information</li>
</ul>

<h2>11. Limitation of Liability</h2>
<p>To the maximum extent permitted by law:</p>
<ul>
  <li>We are not liable for any indirect, incidental, or consequential damages</li>
  <li>We are not responsible for disputes between group members</li>
  <li>We are not liable for losses from on-chain transactions, including incorrect amounts, wrong addresses, or smart contract bugs</li>
  <li>Our total liability is limited to the amount of commissions you have paid us in the preceding 12 months</li>
</ul>

<h2>12. Changes</h2>
<p>We may update these terms at any time. Continued use after changes constitutes acceptance. Material changes will be communicated through the App or Telegram bot.</p>

<h2>13. Governing Law</h2>
<p>These terms are governed by the laws applicable to the jurisdiction of the operator. Disputes will be resolved through good-faith negotiation first.</p>

<h2>14. Contact</h2>
<p>For questions about these terms, use the <strong>Feedback</strong> feature in the app (Account → Send Feedback) or contact us through our Telegram bot.</p>
`,
  );
  return c.html(html);
});

export { app as legalApp };
