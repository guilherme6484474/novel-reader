import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ─── Google Cloud TTS ───
async function synthesizeGoogleTTS(text: string, lang: string, rate: number, pitch: number): Promise<Uint8Array> {
  const apiKey = Deno.env.get("GOOGLE_CLOUD_TTS_KEY");
  if (!apiKey) throw new Error("GOOGLE_CLOUD_TTS_KEY not configured");

  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: lang.includes('-') ? lang : `${lang}-BR`, ssmlGender: "FEMALE" },
      audioConfig: { audioEncoding: "MP3", speakingRate: rate, pitch: (pitch - 1) * 4 },
    }),
  });

  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const bin = atob(data.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── ElevenLabs TTS ───
async function synthesizeElevenLabs(text: string): Promise<Uint8Array> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.5 },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, lang = 'pt-BR', rate = 1, pitch = 1, engine } = await req.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "text"' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const trimmed = text.slice(0, 5000);
    let audio: Uint8Array | null = null;
    let used = '';
    const errors: string[] = [];

    // Try engines in priority order
    const engines = engine ? [engine] : ['google', 'elevenlabs'];

    for (const eng of engines) {
      try {
        if (eng === 'google') {
          audio = await synthesizeGoogleTTS(trimmed, lang, rate, pitch);
          used = 'google';
        } else if (eng === 'elevenlabs') {
          audio = await synthesizeElevenLabs(trimmed);
          used = 'elevenlabs';
        } else {
          errors.push(`Unknown: ${eng}`);
          continue;
        }
        if (audio && audio.length > 0) break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${eng}: ${msg}`);
        console.error(`[cloud-tts] ${eng} failed:`, msg);
        audio = null;
      }
    }

    if (!audio || audio.length === 0) {
      return new Response(JSON.stringify({ error: 'All TTS engines failed', details: errors }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(audio, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg', 'X-TTS-Engine': used },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[cloud-tts] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
