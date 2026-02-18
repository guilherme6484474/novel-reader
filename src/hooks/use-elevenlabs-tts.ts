import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

const TTS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Top ElevenLabs voices good for novel reading
export const ELEVENLABS_VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", lang: "Multi" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", lang: "Multi" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", lang: "Multi" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", lang: "Multi" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", lang: "Multi" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", lang: "Multi" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", lang: "Multi" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", lang: "Multi" },
];

const CHUNK_SIZE = 4500; // Stay under 5000 char limit

function splitTextIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    // Find last sentence boundary before limit
    let splitAt = remaining.lastIndexOf('. ', CHUNK_SIZE);
    if (splitAt < CHUNK_SIZE * 0.5) splitAt = remaining.lastIndexOf('\n', CHUNK_SIZE);
    if (splitAt < CHUNK_SIZE * 0.5) splitAt = remaining.lastIndexOf(' ', CHUNK_SIZE);
    if (splitAt < 1) splitAt = CHUNK_SIZE;
    chunks.push(remaining.slice(0, splitAt + 1));
    remaining = remaining.slice(splitAt + 1);
  }
  return chunks;
}

export function useElevenLabsTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(
    () => localStorage.getItem('nr-elVoice') || ELEVENLABS_VOICES[0].id
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<string[]>([]);
  const currentChunkRef = useRef(0);
  const onEndCallbackRef = useRef<(() => void) | null>(null);
  const stoppedRef = useRef(false);

  const setOnEnd = useCallback((cb: (() => void) | null) => {
    onEndCallbackRef.current = cb;
  }, []);

  const playChunk = useCallback(async (chunks: string[], index: number) => {
    if (stoppedRef.current || index >= chunks.length) {
      setIsSpeaking(false);
      setIsLoading(false);
      if (!stoppedRef.current) {
        setProgress(100);
        onEndCallbackRef.current?.();
      }
      return;
    }

    currentChunkRef.current = index;
    setProgress((index / chunks.length) * 100);

    if (index === 0) setIsLoading(true);

    try {
      const response = await fetch(TTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: API_KEY,
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ text: chunks[index], voiceId: selectedVoice }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (stoppedRef.current) {
        URL.revokeObjectURL(audioUrl);
        return;
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setIsLoading(false);
      setIsSpeaking(true);

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        playChunk(chunks, index + 1);
      };

      audio.ontimeupdate = () => {
        if (audio.duration) {
          const chunkProgress = audio.currentTime / audio.duration;
          const totalProgress = ((index + chunkProgress) / chunks.length) * 100;
          setProgress(totalProgress);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        if (!stoppedRef.current) {
          toast.error("Erro ao reproduzir áudio");
          setIsSpeaking(false);
          setIsLoading(false);
        }
      };

      await audio.play();
    } catch (err: any) {
      if (!stoppedRef.current) {
        toast.error("Erro ElevenLabs: " + err.message);
        setIsSpeaking(false);
        setIsLoading(false);
      }
    }
  }, [selectedVoice]);

  const speak = useCallback((text: string) => {
    stop();
    stoppedRef.current = false;
    const chunks = splitTextIntoChunks(text);
    chunksRef.current = chunks;
    setProgress(0);
    playChunk(chunks, 0);
  }, [playChunk]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play();
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
    setIsLoading(false);
  }, []);

  return {
    isSpeaking, isPaused, progress, isLoading,
    selectedVoice, setSelectedVoice,
    speak, pause, resume, stop, setOnEnd,
  };
}
