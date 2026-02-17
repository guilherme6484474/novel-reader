import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch page: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();

    // Extract chapter content - try multiple common selectors
    let title = '';
    let content = '';
    let nextChapterUrl = '';
    let prevChapterUrl = '';

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is) ||
                       html.match(/<title>(.*?)<\/title>/is);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    // Extract main content from common novel site patterns
    const contentSelectors = [
      /<div[^>]*id="chr-content"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*chr-c[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
      /<article[^>]*>([\s\S]*?)<\/article>/i,
    ];

    for (const selector of contentSelectors) {
      const match = html.match(selector);
      if (match && match[1].length > 200) {
        content = match[1];
        break;
      }
    }

    // Clean HTML tags, keep paragraph breaks
    content = content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '\"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Extract next/prev chapter links
    const nextMatch = html.match(/<a[^>]*id="next_chap"[^>]*href="([^"]*)"[^>]*>/i) ||
                      html.match(/<a[^>]*class="[^"]*next[^"]*"[^>]*href="([^"]*)"[^>]*>/i) ||
                      html.match(/<a[^>]*href="([^"]*)"[^>]*>\s*Next\s*(?:Chapter)?\s*<\/a>/i);
    if (nextMatch) {
      nextChapterUrl = nextMatch[1];
      if (nextChapterUrl.startsWith('/')) {
        const urlObj = new URL(url);
        nextChapterUrl = urlObj.origin + nextChapterUrl;
      }
    }

    const prevMatch = html.match(/<a[^>]*id="prev_chap"[^>]*href="([^"]*)"[^>]*>/i) ||
                      html.match(/<a[^>]*class="[^"]*prev[^"]*"[^>]*href="([^"]*)"[^>]*>/i) ||
                      html.match(/<a[^>]*href="([^"]*)"[^>]*>\s*Prev(?:ious)?\s*(?:Chapter)?\s*<\/a>/i);
    if (prevMatch) {
      prevChapterUrl = prevMatch[1];
      if (prevChapterUrl.startsWith('/')) {
        const urlObj = new URL(url);
        prevChapterUrl = urlObj.origin + prevChapterUrl;
      }
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Could not extract chapter content from the page' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Scraped: title="${title}", content length=${content.length}`);

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

