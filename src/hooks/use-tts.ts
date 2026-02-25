import { useState, useRef, useCallback, useEffect } from "react";
import { isNative, getNativeVoices, nativeSpeak, nativeStop, type NativeVoice } from "@/lib/native-tts";

const MAX_CHUNK_CHARS = 80;

function splitIntoSentences(text: string): string[] {
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
    if (buffer.length + part.length <= MAX_CHUNK_CHARS) {
      buffer += part;
    } else {
      if (buffer) merged.push(buffer);
      if (part.length > MAX_CHUNK_CHARS) {
        let remaining = part;
        while (remaining.length > MAX_CHUNK_CHARS) {
          let splitAt = remaining.lastIndexOf(', ', MAX_CHUNK_CHARS);
          if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', MAX_CHUNK_CHARS);
          if (splitAt <= 0) splitAt = MAX_CHUNK_CHARS;
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
}

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => localStorage.getItem('nr-ttsVoice') || "");
  const [rate, setRate] = useState(() => Number(localStorage.getItem('nr-ttsRate')) || 1);
  const [pitch, setPitch] = useState(() => Number(localStorage.getItem('nr-ttsPitch')) || 1);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);

  const useNativeRef = useRef(isNative());
  const onEndCallbackRef = useRef<(() => void) | null>(null);
  const cancelingRef = useRef(false);
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

  const selectedVoiceRef = useRef(selectedVoice);
  const rateRef = useRef(rate);
  const pitchRef = useRef(pitch);

  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);

  // Load voices — native or web
  useEffect(() => {
    if (useNativeRef.current) {
      // Load native Android/iOS voices
      getNativeVoices().then(nv => {
        const mapped: TTSVoice[] = nv.map(v => ({
          name: v.name,
          lang: v.lang,
          localService: v.localService,
        }));
        setVoices(mapped);
        if (mapped.length > 0) {
          setSelectedVoice(prev => {
            if (prev && mapped.some(v => v.name === prev)) return prev;
            const ptVoice = mapped.find(v => v.lang.startsWith('pt'));
            return ptVoice?.name || mapped[0].name;
          });
        }
      });
    } else {
      // Web Speech API
      if (typeof speechSynthesis === 'undefined') return;
      const loadVoices = () => {
        const v = speechSynthesis.getVoices();
        const mapped: TTSVoice[] = v.map(sv => ({
          name: sv.name,
          lang: sv.lang,
          localService: sv.localService,
        }));
        setVoices(mapped);
        if (mapped.length > 0) {
          setSelectedVoice(prev => {
            if (prev && mapped.some(voice => voice.name === prev)) return prev;
            const ptVoice = mapped.find(voice => voice.lang.startsWith('pt'));
            return ptVoice?.name || mapped[0].name;
          });
        }
      };
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
      return () => { speechSynthesis.onvoiceschanged = null; };
    }
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
  const speakChunkNative = useCallback(async (chunkIndex: number) => {
    if (!speakingRef.current) return;
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

    updatePosition(globalOffset);
    chunkStartTimeRef.current = performance.now();
    startWordStepper(chunkText, globalOffset, rateRef.current);

    try {
      // Find the lang from selected voice
      const selectedV = voices.find(v => v.name === selectedVoiceRef.current);
      await nativeSpeak({
        text: chunkText,
        lang: selectedV?.lang || 'pt-BR',
        rate: rateRef.current,
        pitch: pitchRef.current,
      });

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
      if (speakingRef.current && !cancelingRef.current) {
        speakChunkNative(chunkIndex + 1);
      }
    } catch (e) {
      if (cancelingRef.current) return;
      console.warn('[NativeTTS] speak error:', e);
      clearWordTimer();
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
    }
  }, [clearWordTimer, updatePosition, startWordStepper, voices]);

  // ─── Web Speech API chunk speaker ───
  const speakChunkWeb = useCallback((chunkIndex: number) => {
    if (!speakingRef.current) return;
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
    // Find the real SpeechSynthesisVoice from the browser
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
      if (cancelingRef.current) return;
      chunkStartTimeRef.current = performance.now();
      if (!boundaryFiredRef.current && speakingRef.current) {
        startWordStepper(chunkText, globalOffset, rateRef.current);
      }
    };

    utterance.onend = () => {
      if (cancelingRef.current) return;
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
      speakChunkWeb(chunkIndex + 1);
    };

    utterance.onerror = (e) => {
      if (cancelingRef.current || e.error === 'canceled' || e.error === 'interrupted') return;
      clearWordTimer();
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
    };

    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.speak(utterance);
  }, [clearWordTimer, updatePosition, startWordStepper]);

  // ─── Unified speak function ───
  const speakChunk = useCallback((chunkIndex: number) => {
    if (useNativeRef.current) {
      speakChunkNative(chunkIndex);
    } else {
      speakChunkWeb(chunkIndex);
    }
  }, [speakChunkNative, speakChunkWeb]);

  const speakFromIndex = useCallback((text: string, startCharIndex = 0) => {
    cancelingRef.current = true;
    if (useNativeRef.current) {
      nativeStop();
    } else if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
    clearWordTimer();
    cancelingRef.current = false;

    const textToSpeak = text.slice(startCharIndex);
    textRef.current = text;

    const chunks = splitIntoSentences(textToSpeak);
    chunksRef.current = chunks;

    const offsets: number[] = [];
    let offset = startCharIndex;
    for (const chunk of chunks) {
      offsets.push(offset);
      offset += chunk.length;
    }
    chunkOffsetsRef.current = offsets;

    speakingRef.current = true;
    pausedRef.current = false;
    setIsSpeaking(true);
    setIsPaused(false);
    setActiveCharIndex(startCharIndex);

    speakChunk(0);
  }, [speakChunk, clearWordTimer]);

  const speak = useCallback((text: string) => {
    speakFromIndex(text, 0);
  }, [speakFromIndex]);

  const pause = useCallback(() => {
    // Native TTS plugin doesn't support pause — we stop and track position
    if (useNativeRef.current) {
      nativeStop();
      pausedRef.current = true;
      clearWordTimer();
      setIsPaused(true);
      return;
    }
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.pause();
    pausedRef.current = true;
    clearWordTimer();
    setIsPaused(true);
  }, [clearWordTimer]);

  const resume = useCallback(() => {
    if (useNativeRef.current) {
      // Resume from current chunk on native
      pausedRef.current = false;
      setIsPaused(false);
      if (speakingRef.current) {
        speakChunk(currentChunkRef.current);
      }
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
  }, [startWordStepper, clearWordTimer, speakChunk]);

  const stop = useCallback(() => {
    cancelingRef.current = true;
    speakingRef.current = false;
    pausedRef.current = false;
    if (useNativeRef.current) {
      nativeStop();
    } else if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
    clearWordTimer();
    cancelingRef.current = false;
    chunksRef.current = [];
    chunkOffsetsRef.current = [];
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
    setActiveCharIndex(-1);
  }, [clearWordTimer]);

  return {
    isSpeaking, isPaused, progress, voices, selectedVoice,
    rate, setRate, pitch, setPitch, setSelectedVoice, speak, speakFromIndex, pause, resume, stop,
    activeCharIndex, setOnEnd, isNativeTTS: useNativeRef.current,
  };
}
