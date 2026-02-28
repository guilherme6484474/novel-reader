import { useState, useRef, useCallback, useEffect } from "react";
import { isNative, getNativeVoices, nativeSpeak, nativeStop, openNativeTtsInstall, runTTSDiagnostics, setDiagError, type TTSDiagnostics } from "@/lib/native-tts";
import { ttsLog, ttsError } from "@/lib/tts-debug-log";
import { toast } from "sonner";
import { acquireWakeLock, releaseWakeLock } from "@/lib/keep-awake";
import { startForegroundService, stopForegroundService } from "@/lib/foreground-service";

// Small chunks for Web Speech (needs frequent boundary events), large for Cloud TTS
const MAX_CHUNK_WEB = 80;
const MAX_CHUNK_CLOUD = 4000; // Google Cloud TTS supports up to 5000 chars

function getMaxChunkChars(): number {
  return isNative() ? MAX_CHUNK_CLOUD : MAX_CHUNK_WEB;
}

function splitIntoSentences(text: string): string[] {
  const maxChunk = getMaxChunkChars();
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

    const loadNativeVoices = async () => {
      applyVoices(SYSTEM_DEFAULT_VOICES);
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
        applyVoices(mapped);
      } catch (err) {
        console.warn('[TTS] Failed loading voices, using defaults:', err);
        setDebugInfo(`Error loading voices: ${err}. Using defaults.`);
        applyVoices(SYSTEM_DEFAULT_VOICES);
      }
    };

    if (useNativeRef.current) {
      loadNativeVoices();
      return () => { cancelled = true; };
    }

    // Web Speech API
    if (typeof speechSynthesis === 'undefined') {
      applyVoices(SYSTEM_DEFAULT_VOICES);
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
      applyVoices(final);
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

  const updatePosition = useCallback((globalCharIndex: number) => {
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

      // Pass voiceURI to nativeSpeak so it can match by URI on the native side
      const result = await nativeSpeak({
        text: chunkText,
        lang: selectedV?.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US'),
        rate: rateRef.current,
        pitch: pitchRef.current,
        voiceURI: isSystemDefault ? undefined : selectedV?.voiceURI,
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
      // FIX #4: If paused, the stop() call caused this error — don't reset state
      if (pausedRef.current) {
        clearWordTimer();
        return;
      }
      // FIX #1: Stale generation — ignore silently
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

      // FIX #5: Show user-facing error instead of silent failure
      toast.error("Erro no motor de voz", {
        description: message.length > 100 ? message.slice(0, 100) + '…' : message,
        duration: 5000,
      });

      clearWordTimer();
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
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

      // FIX #5: Show user-facing error
      toast.error("Erro no motor de voz (Web)", {
        description: e.error || "Erro desconhecido",
        duration: 5000,
      });

      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
    };

    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.speak(utterance);
  }, [clearWordTimer, updatePosition, startWordStepper]);

  // ─── Unified speak function ───
  const speakChunk = useCallback((chunkIndex: number, gen: number) => {
    if (useNativeRef.current) {
      speakChunkNative(chunkIndex, gen);
    } else {
      speakChunkWeb(chunkIndex, gen);
    }
  }, [speakChunkNative, speakChunkWeb]);

  const cancelCurrentSpeech = useCallback(async (resetUi: boolean) => {
    // FIX #1: Increment generation to invalidate all in-flight chunk callbacks
    generationRef.current++;
    speakingRef.current = false;
    pausedRef.current = false;

    if (useNativeRef.current) {
      try {
        await nativeStop();
      } catch {
        // ignore
      }
    } else if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }

    clearWordTimer();
    // No more cancelingRef needed — generation handles it
    chunksRef.current = [];
    chunkOffsetsRef.current = [];

    if (resetUi) {
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(0);
      setActiveCharIndex(-1);
    }
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

    const chunks = splitIntoSentences(textToSpeak);
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
    speakingRef.current = true;
    pausedRef.current = false;
    setIsSpeaking(true);
    setIsPaused(false);
    setActiveCharIndex(startCharIndex);

    speakChunk(0, gen);
  }, [speakChunk, cancelCurrentSpeech]);

  const speak = useCallback(async (text: string) => {
    ttsLog('[useTTS] speak() called, textLen=' + text.length);
    setIsLoading(true);
    try {
      await startForegroundService();
      await acquireWakeLock();
      await speakFromIndex(text, 0);
    } catch (e) {
      ttsError('[useTTS] speak() error: ' + (e instanceof Error ? e.message : String(e)));
      await releaseWakeLock();
      await stopForegroundService();
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [speakFromIndex]);

  // FIX #4: Improved pause — set pausedRef BEFORE stopping to prevent error handler reset
  const pause = useCallback(() => {
    pausedRef.current = true;
    setIsPaused(true);
    clearWordTimer();

    if (useNativeRef.current) {
      void nativeStop();
      return;
    }
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.pause();
  }, [clearWordTimer]);

  // FIX #4: Improved resume — properly restart with current generation
  const resume = useCallback(() => {
    if (useNativeRef.current) {
      pausedRef.current = false;
      speakingRef.current = true;
      setIsPaused(false);
      // Use current generation to resume
      speakChunk(currentChunkRef.current, generationRef.current);
      return;
    }
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.resume();
    pausedRef.current = false;
    setIsPaused(false);
    if (!boundaryFiredRef.current && speakingRef.current) {
      const chunk = chunksRef.current[currentChunkRef.current];
      const offset = chunkOffsetsRef.current[currentChunkRef.current];
      if (chunk) {
        chunkStartTimeRef.current = performance.now();
        startWordStepper(chunk, offset, rateRef.current);
      }
    }
  }, [startWordStepper, speakChunk]);

  const stop = useCallback(async () => {
    await cancelCurrentSpeech(true);
    await releaseWakeLock();
    await stopForegroundService();
  }, [cancelCurrentSpeech]);

  return {
    isSpeaking, isPaused, isLoading, progress, voices, selectedVoice,
    rate, setRate, pitch, setPitch, setSelectedVoice, speak, speakFromIndex, pause, resume, stop,
    activeCharIndex, setOnEnd, isNativeTTS: useNativeRef.current,
    debugInfo, runDiagnostics: runTTSDiagnostics, openInstall: openNativeTtsInstall,
  };
}
