import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseXmlFeed } from '../src/feedAdapters';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseXmlFeed — cloudflare-workers-sdk (real Atom)', () => {
  it('parses entries with correct shape', () => {
    const xml = fixture('cloudflare-workers-sdk.atom');
    const entries = parseXmlFeed(xml);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(25);
    const first = entries[0];
    expect(typeof first.id).toBe('string');
    expect(first.id).toBeTruthy();
    expect(typeof first.title).toBe('string');
    expect(first.title).toBeTruthy();
    expect(typeof first.link).toBe('string');
    expect(first.link).toMatch(/^https?:\/\//);
    expect(typeof first.updated).toBe('string');
    expect(typeof first.summary).toBe('string');
    expect(typeof first.raw).toBe('string');
    expect(first.raw.length).toBeGreaterThan(0);
  });

  it('extracts link href from Atom <link rel="alternate"> attribute', () => {
    const xml = fixture('cloudflare-workers-sdk.atom');
    const entries = parseXmlFeed(xml);
    for (const entry of entries) {
      expect(entry.link).toMatch(/^https:\/\/github\.com\/cloudflare\/workers-sdk/);
    }
  });

  it('sorts entries descending by updated timestamp', () => {
    const xml = fixture('cloudflare-workers-sdk.atom');
    const entries = parseXmlFeed(xml);
    for (let i = 1; i < entries.length; i++) {
      if (entries[i - 1].updated && entries[i].updated) {
        expect(entries[i - 1].updated >= entries[i].updated).toBe(true);
      }
    }
  });
});

describe('parseXmlFeed — n8n (real Atom)', () => {
  it('parses multiple entries within the 25-entry cap', () => {
    const xml = fixture('n8n.atom');
    const entries = parseXmlFeed(xml);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(25);
  });

  it('extracts HTML content as plain-text summary', () => {
    const xml = fixture('n8n.atom');
    const entries = parseXmlFeed(xml);
    const withSummary = entries.filter(e => e.summary.length > 0);
    expect(withSummary.length).toBeGreaterThan(0);
    // Summary should not contain raw HTML tags (stripped)
    for (const entry of withSummary) {
      expect(entry.summary).not.toMatch(/<[a-zA-Z]+[\s>]/);
    }
  });
});

describe('parseXmlFeed — malformed (tolerance tests)', () => {
  it('does not throw on malformed input', () => {
    expect(() => parseXmlFeed(fixture('malformed.atom'))).not.toThrow();
  });

  it('falls back to link href when <id> is missing', () => {
    const entries = parseXmlFeed(fixture('malformed.atom'));
    const noIdEntry = entries.find(e => e.link === 'https://example.com/no-id');
    expect(noIdEntry).toBeDefined();
    expect(noIdEntry!.id).toBe('https://example.com/no-id');
  });

  it('returns empty string for missing <updated>', () => {
    const entries = parseXmlFeed(fixture('malformed.atom'));
    const noUpdEntry = entries.find(e => e.link === 'https://example.com/no-updated');
    expect(noUpdEntry).toBeDefined();
    expect(noUpdEntry!.updated).toBe('');
  });

  it('truncates summary to at most 800 chars', () => {
    const entries = parseXmlFeed(fixture('malformed.atom'));
    for (const entry of entries) {
      expect(entry.summary.length).toBeLessThanOrEqual(800);
    }
  });

  it('strips HTML tags from <content type="html"> for summary', () => {
    const entries = parseXmlFeed(fixture('malformed.atom'));
    const htmlEntry = entries.find(e => e.link === 'https://example.com/html-content');
    expect(htmlEntry).toBeDefined();
    expect(htmlEntry!.summary).not.toMatch(/<[a-zA-Z]+/);
    expect(htmlEntry!.summary).toContain('Breaking Change');
  });
});

describe('parseXmlFeed — inline XML (unit)', () => {
  it('handles RSS <item> format', () => {
    const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test RSS</title>
    <item>
      <guid>https://example.com/rss-1</guid>
      <title>RSS entry one</title>
      <link>https://example.com/rss-1</link>
      <pubDate>Thu, 01 May 2026 00:00:00 GMT</pubDate>
      <description>RSS description text.</description>
    </item>
    <item>
      <guid>https://example.com/rss-2</guid>
      <title>RSS entry two</title>
      <link>https://example.com/rss-2</link>
      <pubDate>Wed, 30 Apr 2026 00:00:00 GMT</pubDate>
      <description>Second RSS entry.</description>
    </item>
  </channel>
</rss>`;
    const entries = parseXmlFeed(rss);
    expect(entries.length).toBe(2);
    expect(entries[0].title).toBe('RSS entry one');
    expect(entries[0].link).toBe('https://example.com/rss-1');
    expect(entries[0].summary).toBe('RSS description text.');
  });

  it('respects 25-entry hard cap', () => {
    const entryBlocks = Array.from({ length: 30 }, (_, i) => `
  <entry>
    <id>urn:entry-${i}</id>
    <updated>2026-0${String(Math.floor(i / 10) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z</updated>
    <link href="https://example.com/${i}"/>
    <title>Entry ${i}</title>
  </entry>`).join('');
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">${entryBlocks}</feed>`;
    const entries = parseXmlFeed(xml);
    expect(entries.length).toBe(25);
  });
});
