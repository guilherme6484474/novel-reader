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
}

export async function getNativeVoices(): Promise<NativeVoice[]> {
  const plugin = await getPlugin();
  if (!plugin) return [];
  try {
    const result = await plugin.getSupportedVoices();
    return (result.voices || []).map(v => ({
      name: v.name || v.voiceURI || 'Unknown',
      lang: v.lang || '',
      localService: true,
    }));
  } catch (e) {
    console.warn('[NativeTTS] getSupportedVoices failed:', e);
    // Fallback: return empty, let the hook handle it
    return [];
  }
}

export async function nativeSpeak(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: string;
}): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) throw new Error('Native TTS not available');
  
  await plugin.speak({
    text: options.text,
    lang: options.lang || 'pt-BR',
    rate: options.rate || 1.0,
    pitch: options.pitch || 1.0,
    volume: 1.0,
    category: 'ambient',
    // queueStrategy: 0 = flush (stop previous), 1 = add to queue
    queueStrategy: 1,
  });
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
