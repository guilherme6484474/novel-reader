/**
 * Native TTS bridge using @capacitor-community/text-to-speech
 * Falls back to Web Speech API when not running in Capacitor.
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
    console.warn('[NativeTTS] Plugin not available');
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

export async function getNativeVoices(): Promise<NativeVoice[]> {
  const plugin = await getPlugin();
  if (!plugin) return [];

  // Retry logic: Android TTS engine needs time to initialize (onInit callback)
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
        console.log('[NativeTTS] Voices loaded:', mapped.map(v => `${v.name} (${v.lang})`).join(', '));
        return mapped;
      }
    } catch (e) {
      console.warn(`[NativeTTS] attempt ${attempt + 1} failed:`, e);
    }
    // Wait before retry — increasing delay
    await new Promise(r => setTimeout(r, 500));
  }

  console.warn('[NativeTTS] All voice attempts exhausted, trying language fallback...');

  // Fallback: use getSupportedLanguages() to create basic entries
  try {
    const langResult = await plugin.getSupportedLanguages();
    const languages = langResult.languages || [];
    console.log('[NativeTTS] Language fallback:', languages);
    if (languages.length > 0) {
      return languages.map(lang => ({
        name: lang,
        lang,
        localService: true,
        voiceURI: '',
      }));
    }
  } catch (e) {
    console.warn('[NativeTTS] Language fallback failed:', e);
  }

  // Last resort: return a default pt-BR entry so the user can at least try TTS
  console.warn('[NativeTTS] Returning hardcoded fallback voice');
  return [
    { name: 'Padrão (pt-BR)', lang: 'pt-BR', localService: true, voiceURI: '' },
    { name: 'Default (en-US)', lang: 'en-US', localService: true, voiceURI: '' },
  ];
}

export async function nativeSpeak(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: number; // voice index for Android
}): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) throw new Error('Native TTS not available');

  const speakOptions: any = {
    text: options.text,
    lang: options.lang || 'pt-BR',
    rate: options.rate || 1.0,
    pitch: options.pitch || 1.0,
    volume: 1.0,
    category: 'ambient',
    queueStrategy: 1,
  };

  // Pass voice index if available (Android uses numeric index)
  if (options.voice !== undefined && options.voice >= 0) {
    speakOptions.voice = options.voice;
  }

  await plugin.speak(speakOptions);
}

export async function nativeStop(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.stop();
  } catch {
    // ignore
  }
}
