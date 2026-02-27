import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Free Google Translate using the public endpoint.
 * Translates text in chunks to avoid URL length limits.
 */
async function googleTranslate(text: string, targetLang: string): Promise<string> {
  // Map human-readable language names to Google Translate language codes
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

  const tl = langMap[targetLang.toLowerCase()] || targetLang.slice(0, 2).toLowerCase();

  // Split into paragraphs, translate in chunks
  const MAX_CHUNK = 4500;
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
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

  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(chunk)}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Google Translate failed: ${resp.status} ${errText}`);
    }

    const data = await resp.json();
    // Response format: [[["translated text","original text",null,null,confidence],...]]
    let translated = '';
    if (Array.isArray(data) && Array.isArray(data[0])) {
      for (const segment of data[0]) {
        if (Array.isArray(segment) && segment[0]) {
          translated += segment[0];
        }
      }
    }

    if (!translated) throw new Error('Google Translate returned empty result');
    translatedChunks.push(translated);
  }

  return translatedChunks.join('\n\n');
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
