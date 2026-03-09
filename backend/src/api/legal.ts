import { Hono } from 'hono';
import { marked } from 'marked';
import type { Env } from '../env';
import privacyMd from '../../../docs/privacy-policy.md';
import termsMd from '../../../docs/terms-of-service.md';

const app = new Hono<{ Bindings: Env }>();

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title} — Splitogram</title>
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
      code { background: #2a2a2a; }
    }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    h2 { font-size: 1.15rem; margin-top: 28px; margin-bottom: 10px; }
    h3 { font-size: 1rem; margin-top: 20px; margin-bottom: 8px; }
    p { margin-bottom: 12px; }
    ul { margin-bottom: 12px; padding-left: 24px; }
    li { margin-bottom: 4px; }
    strong { font-weight: 600; }
    em { font-style: italic; color: #666; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
    @media (prefers-color-scheme: dark) { em { color: #999; } }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

// Convert once at startup (module-level), not per request
const privacyHtml = layout('Privacy Policy', marked.parse(privacyMd) as string);
const termsHtml = layout('Terms of Service', marked.parse(termsMd) as string);

app.get('/privacy', (c) => c.html(privacyHtml));
app.get('/terms', (c) => c.html(termsHtml));

export { app as legalApp };
