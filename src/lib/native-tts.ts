/**
 * Native TTS bridge using @capacitor-community/text-to-speech
 * Falls back to Web Speech API when plugin is not available.
 */
import { Capacitor } from '@capacitor/core';
import { ttsLog, ttsWarn, ttsError } from '@/lib/tts-debug-log';
import { cloudSpeak, cloudStop } from '@/lib/cloud-tts';

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
    ttsWarn('Plugin not available, will use Web Speech API fallback');
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
      ttsLog(`Web Speech API returned ${voices.length} voices`);
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

/**
 * Resolve voiceURI to native voice index by matching against plugin voices.
 * FIX #2: Use voiceURI for reliable matching instead of fragile array position.
 */
async function resolveVoiceIndex(
  plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>,
  voiceURI?: string,
): Promise<number | undefined> {
  if (!voiceURI) return undefined;

  try {
    const result = await withTimeout(plugin.getSupportedVoices(), 2000, 'resolveVoiceIndex');
    const pluginVoices = result.voices || [];
    if (pluginVoices.length === 0) return undefined;

    // Try exact match first
    const exactIdx = pluginVoices.findIndex(v =>
      (v.voiceURI || '') === voiceURI || (v.name || '') === voiceURI
    );
    if (exactIdx >= 0) {
      ttsLog(`Voice resolved by URI: index=${exactIdx}, uri=${voiceURI}`);
      return exactIdx;
    }

    // Try partial match (voiceURI contains or is contained)
    const partialIdx = pluginVoices.findIndex(v => {
      const uri = (v.voiceURI || v.name || '').toLowerCase();
      const target = voiceURI.toLowerCase();
      return uri.includes(target) || target.includes(uri);
    });
    if (partialIdx >= 0) {
      ttsLog(`Voice resolved by partial match: index=${partialIdx}, uri=${voiceURI}`);
      return partialIdx;
    }
  } catch (e) {
    ttsWarn('Failed to resolve voice index: ' + getErrorMessage(e));
  }

  return undefined;
}

export async function getNativeVoices(): Promise<NativeVoice[]> {
  ttsLog('getNativeVoices() called. isNative: ' + isNative());
  const plugin = await getPlugin();
  ttsLog('plugin loaded: ' + !!plugin);

  // ─── Try native plugin first ───
  if (plugin) {
    // Try getSupportedVoices with crash protection (Android 12+ sorting bug)
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        ttsLog(`getSupportedVoices attempt ${attempt + 1}...`);
        const result = await withTimeout(plugin.getSupportedVoices(), 2500, 'getSupportedVoices');
        const voices = result.voices || [];
        ttsLog(`Attempt ${attempt + 1}: ${voices.length} voices`);

        if (voices.length > 0) {
          const mapped = voices.map((v, index) => ({
            name: v.name || v.voiceURI || `Voice ${index + 1}`,
            lang: v.lang || '',
            localService: v.localService ?? true,
            voiceURI: v.voiceURI || v.name || '',
          }));
          ttsLog('Plugin voices loaded: ' + mapped.length);
          return [...mapped, ...FALLBACK_VOICES];
        }
      } catch (e) {
        const msg = getErrorMessage(e);
        ttsWarn(`getSupportedVoices attempt ${attempt + 1} failed: ${msg}`);
        if (msg.includes('Comparison method')) {
          ttsWarn('Known Android sorting bug detected, skipping voice enumeration');
          break;
        }
      }
      await sleep(500);
    }

    // Try getSupportedLanguages as secondary fallback
    try {
      ttsLog('Trying getSupportedLanguages fallback...');
      const langResult = await withTimeout(plugin.getSupportedLanguages(), 2000, 'getSupportedLanguages');
      const languages = langResult.languages || [];
      ttsLog('Language fallback got: ' + languages.length + ' languages');
      if (languages.length > 0) {
        const langVoices = languages.map(lang => ({
          name: `Voz ${lang}`,
          lang,
          localService: true,
          voiceURI: `lang:${lang}`,
        }));
        return [...langVoices, ...FALLBACK_VOICES];
      }
    } catch (e) {
      ttsWarn('Language fallback failed: ' + getErrorMessage(e));
    }
  }

  // ─── Try Web Speech API (works in Android WebView) ───
  ttsLog('Trying Web Speech API fallback...');
  const webVoices = getWebSpeechVoices();
  if (webVoices.length > 0) {
    ttsLog('Web Speech returned ' + webVoices.length + ' voices');
    return [...webVoices, ...FALLBACK_VOICES];
  }

  // If speechSynthesis exists but voices aren't loaded yet, wait and retry
  if (typeof speechSynthesis !== 'undefined') {
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(600);
      const delayed = getWebSpeechVoices();
      if (delayed.length > 0) {
        ttsLog('Web Speech delayed load: ' + delayed.length + ' voices');
        return [...delayed, ...FALLBACK_VOICES];
      }
    }
  }

  // ─── Last resort: return guaranteed fallback voices ───
  ttsWarn('All voice loading methods failed, returning fallback voices');
  return FALLBACK_VOICES;
}

export async function openNativeTtsInstall(): Promise<boolean> {
  ttsLog('openNativeTtsInstall called, isNative: ' + isNative());
  if (!isNative()) {
    return false;
  }

  const plugin = await getPlugin();
  if (!plugin) {
    ttsWarn('openInstall: no plugin available');
    return false;
  }

  try {
    ttsLog('Calling plugin.openInstall()...');
    await withTimeout(plugin.openInstall(), 5000, 'openInstall');
    ttsLog('openInstall succeeded');
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
  ttsLog('runTTSDiagnostics() called');
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
      ttsLog('Diag: pluginAvailable = ' + diag.pluginAvailable);

      if (plugin) {
        try {
          const langResult = await withTimeout(plugin.getSupportedLanguages(), 3000, 'diag-langs');
          diag.supportedLanguages = (langResult.languages || []).sort();
          diag.pluginReady = true;
          ttsLog('Diag: pluginReady, langs = ' + diag.supportedLanguages.length);
        } catch (e) {
          ttsWarn('Diag: getSupportedLanguages failed: ' + getErrorMessage(e));
        }

        try {
          const voiceResult = await withTimeout(plugin.getSupportedVoices(), 3000, 'diag-voices');
          diag.voiceCount = (voiceResult.voices || []).length;
          ttsLog('Diag: voiceCount = ' + diag.voiceCount);
        } catch (e) {
          const msg = getErrorMessage(e);
          ttsWarn('Diag: getSupportedVoices failed: ' + msg);
          // Capture this as the last error for display
          if (msg.includes('Comparison method')) {
            diag.lastError = 'Bug Android: erro de sorting nas vozes. O motor TTS pode funcionar mesmo assim.';
          }
        }
      }
    } catch (e) {
      ttsWarn('Diag: plugin load failed: ' + getErrorMessage(e));
    }
  }

  if (diag.webSpeechAvailable) {
    try { diag.webSpeechVoiceCount = speechSynthesis.getVoices().length; } catch {}
    ttsLog('Diag: webSpeechVoiceCount = ' + diag.webSpeechVoiceCount);
  }

  // Evita exibir erro antigo quando o motor nativo já está operacional
  if (diag.isNativePlatform && diag.pluginReady) {
    clearDiagError();
    diag.lastError = null;
  }

  ttsLog('Diagnostics result: ' + JSON.stringify(diag));
  return diag;
}

// FIX #3: Reduced timeout from 30s to 15s for faster failure detection
const SPEAK_TIMEOUT_MS = 15000;

/**
 * Speak text — tries native plugin first, falls back to Web Speech API.
 * Returns info about which engine was used.
 *
 * FIX #2: Accepts voiceURI instead of numeric index for reliable voice matching.
 */
export async function nativeSpeak(options: {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceURI?: string;
}): Promise<{ engine: string }> {
  ttsLog('nativeSpeak: textLen=' + options.text.length + ' lang=' + options.lang + ' rate=' + options.rate + ' voiceURI=' + options.voiceURI + ' isNative=' + isNative());

  // ─── Strategy 1: Try native Capacitor plugin FIRST ───
  const plugin = await getPlugin();
  ttsLog('nativeSpeak: plugin=' + !!plugin);

  if (plugin) {
    let requestedLang = options.lang;
    let triedWithoutVoice = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resolvedLang = await resolveBestPluginLanguage(plugin, requestedLang);
        ttsLog('resolvedLang = ' + resolvedLang);

        // FIX #2: Resolve voice by URI instead of using raw index
        const voiceIndex = triedWithoutVoice ? undefined : await resolveVoiceIndex(plugin, options.voiceURI);
        ttsLog('voiceIndex = ' + voiceIndex);

        const speakOptions: any = {
          text: options.text,
          lang: resolvedLang,
          rate: options.rate || 1.0,
          pitch: options.pitch || 1.0,
          volume: 1.0,
        };

        // Only set voice index when we successfully resolved one
        if (voiceIndex !== undefined && voiceIndex >= 0) {
          speakOptions.voice = voiceIndex;
        }

        ttsLog('Calling plugin.speak: ' + JSON.stringify(speakOptions));
        await withTimeout(plugin.speak(speakOptions), SPEAK_TIMEOUT_MS, 'plugin.speak');
        clearDiagError();
        ttsLog('plugin.speak succeeded');
        return { engine: `capacitor-plugin(${resolvedLang})` };
      } catch (error) {
        const message = getErrorMessage(error);
        const lower = message.toLowerCase();
        ttsWarn(`Plugin speak failed (attempt ${attempt + 1}): ${message}`);

        if (lower.includes('this language is not supported')) {
          requestedLang = undefined;
          continue;
        }

        if (lower.includes('not yet initialized')) {
          await sleep(450);
          continue;
        }

        if (isNoEngineError(lower)) {
          ttsWarn('No TTS engine on device, opening install...');
          await openNativeTtsInstall();
        }

        if (lower.includes('timeout')) {
          ttsWarn('Timeout detected, breaking retry loop');
          break;
        }

        // If we had a voice set, retry once without voice (default system voice)
        if (!triedWithoutVoice && options.voiceURI) {
          ttsLog('Retrying without specific voice...');
          triedWithoutVoice = true;
          continue;
        }

        break;
      }
    }
  }

  // ─── Strategy 2: Try Web Speech API as fallback ───
  ttsLog('Falling back to Web Speech API...');
  const webResult = await tryWebSpeech(options);
  if (webResult) {
    clearDiagError();
    ttsLog('Web Speech succeeded: ' + webResult.engine);
    return webResult;
  }

  // ─── Strategy 3: Cloud TTS fallback (ElevenLabs → Google → Edge TTS) ───
  ttsLog('All local engines failed. Trying Cloud TTS...');
  try {
    const cloudResult = await cloudSpeak({
      text: options.text,
      lang: options.lang || 'pt-BR',
      rate: options.rate,
      pitch: options.pitch,
    });
    clearDiagError();
    ttsLog('Cloud TTS succeeded: ' + cloudResult.engine);
    return cloudResult;
  } catch (cloudErr) {
    const cloudMsg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
    ttsWarn('Cloud TTS also failed: ' + cloudMsg);
  }

  // FIX #5: Descriptive error message for the caller to display
  throw new Error('Nenhum motor de voz produziu áudio (local e nuvem falharam). Verifique sua conexão de internet ou instale um motor TTS nas configurações do Android.');
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
    ttsLog('speechSynthesis not available');
    return Promise.resolve(null);
  }

  return new Promise<{ engine: string } | null>((resolve) => {
    // Cancel any ongoing speech first
    try { speechSynthesis.cancel(); } catch {}

    const doSpeak = () => {
      try {
        const voices = speechSynthesis.getVoices();
        ttsLog('WebSpeech doSpeak: ' + voices.length + ' voices available');

        // FIX #5: If no real voices loaded, Web Speech can't produce audio — bail with log
        if (voices.length === 0) {
          ttsWarn('WebSpeech has 0 voices — cannot produce audio');
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
          ttsLog('Using WebSpeech voice: ' + match.name + ' (' + match.lang + ')');
        }

        let settled = false;
        const settle = (result: { engine: string } | null) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        utterance.onend = () => settle({ engine: `webSpeech(${match?.name || 'default'})` });
        utterance.onerror = (e) => {
          ttsWarn('WebSpeech error: ' + e.error);
          if (e.error === 'canceled' || e.error === 'interrupted') {
            settle({ engine: 'webSpeech-canceled' });
          } else {
            settle(null); // Let caller try next engine
          }
        };

        // FIX #3: Reduced safety timeout from 10s to 8s
        setTimeout(() => {
          if (!settled) {
            ttsWarn('WebSpeech timeout, no onend/onerror fired');
            settle(null);
          }
        }, 8000);

        speechSynthesis.speak(utterance);
        ttsLog('speechSynthesis.speak() called');
      } catch (e) {
        ttsWarn('WebSpeech doSpeak exception: ' + getErrorMessage(e));
        resolve(null);
      }
    };

    // Ensure voices are loaded
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      ttsLog('No voices yet, waiting for onvoiceschanged...');
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
  // Stop cloud audio if playing
  cloudStop();
}
