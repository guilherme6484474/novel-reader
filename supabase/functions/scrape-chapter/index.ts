import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractContent(html: string): string {
  // Try multiple content selectors in priority order
  const selectors = [
    // novelbin specific
    /id="chr-content"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*chr-c[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    // Common novel sites
    /id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*chapter-c(?:ontent|hapter)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /id="content"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*text-left[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];

  for (const sel of selectors) {
    const m = html.match(sel);
    if (m && m[1]) {
      const cleaned = cleanHtml(m[1]);
      if (cleaned.length > 100) return cleaned;
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
    .replace(/window\.\w+\s*=[\s\S]*?[;\n]/g, '')
    // Remove footer/comment junk
    .replace(/Total\s+Respo(?:nses|stas)\s*:\s*\d+/gi, '')
    .replace(/Erro?\s+(?:ao\s+)?(?:loading|carregar)\s+comments?.*$/gim, '')
    .replace(/Error\s+loading\s+comments?.*$/gim, '')
    .replace(/Please\s+try\s+again\s+later\.?/gi, '')
    .replace(/Por\s+favor,?\s+tente\s+novamente\s+mais\s+tarde\.?/gi, '')
    .replace(/—\s*End\s+of\s+Chapter\s+\d+\s*—/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

    console.log('Scraping URL:', url);

    // Try fetching the page directly first
    let html = '';
    const fetchOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Referer': new URL(url).origin,
      },
    };

    const response = await fetch(url, fetchOpts);
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    html = await response.text();

    // Extract title
    let title = '';
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
    const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (h1) title = cleanHtml(h1[1]);
    else if (ogTitle) title = ogTitle[1];
    else if (titleTag) title = cleanHtml(titleTag[1]);

    // Extract content
    let content = extractContent(html);

    // If direct fetch got no content, try via a web cache/proxy approach
    if (!content || content.length < 100) {
      console.log('Direct fetch got insufficient content, trying Google cache...');
      try {
        const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
        const cacheResp = await fetch(cacheUrl, fetchOpts);
        if (cacheResp.ok) {
          const cacheHtml = await cacheResp.text();
          const cacheContent = extractContent(cacheHtml);
          if (cacheContent.length > (content?.length || 0)) {
            content = cacheContent;
          }
        }
      } catch (e) {
        console.log('Cache fallback failed:', e);
      }
    }

    // Extract nav links
    let nextChapterUrl = '';
    let prevChapterUrl = '';

    const nextPatterns = [
      /id="next_chap"[^>]*href="([^"]*)"/i,
      /class="[^"]*next[_-]?chap[^"]*"[^>]*href="([^"]*)"/i,
      /href="([^"]*)"[^>]*id="next_chap"/i,
      /href="([^"]*)"[^>]*>\s*Next\s*(?:Chapter)?\s*</i,
      /class="[^"]*btn-next[^"]*"[^>]*href="([^"]*)"/i,
      /href="([^"]*chapter-\d+[^"]*)"[^>]*class="[^"]*next/i,
    ];

    const prevPatterns = [
      /id="prev_chap"[^>]*href="([^"]*)"/i,
      /class="[^"]*prev[_-]?chap[^"]*"[^>]*href="([^"]*)"/i,
      /href="([^"]*)"[^>]*id="prev_chap"/i,
      /href="([^"]*)"[^>]*>\s*Prev(?:ious)?\s*(?:Chapter)?\s*</i,
      /class="[^"]*btn-prev[^"]*"[^>]*href="([^"]*)"/i,
    ];

    for (const p of nextPatterns) {
      const m = html.match(p);
      if (m) { nextChapterUrl = m[1]; break; }
    }
    for (const p of prevPatterns) {
      const m = html.match(p);
      if (m) { prevChapterUrl = m[1]; break; }
    }

    // Resolve relative URLs
    const origin = new URL(url).origin;
    if (nextChapterUrl && nextChapterUrl.startsWith('/')) nextChapterUrl = origin + nextChapterUrl;
    if (prevChapterUrl && prevChapterUrl.startsWith('/')) prevChapterUrl = origin + prevChapterUrl;

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
