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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[NativeTTS] ${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'Unknown error');
}

function isNoEngineError(message: string): boolean {
  return message.includes('not available on this device') || message.includes('not supported on this device');
}

async function resolveBestPluginLanguage(
  plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>,
  requestedLang?: string,
): Promise<string> {
  const requested = (requestedLang || '').trim();
  const requestedBase = requested.includes('-') ? requested.split('-')[0] : requested;
  const deviceLang = (typeof navigator !== 'undefined' ? navigator.language : '').trim();
  const deviceBase = deviceLang.includes('-') ? deviceLang.split('-')[0] : deviceLang;

  const candidates = Array.from(new Set([
    requested,
    requestedBase,
    deviceLang,
    deviceBase,
    'en-US',
    'en',
  ].filter(Boolean)));

  for (const lang of candidates) {
    try {
      const result = await plugin.isLanguageSupported({ lang });
      if (result.supported) return lang;
    } catch {
      // Ignore and try next candidate
    }
  }

  try {
    const langResult = await withTimeout(plugin.getSupportedLanguages(), 1500, 'getSupportedLanguages');
    const languages = (langResult.languages || []).filter(Boolean);
    if (languages.length > 0) {
      const exactRequested = requested ? languages.find(l => l.toLowerCase() === requested.toLowerCase()) : undefined;
      if (exactRequested) return exactRequested;

      const requestedPrefix = requestedBase?.toLowerCase();
      if (requestedPrefix) {
        const prefByRequested = languages.find(l => l.toLowerCase().startsWith(requestedPrefix));
        if (prefByRequested) return prefByRequested;
      }

      const devicePrefix = deviceBase?.toLowerCase();
      if (devicePrefix) {
        const prefByDevice = languages.find(l => l.toLowerCase().startsWith(devicePrefix));
        if (prefByDevice) return prefByDevice;
      }

      return languages[0];
    }
  } catch {
    // Fall through to final default
  }

  return requested || deviceLang || 'en-US';
}

export async function getNativeVoices(): Promise<NativeVoice[]> {
  const plugin = await getPlugin();

  // ─── Try native plugin first ───
  if (plugin) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        console.log(`[NativeTTS] Loading voices, attempt ${attempt + 1}...`);
        const result = await withTimeout(plugin.getSupportedVoices(), 1500, 'getSupportedVoices');
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
          return [...mapped, ...FALLBACK_VOICES];
        }
      } catch (e) {
        console.warn(`[NativeTTS] attempt ${attempt + 1} failed:`, e);
      }
      await sleep(500);
    }

    // Try getSupportedLanguages as secondary fallback
    try {
      const langResult = await withTimeout(plugin.getSupportedLanguages(), 1500, 'getSupportedLanguages');
      const languages = langResult.languages || [];
      console.log('[NativeTTS] Language fallback:', languages);
      if (languages.length > 0) {
        const langVoices = languages.map(lang => ({
          name: lang,
          lang,
          localService: true,
          voiceURI: '',
        }));
        return [...langVoices, ...FALLBACK_VOICES];
      }
    } catch (e) {
      console.warn('[NativeTTS] Language fallback failed:', e);
    }
  }

  // ─── Try Web Speech API (works in Android WebView) ───
  console.log('[NativeTTS] Trying Web Speech API fallback...');
  const webVoices = getWebSpeechVoices();
  if (webVoices.length > 0) {
    return [...webVoices, ...FALLBACK_VOICES];
  }

  // If speechSynthesis exists but voices aren't loaded yet, wait and retry
  if (typeof speechSynthesis !== 'undefined') {
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(600);
      const delayed = getWebSpeechVoices();
      if (delayed.length > 0) {
        return [...delayed, ...FALLBACK_VOICES];
      }
    }
  }

  // ─── Last resort: return guaranteed fallback voices ───
  console.warn('[NativeTTS] All voice loading methods failed, returning fallback voices');
  return FALLBACK_VOICES;
}

export async function openNativeTtsInstall(): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin || !isNative()) return false;

  try {
    await plugin.openInstall();
    return true;
  } catch (error) {
    console.warn('[NativeTTS] Failed to open TTS install/settings:', error);
    return false;
  }
}

export interface TTSDiagnostics {
  isNativePlatform: boolean;
  pluginAvailable: boolean;
  pluginReady: boolean;
  supportedLanguages: string[];
  voiceCount: number;
  webSpeechAvailable: boolean;
  webSpeechVoiceCount: number;
  lastError: string | null;
}

let lastDiagError: string | null = null;
export function setDiagError(msg: string) { lastDiagError = msg; }

export async function runTTSDiagnostics(): Promise<TTSDiagnostics> {
  const diag: TTSDiagnostics = {
    isNativePlatform: isNative(),
    pluginAvailable: false,
    pluginReady: false,
    supportedLanguages: [],
    voiceCount: 0,
    webSpeechAvailable: typeof speechSynthesis !== 'undefined',
    webSpeechVoiceCount: 0,
    lastError: lastDiagError,
  };

  try {
    const plugin = await getPlugin();
    diag.pluginAvailable = !!plugin;

    if (plugin) {
      try {
        const langResult = await withTimeout(plugin.getSupportedLanguages(), 2000, 'diag-langs');
        diag.supportedLanguages = (langResult.languages || []).sort();
        diag.pluginReady = true;
      } catch { /* not ready */ }

      try {
        const voiceResult = await withTimeout(plugin.getSupportedVoices(), 2000, 'diag-voices');
        diag.voiceCount = (voiceResult.voices || []).length;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  if (diag.webSpeechAvailable) {
    try { diag.webSpeechVoiceCount = speechSynthesis.getVoices().length; } catch {}
  }

  return diag;
}

/**
 * Speak text — tries native plugin first, falls back to Web Speech API.
 * Returns info about which engine was used.
 */
export async function nativeSpeak(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: number;
}): Promise<{ engine: string }> {
  // ─── Strategy 1: Try native Capacitor plugin FIRST ───
  const plugin = await getPlugin();
  if (plugin) {
    let requestedLang = options.lang;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resolvedLang = await resolveBestPluginLanguage(plugin, requestedLang);
        const speakOptions: any = {
          text: options.text,
          lang: resolvedLang,
          rate: options.rate || 1.0,
          pitch: options.pitch || 1.0,
          volume: 1.0,
        };

        // Only set voice index for non-system-default voices
        if (options.voice !== undefined && options.voice >= 0) {
          speakOptions.voice = options.voice;
        }

        console.log('[NativeTTS] Trying plugin.speak with:', JSON.stringify(speakOptions));
        await withTimeout(plugin.speak(speakOptions), 30000, 'plugin.speak');
        return { engine: `capacitor-plugin(${resolvedLang})` };
      } catch (error) {
        const message = getErrorMessage(error);
        const lower = message.toLowerCase();
        console.warn(`[NativeTTS] Plugin speak failed (attempt ${attempt + 1}):`, message);

        if (lower.includes('this language is not supported')) {
          requestedLang = undefined;
          continue;
        }

        if (lower.includes('not yet initialized')) {
          await sleep(450);
          continue;
        }

        if (isNoEngineError(lower)) {
          await openNativeTtsInstall();
        }

        break;
      }
    }
  }

  // ─── Strategy 2: Try Web Speech API as fallback (only if voices exist) ───
  const webResult = await tryWebSpeech(options);
  if (webResult) return webResult;

  throw new Error('No TTS engine produced audio. Install/enable an Android TTS engine.');
}

/**
 * Try speaking with Web Speech API. Returns result or null if unavailable.
 */
function tryWebSpeech(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}): Promise<{ engine: string } | null> {
  if (typeof speechSynthesis === 'undefined') {
    console.log('[NativeTTS] speechSynthesis not available');
    return Promise.resolve(null);
  }

  return new Promise<{ engine: string } | null>((resolve) => {
    // Cancel any ongoing speech first
    try { speechSynthesis.cancel(); } catch {}

    const doSpeak = () => {
      try {
        const voices = speechSynthesis.getVoices();
        console.log(`[NativeTTS] WebSpeech doSpeak: ${voices.length} voices available`);

        // If no real voices loaded, Web Speech can't produce audio — bail out
        if (voices.length === 0) {
          console.warn('[NativeTTS] WebSpeech has 0 voices, skipping');
          resolve(null);
          return;
        }

        const utterance = new SpeechSynthesisUtterance(options.text);
        utterance.lang = options.lang || 'pt-BR';
        utterance.rate = options.rate || 1.0;
        utterance.pitch = options.pitch || 1.0;
        utterance.volume = 1.0;

        // Try to find a matching voice
        const langPrefix = options.lang?.split('-')[0] || 'pt';
        const match = voices.find(v => v.lang.startsWith(langPrefix));
        if (match) {
          utterance.voice = match;
          console.log(`[NativeTTS] Using WebSpeech voice: ${match.name} (${match.lang})`);
        }

        let settled = false;
        const settle = (result: { engine: string } | null) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        utterance.onend = () => settle({ engine: `webSpeech(${match?.name || 'default'})` });
        utterance.onerror = (e) => {
          console.warn('[NativeTTS] WebSpeech error:', e.error);
          if (e.error === 'canceled' || e.error === 'interrupted') {
            settle({ engine: 'webSpeech-canceled' });
          } else {
            settle(null); // Let caller try next engine
          }
        };

        // Safety timeout — if nothing happens in 10s, consider it failed
        setTimeout(() => {
          if (!settled) {
            console.warn('[NativeTTS] WebSpeech timeout, no onend/onerror fired');
            settle(null);
          }
        }, 10000);

        speechSynthesis.speak(utterance);
        console.log('[NativeTTS] speechSynthesis.speak() called');
      } catch (e) {
        console.warn('[NativeTTS] WebSpeech doSpeak exception:', e);
        resolve(null);
      }
    };

    // Ensure voices are loaded
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      console.log('[NativeTTS] No voices yet, waiting for onvoiceschanged...');
      let waited = false;
      speechSynthesis.onvoiceschanged = () => {
        if (waited) return;
        waited = true;
        speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
      setTimeout(() => {
        if (!waited) {
          waited = true;
          speechSynthesis.onvoiceschanged = null;
          doSpeak();
        }
      }, 1500);
    } else {
      doSpeak();
    }
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
