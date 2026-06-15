/**
 * Native TTS bridge using @capacitor-community/text-to-speech.
 * Falls back to Web Speech API in the browser.
 *
 * Engines supported:
 *  - 'native'    → Android/iOS system TTS plugin (Capacitor). Plays with screen off
 *                  thanks to Wake Lock + Foreground Service wired in use-tts.
 *  - 'webspeech' → Browser SpeechSynthesis. Free, offline-ish, but pauses when the
 *                  screen turns off on mobile browsers (Chrome/WebView limitation).
 */
import { Capacitor } from '@capacitor/core';
import { ttsLog, ttsWarn, ttsError } from '@/lib/tts-debug-log';

export type TTSEnginePreference = 'webspeech' | 'native' | 'edge';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Read engine preference with migration of legacy values ('cloud' / 'piper').
 */
export function getTTSEngine(): TTSEnginePreference {
  const raw = (typeof localStorage !== 'undefined' && localStorage.getItem('nr-ttsEngine')) || '';
  if (raw === 'webspeech' || raw === 'native' || raw === 'edge') return raw;
  // Legacy values ('cloud', 'piper', '') → pick the best for the platform
  const fallback: TTSEnginePreference = isNative() ? 'native' : 'webspeech';
  if (raw) {
    try { localStorage.setItem('nr-ttsEngine', fallback); } catch { /* ignore */ }
  }
  return fallback;
}

export function setTTSEngine(engine: TTSEnginePreference) {
  try { localStorage.setItem('nr-ttsEngine', engine); } catch { /* ignore */ }
}

let CapTTS: typeof import('@capacitor-community/text-to-speech').TextToSpeech | null = null;

async function getPlugin() {
  if (CapTTS) return CapTTS;
  if (!isNative()) return null;
  try {
    const mod = await import('@capacitor-community/text-to-speech');
    CapTTS = mod.TextToSpeech;
    return CapTTS;
  } catch {
    ttsWarn('Plugin not available, will use Web Speech API fallback');
    return null;
  }
}

export interface NativeVoice {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

const FALLBACK_VOICES: NativeVoice[] = [
  { name: '🔊 Voz padrão do sistema', lang: 'pt-BR', localService: true, voiceURI: '__system_default__' },
  { name: '🔊 System default voice', lang: 'en-US', localService: true, voiceURI: '__system_default_en__' },
];

function getWebSpeechVoices(): NativeVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  try {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      return voices.map(v => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        voiceURI: v.voiceURI || v.name,
      }));
    }
  } catch (e) {
    ttsWarn('Web Speech API getVoices failed: ' + String(e));
  }
  return [];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[NativeTTS] ${label} timeout after ${timeoutMs}ms`)), timeoutMs);
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

async function resolveBestPluginLanguage(
  plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>,
  requestedLang?: string,
): Promise<string> {
  const requested = (requestedLang || '').trim();
  const requestedBase = requested.includes('-') ? requested.split('-')[0] : requested;
  const deviceLang = (typeof navigator !== 'undefined' ? navigator.language : '').trim();
  const deviceBase = deviceLang.includes('-') ? deviceLang.split('-')[0] : deviceLang;

  const candidates = Array.from(new Set([requested, requestedBase, deviceLang, deviceBase, 'en-US', 'en'].filter(Boolean)));

  for (const lang of candidates) {
    try {
      const result = await plugin.isLanguageSupported({ lang });
      if (result.supported) return lang;
    } catch { /* try next */ }
  }

  try {
    const langResult = await withTimeout(plugin.getSupportedLanguages(), 1500, 'getSupportedLanguages');
    const languages = (langResult.languages || []).filter(Boolean);
    if (languages.length > 0) {
      if (requested) {
        const exact = languages.find(l => l.toLowerCase() === requested.toLowerCase());
        if (exact) return exact;
      }
      if (requestedBase) {
        const pref = languages.find(l => l.toLowerCase().startsWith(requestedBase.toLowerCase()));
        if (pref) return pref;
      }
      if (deviceBase) {
        const pref = languages.find(l => l.toLowerCase().startsWith(deviceBase.toLowerCase()));
        if (pref) return pref;
      }
      return languages[0];
    }
  } catch { /* fall through */ }

  return requested || deviceLang || 'en-US';
}

async function resolveVoiceIndex(
  plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>,
  voiceURI?: string,
): Promise<number | undefined> {
  if (!voiceURI) return undefined;
  try {
    const result = await withTimeout(plugin.getSupportedVoices(), 2000, 'resolveVoiceIndex');
    const pluginVoices = result.voices || [];
    if (pluginVoices.length === 0) return undefined;

    const exactIdx = pluginVoices.findIndex(v => (v.voiceURI || '') === voiceURI || (v.name || '') === voiceURI);
    if (exactIdx >= 0) return exactIdx;

    const partialIdx = pluginVoices.findIndex(v => {
      const uri = (v.voiceURI || v.name || '').toLowerCase();
      const target = voiceURI.toLowerCase();
      return uri.includes(target) || target.includes(uri);
    });
    if (partialIdx >= 0) return partialIdx;
  } catch (e) {
    ttsWarn('Failed to resolve voice index: ' + getErrorMessage(e));
  }
  return undefined;
}

export async function getNativeVoices(): Promise<NativeVoice[]> {
  const plugin = await getPlugin();

  if (plugin) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await withTimeout(plugin.getSupportedVoices(), 2500, 'getSupportedVoices');
        const voices = result.voices || [];
        if (voices.length > 0) {
          const mapped = voices.map((v, index) => ({
            name: v.name || v.voiceURI || `Voice ${index + 1}`,
            lang: v.lang || '',
            localService: v.localService ?? true,
            voiceURI: v.voiceURI || v.name || '',
          }));
          return [...mapped, ...FALLBACK_VOICES];
        }
      } catch (e) {
        const msg = getErrorMessage(e);
        ttsWarn(`getSupportedVoices attempt ${attempt + 1} failed: ${msg}`);
        if (msg.includes('Comparison method')) break;
      }
      await sleep(500);
    }

    try {
      const langResult = await withTimeout(plugin.getSupportedLanguages(), 2000, 'getSupportedLanguages');
      const languages = langResult.languages || [];
      if (languages.length > 0) {
        const langVoices = languages.map(lang => ({
          name: `Voz ${lang}`, lang, localService: true, voiceURI: `lang:${lang}`,
        }));
        return [...langVoices, ...FALLBACK_VOICES];
      }
    } catch (e) {
      ttsWarn('Language fallback failed: ' + getErrorMessage(e));
    }
  }

  const webVoices = getWebSpeechVoices();
  if (webVoices.length > 0) return [...webVoices, ...FALLBACK_VOICES];

  if (typeof speechSynthesis !== 'undefined') {
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(600);
      const delayed = getWebSpeechVoices();
      if (delayed.length > 0) return [...delayed, ...FALLBACK_VOICES];
    }
  }

  return FALLBACK_VOICES;
}

export async function openNativeTtsInstall(): Promise<boolean> {
  if (!isNative()) return false;
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    await withTimeout(plugin.openInstall(), 5000, 'openInstall');
    return true;
  } catch (error) {
    ttsWarn('openInstall failed: ' + getErrorMessage(error));
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
export function setDiagError(msg: string | null) { lastDiagError = msg; }
export function clearDiagError() { lastDiagError = null; }

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

  if (isNative()) {
    try {
      const plugin = await getPlugin();
      diag.pluginAvailable = !!plugin;
      if (plugin) {
        try {
          const langResult = await withTimeout(plugin.getSupportedLanguages(), 3000, 'diag-langs');
          diag.supportedLanguages = (langResult.languages || []).sort();
          diag.pluginReady = true;
        } catch (e) { ttsWarn('Diag: getSupportedLanguages failed: ' + getErrorMessage(e)); }
        try {
          const voiceResult = await withTimeout(plugin.getSupportedVoices(), 3000, 'diag-voices');
          diag.voiceCount = (voiceResult.voices || []).length;
        } catch (e) {
          const msg = getErrorMessage(e);
          ttsWarn('Diag: getSupportedVoices failed: ' + msg);
          if (msg.includes('Comparison method')) {
            diag.lastError = 'Bug Android: erro de sorting nas vozes. O motor TTS pode funcionar mesmo assim.';
          }
        }
      }
    } catch (e) { ttsWarn('Diag: plugin load failed: ' + getErrorMessage(e)); }
  }

  if (diag.webSpeechAvailable) {
    try { diag.webSpeechVoiceCount = speechSynthesis.getVoices().length; } catch { /* ignore */ }
  }

  if (diag.isNativePlatform && diag.pluginReady) {
    clearDiagError();
    diag.lastError = null;
  }

  return diag;
}

/**
 * Speak text — Android: native plugin only. Web: Web Speech API.
 * `nextChunkText` is accepted for API stability but no longer used.
 */
export async function nativeSpeak(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceURI?: string;
  nextChunkText?: string;
}): Promise<{ engine: string }> {
  ttsLog('nativeSpeak: textLen=' + options.text.length + ' lang=' + options.lang + ' isNative=' + isNative());

  if (isNative()) {
    const plugin = await getPlugin();
    if (!plugin) {
      throw new Error('Motor TTS nativo indisponível. Instale ou ative um motor de voz nas configurações do Android.');
    }
    const lang = await resolveBestPluginLanguage(plugin, options.lang);
    const voiceIdx = await resolveVoiceIndex(plugin, options.voiceURI);
    try {
      await plugin.speak({
        text: options.text,
        lang,
        rate: options.rate ?? 1.0,
        pitch: options.pitch ?? 1.0,
        volume: 1.0,
        category: 'playback',
        ...(voiceIdx !== undefined ? { voice: voiceIdx } : {}),
      });
      clearDiagError();
      return { engine: `native(${lang}${voiceIdx !== undefined ? `#${voiceIdx}` : ''})` };
    } catch (e) {
      const msg = getErrorMessage(e);
      ttsError('Native plugin.speak failed: ' + msg);
      setDiagError(msg);
      throw new Error(msg);
    }
  }

  const webResult = await tryWebSpeech(options);
  if (webResult) {
    clearDiagError();
    return webResult;
  }
  throw new Error('Web Speech API não produziu áudio. Verifique se há vozes instaladas no navegador.');
}

function tryWebSpeech(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}): Promise<{ engine: string } | null> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve(null);

  return new Promise<{ engine: string } | null>((resolve) => {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }

    const doSpeak = () => {
      try {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) { resolve(null); return; }

        const utterance = new SpeechSynthesisUtterance(options.text);
        utterance.lang = options.lang || 'pt-BR';
        utterance.rate = options.rate || 1.0;
        utterance.pitch = options.pitch || 1.0;
        utterance.volume = 1.0;

        const langPrefix = options.lang?.split('-')[0] || 'pt';
        const match = voices.find(v => v.lang.startsWith(langPrefix));
        if (match) utterance.voice = match;

        let settled = false;
        let speechStarted = false;
        const settle = (result: { engine: string } | null) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        utterance.onstart = () => { speechStarted = true; };
        utterance.onend = () => settle({ engine: `webSpeech(${match?.name || 'default'})` });
        utterance.onerror = (e) => {
          if (e.error === 'canceled' || e.error === 'interrupted') {
            settle({ engine: 'webSpeech-canceled' });
          } else {
            ttsWarn('WebSpeech error: ' + e.error);
            settle(null);
          }
        };

        setTimeout(() => {
          if (!settled && !speechStarted) {
            try { speechSynthesis.cancel(); } catch { /* ignore */ }
            settle(null);
          }
        }, 5000);

        speechSynthesis.speak(utterance);
      } catch (e) {
        ttsWarn('WebSpeech doSpeak exception: ' + getErrorMessage(e));
        resolve(null);
      }
    };

    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
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
      }, 800);
    } else {
      doSpeak();
    }
  });
}

export async function nativeStop(): Promise<void> {
  const stopWithTimeout = async () => {
    const plugin = await getPlugin();
    if (plugin) {
      try { await withTimeout(plugin.stop(), 2000, 'plugin.stop'); } catch { /* ignore */ }
    }
  };

  try {
    await withTimeout(stopWithTimeout(), 3000, 'nativeStop');
  } catch {
    ttsWarn('nativeStop timed out — forcing continue');
  }

  if (typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}
