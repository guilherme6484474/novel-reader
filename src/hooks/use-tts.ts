import { useState, useRef, useCallback, useEffect } from "react";
import { isNative, getNativeVoices, nativeSpeak, nativeStop, openNativeTtsInstall, runTTSDiagnostics, setDiagError, type TTSDiagnostics } from "@/lib/native-tts";
import { ttsLog, ttsError } from "@/lib/tts-debug-log";
import { toast } from "sonner";
import { acquireWakeLock, releaseWakeLock, setMediaSessionHandlers, updateMediaSessionPlaybackState } from "@/lib/keep-awake";
import { startForegroundService, stopForegroundService } from "@/lib/foreground-service";

import { getTTSEngine } from "@/lib/native-tts";
import { EDGE_TTS_VOICES, fetchEdgeTtsAudio } from "@/lib/edge-tts";
import { KOKORO_VOICES, fetchKokoroTtsAudio, isKokoroVoice, kokoroVoiceId, onKokoroLoadProgress, isKokoroLoaded } from "@/lib/kokoro-tts";

// Chunk sizes per engine
const MAX_CHUNK_NATIVE = 4000; // Native Android/iOS TTS handles long input well
const MAX_CHUNK_WEBSPEECH = 200; // WebSpeech works best with short utterances
const MAX_CHUNK_EDGE = 1500; // Edge TTS: keep MP3 size reasonable for fast first-play
const MAX_CHUNK_KOKORO = 500; // Kokoro runs on CPU — keep chunks short so first audio arrives quickly

type RuntimeTTSEngine = 'webspeech' | 'native' | 'edge' | 'kokoro';

function getMaxChunkChars(): number {
  const engine = getTTSEngine();
  if (engine === 'edge') return MAX_CHUNK_EDGE;
  if (engine === 'kokoro') return MAX_CHUNK_KOKORO;
  if (!isNative() && engine === 'webspeech') return MAX_CHUNK_WEBSPEECH;
  return MAX_CHUNK_NATIVE;
}

function splitIntoSentences(text: string, maxChunk = getMaxChunkChars()): string[] {
  const parts: string[] = [];
  const regex = /[^.!?\n]+[.!?\n]+\s*/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    parts.push(match[0]);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    const remainder = text.slice(lastIndex);
    if (remainder.trim()) parts.push(remainder);
  }

  if (parts.length === 0 && text.trim()) return [text];

  const merged: string[] = [];
  let buffer = "";
  for (const part of parts) {
    if (buffer.length + part.length <= maxChunk) {
      buffer += part;
    } else {
      if (buffer) merged.push(buffer);
      if (part.length > maxChunk) {
        let remaining = part;
        while (remaining.length > maxChunk) {
          let splitAt = remaining.lastIndexOf('. ', maxChunk);
          if (splitAt <= 0) splitAt = remaining.lastIndexOf(', ', maxChunk);
          if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', maxChunk);
          if (splitAt <= 0) splitAt = maxChunk;
          else splitAt += 1;
          merged.push(remaining.slice(0, splitAt));
          remaining = remaining.slice(splitAt);
        }
        buffer = remaining;
      } else {
        buffer = part;
      }
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
}

function splitTextForPlayback(text: string): string[] {
  return splitIntoSentences(text);
}

function buildWordMap(text: string): { word: string; start: number }[] {
  const words: { word: string; start: number }[] = [];
  const regex = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    words.push({ word: m[0], start: m.index });
  }
  return words;
}

// Unified voice type for both native and web
export interface TTSVoice {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

function normalizeVoices(rawVoices: TTSVoice[]): TTSVoice[] {
  const seen = new Map<string, number>();

  return rawVoices
    .map((voice, index) => {
      const baseName = (voice.name || voice.voiceURI || `${voice.lang || 'Voice'} ${index + 1}`).trim();
      const fallbackName = baseName || `Voice ${index + 1}`;
      const occurrences = seen.get(fallbackName) || 0;
      seen.set(fallbackName, occurrences + 1);

      return {
        ...voice,
        name: occurrences > 0 ? `${fallbackName} #${occurrences + 1}` : fallbackName,
        lang: (voice.lang || 'und').trim() || 'und',
        voiceURI: voice.voiceURI || fallbackName,
      };
    })
    .filter(v => v.name.trim().length > 0);
}

function getPreferredRuntimeEngine(): RuntimeTTSEngine {
  const engine = getTTSEngine();
  if (engine === 'native' || engine === 'edge' || engine === 'kokoro' || engine === 'webspeech') return engine;
  return isNative() ? 'native' : 'webspeech';
}

function getRuntimeCandidates(preferred: RuntimeTTSEngine): RuntimeTTSEngine[] {
  const platformDefaults: RuntimeTTSEngine[] = isNative()
    ? ['native', 'webspeech', 'edge', 'kokoro']
    : ['webspeech', 'edge', 'kokoro', 'native'];
  return [preferred, ...platformDefaults.filter(engine => engine !== preferred)];
}

function chooseRuntimeEngine(preferred: RuntimeTTSEngine, failed: Set<RuntimeTTSEngine>): RuntimeTTSEngine | null {
  return getRuntimeCandidates(preferred).find(engine => !failed.has(engine)) || null;
}

function runtimeEngineLabel(engine: RuntimeTTSEngine): string {
  if (engine === 'edge') return 'Edge TTS';
  if (engine === 'kokoro') return 'Kokoro TTS';
  if (engine === 'native') return 'motor nativo';
  return 'Web Speech';
}

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => localStorage.getItem('nr-ttsVoice') || "");
  const [rate, setRate] = useState(() => Number(localStorage.getItem('nr-ttsRate')) || 1);
  const [pitch, setPitch] = useState(() => Number(localStorage.getItem('nr-ttsPitch')) || 1);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);
  const [debugInfo, setDebugInfo] = useState("Initializing...");

  const useNativeRef = useRef(isNative());
  const onEndCallbackRef = useRef<(() => void) | null>(null);
  const onNextChapterRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<string[]>([]);
  const chunkOffsetsRef = useRef<number[]>([]);
  const currentChunkRef = useRef(0);
  const textRef = useRef("");
  const speakingRef = useRef(false);
  const pausedRef = useRef(false);
  const boundaryFiredRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const chunkStartTimeRef = useRef(0);
  const calibratedCpsRef = useRef(Number(localStorage.getItem('nr-ttsCps')) || 0);
  const calibratedRateRef = useRef(Number(localStorage.getItem('nr-ttsCpsRate')) || 1);
  const installPromptShownRef = useRef(false);
  const lastUiUpdateRef = useRef({ ts: 0, charIndex: -1 });

  // Edge TTS playback: a single shared HTMLAudioElement and the current blob URL.
  const edgeAudioRef = useRef<HTMLAudioElement | null>(null);
  const edgeBlobUrlRef = useRef<string | null>(null);
  const edgePrefetchRef = useRef<{ chunkIndex: number; url: Promise<string> } | null>(null);

  // If a selected/cloud/local engine fails during a reading session, keep the
  // fallback engine for the remaining chunks instead of retrying the broken one.
  const runtimeEngineRef = useRef<RuntimeTTSEngine | null>(null);
  const fallbackNoticeShownRef = useRef(false);
  const failedEnginesRef = useRef<Set<RuntimeTTSEngine>>(new Set());
  const fallbackChunkRef = useRef<((failedEngine: RuntimeTTSEngine, chunkIndex: number, gen: number, reason: string) => boolean) | null>(null);

  // FIX #1: Generation counter to prevent race conditions
  const generationRef = useRef(0);

  const selectedVoiceRef = useRef(selectedVoice);
  const rateRef = useRef(rate);
  const pitchRef = useRef(pitch);

  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);

  // Load voices — native or web
  useEffect(() => {
    let cancelled = false;

    const SYSTEM_DEFAULT_VOICES: TTSVoice[] = [
      { name: '🔊 Voz padrão do sistema', lang: 'pt-BR', localService: true, voiceURI: '__system_default__' },
      { name: '🔊 System default voice', lang: 'en-US', localService: true, voiceURI: '__system_default_en__' },
    ];

    const pickDefaultVoice = (available: TTSVoice[]) => {
      if (available.length === 0) return;
      setSelectedVoice(prev => {
        if (prev && available.some(v => v.name === prev)) return prev;

        const nonSystemVoices = available.filter(v => !v.voiceURI.startsWith('__system_default'));
        const pool = nonSystemVoices.length > 0 ? nonSystemVoices : available;

        const deviceLang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
        const langPrefix = deviceLang.split('-')[0];

        const exactDevice = pool.find(v => v.lang.toLowerCase() === deviceLang);
        const sameFamily = langPrefix ? pool.find(v => v.lang.toLowerCase().startsWith(langPrefix)) : undefined;
        const ptVoice = pool.find(v => v.lang.startsWith('pt'));

        return exactDevice?.name || sameFamily?.name || ptVoice?.name || pool[0].name;
      });
    };

    const applyVoices = (available: TTSVoice[]) => {
      if (cancelled) return;
      setVoices(available);
      pickDefaultVoice(available);
    };

    const ensureVoices = (mapped: TTSVoice[]): TTSVoice[] => {
      if (mapped.length === 0) return SYSTEM_DEFAULT_VOICES;
      if (mapped.some(v => v.voiceURI.startsWith('__system_default'))) return mapped;
      return mapped;
    };

    // Always append Edge TTS + Kokoro voices so the user can pick them once the
    // corresponding engine is selected. The engine router decides which one is used.
    const withEdgeVoices = (list: TTSVoice[]): TTSVoice[] => [...list, ...EDGE_TTS_VOICES, ...KOKORO_VOICES];

    const loadNativeVoices = async () => {
      applyVoices(withEdgeVoices(SYSTEM_DEFAULT_VOICES));
      setDebugInfo(`Native=${useNativeRef.current}, WebSpeech=${typeof speechSynthesis !== 'undefined'}, loading...`);

      try {
        const timeoutMs = 8000;
        const timeoutFallback = new Promise<Awaited<ReturnType<typeof getNativeVoices>>>((resolve) => {
          setTimeout(() => resolve(SYSTEM_DEFAULT_VOICES), timeoutMs);
        });

        const nv = await Promise.race([getNativeVoices(), timeoutFallback]);
        const mapped = ensureVoices(normalizeVoices(nv.map(v => ({
          name: v.name,
          lang: v.lang,
          localService: v.localService,
          voiceURI: v.voiceURI || '',
        }))));

        const pluginCount = mapped.filter(v => !v.voiceURI.startsWith('__system_default')).length;
        setDebugInfo(
          pluginCount > 0
            ? `OK: ${mapped.length} voices (${pluginCount} from engine). Native=${useNativeRef.current}`
            : `Sem vozes reais do motor Android. Usando fallback do sistema (${mapped.length}).`
        );
        applyVoices(withEdgeVoices(mapped));
      } catch (err) {
        console.warn('[TTS] Failed loading voices, using defaults:', err);
        setDebugInfo(`Error loading voices: ${err}. Using defaults.`);
        applyVoices(withEdgeVoices(SYSTEM_DEFAULT_VOICES));
      }
    };

    if (useNativeRef.current) {
      loadNativeVoices();
      return () => { cancelled = true; };
    }

    // Web Speech API
    if (typeof speechSynthesis === 'undefined') {
      applyVoices(withEdgeVoices(SYSTEM_DEFAULT_VOICES));
      return () => { cancelled = true; };
    }

    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      const mapped = normalizeVoices(v.map(sv => ({
        name: sv.name,
        lang: sv.lang,
        localService: sv.localService,
        voiceURI: sv.voiceURI || '',
      })));
      const final = ensureVoices(mapped);
      applyVoices(withEdgeVoices(final));
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      cancelled = true;
      speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const clearWordTimer = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const updatePosition = useCallback((globalCharIndex: number, force = false) => {
    lastUiUpdateRef.current = { ts: Date.now(), charIndex: globalCharIndex };
    void force;

    setActiveCharIndex(globalCharIndex);
    const totalLen = textRef.current.length;
    if (totalLen > 0) setProgress((globalCharIndex / totalLen) * 100);
  }, []);

  const estimateCps = useCallback((speechRate: number): number => {
    if (calibratedCpsRef.current > 0) {
      const rateRatio = speechRate / calibratedRateRef.current;
      const scaledRatio = Math.pow(rateRatio, 0.85);
      return calibratedCpsRef.current * scaledRatio;
    }
    return 14 * Math.pow(speechRate, 0.85);
  }, []);

  const startWordStepper = useCallback((chunkText: string, globalOffset: number, speechRate: number) => {
    const words = buildWordMap(chunkText);
    if (words.length === 0) return;

    const cps = estimateCps(speechRate);
    const estimatedDurationMs = (chunkText.length / cps) * 1000;
    const lastWordStart = words[words.length - 1].start;
    const wordFractions = words.map(w => lastWordStart > 0 ? w.start / lastWordStart : 0);
    let lastWordIdx = -1;

    const step = () => {
      if (!speakingRef.current || pausedRef.current) return;
      const elapsed = performance.now() - chunkStartTimeRef.current;
      const fraction = Math.min(elapsed / estimatedDurationMs, 1);
      let wordIdx = 0;
      for (let i = words.length - 1; i >= 0; i--) {
        if (fraction >= wordFractions[i]) { wordIdx = i; break; }
      }
      if (wordIdx !== lastWordIdx) {
        lastWordIdx = wordIdx;
        updatePosition(globalOffset + words[wordIdx].start);
      }
      if (fraction < 1) rafRef.current = requestAnimationFrame(step);
    };

    updatePosition(globalOffset + words[0].start);
    lastWordIdx = 0;
    rafRef.current = requestAnimationFrame(step);
  }, [updatePosition, estimateCps]);

  const setOnEnd = useCallback((cb: (() => void) | null) => {
    onEndCallbackRef.current = cb;
  }, []);

  const setOnNextChapter = useCallback((cb: (() => void) | null) => {
    onNextChapterRef.current = cb;
  }, []);

  // ─── Native chunk speaker ───
  // FIX #1: Accept generation to detect stale calls
  // FIX #2: Use voiceURI instead of fragile index
  // FIX #4: Check pausedRef to avoid false error on pause stop
  const speakChunkNative = useCallback(async (chunkIndex: number, gen: number) => {
    if (!speakingRef.current || gen !== generationRef.current) return;
    const chunks = chunksRef.current;
    const offsets = chunkOffsetsRef.current;

    if (chunkIndex >= chunks.length) {
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(100);
      setActiveCharIndex(-1);
      clearWordTimer();
      void releaseWakeLock();
      void stopForegroundService();
      onEndCallbackRef.current?.();
      return;
    }

    const chunkText = chunks[chunkIndex];
    const globalOffset = offsets[chunkIndex];
    currentChunkRef.current = chunkIndex;

    updatePosition(globalOffset);
    chunkStartTimeRef.current = performance.now();
    startWordStepper(chunkText, globalOffset, rateRef.current);

    try {
      // FIX #2: Resolve voice by voiceURI, not by fragile array index
      const selectedV = voices.find(v => v.name === selectedVoiceRef.current);
      const isSystemDefault = !selectedV || selectedV.voiceURI.startsWith('__system_default');

      // Get next chunk text for pre-buffering
      const nextChunkText = chunkIndex + 1 < chunks.length ? chunks[chunkIndex + 1] : undefined;

      // Pass voiceURI to nativeSpeak so it can match by URI on the native side
      const result = await nativeSpeak({
        text: chunkText,
        lang: selectedV?.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US'),
        rate: rateRef.current,
        pitch: pitchRef.current,
        voiceURI: isSystemDefault ? undefined : selectedV?.voiceURI,
        nextChunkText,
      });

      if (chunkIndex === 0) {
        setDebugInfo(prev => prev + ` | Engine: ${result.engine}`);
      }

      // Calibrate CPS
      const actualDurationMs = performance.now() - chunkStartTimeRef.current;
      if (actualDurationMs > 100) {
        const actualCps = chunkText.length / (actualDurationMs / 1000);
        if (actualCps > 2 && actualCps < 50) {
          calibratedCpsRef.current = calibratedCpsRef.current > 0
            ? calibratedCpsRef.current * 0.3 + actualCps * 0.7 : actualCps;
          calibratedRateRef.current = rateRef.current;
          localStorage.setItem('nr-ttsCps', String(calibratedCpsRef.current));
          localStorage.setItem('nr-ttsCpsRate', String(calibratedRateRef.current));
        }
      }

      clearWordTimer();

      // FIX #1: Check generation before advancing to next chunk
      if (speakingRef.current && gen === generationRef.current && !pausedRef.current) {
        speakChunkNative(chunkIndex + 1, gen);
      }
    } catch (e) {
      // Stale generation (paused, stopped, or new speak session) — ignore silently
      if (gen !== generationRef.current) {
        clearWordTimer();
        return;
      }

      const message = e instanceof Error ? e.message : String(e);
      console.warn('[NativeTTS] speak error:', message);
      setDiagError(message);

      if (/install\/enable an android tts engine|not available on this device|not yet initialized/i.test(message)) {
        setDebugInfo('Motor TTS Android indisponível. Abrindo instalação/configuração do motor de voz...');
        if (!installPromptShownRef.current) {
          installPromptShownRef.current = true;
          void openNativeTtsInstall();
        }
      }

      clearWordTimer();
      const fallbackStarted = fallbackChunkRef.current?.('native', chunkIndex, gen, message);
      if (!fallbackStarted) {
        toast.error("Erro no motor de voz", {
          description: message.length > 100 ? message.slice(0, 100) + '…' : message,
          duration: 5000,
        });
        speakingRef.current = false;
        setIsSpeaking(false);
        setIsPaused(false);
        setActiveCharIndex(-1);
      }
    }
  }, [clearWordTimer, updatePosition, startWordStepper, voices]);

  // ─── Web Speech API chunk speaker ───
  const speakChunkWeb = useCallback((chunkIndex: number, gen: number) => {
    if (!speakingRef.current || gen !== generationRef.current) return;
    const chunks = chunksRef.current;
    const offsets = chunkOffsetsRef.current;

    if (chunkIndex >= chunks.length) {
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(100);
      setActiveCharIndex(-1);
      clearWordTimer();
      updateMediaSessionPlaybackState('none');
      void releaseWakeLock();
      void stopForegroundService();
      onEndCallbackRef.current?.();
      return;
    }

    const chunkText = chunks[chunkIndex];
    const globalOffset = offsets[chunkIndex];
    currentChunkRef.current = chunkIndex;
    boundaryFiredRef.current = false;

    updatePosition(globalOffset);

    const utterance = new SpeechSynthesisUtterance(chunkText);
    if (typeof speechSynthesis !== 'undefined') {
      const webVoices = speechSynthesis.getVoices();
      const voice = webVoices.find(v => v.name === selectedVoiceRef.current);
      if (voice) utterance.voice = voice;
    }
    utterance.rate = rateRef.current;
    utterance.pitch = pitchRef.current;

    utterance.onboundary = (e) => {
      if (e.name === 'word') {
        if (!boundaryFiredRef.current) {
          boundaryFiredRef.current = true;
          clearWordTimer();
        }
        updatePosition(globalOffset + e.charIndex);
      }
    };

    utterance.onstart = () => {
      if (gen !== generationRef.current) return;
      chunkStartTimeRef.current = performance.now();
      if (!boundaryFiredRef.current && speakingRef.current) {
        startWordStepper(chunkText, globalOffset, rateRef.current);
      }
    };

    utterance.onend = () => {
      if (gen !== generationRef.current) return;
      clearWordTimer();
      if (!boundaryFiredRef.current && chunkStartTimeRef.current > 0) {
        const actualDurationMs = performance.now() - chunkStartTimeRef.current;
        if (actualDurationMs > 100) {
          const actualCps = chunkText.length / (actualDurationMs / 1000);
          if (actualCps > 2 && actualCps < 50) {
            calibratedCpsRef.current = calibratedCpsRef.current > 0
              ? calibratedCpsRef.current * 0.3 + actualCps * 0.7 : actualCps;
            calibratedRateRef.current = rateRef.current;
            localStorage.setItem('nr-ttsCps', String(calibratedCpsRef.current));
            localStorage.setItem('nr-ttsCpsRate', String(calibratedRateRef.current));
          }
        }
      }
      speakChunkWeb(chunkIndex + 1, gen);
    };

    utterance.onerror = (e) => {
      if (gen !== generationRef.current || e.error === 'canceled' || e.error === 'interrupted') return;
      clearWordTimer();

      const errorMsg = e.error || "unknown";
      ttsError(`WebSpeech chunk ${chunkIndex} error: ${errorMsg}`);

      // Auto-retry once, then fallback to Cloud TTS
      const retryKey = `ws-retry-${gen}-${chunkIndex}`;
      const alreadyRetried = (window as any)[retryKey];
      if (!alreadyRetried) {
        (window as any)[retryKey] = true;
        ttsLog(`Retrying WebSpeech chunk ${chunkIndex}...`);
        setTimeout(() => {
          if (gen === generationRef.current && speakingRef.current) {
            speechSynthesis.cancel();
            speakChunkWeb(chunkIndex, gen);
          }
        }, 300);
        return;
      }

      ttsLog(`WebSpeech failed after retry, switching engine`);
      speechSynthesis.cancel();
      const fallbackStarted = fallbackChunkRef.current?.('webspeech', chunkIndex, gen, errorMsg);
      if (!fallbackStarted) {
        toast.error("Web Speech falhou", {
          description: "Nenhum outro motor de voz conseguiu iniciar neste dispositivo.",
          duration: 5000,
        });
        speakingRef.current = false;
        setIsSpeaking(false);
        setIsPaused(false);
        setActiveCharIndex(-1);
      }
    };

    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.speak(utterance);
  }, [clearWordTimer, updatePosition, startWordStepper, speakChunkNative]);

  // ─── Edge TTS (experimental) chunk speaker ───
  // Calls the supabase edge function to get MP3 and plays it via HTMLAudioElement.
  // On any failure, automatically falls back to Web Speech / Native for the rest of the chapter.
  const speakChunkEdge = useCallback(async (chunkIndex: number, gen: number) => {
    if (!speakingRef.current || gen !== generationRef.current) return;
    const chunks = chunksRef.current;
    const offsets = chunkOffsetsRef.current;

    if (chunkIndex >= chunks.length) {
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(100);
      setActiveCharIndex(-1);
      clearWordTimer();
      updateMediaSessionPlaybackState('none');
      void releaseWakeLock();
      void stopForegroundService();
      onEndCallbackRef.current?.();
      return;
    }

    const chunkText = chunks[chunkIndex];
    const globalOffset = offsets[chunkIndex];
    currentChunkRef.current = chunkIndex;

    updatePosition(globalOffset);

    const selectedV = voices.find(v => v.name === selectedVoiceRef.current);
    const voiceURI = selectedV?.voiceURI && /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(selectedV.voiceURI)
      ? selectedV.voiceURI
      : 'pt-BR-FranciscaNeural';
    const lang = selectedV?.lang || 'pt-BR';

    const fallbackToWebSpeech = (reason: string) => {
      if (gen !== generationRef.current) return;
      ttsError(`[EdgeTTS] ${reason} — falling back to Web Speech`);
      const fallbackStarted = fallbackChunkRef.current?.('edge', chunkIndex, gen, reason);
      if (!fallbackStarted) {
        toast.error('Edge TTS indisponível', {
          description: 'Nenhum outro motor de voz conseguiu iniciar neste dispositivo.',
          duration: 5000,
        });
        speakingRef.current = false;
        setIsSpeaking(false);
        setIsPaused(false);
        setActiveCharIndex(-1);
      }
    };

    try {
      // Reuse prefetched URL when available
      let urlPromise: Promise<string>;
      if (edgePrefetchRef.current && edgePrefetchRef.current.chunkIndex === chunkIndex) {
        urlPromise = edgePrefetchRef.current.url;
        edgePrefetchRef.current = null;
      } else {
        urlPromise = fetchEdgeTtsAudio({
          text: chunkText,
          voice: voiceURI,
          lang,
          rate: rateRef.current,
          pitch: pitchRef.current,
        });
      }

      const url = await urlPromise;
      if (gen !== generationRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      // Pre-fetch the NEXT chunk in parallel while this one plays
      if (chunkIndex + 1 < chunks.length) {
        const nextIdx = chunkIndex + 1;
        edgePrefetchRef.current = {
          chunkIndex: nextIdx,
          url: fetchEdgeTtsAudio({
            text: chunks[nextIdx],
            voice: voiceURI,
            lang,
            rate: rateRef.current,
            pitch: pitchRef.current,
          }).catch(() => Promise.reject(new Error('prefetch failed'))),
        };
      }

      // Revoke previous blob URL
      if (edgeBlobUrlRef.current) {
        try { URL.revokeObjectURL(edgeBlobUrlRef.current); } catch { /* ignore */ }
      }
      edgeBlobUrlRef.current = url;

      let audio = edgeAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        edgeAudioRef.current = audio;
      }

      audio.src = url;
      audio.playbackRate = 1; // rate already baked into the SSML
      audio.onended = null;
      audio.onerror = null;

      chunkStartTimeRef.current = performance.now();
      startWordStepper(chunkText, globalOffset, rateRef.current);

      const onEnded = () => {
        if (gen !== generationRef.current) return;
        clearWordTimer();
        if (speakingRef.current && !pausedRef.current) {
          void speakChunkEdge(chunkIndex + 1, gen);
        }
      };
      const onAudioError = () => {
        if (gen !== generationRef.current) return;
        clearWordTimer();
        fallbackToWebSpeech('audio playback error');
      };

      audio.onended = onEnded;
      audio.onerror = onAudioError;

      try {
        await audio.play();
        if (chunkIndex === 0) {
          setDebugInfo(prev => prev + ' | Engine: edge-tts');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ttsError(`[EdgeTTS] audio.play() rejected: ${msg}`);
        clearWordTimer();
        fallbackToWebSpeech(msg);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      clearWordTimer();
      fallbackToWebSpeech(msg);
    }
  }, [clearWordTimer, updatePosition, startWordStepper, speakChunkWeb, speakChunkNative, voices]);

  // ─── Kokoro TTS chunk speaker ───
  // Mirrors speakChunkEdge but uses the in-browser Kokoro pipeline. Shares
  // edgeAudioRef/edgeBlobUrlRef/edgePrefetchRef — only one engine plays at a time.
  const speakChunkKokoro = useCallback(async (chunkIndex: number, gen: number) => {
    if (!speakingRef.current || gen !== generationRef.current) return;
    const chunks = chunksRef.current;
    const offsets = chunkOffsetsRef.current;

    if (chunkIndex >= chunks.length) {
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(100);
      setActiveCharIndex(-1);
      clearWordTimer();
      updateMediaSessionPlaybackState('none');
      void releaseWakeLock();
      void stopForegroundService();
      onEndCallbackRef.current?.();
      return;
    }

    const chunkText = chunks[chunkIndex];
    const globalOffset = offsets[chunkIndex];
    currentChunkRef.current = chunkIndex;
    updatePosition(globalOffset);

    const selectedV = voices.find(v => v.name === selectedVoiceRef.current);
    const voiceId = isKokoroVoice(selectedV?.voiceURI) ? kokoroVoiceId(selectedV!.voiceURI) : 'af_heart';

    const fallbackEngine = (reason: string) => {
      if (gen !== generationRef.current) return;
      ttsError(`[KokoroTTS] ${reason} — falling back`);
      const fallbackStarted = fallbackChunkRef.current?.('kokoro', chunkIndex, gen, reason);
      if (!fallbackStarted) {
        toast.error('Kokoro TTS indisponível', {
          description: 'Nenhum outro motor de voz conseguiu iniciar neste dispositivo.',
          duration: 5000,
        });
        speakingRef.current = false;
        setIsSpeaking(false);
        setIsPaused(false);
        setActiveCharIndex(-1);
      }
    };

    // First-load notice — Kokoro downloads ~85MB on the first run.
    if (chunkIndex === 0 && !isKokoroLoaded()) {
      toast.info('Carregando Kokoro TTS…', {
        description: 'Primeira execução baixa ~85MB. Próximas vezes inicia instantaneamente.',
        duration: 6000,
      });
      onKokoroLoadProgress((pct) => {
        setDebugInfo(prev => prev.replace(/ \| Kokoro: \d+%$/, '') + ` | Kokoro: ${Math.round(pct)}%`);
      });
    }

    try {
      let urlPromise: Promise<string>;
      if (edgePrefetchRef.current && edgePrefetchRef.current.chunkIndex === chunkIndex) {
        urlPromise = edgePrefetchRef.current.url;
        edgePrefetchRef.current = null;
      } else {
        urlPromise = fetchKokoroTtsAudio({ text: chunkText, voice: voiceId });
      }

      const url = await urlPromise;
      if (gen !== generationRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      // Pre-fetch the NEXT chunk in parallel
      if (chunkIndex + 1 < chunks.length) {
        const nextIdx = chunkIndex + 1;
        const nextSelectedV = voices.find(v => v.name === selectedVoiceRef.current);
        const nextVoiceId = isKokoroVoice(nextSelectedV?.voiceURI) ? kokoroVoiceId(nextSelectedV!.voiceURI) : 'af_heart';
        edgePrefetchRef.current = {
          chunkIndex: nextIdx,
          url: fetchKokoroTtsAudio({ text: chunks[nextIdx], voice: nextVoiceId })
            .catch(() => Promise.reject(new Error('prefetch failed'))),
        };
      }

      if (edgeBlobUrlRef.current) {
        try { URL.revokeObjectURL(edgeBlobUrlRef.current); } catch { /* ignore */ }
      }
      edgeBlobUrlRef.current = url;

      let audio = edgeAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        edgeAudioRef.current = audio;
      }
      audio.src = url;
      audio.playbackRate = rateRef.current; // Kokoro audio is at natural speed; let HTMLAudio scale
      audio.onended = null;
      audio.onerror = null;

      chunkStartTimeRef.current = performance.now();
      startWordStepper(chunkText, globalOffset, rateRef.current);

      audio.onended = () => {
        if (gen !== generationRef.current) return;
        clearWordTimer();
        if (speakingRef.current && !pausedRef.current) {
          void speakChunkKokoro(chunkIndex + 1, gen);
        }
      };
      audio.onerror = () => {
        if (gen !== generationRef.current) return;
        clearWordTimer();
        fallbackEngine('audio playback error');
      };

      try {
        await audio.play();
        if (chunkIndex === 0) setDebugInfo(prev => prev + ' | Engine: kokoro-tts');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ttsError(`[KokoroTTS] audio.play() rejected: ${msg}`);
        clearWordTimer();
        fallbackEngine(msg);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      clearWordTimer();
      fallbackEngine(msg);
    }
  }, [clearWordTimer, updatePosition, startWordStepper, speakChunkWeb, speakChunkNative, voices]);

  // ─── Unified speak function ───
  // Routes to the correct speaker and switches engines when one fails.
  const runChunkWithEngine = useCallback((engine: RuntimeTTSEngine, chunkIndex: number, gen: number) => {
    if (engine === 'edge') {
      void speakChunkEdge(chunkIndex, gen);
    } else if (engine === 'kokoro') {
      void speakChunkKokoro(chunkIndex, gen);
    } else if (engine === 'webspeech') {
      speakChunkWeb(chunkIndex, gen);
    } else {
      void speakChunkNative(chunkIndex, gen);
    }
  }, [speakChunkNative, speakChunkWeb, speakChunkEdge, speakChunkKokoro]);

  const fallbackChunk = useCallback((failedEngine: RuntimeTTSEngine, chunkIndex: number, gen: number, reason: string): boolean => {
    if (gen !== generationRef.current || !speakingRef.current) return false;
    failedEnginesRef.current.add(failedEngine);
    edgePrefetchRef.current = null;

    const preferred = runtimeEngineRef.current || getPreferredRuntimeEngine();
    const nextEngine = chooseRuntimeEngine(preferred, failedEnginesRef.current);
    if (!nextEngine) return false;

    runtimeEngineRef.current = nextEngine;
    setDebugInfo(prev => `${prev} | Fallback: ${runtimeEngineLabel(failedEngine)} → ${runtimeEngineLabel(nextEngine)}`);
    if (!fallbackNoticeShownRef.current) {
      fallbackNoticeShownRef.current = true;
      toast.warning(`${runtimeEngineLabel(failedEngine)} indisponível`, {
        description: `Tentando ${runtimeEngineLabel(nextEngine)} automaticamente.`,
        duration: 4000,
      });
    }
    ttsLog(`[TTS] fallback ${failedEngine} -> ${nextEngine}: ${reason}`);
    runChunkWithEngine(nextEngine, chunkIndex, gen);
    return true;
  }, [runChunkWithEngine]);

  useEffect(() => {
    fallbackChunkRef.current = fallbackChunk;
    return () => { fallbackChunkRef.current = null; };
  }, [fallbackChunk]);

  const speakChunk = useCallback((chunkIndex: number, gen: number) => {
    const preferred = runtimeEngineRef.current || getPreferredRuntimeEngine();
    const engine = chooseRuntimeEngine(preferred, failedEnginesRef.current);
    if (!engine) {
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
      toast.error('Nenhum motor de voz disponível', {
        description: 'Teste outro motor nas configurações de voz do app ou instale uma voz no sistema.',
        duration: 6000,
      });
      return;
    }
    runtimeEngineRef.current = engine;
    runChunkWithEngine(engine, chunkIndex, gen);
  }, [runChunkWithEngine]);

  const cancelCurrentSpeech = useCallback(async (resetUi: boolean) => {
    // Increment generation to invalidate all in-flight chunk callbacks
    generationRef.current++;
    speakingRef.current = false;
    pausedRef.current = false;
    lastUiUpdateRef.current = { ts: 0, charIndex: -1 };

    const stopPromise = nativeStop().catch(() => {});

    clearWordTimer();
    chunksRef.current = [];
    chunkOffsetsRef.current = [];

    // Stop and release Edge TTS audio resources
    if (edgeAudioRef.current) {
      try { edgeAudioRef.current.pause(); edgeAudioRef.current.src = ''; } catch { /* ignore */ }
    }
    if (edgeBlobUrlRef.current) {
      try { URL.revokeObjectURL(edgeBlobUrlRef.current); } catch { /* ignore */ }
      edgeBlobUrlRef.current = null;
    }
    edgePrefetchRef.current = null;
    if (typeof speechSynthesis !== 'undefined') {
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
    }

    if (resetUi) {
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(0);
      setActiveCharIndex(-1);
    }

    // Wait for stop to finish but don't block UI state reset
    await stopPromise;
  }, [clearWordTimer]);

  const speakFromIndex = useCallback(async (text: string, startCharIndex = 0) => {
    await cancelCurrentSpeech(false);

    const textToSpeak = text.slice(startCharIndex);
    textRef.current = text;

    if (!textToSpeak.trim()) {
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(0);
      setActiveCharIndex(-1);
      return;
    }

    const chunks = splitTextForPlayback(textToSpeak);
    chunksRef.current = chunks;

    const offsets: number[] = [];
    let offset = startCharIndex;
    for (const chunk of chunks) {
      offsets.push(offset);
      offset += chunk.length;
    }
    chunkOffsetsRef.current = offsets;

    // FIX #1: New generation for this speak session
    const gen = ++generationRef.current;
    lastUiUpdateRef.current = { ts: 0, charIndex: -1 };
    speakingRef.current = true;
    pausedRef.current = false;
    setIsSpeaking(true);
    setIsPaused(false);
    setActiveCharIndex(startCharIndex);

    speakChunk(0, gen);
  }, [speakChunk, cancelCurrentSpeech]);

  // Improved pause — increment generation to kill in-flight async operations
  const pause = useCallback(() => {
    pausedRef.current = true;
    speakingRef.current = false;
    setIsPaused(true);
    clearWordTimer();
    updateMediaSessionPlaybackState('paused');

    // For Edge TTS we can pause the audio element without losing playback position
    const engine = getTTSEngine();
    if ((engine === 'edge' || engine === 'kokoro') && edgeAudioRef.current) {
      try { edgeAudioRef.current.pause(); } catch { /* ignore */ }
      return;
    }

    // For Native/WebSpeech we cancel — resume restarts the current chunk
    generationRef.current++;
    void nativeStop();
    if (typeof speechSynthesis !== 'undefined') {
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
    }
  }, [clearWordTimer]);

  // Improved resume — new generation prevents stale callbacks from interfering
  const resume = useCallback(() => {
    if (chunksRef.current.length === 0) return;
    pausedRef.current = false;
    speakingRef.current = true;
    setIsPaused(false);
    setIsSpeaking(true);
    updateMediaSessionPlaybackState('playing');

    const engine = getTTSEngine();
    if ((engine === 'edge' || engine === 'kokoro') && edgeAudioRef.current && edgeAudioRef.current.src) {
      // Resume from current position in the MP3 — restart word stepper too
      chunkStartTimeRef.current = performance.now() - (edgeAudioRef.current.currentTime * 1000);
      startWordStepper(
        chunksRef.current[currentChunkRef.current] || '',
        chunkOffsetsRef.current[currentChunkRef.current] || 0,
        rateRef.current,
      );
      void edgeAudioRef.current.play().catch(() => {
        const gen = ++generationRef.current;
        speakChunk(currentChunkRef.current, gen);
      });
      return;
    }

    const gen = ++generationRef.current;
    speakChunk(currentChunkRef.current, gen);
  }, [speakChunk, startWordStepper]);

  const stop = useCallback(async () => {
    await cancelCurrentSpeech(true);
    await releaseWakeLock();
    await stopForegroundService();
  }, [cancelCurrentSpeech]);

  const speak = useCallback(async (text: string) => {
    ttsLog('[useTTS] speak() called, textLen=' + text.length);
    setIsLoading(true);
    try {
      // Wire lock-screen media controls synchronously (web only)
      setMediaSessionHandlers({
        onPause: () => pause(),
        onPlay: () => resume(),
        onStop: () => { void stop(); },
        onNextTrack: () => { onNextChapterRef.current?.(); },
      });

      // Start playback IMMEDIATELY — don't wait for foreground service/wake lock
      // These run in background and are not required for audio to start
      const bgSetup = Promise.all([
        startForegroundService().catch(e => ttsError('[useTTS] FG service failed: ' + String(e))),
        acquireWakeLock().catch(e => ttsError('[useTTS] Wake lock failed: ' + String(e))),
      ]);

      // Start speaking without waiting for background setup
      await speakFromIndex(text, 0);

      // Ensure background setup completes (non-blocking for the user)
      await bgSetup;
    } catch (e) {
      ttsError('[useTTS] speak() error: ' + (e instanceof Error ? e.message : String(e)));
      await releaseWakeLock();
      await stopForegroundService();
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [speakFromIndex, pause, resume, stop]);

  return {
    isSpeaking, isPaused, isLoading, progress, voices, selectedVoice,
    rate, setRate, pitch, setPitch, setSelectedVoice, speak, speakFromIndex, pause, resume, stop,
    activeCharIndex, setOnEnd, setOnNextChapter, isNativeTTS: useNativeRef.current,
    debugInfo, runDiagnostics: runTTSDiagnostics, openInstall: openNativeTtsInstall,
  };
}
