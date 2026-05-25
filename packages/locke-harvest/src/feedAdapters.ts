export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  updated: string;
  summary: string;
  raw: string;
}

export async function fetchAtomFeed(url: string): Promise<FeedEntry[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'locke-changelog-watcher/1.0' }
  });
  if (!response.ok) {
    throw new Error(`fetchAtomFeed: ${response.status} ${url}`);
  }
  const xml = await response.text();
  return parseXmlFeed(xml);
}

export function parseXmlFeed(xml: string): FeedEntry[] {
  const isAtom = /<entry[\s>]/.test(xml);
  const tag = isAtom ? 'entry' : 'item';

  const blockRegex = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'g');
  const blocks = xml.match(blockRegex) ?? [];

  const entries: FeedEntry[] = blocks.map(block => {
    const id = extractText(block, 'id') ?? extractText(block, 'guid') ?? '';
    const title = extractInnerText(block, 'title') ?? '';
    const link = extractLink(block);
    const updated = extractText(block, 'updated') ?? extractText(block, 'pubDate') ?? '';
    const summary = extractSummary(block).slice(0, 800);

    return {
      id: id || link,
      title,
      link,
      updated,
      summary,
      raw: block
    };
  });

  entries.sort((a, b) => {
    const ta = a.updated ? Date.parse(a.updated) : NaN;
    const tb = b.updated ? Date.parse(b.updated) : NaN;
    const taOk = Number.isFinite(ta);
    const tbOk = Number.isFinite(tb);
    if (!taOk && !tbOk) return 0;
    if (!taOk) return 1;
    if (!tbOk) return -1;
    return tb - ta;
  });

  return entries.slice(0, 25);
}

function extractText(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  if (!m) return undefined;
  const inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return inner || undefined;
}

function extractInnerText(block: string, tag: string): string | undefined {
  const raw = extractText(block, tag);
  return raw !== undefined ? decodeEntities(raw) : undefined;
}

function extractLink(block: string): string {
  // Atom: <link ... href="..."/>
  const hrefMatch = /<link[^>]+href=["']([^"']+)["'][^>]*\/?>/.exec(block);
  if (hrefMatch) return hrefMatch[1];
  // RSS: <link>url</link>
  return extractText(block, 'link') ?? '';
}

function extractSummary(block: string): string {
  for (const tag of ['summary', 'content', 'description']) {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
    if (!m) continue;
    const inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    if (!inner) continue;
    const text = decodeEntities(inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
