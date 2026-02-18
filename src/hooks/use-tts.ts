import { useState, useRef, useCallback, useEffect } from "react";

const MAX_CHUNK_CHARS = 300;

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

// Build word map: [{word, startIndex}] for a given text
function buildWordMap(text: string): { word: string; start: number }[] {
  const words: { word: string; start: number }[] = [];
  const regex = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    words.push({ word: m[0], start: m.index });
  }
  return words;
}

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => localStorage.getItem('nr-ttsVoice') || "");
  const [rate, setRate] = useState(() => Number(localStorage.getItem('nr-ttsRate')) || 1);
  const [pitch, setPitch] = useState(() => Number(localStorage.getItem('nr-ttsPitch')) || 1);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);

  const onEndCallbackRef = useRef<(() => void) | null>(null);
  const cancelingRef = useRef(false);
  const chunksRef = useRef<string[]>([]);
  const chunkOffsetsRef = useRef<number[]>([]);
  const currentChunkRef = useRef(0);
  const textRef = useRef("");
  const speakingRef = useRef(false);
  const pausedRef = useRef(false);
  const boundaryFiredRef = useRef(false);
  const wordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunkStartTimeRef = useRef(0);
  const calibratedCpsRef = useRef(Number(localStorage.getItem('nr-ttsCps')) || 0);

  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const selectedVoiceRef = useRef(selectedVoice);
  const rateRef = useRef(rate);
  const pitchRef = useRef(pitch);

  useEffect(() => { voicesRef.current = voices; }, [voices]);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);

  useEffect(() => {
    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      setVoices(v);
      if (v.length > 0) {
        setSelectedVoice(prev => {
          if (prev && v.some(voice => voice.name === prev)) return prev;
          const ptVoice = v.find(voice => voice.lang.startsWith('pt'));
          return ptVoice?.name || v[0].name;
        });
      }
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, []);

  const clearWordTimer = useCallback(() => {
    if (wordTimerRef.current) {
      clearTimeout(wordTimerRef.current);
      wordTimerRef.current = null;
    }
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

  // Fallback: interpolate word position using estimated chunk duration
  const startWordStepper = useCallback((chunkText: string, globalOffset: number, speechRate: number) => {
    const words = buildWordMap(chunkText);
    if (words.length === 0) return;

    // Use calibrated rate or default (~8 chars/sec at rate 1.0)
    const cps = (calibratedCpsRef.current || 8) * speechRate;
    const totalChars = chunkText.length;
    const estimatedDurationMs = (totalChars / cps) * 1000;

    chunkStartTimeRef.current = performance.now();

    // Map each word to a fractional position [0, 1] within the chunk
    const lastWordStart = words[words.length - 1].start;
    const wordFractions = words.map(w => lastWordStart > 0 ? w.start / lastWordStart : 0);

    let lastWordIdx = -1;

    const step = () => {
      if (!speakingRef.current || pausedRef.current) return;

      const elapsed = performance.now() - chunkStartTimeRef.current;
      // Use ~90% of estimated duration for word distribution (last 10% is trailing silence)
      const fraction = Math.min(elapsed / (estimatedDurationMs * 0.9), 1);

      // Find the word that corresponds to current time fraction
      let wordIdx = 0;
      for (let i = words.length - 1; i >= 0; i--) {
        if (fraction >= wordFractions[i]) {
          wordIdx = i;
          break;
        }
      }

      if (wordIdx !== lastWordIdx) {
        lastWordIdx = wordIdx;
        updatePosition(globalOffset + words[wordIdx].start);
      }

      if (fraction < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    // Start with first word immediately
    updatePosition(globalOffset + words[0].start);
    lastWordIdx = 0;
    rafRef.current = requestAnimationFrame(step);
  }, [updatePosition]);

  const setOnEnd = useCallback((cb: (() => void) | null) => {
    onEndCallbackRef.current = cb;
  }, []);

  const speakChunk = useCallback((chunkIndex: number) => {
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
    const voice = voicesRef.current.find(v => v.name === selectedVoiceRef.current);
    if (voice) utterance.voice = voice;
    utterance.rate = rateRef.current;
    utterance.pitch = pitchRef.current;
    utterance.onboundary = (e) => {
      if (e.name === 'word') {
        if (!boundaryFiredRef.current) {
          boundaryFiredRef.current = true;
          clearWordTimer(); // Native tracking works, stop fallback
        }
        updatePosition(globalOffset + e.charIndex);
      }
    };

    utterance.onstart = () => {
      if (cancelingRef.current) return;
      chunkStartTimeRef.current = performance.now();
      // Start fallback stepper on actual speech start (not after arbitrary delay)
      if (!boundaryFiredRef.current && speakingRef.current) {
        startWordStepper(chunkText, globalOffset, rateRef.current);
      }
    };

    utterance.onend = () => {
      if (cancelingRef.current) return;
      clearWordTimer();
      // Calibrate: measure actual duration of this chunk
      if (!boundaryFiredRef.current && chunkStartTimeRef.current > 0) {
        const actualDurationMs = performance.now() - chunkStartTimeRef.current;
        const actualCps = chunkText.length / (actualDurationMs / 1000) / rateRef.current;
        if (actualCps > 2 && actualCps < 30) {
          calibratedCpsRef.current = calibratedCpsRef.current > 0
            ? calibratedCpsRef.current * 0.3 + actualCps * 0.7
            : actualCps;
          localStorage.setItem('nr-ttsCps', String(calibratedCpsRef.current));
        }
      }
      speakChunk(chunkIndex + 1);
    };

    utterance.onerror = (e) => {
      if (cancelingRef.current || e.error === 'canceled' || e.error === 'interrupted') return;
      clearWordTimer();
      speakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
    };

    speechSynthesis.speak(utterance);
  }, [clearWordTimer, updatePosition, startWordStepper]);

  const speakFromIndex = useCallback((text: string, startCharIndex = 0) => {
    cancelingRef.current = true;
    speechSynthesis.cancel();
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
    speechSynthesis.pause();
    pausedRef.current = true;
    clearWordTimer();
    setIsPaused(true);
  }, [clearWordTimer]);

  const resume = useCallback(() => {
    speechSynthesis.resume();
    pausedRef.current = false;
    setIsPaused(false);
    // Restart fallback stepper if needed
    if (!boundaryFiredRef.current && speakingRef.current) {
      const chunk = chunksRef.current[currentChunkRef.current];
      const offset = chunkOffsetsRef.current[currentChunkRef.current];
      if (chunk) {
        chunkStartTimeRef.current = performance.now(); // reset timing
        startWordStepper(chunk, offset, rateRef.current);
      }
    }
  }, [startWordStepper, clearWordTimer]);

  const stop = useCallback(() => {
    cancelingRef.current = true;
    speakingRef.current = false;
    pausedRef.current = false;
    speechSynthesis.cancel();
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
    activeCharIndex, setOnEnd,
  };
}
