import { useState, useRef, useCallback, useEffect } from "react";

// Mobile browsers cut speech at ~200-300 words. We chunk at sentence boundaries.
const MAX_CHUNK_CHARS = 800;

function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_CHARS) {
      chunks.push(remaining);
      break;
    }
    // Find last sentence boundary within limit
    let splitAt = -1;
    const searchRegion = remaining.slice(0, MAX_CHUNK_CHARS);
    // Prefer splitting at sentence-ending punctuation
    for (const sep of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
      const idx = searchRegion.lastIndexOf(sep);
      if (idx > splitAt) splitAt = idx + sep.length;
    }
    // Fallback to comma/semicolon
    if (splitAt <= 0) {
      for (const sep of [', ', '; ', ',\n']) {
        const idx = searchRegion.lastIndexOf(sep);
        if (idx > splitAt) splitAt = idx + sep.length;
      }
    }
    // Last resort: split at space
    if (splitAt <= 0) {
      splitAt = searchRegion.lastIndexOf(' ');
    }
    if (splitAt <= 0) splitAt = MAX_CHUNK_CHARS;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => localStorage.getItem('nr-ttsVoice') || "");
  const [rate, setRate] = useState(() => Number(localStorage.getItem('nr-ttsRate')) || 1);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const textRef = useRef("");
  const onEndCallbackRef = useRef<(() => void) | null>(null);
  const cancelingRef = useRef(false);
  const chunksRef = useRef<string[]>([]);
  const currentChunkRef = useRef(0);
  const chunkOffsetRef = useRef(0); // global char offset of current chunk
  const startCharRef = useRef(0);
  const boundaryFiredRef = useRef(false);
  const wordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for latest values
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const selectedVoiceRef = useRef(selectedVoice);
  const rateRef = useRef(rate);

  useEffect(() => { voicesRef.current = voices; }, [voices]);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { rateRef.current = rate; }, [rate]);

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
      clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }
  }, []);

  // Fallback word tracking for mobile (when onboundary doesn't fire)
  const startFallbackWordTracking = useCallback((text: string, globalOffset: number, speechRate: number) => {
    clearWordTimer();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    // Estimate ~150 words per minute at rate 1.0
    const msPerWord = (60000 / 150) / speechRate;
    let wordIdx = 0;
    let charPos = 0;

    wordTimerRef.current = setInterval(() => {
      if (wordIdx >= words.length) {
        clearWordTimer();
        return;
      }
      // Find position of current word
      const wordStart = text.indexOf(words[wordIdx], charPos);
      if (wordStart >= 0) {
        charPos = wordStart + words[wordIdx].length;
        setActiveCharIndex(globalOffset + wordStart);
        const totalText = textRef.current;
        if (totalText.length > 0) {
          setProgress(((globalOffset + wordStart) / totalText.length) * 100);
        }
      }
      wordIdx++;
    }, msPerWord);
  }, [clearWordTimer]);

  const setOnEnd = useCallback((cb: (() => void) | null) => {
    onEndCallbackRef.current = cb;
  }, []);

  const speakChunk = useCallback((chunkIndex: number) => {
    const chunks = chunksRef.current;
    if (chunkIndex >= chunks.length) {
      // All chunks done
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(100);
      setActiveCharIndex(-1);
      clearWordTimer();
      onEndCallbackRef.current?.();
      return;
    }

    const chunkText = chunks[chunkIndex];
    // Calculate global offset for this chunk
    let offset = startCharRef.current;
    for (let i = 0; i < chunkIndex; i++) {
      offset += chunks[i].length;
    }
    chunkOffsetRef.current = offset;
    currentChunkRef.current = chunkIndex;
    boundaryFiredRef.current = false;

    const utterance = new SpeechSynthesisUtterance(chunkText);
    const voice = voicesRef.current.find(v => v.name === selectedVoiceRef.current);
    if (voice) utterance.voice = voice;
    utterance.rate = rateRef.current;

    utterance.onboundary = (e) => {
      if (e.name === 'word') {
        boundaryFiredRef.current = true;
        clearWordTimer(); // No need for fallback if native events work
        const globalIndex = offset + e.charIndex;
        setActiveCharIndex(globalIndex);
        const totalLen = textRef.current.length;
        if (totalLen > 0) setProgress((globalIndex / totalLen) * 100);
      }
    };

    utterance.onend = () => {
      if (cancelingRef.current) return;
      clearWordTimer();
      // Speak next chunk
      speakChunk(chunkIndex + 1);
    };

    utterance.onerror = (e) => {
      if (cancelingRef.current || e.error === 'canceled' || e.error === 'interrupted') return;
      clearWordTimer();
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
    };

    // Start fallback word tracking after a short delay (if onboundary doesn't fire)
    setTimeout(() => {
      if (!boundaryFiredRef.current && !cancelingRef.current) {
        startFallbackWordTracking(chunkText, offset, rateRef.current);
      }
    }, 500);

    utteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
  }, [clearWordTimer, startFallbackWordTracking]);

  const speakFromIndex = useCallback((text: string, startCharIndex = 0) => {
    cancelingRef.current = true;
    speechSynthesis.cancel();
    clearWordTimer();
    cancelingRef.current = false;

    const textToSpeak = text.slice(startCharIndex);
    textRef.current = text;
    startCharRef.current = startCharIndex;

    // Split into mobile-safe chunks
    chunksRef.current = splitIntoChunks(textToSpeak);

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
    clearWordTimer();
    setIsPaused(true);
  }, [clearWordTimer]);

  const resume = useCallback(() => {
    speechSynthesis.resume();
    setIsPaused(false);
    // Restart fallback tracking if needed
    if (!boundaryFiredRef.current) {
      const chunk = chunksRef.current[currentChunkRef.current];
      if (chunk) {
        startFallbackWordTracking(chunk, chunkOffsetRef.current, rateRef.current);
      }
    }
  }, [startFallbackWordTracking]);

  const stop = useCallback(() => {
    cancelingRef.current = true;
    speechSynthesis.cancel();
    clearWordTimer();
    cancelingRef.current = false;
    chunksRef.current = [];
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
    setActiveCharIndex(-1);
  }, [clearWordTimer]);

  return {
    isSpeaking, isPaused, progress, voices, selectedVoice,
    rate, setRate, setSelectedVoice, speak, speakFromIndex, pause, resume, stop,
    activeCharIndex, setOnEnd,
  };
}
