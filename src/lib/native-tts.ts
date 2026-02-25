/**
 * Native TTS bridge using @capacitor-community/text-to-speech
 * Falls back to Web Speech API when plugin is not available.
 */
import { Capacitor } from '@capacitor/core';

let CapTTS: typeof import('@capacitor-community/text-to-speech').TextToSpeech | null = null;

// Lazy-load the plugin only in native context
async function getPlugin() {
  if (CapTTS) return CapTTS;
  if (!isNative()) return null;
  try {
    const mod = await import('@capacitor-community/text-to-speech');
    CapTTS = mod.TextToSpeech;
    return CapTTS;
  } catch {
    console.warn('[NativeTTS] Plugin not available, will use Web Speech API fallback');
    return null;
  }
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export interface NativeVoice {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

// Default fallback voices — always available
const FALLBACK_VOICES: NativeVoice[] = [
  { name: '🔊 Voz padrão do sistema', lang: 'pt-BR', localService: true, voiceURI: '__system_default__' },
  { name: '🔊 System default voice', lang: 'en-US', localService: true, voiceURI: '__system_default_en__' },
];

/**
 * Try loading voices from Web Speech API (available in Android WebView)
 */
function getWebSpeechVoices(): NativeVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  try {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      console.log(`[NativeTTS] Web Speech API returned ${voices.length} voices`);
      return voices.map(v => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        voiceURI: v.voiceURI || v.name,
      }));
    }
  } catch (e) {
    console.warn('[NativeTTS] Web Speech API getVoices failed:', e);
  }
  return [];
}

export async function getNativeVoices(): Promise<NativeVoice[]> {
  const plugin = await getPlugin();

  // ─── Try native plugin first ───
  if (plugin) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        console.log(`[NativeTTS] Loading voices, attempt ${attempt + 1}...`);
        const result = await plugin.getSupportedVoices();
        const voices = result.voices || [];
        console.log(`[NativeTTS] Attempt ${attempt + 1}: got ${voices.length} voices`);

        if (voices.length > 0) {
          const mapped = voices.map((v, index) => ({
            name: v.name || v.voiceURI || `Voice ${index + 1}`,
            lang: v.lang || '',
            localService: v.localService ?? true,
            voiceURI: v.voiceURI || v.name || '',
          }));
          console.log('[NativeTTS] Plugin voices loaded:', mapped.length);
          return [...FALLBACK_VOICES, ...mapped];
        }
      } catch (e) {
        console.warn(`[NativeTTS] attempt ${attempt + 1} failed:`, e);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Try getSupportedLanguages as secondary fallback
    try {
      const langResult = await plugin.getSupportedLanguages();
      const languages = langResult.languages || [];
      console.log('[NativeTTS] Language fallback:', languages);
      if (languages.length > 0) {
        const langVoices = languages.map(lang => ({
          name: lang,
          lang,
          localService: true,
          voiceURI: '',
        }));
        return [...FALLBACK_VOICES, ...langVoices];
      }
    } catch (e) {
      console.warn('[NativeTTS] Language fallback failed:', e);
    }
  }

  // ─── Try Web Speech API (works in Android WebView) ───
  console.log('[NativeTTS] Trying Web Speech API fallback...');
  const webVoices = getWebSpeechVoices();
  if (webVoices.length > 0) {
    return [...FALLBACK_VOICES, ...webVoices];
  }

  // If speechSynthesis exists but voices aren't loaded yet, wait and retry
  if (typeof speechSynthesis !== 'undefined') {
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 600));
      const delayed = getWebSpeechVoices();
      if (delayed.length > 0) {
        return [...FALLBACK_VOICES, ...delayed];
      }
    }
  }

  // ─── Last resort: return guaranteed fallback voices ───
  console.warn('[NativeTTS] All voice loading methods failed, returning fallback voices');
  return FALLBACK_VOICES;
}

/**
 * Speak text — tries native plugin first, falls back to Web Speech API
 */
export async function nativeSpeak(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: number;
}): Promise<void> {
  const plugin = await getPlugin();

  // ─── Try native plugin ───
  if (plugin) {
    const speakOptions: any = {
      text: options.text,
      lang: options.lang || 'pt-BR',
      rate: options.rate || 1.0,
      pitch: options.pitch || 1.0,
      volume: 1.0,
      category: 'ambient',
      queueStrategy: 1,
    };

    if (options.voice !== undefined && options.voice >= 0) {
      speakOptions.voice = options.voice;
    }

    try {
      await plugin.speak(speakOptions);
      return;
    } catch (e) {
      console.warn('[NativeTTS] Plugin speak failed, trying Web Speech fallback:', e);
    }
  }

  // ─── Fallback: Web Speech API ───
  if (typeof speechSynthesis === 'undefined') {
    throw new Error('No TTS engine available');
  }

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = options.lang || 'pt-BR';
    utterance.rate = options.rate || 1.0;
    utterance.pitch = options.pitch || 1.0;

    // Try to find a matching voice
    const voices = speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.startsWith(options.lang?.split('-')[0] || 'pt'));
    if (match) utterance.voice = match;

    utterance.onend = () => resolve();
    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') resolve();
      else reject(new Error(e.error));
    };

    speechSynthesis.speak(utterance);
  });
}

export async function nativeStop(): Promise<void> {
  const plugin = await getPlugin();
  if (plugin) {
    try { await plugin.stop(); } catch { /* ignore */ }
  }
  // Also stop Web Speech API in case fallback was used
  if (typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}
