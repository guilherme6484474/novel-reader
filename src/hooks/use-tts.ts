import { useState, useRef, useCallback, useEffect } from "react";

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

  useEffect(() => {
    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      setVoices(v);
      if (v.length > 0) {
        setSelectedVoice(prev => {
          // If we already have a saved voice that exists in the list, keep it
          if (prev && v.some(voice => voice.name === prev)) return prev;
          const ptVoice = v.find(voice => voice.lang.startsWith('pt'));
          return ptVoice?.name || v[0].name;
        });
      }
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, [selectedVoice]);

  const setOnEnd = useCallback((cb: (() => void) | null) => {
    onEndCallbackRef.current = cb;
  }, []);

  const speakFromIndex = useCallback((text: string, startCharIndex = 0) => {
    cancelingRef.current = true;
    speechSynthesis.cancel();
    cancelingRef.current = false;
    
    const textToSpeak = text.slice(startCharIndex);
    textRef.current = text;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const voice = voices.find(v => v.name === selectedVoice);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;

    utterance.onboundary = (e) => {
      if (e.name === 'word') {
        const globalIndex = startCharIndex + e.charIndex;
        setActiveCharIndex(globalIndex);
        setProgress((globalIndex / text.length) * 100);
      }
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(100);
      setActiveCharIndex(-1);
      onEndCallbackRef.current?.();
    };
    utterance.onerror = (e) => {
      // Ignore errors from intentional cancel (e.g. clicking a new word)
      if (cancelingRef.current || e.error === 'canceled' || e.error === 'interrupted') return;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
    };

    utteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
    setIsSpeaking(true);
    setIsPaused(false);
    setActiveCharIndex(startCharIndex);
  }, [voices, selectedVoice, rate]);

  const speak = useCallback((text: string) => {
    speakFromIndex(text, 0);
  }, [speakFromIndex]);

  const pause = useCallback(() => {
    speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
    setActiveCharIndex(-1);
  }, []);

  return {
    isSpeaking, isPaused, progress, voices, selectedVoice,
    rate, setRate, setSelectedVoice, speak, speakFromIndex, pause, resume, stop,
    activeCharIndex, setOnEnd,
  };
}
