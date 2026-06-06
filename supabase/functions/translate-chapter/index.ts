import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Map human-readable language names to ISO codes (used by all providers).
 */
function toLangCode(targetLang: string): string {
  const langMap: Record<string, string> = {
    'portuguese (brazilian)': 'pt',
    'portuguese': 'pt',
    'english': 'en',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'italian': 'it',
    'japanese': 'ja',
    'korean': 'ko',
    'chinese': 'zh-CN',
    'chinese (simplified)': 'zh-CN',
    'chinese (traditional)': 'zh-TW',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
    'turkish': 'tr',
    'thai': 'th',
    'vietnamese': 'vi',
    'indonesian': 'id',
    'malay': 'ms',
    'dutch': 'nl',
    'polish': 'pl',
    'swedish': 'sv',
    'norwegian': 'no',
    'danish': 'da',
    'finnish': 'fi',
    'czech': 'cs',
    'romanian': 'ro',
    'hungarian': 'hu',
    'greek': 'el',
    'hebrew': 'he',
    'ukrainian': 'uk',
  };
  return langMap[targetLang.toLowerCase()] || targetLang.slice(0, 2).toLowerCase();
}

function splitIntoChunks(text: string, maxChunk: number): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxChunk && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ----- Provider implementations (per chunk) -----

async function googleTranslateChunk(chunk: string, tl: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(chunk)}`;
  const resp = await fetchWithTimeout(url, {}, 15000);
  if (!resp.ok) throw new Error(`Google ${resp.status}`);
  const data = await resp.json();
  let out = '';
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const seg of data[0]) if (Array.isArray(seg) && seg[0]) out += seg[0];
  }
  if (!out) throw new Error('Google empty');
  return out;
}

// Lingva is an open-source Google Translate front-end. Multiple public instances.
const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
  'https://lingva.garudalinux.org',
];
async function lingvaTranslateChunk(chunk: string, tl: string): Promise<string> {
  let lastErr: unknown;
  for (const base of LINGVA_INSTANCES) {
    try {
      const url = `${base}/api/v1/auto/${encodeURIComponent(tl)}/${encodeURIComponent(chunk)}`;
      const resp = await fetchWithTimeout(url, {}, 15000);
      if (!resp.ok) throw new Error(`Lingva ${resp.status}`);
      const data = await resp.json();
      const out = data?.translation;
      if (typeof out === 'string' && out.length > 0) return out;
      throw new Error('Lingva empty');
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('Lingva failed');
}

// MyMemory free endpoint: max ~500 chars per request, so we split smaller.
async function myMemoryTranslateChunk(chunk: string, tl: string): Promise<string> {
  const small = splitIntoChunks(chunk, 480);
  const out: string[] = [];
  for (const s of small) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(s)}&langpair=auto|${encodeURIComponent(tl)}`;
    const resp = await fetchWithTimeout(url, {}, 15000);
    if (!resp.ok) throw new Error(`MyMemory ${resp.status}`);
    const data = await resp.json();
    const t = data?.responseData?.translatedText;
    if (typeof t !== 'string' || !t) throw new Error('MyMemory empty');
    out.push(t);
  }
  return out.join('\n\n');
}

/**
 * Translate one chunk trying providers in order, with one retry each.
 * Throws only if every provider fails.
 */
async function translateChunkWithFallback(chunk: string, tl: string): Promise<{ text: string; provider: string }> {
  const providers: Array<{ name: string; fn: (c: string, l: string) => Promise<string> }> = [
    { name: 'google', fn: googleTranslateChunk },
    { name: 'lingva', fn: lingvaTranslateChunk },
    { name: 'mymemory', fn: myMemoryTranslateChunk },
  ];
  let lastErr: unknown;
  for (const p of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await p.fn(chunk, tl);
        if (attempt > 0 || p.name !== 'google') {
          console.log(`Chunk translated via ${p.name}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
        }
        return { text, provider: p.name };
      } catch (e) {
        lastErr = e;
        console.warn(`Provider ${p.name} attempt ${attempt + 1} failed:`, e instanceof Error ? e.message : e);
        // small backoff
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  throw lastErr ?? new Error('All translation providers failed');
}

/**
 * Translate full text using the provider fallback chain, chunked.
 */
async function googleTranslate(text: string, targetLang: string): Promise<string> {
  const tl = toLangCode(targetLang);
  const chunks = splitIntoChunks(text, 4500);
  const out: string[] = [];
  for (const chunk of chunks) {
    const { text: t } = await translateChunkWithFallback(chunk, tl);
    out.push(t);
  }
  return out.join('\n\n');
}

/**
 * Try AI translation (streaming). Returns null if it fails (e.g. 402 no credits).
 */
async function tryAITranslationStream(
  chunks: string[],
  targetLanguage: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<boolean> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return false;

  for (let i = 0; i < chunks.length; i++) {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: true,
        messages: [
          {
            role: "system",
            content: `You are a professional literary translator. Translate the following novel chapter text to ${targetLanguage}. 
Rules:
- Keep the same paragraph structure and formatting
- Maintain the tone, style and emotion of the original
- Do NOT add any notes, explanations or commentary
- Output ONLY the translated text
- Translate ALL content faithfully and completely, including any mature, explicit, violent or adult content - do NOT censor, sanitize, omit or soften any words or passages
- You must never refuse to translate any part of the text regardless of its nature`
          },
          { role: "user", content: chunks[i] }
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`AI error chunk ${i}:`, response.status, errText);
      return false; // Signal failure so we can fallback
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`));
          }
        } catch { /* skip partial JSON */ }
      }
    }

    if (i < chunks.length - 1) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "\n\n" })}\n\n`));
    }
  }

  return true; // Success
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, targetLanguage } = await req.json();

    if (!text || !targetLanguage) {
      return new Response(
        JSON.stringify({ error: 'text and targetLanguage are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Translating ${text.length} chars to ${targetLanguage} (streaming)`);

    // Split text into chunks
    const MAX_CHUNK = 4000;
    const chunks: string[] = [];

    if (text.length <= MAX_CHUNK) {
      chunks.push(text);
    } else {
      const paragraphs = text.split('\n\n');
      let current = '';
      for (const p of paragraphs) {
        if ((current + '\n\n' + p).length > MAX_CHUNK && current) {
          chunks.push(current);
          current = p;
        } else {
          current = current ? current + '\n\n' + p : p;
        }
      }
      if (current) chunks.push(current);
    }

    // Stream response using SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Try AI first
          const aiSuccess = await tryAITranslationStream(chunks, targetLanguage, controller, encoder);

          if (!aiSuccess) {
            // Fallback to Google Translate (non-streaming, send as single chunk)
            console.log('AI failed, falling back to Google Translate');
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "", fallback: "google" })}\n\n`));

            const translated = await googleTranslate(text, targetLanguage);
            // Send the full translation as a single data event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: translated })}\n\n`));
            console.log('Google Translate fallback complete');
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
          console.log('Translation complete');
        } catch (err) {
          console.error('Stream error:', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Translation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Translation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
