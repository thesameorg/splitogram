import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { marked } from 'marked';

const docsDir = resolve(__dirname, '../../docs');
const privacyMd = readFileSync(resolve(docsDir, 'privacy-policy.md'), 'utf-8');
const termsMd = readFileSync(resolve(docsDir, 'terms-of-service.md'), 'utf-8');

describe('legal pages', () => {
  it('privacy policy MD contains required sections', () => {
    expect(privacyMd).toContain('# Privacy Policy');
    expect(privacyMd).toContain('Data We Collect');
    expect(privacyMd).toContain('Data Sharing');
    expect(privacyMd).toContain('Your Rights');
    expect(privacyMd).toContain('Contact');
  });

  it('terms of service MD contains required sections', () => {
    expect(termsMd).toContain('# Terms of Service');
    expect(termsMd).toContain('Acceptable Use');
    expect(termsMd).toContain('On-Chain Settlements');
    expect(termsMd).toContain('Limitation of Liability');
    expect(termsMd).toContain('Contact');
  });

  it('privacy policy renders valid HTML', () => {
    const html = marked.parse(privacyMd) as string;
    expect(html).toContain('<h1>Privacy Policy</h1>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>');
  });

  it('terms of service renders valid HTML with links', () => {
    const html = marked.parse(termsMd) as string;
    expect(html).toContain('<h1>Terms of Service</h1>');
    expect(html).toContain('href="https://telegram.org/tos"');
    expect(html).toContain('href="/privacy"');
  });
});
