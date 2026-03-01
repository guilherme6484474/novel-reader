import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ─── Google Cloud TTS with voice selection ───
async function synthesizeGoogleTTS(
  text: string,
  lang: string,
  rate: number,
  pitch: number,
  voiceName?: string,
): Promise<Uint8Array> {
  const apiKey = Deno.env.get("GOOGLE_CLOUD_TTS_KEY");
  if (!apiKey) throw new Error("GOOGLE_CLOUD_TTS_KEY not configured");

  // Determine voice config
  const voiceConfig: Record<string, unknown> = {};
  if (voiceName) {
    // Use specific voice name (e.g. 'pt-BR-Wavenet-A')
    voiceConfig.name = voiceName;
    // Extract language code from voice name (e.g. 'pt-BR' from 'pt-BR-Wavenet-A')
    const langMatch = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})/);
    voiceConfig.languageCode = langMatch ? langMatch[1] : (lang.includes('-') ? lang : `${lang}-BR`);
  } else {
    voiceConfig.languageCode = lang.includes('-') ? lang : `${lang}-BR`;
    voiceConfig.ssmlGender = "FEMALE";
  }

  // speakingRate: Google accepts 0.25 to 4.0
  // Map our rate (0.5-3.0) directly — allows much faster reading
  const speakingRate = Math.max(0.25, Math.min(4.0, rate));

  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: voiceConfig,
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        pitch: (pitch - 1) * 4,
        // Optimize for faster delivery
        effectsProfileId: ["small-bluetooth-speaker-class-device"],
      },
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
async function synthesizeElevenLabs(text: string, rate?: number): Promise<Uint8Array> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel
  const speed = rate ? Math.max(0.7, Math.min(1.2, rate)) : 1.0;

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
      voice_settings: { stability: 0.5, similarity_boost: 0.5, speed },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ─── Log usage ───
async function logUsage(userId: string | null, charCount: number, engine: string, lang: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    await supabase.from("tts_usage").insert({
      user_id: userId,
      characters_count: charCount,
      engine,
      lang,
    });
  } catch (e) {
    console.error("[cloud-tts] Failed to log usage:", e);
  }
}

function extractUserId(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = extractUserId(req);
    const { text, lang = 'pt-BR', rate = 1, pitch = 1, engine, voiceName } = await req.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "text"' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const trimmed = text.slice(0, 5000);
    let audio: Uint8Array | null = null;
    let used = '';
    const errors: string[] = [];

    const engines = engine ? [engine] : ['google', 'elevenlabs'];

    for (const eng of engines) {
      try {
        if (eng === 'google') {
          audio = await synthesizeGoogleTTS(trimmed, lang, rate, pitch, voiceName);
          used = 'google';
        } else if (eng === 'elevenlabs') {
          audio = await synthesizeElevenLabs(trimmed, rate);
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

    logUsage(userId, trimmed.length, used, lang);

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
