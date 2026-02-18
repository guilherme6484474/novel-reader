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
    const { text, targetLanguage } = await req.json();

    if (!text || !targetLanguage) {
      return new Response(
        JSON.stringify({ error: 'text and targetLanguage are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`Translating ${text.length} chars to ${targetLanguage}`);

    // Split text into chunks if too large (max ~4000 chars per chunk)
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

    const translateChunk = async (chunk: string, index: number): Promise<{ index: number; text: string }> => {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a professional literary translator. Translate the following novel chapter text to ${targetLanguage}. 
Rules:
- Keep the same paragraph structure and formatting
- Maintain the tone, style and emotion of the original
- Do NOT add any notes, explanations or commentary
- Output ONLY the translated text`
            },
            { role: "user", content: chunk }
          ],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw { status: 429, message: "Rate limit exceeded. Please try again in a moment." };
        }
        if (response.status === 402) {
          throw { status: 402, message: "AI credits exhausted. Please add credits." };
        }
        const errText = await response.text();
        console.error(`AI error chunk ${index}:`, response.status, errText);
        throw new Error(`Translation failed: ${response.status}`);
      }

      const data = await response.json();
      return { index, text: data.choices?.[0]?.message?.content || '' };
    };

    try {
      // Translate all chunks in parallel
      const results = await Promise.all(chunks.map((chunk, i) => translateChunk(chunk, i)));
      results.sort((a, b) => a.index - b.index);
      var translatedChunks = results.map(r => r.text);
    } catch (err: any) {
      if (err.status === 429 || err.status === 402) {
        return new Response(
          JSON.stringify({ error: err.message }),
          { status: err.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw err;
    }

    const translatedText = translatedChunks.join('\n\n');
    console.log(`Translation done: ${translatedText.length} chars`);

    return new Response(
      JSON.stringify({ translatedText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Translation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Translation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
