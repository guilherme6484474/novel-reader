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
  // Use POST to avoid URL-length limits (GET fails with 400 on long chunks)
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t`;
  const body = `q=${encodeURIComponent(chunk)}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 20000);
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
  'https://lingva.lunar.icu',
  'https://translate.plausibility.cloud',
  'https://lingva.garudalinux.org',
  'https://lingva.ml',
];
async function lingvaTranslateChunk(chunk: string, tl: string): Promise<string> {
  let lastErr: unknown;
  for (const base of LINGVA_INSTANCES) {
    try {
      const url = `${base}/api/v1/auto/${encodeURIComponent(tl)}/${encodeURIComponent(chunk)}`;
      const resp = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      }, 15000);
      if (!resp.ok) throw new Error(`Lingva ${resp.status}`);
      const data = await resp.json();
      const out = data?.translation;
      if (typeof out === 'string' && out.length > 0) return out;
      throw new Error('Lingva empty');
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('Lingva failed');
}

// MyMemory free endpoint: ~500 chars per request and requires explicit source lang
// (langpair=auto|xx returns 414/400). We assume English as source — the vast majority
// of scraped novels are English translations.
async function myMemoryTranslateChunk(chunk: string, tl: string): Promise<string> {
  const small = splitIntoChunks(chunk, 450);
  const out: string[] = [];
  for (const s of small) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(s)}&langpair=en|${encodeURIComponent(tl)}`;
    const resp = await fetchWithTimeout(url, {}, 15000);
    if (!resp.ok) throw new Error(`MyMemory ${resp.status}`);
    const data = await resp.json();
    const t = data?.responseData?.translatedText;
    if (typeof t !== 'string' || !t) throw new Error('MyMemory empty');
    // MyMemory returns quota / error strings in the translatedText field
    // (e.g. "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY").
    // Treat these as failures so we don't inject them into the chapter.
    if (/^MYMEMORY (WARNING|ERROR)/i.test(t) || /QUERY LENGTH LIMIT|AVAILABLE FREE TRANSLATIONS/i.test(t)) {
      throw new Error('MyMemory quota/error');
    }
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
        // Sanity check: a legitimate translation should be at least ~40%
        // of the source length. Anything shorter is almost certainly a
        // truncated response, quota error, or (with AI) a summary.
        // Skip the ratio guard for very short chunks where variance is high.
        if (chunk.length > 400 && text.length < chunk.length * 0.4) {
          throw new Error(`${p.name} suspiciously short output (${text.length}/${chunk.length})`);
        }
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
  // Translate chunks in parallel (bounded concurrency) — was sequential,
  // which multiplied latency by chunk count on long chapters.
  const CONCURRENCY = 4;
  const results: string[] = new Array(chunks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= chunks.length) return;
      const { text: t } = await translateChunkWithFallback(chunks[i], tl);
      results[i] = t;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return results.join('\n\n');
}

/**
 * Stream Google/Lingva/MyMemory translation chunk-by-chunk to the client so the
 * user sees progress instead of staring at 0% until the full chapter is done.
 */
async function googleTranslateStream(
  text: string,
  targetLang: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  const tl = toLangCode(targetLang);
  const chunks = splitIntoChunks(text, 4500);
  // Translate chunks in parallel and emit them in order as soon as each
  // prefix is ready. Users see progress much faster on long chapters.
  const CONCURRENCY = 4;
  const results: (string | null)[] = new Array(chunks.length).fill(null);
  let nextToEmit = 0;
  const emitReady = () => {
    while (nextToEmit < chunks.length && results[nextToEmit] !== null) {
      const piece = (nextToEmit === 0 ? '' : '\n\n') + results[nextToEmit]!;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: piece })}\n\n`));
      nextToEmit++;
    }
  };
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= chunks.length) return;
      const { text: t } = await translateChunkWithFallback(chunks[i], tl);
      results[i] = t;
      emitReady();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
}

// ----- AI availability cache (module-level, lives per warm instance) -----
// When the Lovable AI Gateway returns 402 (no credits) or 429 (rate-limited),
// skip AI for a short window so we don't waste ~500ms per request waiting for
// a guaranteed failure. The client gets the Google fallback immediately.
let aiUnavailableUntil = 0;
function aiIsKnownDown(): boolean {
  return Date.now() < aiUnavailableUntil;
}
function markAiDown(reason: string, ttlMs = 5 * 60_000) {
  aiUnavailableUntil = Date.now() + ttlMs;
  console.warn(`AI gateway marked unavailable for ${Math.round(ttlMs / 1000)}s — ${reason}`);
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
  if (aiIsKnownDown()) {
    console.log("Skipping AI (recently failed) — going straight to Google fallback");
    return false;
  }

  let emittedAny = false;

  for (let i = 0; i < chunks.length; i++) {
    let chunkAccumulated = '';
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
            content: `You are a professional literary translation ENGINE. Your ONLY job is to translate the provided novel chapter text to ${targetLanguage} sentence-by-sentence, in full.

STRICT RULES:
- Translate EVERY sentence. Do NOT summarize, paraphrase, condense, shorten, or skip any part of the text.
- Output length must be comparable to the input length (a faithful literary translation, never a synopsis).
- Preserve the original paragraph breaks and dialogue formatting exactly.
- Do NOT add prefaces like "Here is the translation", notes, explanations, headings, or commentary of any kind.
- Do NOT wrap output in quotes or code blocks.
- Translate ALL content faithfully, including mature, explicit, violent or adult content. Do NOT censor, sanitize, omit or soften anything.
- Never refuse. If in doubt, translate literally.

You are a translator, NOT a summarizer. A summary is a failure.`
          },
          { role: "user", content: `Translate the following text to ${targetLanguage}. Output ONLY the full translated text, nothing else:\n\n${chunks[i]}` }
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`AI error chunk ${i}:`, response.status, errText);
      if (response.status === 402 || response.status === 429) {
        markAiDown(`HTTP ${response.status}`);
      }
      // If we already streamed some AI output for earlier chunks, signal a
      // reset so the client wipes the partial text before Google re-does it.
      if (emittedAny) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "", fallback: "google", reset: true })}\n\n`));
      }
      return false; // Signal failure so we can fallback
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
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
              emittedAny = true;
              chunkAccumulated += content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`));
            }
          } catch { /* skip partial JSON */ }
        }
      }
    } catch (streamErr) {
      console.error(`AI stream broke on chunk ${i}:`, streamErr);
      if (emittedAny) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "", fallback: "google", reset: true })}\n\n`));
      }
      return false;
    }

    // Guard against summarization: if the model returned a drastically shorter
    // output than the source, treat as failure and fall back to Google.
    if (chunks[i].length > 400 && chunkAccumulated.length < chunks[i].length * 0.4) {
      console.warn(`AI likely summarized chunk ${i} (${chunkAccumulated.length}/${chunks[i].length}) — falling back to Google`);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "", fallback: "google", reset: true })}\n\n`));
      return false;
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "", fallback: "google", reset: true })}\n\n`));

            await googleTranslateStream(text, targetLanguage, controller, encoder);
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
