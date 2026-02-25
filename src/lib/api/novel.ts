import { supabase } from "@/integrations/supabase/client";

export type ChapterData = {
  title: string;
  content: string;
  nextChapterUrl: string;
  prevChapterUrl: string;
};

export async function scrapeChapter(url: string): Promise<ChapterData> {
  const { data, error } = await supabase.functions.invoke('scrape-chapter', {
    body: { url },
  });

  if (error) throw new Error(error.message || 'Failed to scrape chapter');
  if (data.error) throw new Error(data.error);
  return data;
}

export async function translateChapter(text: string, targetLanguage: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('translate-chapter', {
    body: { text, targetLanguage },
  });

  if (error) throw new Error(error.message || 'Translation failed');
  if (data.error) throw new Error(data.error);
  return data.translatedText;
}

export async function translateChapterStream(
  text: string,
  targetLanguage: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-chapter`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ text, targetLanguage }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const errData = await resp.text();
    throw new Error(`Translation failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") return;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) onDelta(parsed.text);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Translation")) throw e;
      }
    }
  }
}
