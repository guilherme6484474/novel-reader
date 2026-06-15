/**
 * Edge TTS (experimental) — calls our Supabase edge function which talks to the
 * unofficial Microsoft Edge "Read Aloud" WebSocket and returns MP3.
 *
 * ⚠️ Uses a non-documented Microsoft endpoint. May break without notice.
 * Always pair with a fallback (Web Speech / Native).
 */
import { supabase } from '@/integrations/supabase/client';
import type { TTSVoice } from '@/hooks/use-tts';

// Curated short list of high-quality neural voices. Names follow the format
// expected by the Microsoft endpoint: <lang>-<region>-<voice>Neural.
export const EDGE_TTS_VOICES: TTSVoice[] = [
  // Português (Brasil)
  { name: '☁️ Edge: Francisca (pt-BR, feminina)', lang: 'pt-BR', localService: false, voiceURI: 'pt-BR-FranciscaNeural' },
  { name: '☁️ Edge: Antônio (pt-BR, masculina)', lang: 'pt-BR', localService: false, voiceURI: 'pt-BR-AntonioNeural' },
  { name: '☁️ Edge: Thalita (pt-BR, feminina)', lang: 'pt-BR', localService: false, voiceURI: 'pt-BR-ThalitaNeural' },
  { name: '☁️ Edge: Brenda (pt-BR, feminina)', lang: 'pt-BR', localService: false, voiceURI: 'pt-BR-BrendaNeural' },
  { name: '☁️ Edge: Donato (pt-BR, masculina)', lang: 'pt-BR', localService: false, voiceURI: 'pt-BR-DonatoNeural' },
  // Português (Portugal)
  { name: '☁️ Edge: Raquel (pt-PT, feminina)', lang: 'pt-PT', localService: false, voiceURI: 'pt-PT-RaquelNeural' },
  // Inglês
  { name: '☁️ Edge: Jenny (en-US, feminina)', lang: 'en-US', localService: false, voiceURI: 'en-US-JennyNeural' },
  { name: '☁️ Edge: Guy (en-US, masculina)', lang: 'en-US', localService: false, voiceURI: 'en-US-GuyNeural' },
  { name: '☁️ Edge: Aria (en-US, feminina)', lang: 'en-US', localService: false, voiceURI: 'en-US-AriaNeural' },
  // Espanhol
  { name: '☁️ Edge: Elvira (es-ES, feminina)', lang: 'es-ES', localService: false, voiceURI: 'es-ES-ElviraNeural' },
  // Japonês
  { name: '☁️ Edge: Nanami (ja-JP, feminina)', lang: 'ja-JP', localService: false, voiceURI: 'ja-JP-NanamiNeural' },
];

export function isEdgeVoice(voiceURI: string | undefined): boolean {
  if (!voiceURI) return false;
  return /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voiceURI);
}

/**
 * Fetch MP3 audio for the given text via our edge function.
 * Returns a Blob URL that can be assigned to an <audio> element.
 */
export async function fetchEdgeTtsAudio(opts: {
  text: string;
  voice: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke('edge-tts', {
    body: {
      text: opts.text,
      voice: opts.voice,
      lang: opts.lang,
      rate: opts.rate ?? 1,
      pitch: opts.pitch ?? 1,
    },
  });

  if (error) throw new Error(`Edge TTS falhou: ${error.message}`);

  // Supabase JS returns the body as a Blob for binary responses
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (data instanceof ArrayBuffer) {
    blob = new Blob([data], { type: 'audio/mpeg' });
  } else if (typeof data === 'object' && data !== null && 'error' in data) {
    throw new Error(`Edge TTS: ${(data as { error: string }).error}`);
  } else {
    throw new Error('Edge TTS: resposta inesperada');
  }

  return URL.createObjectURL(blob);
}