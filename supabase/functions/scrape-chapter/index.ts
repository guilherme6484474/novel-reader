import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractTextFromNextData(obj: unknown, depth = 0): string {
  if (depth > 15 || !obj) return '';
  if (typeof obj === 'string') {
    // Look for strings that seem like chapter content (long text with sentences)
    const cleaned = cleanHtml(obj);
    if (cleaned.length > 200) return cleaned;
    return '';
  }
  if (Array.isArray(obj)) {
    // Collect all long text strings from array
    const parts: string[] = [];
    for (const item of obj) {
      const text = extractTextFromNextData(item, depth + 1);
      if (text) parts.push(text);
    }
    if (parts.length > 0) return parts.join('\n\n');
    return '';
  }
  if (typeof obj === 'object' && obj !== null) {
    // Prioritize keys likely to contain chapter text
    const priorityKeys = ['content', 'text', 'body', 'chapter', 'chapterContent', 'rawText', 'paragraphs', 'data', 'result', 'translatedText', 'original'];
    const record = obj as Record<string, unknown>;
    for (const key of priorityKeys) {
      if (key in record) {
        const text = extractTextFromNextData(record[key], depth + 1);
        if (text && text.length > 200) return text;
      }
    }
    // Search all keys
    let longest = '';
    for (const val of Object.values(record)) {
      const text = extractTextFromNextData(val, depth + 1);
      if (text.length > longest.length) longest = text;
    }
    return longest;
  }
  return '';
}

function extractContent(html: string, hostname: string): string {
  // Strip script/style/noscript blocks early so their contents (e.g. JS template
  // literals containing <article>/<div> markup) cannot be matched by the
  // selectors below. This prevents extracting comment-widget templates
  // (e.g. NovelBin) instead of the actual chapter text.
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Site-specific selectors first, then generic fallbacks
  const siteSelectors: Record<string, RegExp[]> = {
    'royalroad.com': [
      /class="[^"]*chapter-inner[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div\s+class="[^"]*portlet)/i,
      /class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'lightnovelpub': [
      /id="chapter-container"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'novelfull': [
      /id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chapter-c[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'freewebnovel': [
      /class="[^"]*txt[^"]*"[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div\s+class="[^"]*chapter-end|<\/div>\s*<\/div>)/i,
      /id="article"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chapter-content[0-9]*[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'webnovel.com': [
      /class="[^"]*chapter_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*cha-words[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'novelhall': [
      /id="htmlContent"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'novelbuddy': [
      /id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chapter__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'wuxiaworld': [
      /class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'scribblehub': [
      /id="chp_raw"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chp_raw[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'novelbin': [
      // chr-content contains nested <div> ad slots — capture everything up to chr-end marker.
      /id="chr-content"[^>]*>([\s\S]*?)<hr\s+class="chr-end"/i,
      /id="chr-content"[^>]*>([\s\S]*?)<\/div>\s*<hr/i,
      /id="chr-content"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chr-c[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'allnovelbin': [
      /id="chr-content"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'readlightnovel': [
      /class="[^"]*chapter-content3[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'boxnovel': [
      /class="[^"]*text-left[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'wtr-lab.com': [
      /class="[^"]*chapter-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class="[^"]*d-flex/i,
      /class="[^"]*chapter-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*chapter-wrap[^"]*card-body[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*chapter-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
    'novellive.app': [
      /class="[^"]*txt[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\s+class="chapter-end"/i,
      /class="[^"]*txt[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ],
  };

  // Try site-specific selectors
  for (const [site, selectors] of Object.entries(siteSelectors)) {
    if (hostname.includes(site)) {
      for (const sel of selectors) {
        const m = html.match(sel);
        if (m && m[1]) {
          const cleaned = cleanHtml(m[1]);
          if (cleaned.length > 100) return cleaned;
        }
      }
    }
  }

  // Generic selectors as fallback
  const genericSelectors = [
    /id="chr-content"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*chr-c[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
    /id="chp_raw"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*chapter-c(?:ontent|hapter)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*chapter-inner[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /id="content"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*text-left[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];

  for (const sel of genericSelectors) {
    const m = html.match(sel);
    if (m && m[1]) {
      const cleaned = cleanHtml(m[1]);
      if (cleaned.length > 100) return cleaned;
    }
  }

  // Fallback: Next.js __NEXT_DATA__ JSON extraction
  const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const textContent = extractTextFromNextData(nextData);
      if (textContent && textContent.length > 100) return textContent;
    } catch (e) {
      console.log('Failed to parse __NEXT_DATA__:', e);
    }
  }

  // Fallback: find the largest block of <p> tags
  const pBlocks = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  if (pBlocks.length > 3) {
    const text = pBlocks.map(p => cleanHtml(p)).join('\n\n');
    if (text.length > 200) return text;
  }

  return '';
}

function trimChapterContent(content: string, title: string, hostname: string): string {
  let trimmed = content.trim();

  if (hostname.includes('webnovel.com')) {
    // Start from the actual chapter heading when extra page chrome leaks in
    const titleIndex = title ? trimmed.indexOf(title) : -1;
    if (titleIndex > 0) {
      trimmed = trimmed.slice(titleIndex);
    }

    // Remove duplicate numeric markers and trailing site UI copied from markdown/html rendering
    trimmed = trimmed
      .replace(/^(?:\d+\s*){1,3}(?=Chapter\s+\d+)/i, '')
      // Cut everything after common Webnovel UI markers
      .replace(/\n{2,}(?:Table Of Contents|Display Options|Chapter comments|Paragraph comments|Write a review|Vote with Power Stone|You may also Like|Batch unlock chapters|Report inappropriate content|Help center|Weekly Power Status|Status de energia semanal|Weekly Energy Status|Power Stone|Fundo padr[ãa]o|unlock_batch_gear)[\s\S]*$/i, '')
      .replace(/\n{2,}(?:Advertisement|Whoops!|We might have some troubles to find out this page\.)[\s\S]*$/i, '')
      .replace(/\n{2,}get more coins[\s\S]*$/i, '')
      .trim();
  }

  if (hostname.includes('novellive.app')) {
    trimmed = trimmed
      .replace(/\n{2,}Visit and read more novel to help us update chapter quickly\.[\s\S]*$/i, '')
      .trim();
  }

  return trimmed;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    // Remove residual HTML comment closing tags (e.g. "-->")
    .replace(/^\s*-{1,3}>\s*$/gm, '')
    .replace(/\s*-->\s*/g, '')
    .replace(/window\.\w+\s*=[\s\S]*?[;\n]/g, '')
    .replace(/This (?:narrative|story|novel|chapter) has been (?:unlawfully|illegally|stolen)[\s\S]*?(?:\.|report it)/gi, '')
    .replace(/If you see (?:it|this) on Amazon[\s\S]*?report it\.?/gi, '')
    .replace(/Total\s+Respo(?:nses|stas)\s*:\s*\d+/gi, '')
    .replace(/Erro?\s+(?:ao\s+)?(?:loading|carregar)\s+comments?.*$/gim, '')
    .replace(/Error\s+loading\s+comments?.*$/gim, '')
    .replace(/Please\s+try\s+again\s+later\.?/gi, '')
    .replace(/Por\s+favor,?\s+tente\s+novamente\s+mais\s+tarde\.?/gi, '')
    .replace(/—\s*End\s+of\s+Chapter\s+\d+\s*—/gi, '')
    // Strip residual HTML attribute fragments (e.g. " id="" type="radio" ...")
    .replace(/"\s*(?:id|type|name|value|class|href|src|data-\w+)\s*=\s*"[^"]*"\s*/g, '')
    .replace(/^\s*[">}\]]\s*$/gm, '')
    .replace(/^\s*[-,.\s]{1,5}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractNavLinks(html: string, hostname: string): { next: string; prev: string } {
  let next = '';
  let prev = '';

  // Site-specific nav patterns
  const siteNavPatterns: Record<string, { next: RegExp[]; prev: RegExp[] }> = {
    'royalroad.com': {
      next: [
        /class="[^"]*btn[^"]*"[^>]*href="([^"]*)"[^>]*>\s*(?:[\s\S]*?)Next\s*(?:[\s\S]*?)Chapter/i,
        /href="([^"]*\/chapter\/\d+\/[^"]*)"[^>]*>\s*(?:[\s\S]*?)Next/i,
      ],
      prev: [
        /href="([^"]*\/chapter\/\d+\/[^"]*)"[^>]*>\s*(?:[\s\S]*?)Previous/i,
      ],
    },
    'lightnovelpub': {
      next: [
        /class="[^"]*next[_-]?chap[^"]*"[^>]*href="([^"]*)"/i,
        /href="([^"]*)"[^>]*class="[^"]*next[_-]?chap/i,
        /id="next_chap"[^>]*href="([^"]*)"/i,
      ],
      prev: [
        /class="[^"]*prev[_-]?chap[^"]*"[^>]*href="([^"]*)"/i,
        /id="prev_chap"[^>]*href="([^"]*)"/i,
      ],
    },
    'scribblehub': {
      next: [
        /class="[^"]*btn-next[^"]*"[^>]*href="([^"]*)"/i,
      ],
      prev: [
        /class="[^"]*btn-prev[^"]*"[^>]*href="([^"]*)"/i,
      ],
    },
    'wtr-lab.com': {
      next: [
        /href="([^"]*\/chapter-\d+[^"]*)"[^>]*>\s*(?:[\s\S]*?)Next/i,
        /class="[^"]*next[^"]*"[^>]*href="([^"]*)"/i,
      ],
      prev: [
        /href="([^"]*\/chapter-\d+[^"]*)"[^>]*>\s*(?:[\s\S]*?)Prev/i,
        /class="[^"]*prev[^"]*"[^>]*href="([^"]*)"/i,
      ],
    },
    'novellive.app': {
      next: [
        /id="next"[^>]*href="([^"]*)"/i,
      ],
      prev: [
        /id="prev"[^>]*href="([^"]*)"/i,
      ],
    },
    'freewebnovel': {
      next: [
        /href="([^"]*)"[^>]*id="next_url"/i,
        /id="next_url"[^>]*href="([^"]*)"/i,
        /href="([^"]*\/chapter-\d+[^"]*)"[^>]*title="Read Next chapter"/i,
      ],
      prev: [
        /href="([^"]*)"[^>]*id="prev_url"/i,
        /id="prev_url"[^>]*href="([^"]*)"/i,
      ],
    },
    'novelbin': {
      next: [
        /<a\b(?=[^>]*data-chapter-nav="next")(?=[^>]*data-chapter-url="([^"]+)")[^>]*>/i,
        /<a\b(?=[^>]*data-chapter-nav="next")(?=[^>]*href="([^"]+)")[^>]*>/i,
        /<a\b(?=[^>]*class="[^"]*js-chapter-nav[^"]*")(?=[^>]*data-chapter-nav="next")(?=[^>]*href="([^"]+)")[^>]*>/i,
      ],
      prev: [
        /<a\b(?=[^>]*data-chapter-nav="prev")(?=[^>]*data-chapter-url="([^"]+)")[^>]*>/i,
        /<a\b(?=[^>]*data-chapter-nav="prev")(?=[^>]*href="([^"]+)")[^>]*>/i,
        /<a\b(?=[^>]*class="[^"]*js-chapter-nav[^"]*")(?=[^>]*data-chapter-nav="prev")(?=[^>]*href="([^"]+)")[^>]*>/i,
      ],
    },
  };
  for (const [site, patterns] of Object.entries(siteNavPatterns)) {
    if (hostname.includes(site)) {
      console.log(`Nav: matched site pattern '${site}'`);
      for (const p of patterns.next) {
        const m = html.match(p);
        if (m) { next = m[1]; console.log(`Nav next matched: ${next}`); break; }
      }
      for (const p of patterns.prev) {
        const m = html.match(p);
        if (m) { prev = m[1]; console.log(`Nav prev matched: ${prev}`); break; }
      }
      if (next || prev) return { next, prev };
    }
  }

  // Generic nav patterns
  const nextPatterns = [
    /id="next_chap"[^>]*href="([^"]*)"/i,
    /class="[^"]*next[_-]?chap[^"]*"[^>]*href="([^"]*)"/i,
    /href="([^"]*)"[^>]*id="next_chap"/i,
    /href="([^"]*)"[^>]*>\s*Next\s*(?:Chapter)?\s*</i,
    /class="[^"]*btn-next[^"]*"[^>]*href="([^"]*)"/i,
    /href="([^"]*chapter-\d+[^"]*)"[^>]*class="[^"]*next/i,
    /class="[^"]*nav-next[^"]*"[^>]*href="([^"]*)"/i,
    /href="([^"]*)"[^>]*class="[^"]*next_page/i,
  ];

  const prevPatterns = [
    /id="prev_chap"[^>]*href="([^"]*)"/i,
    /class="[^"]*prev[_-]?chap[^"]*"[^>]*href="([^"]*)"/i,
    /href="([^"]*)"[^>]*id="prev_chap"/i,
    /href="([^"]*)"[^>]*>\s*Prev(?:ious)?\s*(?:Chapter)?\s*</i,
    /class="[^"]*btn-prev[^"]*"[^>]*href="([^"]*)"/i,
    /class="[^"]*nav-prev[^"]*"[^>]*href="([^"]*)"/i,
  ];

  for (const p of nextPatterns) {
    const m = html.match(p);
    if (m) { next = m[1]; break; }
  }
  for (const p of prevPatterns) {
    const m = html.match(p);
    if (m) { prev = m[1]; break; }
  }

  return { next, prev };
}

function normalizeWebnovelSlug(slug: string): string {
  return slug.replace(/&amp;/g, '&').trim().replace(/\/$/, '');
}

function getWebnovelChapterNumber(value: string): number | null {
  const normalized = cleanHtml(value).replace(/\s+/g, ' ').trim();
  const match = normalized.match(/\bchapter\s+(\d+(?:\.\d+)?)\b/i);
  if (match) return Number(match[1]);
  return null;
}

function getWebnovelChapterId(slug: string): number | null {
  const match = normalizeWebnovelSlug(slug).match(/_(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function extractWebnovelCatalogSequence(catHtml: string): string[] {
  const anchorRegex = /<a\b[^>]*href="([^"]*\/book\/[^"]*?_\d+\/([^"]+_\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
  const items = new Map<string, { slug: string; chapterNumber: number | null; chapterId: number | null }>();

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(catHtml)) !== null) {
    const slug = normalizeWebnovelSlug(match[2]);
    const anchorHtml = match[3] ?? '';
    const chapterNumber = getWebnovelChapterNumber(anchorHtml) ?? getWebnovelChapterNumber(slug.replace(/[_-]+/g, ' '));
    const chapterId = getWebnovelChapterId(slug);

    if (!items.has(slug)) {
      items.set(slug, { slug, chapterNumber, chapterId });
      continue;
    }

    const existing = items.get(slug)!;
    if (existing.chapterNumber === null && chapterNumber !== null) {
      existing.chapterNumber = chapterNumber;
    }
    if (existing.chapterId === null && chapterId !== null) {
      existing.chapterId = chapterId;
    }
  }

  return [...items.values()]
    .sort((a, b) => {
      if (a.chapterNumber !== null && b.chapterNumber !== null && a.chapterNumber !== b.chapterNumber) {
        return a.chapterNumber - b.chapterNumber;
      }
      if (a.chapterNumber !== null && b.chapterNumber === null) return -1;
      if (a.chapterNumber === null && b.chapterNumber !== null) return 1;
      if (a.chapterId !== null && b.chapterId !== null && a.chapterId !== b.chapterId) {
        return a.chapterId - b.chapterId;
      }
      if (a.chapterId !== null && b.chapterId === null) return -1;
      if (a.chapterId === null && b.chapterId !== null) return 1;
      return a.slug.localeCompare(b.slug);
    })
    .map((item) => item.slug);
}

function extractWebnovelMainChapterSequence(catHtml: string): string[] {
  const linkRegex = /\/book\/[^"'#?]+\/(\d+_\d+)/g;
  const items = new Map<number, string>();
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(catHtml)) !== null) {
    const slug = normalizeWebnovelSlug(match[1]);
    const chapterNumber = Number(slug.split('_')[0]);
    if (!Number.isFinite(chapterNumber) || items.has(chapterNumber)) continue;
    items.set(chapterNumber, slug);
  }

  return [...items.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slug]) => slug);
}

async function handleWtrLab(url: string, parsedUrl: URL): Promise<Response> {
  return new Response(
    JSON.stringify({ 
      error: 'O site wtr-lab.com criptografa o conteúdo dos capítulos. ' +
             'Não é possível extrair o texto sem um navegador real. ' +
             'Tente usar um site alternativo como novelbin.com ou allnovelbin.net para esta novel.'
    }),
    { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function normalizeCompareUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

function getNovelbinNovelId(parsedUrl: URL): string {
  return decodeURIComponent(parsedUrl.pathname.match(/\/(?:b|novel-book)\/([^/]+)/)?.[1] || '');
}

function getNovelbinChapterNumber(value: string): number | null {
  const match = value.match(/\/c?chapter-(\d+)(?:\b|[-/?#])/i);
  return match ? Number(match[1]) : null;
}

function isBareNovelbinChapterUrl(value: string): boolean {
  return /\/c?chapter-\d+\/?(?:[?#].*)?$/i.test(value);
}

function slugifyNovelbinChapterTitle(title: string): string {
  return title
    .replace(/&amp;/g, '&')
    .replace(/[_]+/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function looksLikeNovelbinChrome(content: string): boolean {
  const head = content.slice(0, 3000).toLowerCase();
  const markers = [
    'novel list',
    'latest release',
    'hot novel',
    'completed novel',
    'most popular',
    'genre',
    'show menu',
  ];
  return markers.filter((marker) => head.includes(marker)).length >= 3;
}

function extractJinaNavLinks(md: string): { next: string; prev: string } {
  const prev = md.match(/\[Prev(?:ious)?\s+Chapter\]\(([^)\s]+)(?:\s+"[^"]*")?\)/i)?.[1]?.replace(/&amp;/g, '&') || '';
  const next = md.match(/\[Next\s+Chapter\]\(([^)\s]+)(?:\s+"[^"]*")?\)/i)?.[1]?.replace(/&amp;/g, '&') || '';
  return { next, prev };
}

function extractNovelbinCanonicalUrlFromMarkdown(md: string, chapterNumber: number): string {
  const patterns = [
    new RegExp(`\\((https?:\\/\\/[^)\\s"']*novelbin\\.com\\/b\\/[^)\\s"']*\\/chapter-${chapterNumber}-[^)\\s"']*)`, 'i'),
    new RegExp(`URL Source:\\s*(https?:\\/\\/[^\\s]+\\/chapter-${chapterNumber}-[^\\s]+)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = md.match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, '&').replace(/["')\]]+$/, '');
  }
  return '';
}

function resolveNovelbinCanonicalFromCatalogMarkdown(currentUrl: string, catalogMarkdown: string): string {
  const chapterNumber = getNovelbinChapterNumber(currentUrl);
  if (chapterNumber === null || !catalogMarkdown) return '';
  const body = catalogMarkdown.includes('Markdown Content:')
    ? catalogMarkdown.slice(catalogMarkdown.indexOf('Markdown Content:') + 'Markdown Content:'.length)
    : catalogMarkdown;
  const line = body
    .split('\n')
    .map((item) => item.trim())
    .find((item) => new RegExp(`^Chapter\\s+${chapterNumber}(?:\\b|\\s*[-:])`, 'i').test(item));
  if (!line) return '';
  try {
    const parsed = new URL(currentUrl);
    const novelId = getNovelbinNovelId(parsed);
    if (!novelId) return '';
    const pathPrefix = parsed.hostname.includes('novelbin.me') ? 'novel-book' : 'b';
    return `${parsed.origin}/${pathPrefix}/${novelId}/${slugifyNovelbinChapterTitle(line)}`;
  } catch {
    return '';
  }
}

function getNovelbinCatalogContextFromMarkdown(
  currentUrl: string,
  catalogMarkdown: string,
): { current: string; next: string; prev: string; title: string } | null {
  const chapterNumber = getNovelbinChapterNumber(currentUrl);
  if (chapterNumber === null || !catalogMarkdown) return null;
  try {
    const parsed = new URL(currentUrl);
    const novelId = getNovelbinNovelId(parsed);
    if (!novelId) return null;
    const pathPrefix = parsed.hostname.includes('novelbin.me') ? 'novel-book' : 'b';
    const body = catalogMarkdown.includes('Markdown Content:')
      ? catalogMarkdown.slice(catalogMarkdown.indexOf('Markdown Content:') + 'Markdown Content:'.length)
      : catalogMarkdown;
    const items = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^Chapter\s+\d+(?:\b|\s*[-:])/i.test(line))
      .map((title) => ({
        title,
        number: getNovelbinChapterNumber(`/${slugifyNovelbinChapterTitle(title)}`),
        url: `${parsed.origin}/${pathPrefix}/${novelId}/${slugifyNovelbinChapterTitle(title)}`,
      }));
    const index = items.findIndex((item) => item.number === chapterNumber);
    if (index === -1) return null;
    return {
      current: items[index].url,
      prev: index > 0 ? items[index - 1].url : '',
      next: index < items.length - 1 ? items[index + 1].url : '',
      title: items[index].title,
    };
  } catch {
    return null;
  }
}

async function getNovelbinCatalogContext(
  currentUrl: string,
  parsedUrl: URL,
  userAgent: string,
): Promise<{ current: string; next: string; prev: string; title: string } | null> {
  const novelId = getNovelbinNovelId(parsedUrl);
  if (!novelId) return null;

  try {
    const archiveUrl = `${parsedUrl.origin}/ajax/chapter-option?novelId=${encodeURIComponent(novelId)}`;
    const novelPathPrefix = parsedUrl.hostname.includes('novelbin.me') ? 'novel-book' : 'b';
    const novelHomeUrl = `${parsedUrl.origin}/${novelPathPrefix}/${novelId}`;
    const catalogHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': novelHomeUrl,
    };
    console.log(`NovelBin catalog lookup: ${archiveUrl}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(archiveUrl, {
      headers: catalogHeaders,
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    let catalogResp = resp;

    if (!catalogResp.ok && (catalogResp.status === 403 || catalogResp.status === 419)) {
      console.log(`NovelBin chapter catalog returned ${catalogResp.status}, warming cookies...`);
      const pageResp = await fetch(novelHomeUrl, {
        headers: { 'User-Agent': userAgent, 'Accept': catalogHeaders.Accept },
        redirect: 'follow',
      });
      const setCookie = pageResp.headers.get('set-cookie') || '';
      await pageResp.text().catch(() => '');
      const cookie = setCookie
        .split(/,(?=\s*[^;,=]+=[^;,]+)/)
        .map((part) => part.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
      if (cookie) {
        catalogResp = await fetch(archiveUrl, {
          headers: { ...catalogHeaders, Cookie: cookie },
          redirect: 'follow',
        });
      }
    }

    if (!catalogResp.ok) {
      console.log(`NovelBin chapter catalog returned ${catalogResp.status}`);
      return null;
    }

    const html = await catalogResp.text();
    const items: Array<{ url: string; number: number | null; title: string }> = [];
    const optionRegex = /<option\b[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi;
    let match: RegExpExecArray | null;
    while ((match = optionRegex.exec(html)) !== null) {
      const chapterUrl = match[1].replace(/&amp;/g, '&');
      items.push({
        url: chapterUrl,
        number: getNovelbinChapterNumber(chapterUrl),
        title: cleanHtml(match[2]).replace(/\s+/g, ' ').trim(),
      });
    }

    if (!items.length) return null;
    const normalizedCurrent = normalizeCompareUrl(currentUrl);
    const currentNumber = getNovelbinChapterNumber(currentUrl);
    let index = items.findIndex((item) => normalizeCompareUrl(item.url) === normalizedCurrent);
    if (index === -1 && currentNumber !== null) {
      index = items.findIndex((item) => item.number === currentNumber);
    }
    if (index === -1) return null;

    return {
      current: items[index].url,
      prev: index > 0 ? items[index - 1].url : '',
      next: index < items.length - 1 ? items[index + 1].url : '',
      title: items[index].title,
    };
  } catch (e) {
    console.log('NovelBin chapter catalog failed:', (e as Error).message);
    return null;
  }
}

async function getNovelbinMirrorCatalogContext(
  currentUrl: string,
  parsedUrl: URL,
  userAgent: string,
): Promise<{ current: string; next: string; prev: string; title: string } | null> {
  if (!parsedUrl.hostname.includes('novelbin.com')) return null;
  const mirrorUrl = new URL(currentUrl);
  mirrorUrl.hostname = 'novelbin.me';
  const context = await getNovelbinCatalogContext(mirrorUrl.toString(), mirrorUrl, userAgent);
  if (!context) return null;

  const normalizeHost = (value: string) => value
    .replace('https://novelbin.me/novel-book/', 'https://novelbin.com/b/')
    .replace('http://novelbin.me/novel-book/', 'https://novelbin.com/b/')
    .replace('https://novelbin.me/b/', 'https://novelbin.com/b/')
    .replace('http://novelbin.me/b/', 'https://novelbin.com/b/');

  return {
    current: normalizeHost(context.current),
    next: normalizeHost(context.next),
    prev: normalizeHost(context.prev),
    title: context.title,
  };
}

function parseJinaMarkdown(md: string, sourceUrl = '', hostname = ''): { title: string; content: string; next: string; prev: string } {
  // Jina Reader format:
  //   Title: ...
  //   URL Source: ...
  //   Markdown Content:
  //   <body>
  let title = '';
  let body = md;
  const titleMatch = md.match(/^Title:\s*(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();
  const idx = md.indexOf('Markdown Content:');
  if (idx !== -1) body = md.slice(idx + 'Markdown Content:'.length);
  const nav = extractJinaNavLinks(md);

  if (hostname.includes('novelbin')) {
    const chapterNumber = getNovelbinChapterNumber(sourceUrl);
    // Try exact chapter number first; if not found (slug number differs from
    // in-page chapter heading number, e.g. "chapter-211-chapter-11-..."),
    // fall back to any chapter heading. As a last resort, just strip the
    // top page chrome heuristically.
    const exactRegex = chapterNumber !== null
      ? new RegExp(`^##\\s*\\[[^\\]]*Chapter\\s+${chapterNumber}\\b[^\\]]*\\]\\([^)]*\\)\\s*$`, 'im')
      : null;
    const anyRegex = /^##\s*\[[^\]]*Chapter\s+\d+\b[^\]]*\]\([^)]*\)\s*$/im;
    let heading = exactRegex ? body.match(exactRegex) : null;
    if (!heading || heading.index === undefined) {
      heading = body.match(anyRegex);
    }
    if (heading && heading.index !== undefined) {
      body = body.slice(heading.index + heading[0].length);
    } else {
      console.log('Jina NovelBin markdown missing chapter heading, using heuristic strip');
      // Drop everything before the URL Source / Markdown Content markers were
      // already removed; additionally trim a known prelude block if present.
      const cutoff = body.search(/\n[A-Z][^\n]{40,}\n/);
      if (cutoff > 0 && cutoff < 4000) body = body.slice(cutoff);
    }

    const lines = body.split('\n');
    while (lines.length) {
      const line = lines[0].trim();
      if (!line || line === '* * *' || line.startsWith('[](javascript:') || /\[(?:Prev|Previous|Next)\s+Chapter\]/i.test(line)) {
        lines.shift();
        continue;
      }
      break;
    }
    body = lines.join('\n');
    const endMatch = body.search(/\n\s*(?:\* \* \*\s*)?(?:\[\]\(javascript:|\[(?:Prev|Previous|Next)\s+Chapter\]|Comments?|Chapter Comments|Commented on)\b/i);
    if (endMatch > 500) body = body.slice(0, endMatch);
  }

  // Strip markdown links/images, headers, navigation chrome
  body = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^[-*]\s+.*$/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^(?:Prev|Previous|Next)\s+Chapter.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Build paragraph-ish content
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 20);
  return { title, content: paragraphs.join('\n\n'), next: nav.next, prev: nav.prev };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    console.log('Scraping URL:', url, '| Host:', hostname);
    let canonicalUrl = url;
    let catalogContext: { current: string; next: string; prev: string; title: string } | null = null;

    // === wtr-lab.com: use internal API directly ===
    if (hostname.includes('wtr-lab.com')) {
      return await handleWtrLab(url, parsedUrl);
    }

    const fetchOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Referer': parsedUrl.origin,
      },
    };

    if (hostname.includes('novelbin')) {
      catalogContext = await getNovelbinCatalogContext(url, parsedUrl, fetchOpts.headers['User-Agent']);
      if (!catalogContext) {
        catalogContext = await getNovelbinMirrorCatalogContext(url, parsedUrl, fetchOpts.headers['User-Agent']);
      }
      if (catalogContext?.current && normalizeCompareUrl(catalogContext.current) !== normalizeCompareUrl(url)) {
        canonicalUrl = catalogContext.current;
        console.log(`NovelBin canonical chapter URL resolved: ${canonicalUrl}`);
      }
    }

    let response = await fetch(canonicalUrl, fetchOpts);
    let html = response.ok ? await response.text() : '';
    let jinaMarkdown = '';

    // Proxy list used both when direct fetch fails AND when it returns a
    // suspiciously short page (e.g. a challenge/redirect/error stub) AND
    // when the body is large but doesn't contain real chapter markup
    // (e.g. corsproxy returning a generic landing/interstitial page).
    const htmlProxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(canonicalUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(canonicalUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(canonicalUrl)}`,
    ];
    const MIN_HTML = 20000; // novelbin chapter pages are ~200kb; <20kb is a stub

    // Per-host markers that prove the response contains a real chapter page.
    const validityMarkers: Record<string, RegExp[]> = {
      'novelbin': [/id="chr-content"/i],
      'allnovelbin': [/id="chr-content"/i],
      'royalroad.com': [/chapter-content/i, /chapter-inner/i],
      'lightnovelpub': [/id="chapter-container"/i, /chapter-content/i],
      'novelfull': [/id="chapter-content"/i, /chapter-c/i],
      'freewebnovel': [/id="article"/i, /chapter-content/i, /class="[^"]*txt[^"]*"/i],
      'novelbuddy': [/id="chapter-content"/i, /chapter__content/i],
      'novelhall': [/id="htmlContent"/i],
      'scribblehub': [/id="chp_raw"/i, /chp_raw/i],
      'wuxiaworld': [/chapter-content/i],
      'webnovel.com': [/chapter_content/i, /cha-words/i],
      'readlightnovel': [/chapter-content3/i],
      'boxnovel': [/reading-content/i, /text-left/i],
      'novellive.app': [/class="[^"]*txt[^"]*"[^>]*>/i],
    };

    const isValidChapterHtml = (body: string): boolean => {
      if (!body || body.length < MIN_HTML) return false;
      for (const [site, markers] of Object.entries(validityMarkers)) {
        if (hostname.includes(site)) {
          return markers.some((m) => m.test(body));
        }
      }
      // Unknown host: accept any sufficiently large HTML.
      return /<\/(?:article|div)>/i.test(body);
    };

    const tryProxies = async (label: string) => {
      for (const proxyUrl of htmlProxies) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const proxyResp = await fetch(proxyUrl, {
            headers: { 'User-Agent': fetchOpts.headers['User-Agent'] },
            redirect: 'follow',
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!proxyResp.ok) {
            console.log(`Proxy ${proxyUrl.split('?')[0]} returned ${proxyResp.status}`);
            continue;
          }
          const text = await proxyResp.text();
          if (text.length < MIN_HTML) {
            console.log(`Proxy ${proxyUrl.split('?')[0]} returned short body (${text.length} bytes), skipping`);
            continue;
          }
          if (!isValidChapterHtml(text)) {
            console.log(`Proxy ${proxyUrl.split('?')[0]} returned ${text.length} bytes but missing chapter markers, skipping`);
            continue;
          }
          console.log(`${label}: proxy succeeded via ${proxyUrl.split('?')[0]} (${text.length} bytes)`);
          return text;
        } catch (e) {
          console.log('Proxy failed/timeout:', (e as Error).message);
        }
      }
      return '';
    };

    const tryJinaUrl = async (targetUrl: string): Promise<string> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(`https://r.jina.ai/${targetUrl}`, {
          headers: {
            'User-Agent': fetchOpts.headers['User-Agent'],
            'X-Return-Format': 'markdown',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          console.log(`Jina returned ${resp.status}`);
          return '';
        }
        const text = await resp.text();
        console.log(`Jina returned ${text.length} bytes of markdown`);
        return text;
      } catch (e) {
        console.log('Jina failed/timeout:', (e as Error).message);
        return '';
      }
    };

    const tryJinaMarkdown = async (): Promise<string> => tryJinaUrl(canonicalUrl);

    if (hostname.includes('novelbin') && !catalogContext) {
      const novelId = getNovelbinNovelId(parsedUrl);
      if (novelId) {
        const catalogMarkdown = await tryJinaUrl(`${parsedUrl.origin}/ajax/chapter-option?novelId=${encodeURIComponent(novelId)}`);
        const markdownContext = getNovelbinCatalogContextFromMarkdown(canonicalUrl, catalogMarkdown);
        if (markdownContext) {
          catalogContext = markdownContext;
          if (normalizeCompareUrl(markdownContext.current) !== normalizeCompareUrl(canonicalUrl)) {
            canonicalUrl = markdownContext.current;
            console.log(`NovelBin canonical chapter URL resolved from Jina catalog: ${canonicalUrl}`);
            response = await fetch(canonicalUrl, fetchOpts);
            html = response.ok ? await response.text() : '';
            jinaMarkdown = '';
          }
        }
      }
    }

    if (hostname.includes('novelbin') && isBareNovelbinChapterUrl(canonicalUrl)) {
      jinaMarkdown = await tryJinaMarkdown();
      const chapterNumber = getNovelbinChapterNumber(canonicalUrl);
      const jinaCanonicalUrl = chapterNumber !== null
        ? extractNovelbinCanonicalUrlFromMarkdown(jinaMarkdown, chapterNumber)
        : '';
      if (jinaCanonicalUrl && normalizeCompareUrl(jinaCanonicalUrl) !== normalizeCompareUrl(canonicalUrl)) {
        canonicalUrl = jinaCanonicalUrl;
        console.log(`NovelBin canonical URL resolved from Jina: ${canonicalUrl}`);
        response = await fetch(canonicalUrl, fetchOpts);
        html = response.ok ? await response.text() : '';
        jinaMarkdown = '';
      }
    }

    if (!response.ok) {
      const status = response.status;
      console.log(`Direct fetch failed with ${status}, trying proxies...`);
      const proxied = await tryProxies('Direct-fail');
      if (proxied) {
        html = proxied;
      } else {
        // Last resort: ask Jina Reader for markdown.
        jinaMarkdown = await tryJinaMarkdown();
        if (!jinaMarkdown) {
          return new Response(
            JSON.stringify({ error: `O site bloqueou o acesso (${status}). Tente usar um site alternativo como novelbin.com ou allnovelbin.net.` }),
            { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else if (!isValidChapterHtml(html) && !hostname.includes('wtr-lab.com')) {
      console.log(`Direct fetch returned ${html.length} bytes but failed validity check, trying proxies...`);
      const proxied = await tryProxies('Invalid-body');
      if (proxied) html = proxied;
    }
    console.log(`HTML length: ${html.length}, valid: ${isValidChapterHtml(html)}, jina: ${jinaMarkdown.length}`);

    // Extract title
    let title = '';
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
    const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (h1) title = cleanHtml(h1[1]);
    else if (ogTitle) title = ogTitle[1];
    else if (titleTag) title = cleanHtml(titleTag[1]);
    if (catalogContext?.title) title = catalogContext.title;

    // Extract content with site-aware selectors
    let content = html ? trimChapterContent(extractContent(html, hostname), title, hostname) : '';

    // If we still don't have content, fall back to Jina Reader markdown.
    if (!content || content.length < 100) {
      if (!jinaMarkdown) {
        console.log('Insufficient content from HTML, trying Jina Reader fallback...');
        jinaMarkdown = await tryJinaMarkdown();
      }
      if (jinaMarkdown) {
        const parsed = parseJinaMarkdown(jinaMarkdown, canonicalUrl, hostname);
        if (parsed.content && parsed.content.length > (content?.length || 0)) {
          content = parsed.content;
          if (!title && parsed.title) title = parsed.title;
        }
      }
    }

    // Extract nav links (skip generic extraction for webnovel.com — it picks up wrong links like "Last Chapter")
    let nextChapterUrl = '';
    let prevChapterUrl = '';
    if (!hostname.includes('webnovel.com')) {
      const nav = extractNavLinks(html, hostname);
      nextChapterUrl = nav.next;
      prevChapterUrl = nav.prev;
    }

    if ((!nextChapterUrl || !prevChapterUrl || (hostname.includes('novelbin') && (isBareNovelbinChapterUrl(nextChapterUrl) || isBareNovelbinChapterUrl(prevChapterUrl))))) {
      if (!jinaMarkdown) jinaMarkdown = await tryJinaMarkdown();
      if (jinaMarkdown) {
        const jinaNav = extractJinaNavLinks(jinaMarkdown);
        if (!nextChapterUrl || isBareNovelbinChapterUrl(nextChapterUrl)) nextChapterUrl = jinaNav.next;
        if (!prevChapterUrl || isBareNovelbinChapterUrl(prevChapterUrl)) prevChapterUrl = jinaNav.prev;
      }
    }

    // Strip broken "/undefined" links produced by SSR placeholders (e.g. novelbin)
    if (nextChapterUrl.endsWith('/undefined') || nextChapterUrl.includes('undefined')) nextChapterUrl = '';
    if (prevChapterUrl.endsWith('/undefined') || prevChapterUrl.includes('undefined')) prevChapterUrl = '';

    if (catalogContext) {
      if (!nextChapterUrl || isBareNovelbinChapterUrl(nextChapterUrl)) nextChapterUrl = catalogContext.next;
      if (!prevChapterUrl || isBareNovelbinChapterUrl(prevChapterUrl)) prevChapterUrl = catalogContext.prev;
    }

    // URL-based chapter navigation fallback for sites with sequential chapter URLs
    if (hostname.includes('wtr-lab.com') || hostname.includes('freewebnovel')) {
      const chapterMatch = url.match(/\/chapter-(\d+)/);
      if (chapterMatch) {
        const chNum = parseInt(chapterMatch[1], 10);
        if (!nextChapterUrl) {
          nextChapterUrl = url.replace(/\/chapter-\d+/, `/chapter-${chNum + 1}`);
        }
        if (!prevChapterUrl && chNum > 1) {
          prevChapterUrl = url.replace(/\/chapter-\d+/, `/chapter-${chNum - 1}`);
        }
      }
    }

    // novelbin uses /cchapter-N (and sometimes /chapter-N) sequential URLs;
    // SSR often renders next as /undefined, so derive from current URL.
    if (hostname.includes('novelbin')) {
      const m = canonicalUrl.match(/\/c?chapter-(\d+)/);
      if (m) {
        const chNum = parseInt(m[1], 10);
        const prefix = canonicalUrl.includes('/cchapter-') ? 'cchapter' : 'chapter';
        if (!nextChapterUrl) {
          nextChapterUrl = canonicalUrl.replace(/\/c?chapter-\d+[^/?#]*/, `/${prefix}-${chNum + 1}`);
        }
        if (!prevChapterUrl && chNum > 1) {
          prevChapterUrl = canonicalUrl.replace(/\/c?chapter-\d+[^/?#]*/, `/${prefix}-${chNum - 1}`);
        }
      }
    }

    // webnovel.com: fetch catalog to find next/prev chapter (IDs are non-sequential)
    if (hostname.includes('webnovel.com')) {
      try {
        // Extract bookId and current chapter slug from URL
        // URL pattern: /book/{slug}_{bookId}/{chapterSlug}_{chapterId}
        const bookMatch = url.match(/\/book\/[^/]+_(\d+)\/([^/?#]+)/);
        if (bookMatch) {
          const bookId = bookMatch[1];
          const currentSlug = bookMatch[2]; // e.g. "1_84281807280864220"
          const catalogUrl = `https://www.webnovel.com/book/${bookId}/catalog`;
          console.log('Fetching webnovel catalog for navigation...');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const catResp = await fetch(catalogUrl, { ...fetchOpts, signal: controller.signal });
          clearTimeout(timeout);
          if (catResp.ok) {
            const catHtml = await catResp.text();
            const chapterLinks = /^\d+_\d+$/.test(currentSlug)
              ? extractWebnovelMainChapterSequence(catHtml)
              : extractWebnovelCatalogSequence(catHtml);
            // Find current chapter index and get adjacent
            const normalizedCurrentSlug = normalizeWebnovelSlug(currentSlug);
            const currentIdx = chapterLinks.indexOf(normalizedCurrentSlug);
            if (currentIdx !== -1) {
              const bookSlug = url.match(/\/book\/([^/]+)\//)?.[1] || '';
              if (currentIdx > 0 && !prevChapterUrl) {
                prevChapterUrl = `https://www.webnovel.com/book/${bookSlug}/${chapterLinks[currentIdx - 1]}`;
              }
              if (currentIdx < chapterLinks.length - 1 && !nextChapterUrl) {
                nextChapterUrl = `https://www.webnovel.com/book/${bookSlug}/${chapterLinks[currentIdx + 1]}`;
              }
              console.log(`Catalog: found ${chapterLinks.length} chapters, current index=${currentIdx}`);
            } else {
              console.log(`Catalog: current slug not found (${normalizedCurrentSlug}), first entries=${chapterLinks.slice(0, 5).join(', ')}`);
            }
          }
        }
      } catch (e) {
        console.log('Webnovel catalog fetch failed:', (e as Error).message);
      }
    }

    // Resolve relative URLs
    const origin = parsedUrl.origin;
    if (nextChapterUrl && !nextChapterUrl.startsWith('http')) {
      nextChapterUrl = nextChapterUrl.startsWith('/') ? origin + nextChapterUrl : origin + '/' + nextChapterUrl;
    }
    if (prevChapterUrl && !prevChapterUrl.startsWith('http')) {
      prevChapterUrl = prevChapterUrl.startsWith('/') ? origin + prevChapterUrl : origin + '/' + prevChapterUrl;
    }

    if (!content || content.length < 50) {
      console.log('Content extraction failed. HTML length:', html.length, 'Content length:', content?.length || 0);
      return new Response(
        JSON.stringify({ error: 'Não foi possível extrair o conteúdo. O site pode usar proteção anti-scraping.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Scraped: title="${title}", content length=${content.length}, next=${!!nextChapterUrl}, prev=${!!prevChapterUrl}`);

    return new Response(
      JSON.stringify({ title, content, nextChapterUrl, prevChapterUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to scrape' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
