import { supabase } from "@/integrations/supabase/client";

export type ChapterData = {
  title: string;
  content: string;
  nextChapterUrl: string;
  prevChapterUrl: string;
};

function toLangCode(targetLang: string): string {
  const langMap: Record<string, string> = {
    'portuguese (brazilian)': 'pt',
    portuguese: 'pt',
    english: 'en',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    italian: 'it',
    japanese: 'ja',
    korean: 'ko',
    chinese: 'zh-CN',
  };
  return langMap[targetLang.toLowerCase()] || targetLang.slice(0, 2).toLowerCase();
}

function splitIntoChunks(text: string, maxChunk = 1400): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  const pushHardSplit = (value: string) => {
    let remaining = value.trim();
    while (remaining.length > maxChunk) {
      let splitAt = remaining.lastIndexOf('. ', maxChunk);
      if (splitAt <= maxChunk * 0.5) splitAt = remaining.lastIndexOf('! ', maxChunk);
      if (splitAt <= maxChunk * 0.5) splitAt = remaining.lastIndexOf('? ', maxChunk);
      if (splitAt <= maxChunk * 0.5) splitAt = remaining.lastIndexOf(', ', maxChunk);
      if (splitAt <= maxChunk * 0.5) splitAt = remaining.lastIndexOf(' ', maxChunk);
      if (splitAt <= 0) splitAt = maxChunk;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
  };

  for (const p of paragraphs) {
    if (p.length > maxChunk) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      pushHardSplit(p);
      continue;
    }

    if (current && `${current}\n\n${p}`.length > maxChunk) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sourceOverlapRatio(translated: string, source: string): number {
  const sourceWords = source
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z]{4,}/g);
  if (!sourceWords || sourceWords.length < 80) return 0;

  const sample = sourceWords.slice(0, 450);
  const translatedWords = new Set(
    translated
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z]{4,}/g) || []
  );
  if (translatedWords.size === 0) return 0;

  const matches = sample.filter((word) => translatedWords.has(word)).length;
  return matches / sample.length;
}

function looksUntranslated(translated: string, source: string, targetLanguage: string): boolean {
  const out = normalizeText(translated);
  const src = normalizeText(source);
  if (!out) return true;
  if (src.length > 120 && out === src) return true;
  if (!targetLanguage.toLowerCase().startsWith('english') && src.length > 400 && out.length < src.length * 0.25) return true;
  if (!targetLanguage.toLowerCase().startsWith('english') && src.length > 1200 && sourceOverlapRatio(out, src) > 0.58) return true;
  return false;
}

async function googleTranslateDirectChunk(chunk: string, tl: string, signal?: AbortSignal): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(chunk)}`,
    signal,
  });
  if (!resp.ok) throw new Error(`Google direto falhou (${resp.status})`);
  const data = await resp.json();
  let out = '';
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const seg of data[0]) if (Array.isArray(seg) && seg[0]) out += seg[0];
  }
  if (!out) throw new Error('Google direto retornou vazio');
  return out;
}

async function translateDirectFromBrowser(
  text: string,
  targetLanguage: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const tl = toLangCode(targetLanguage);
  const chunks = splitIntoChunks(text, 1800);
  const results: (string | null)[] = new Array(chunks.length).fill(null);
  let nextToEmit = 0;
  let cursor = 0;
  let accumulated = '';
  let failed = false;

  const emitReady = () => {
    while (nextToEmit < chunks.length && results[nextToEmit] !== null) {
      const piece = (nextToEmit === 0 ? '' : '\n\n') + results[nextToEmit]!;
      accumulated += piece;
      onDelta(piece);
      nextToEmit++;
    }
  };

  async function worker() {
    while (true) {
      if (failed) return;
      const i = cursor++;
      if (i >= chunks.length) return;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          results[i] = await googleTranslateDirectChunk(chunks[i], tl, signal);
          if (looksUntranslated(results[i] || '', chunks[i], targetLanguage)) {
            throw new Error('Google direto retornou texto sem tradução');
          }
          if (failed) return;
          emitReady();
          break;
        } catch (err) {
          lastErr = err;
          if (signal?.aborted) throw err;
          if (attempt < 2) await new Promise((r) => setTimeout(r, attempt === 0 ? 450 : 1100));
        }
      }
      if (results[i] === null) {
        failed = true;
        throw lastErr instanceof Error ? lastErr : new Error('Tradução direta falhou');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, worker));
  if (looksUntranslated(accumulated, text, targetLanguage)) {
    throw new Error('A rota alternativa também retornou texto sem tradução.');
  }
  return accumulated;
}

export async function scrapeChapter(url: string): Promise<ChapterData> {
  const { data, error } = await supabase.functions.invoke('scrape-chapter', {
    body: { url },
  });

  if (error) throw new Error(error.message || 'Failed to scrape chapter');
  if (data.error) throw new Error(data.error);
  return data;
}

export async function translateChapter(text: string, targetLanguage: string): Promise<string> {
  let translated = '';
  await translateChapterStream(text, targetLanguage, (delta) => { translated += delta; });
  return translated;
}

async function translateChapterViaEdgeStream(
  text: string,
  targetLanguage: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  onReset?: () => void,
  useAI = false,
): Promise<string> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-chapter`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ text, targetLanguage, useAI }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`Translation failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedText = false;
  let accumulated = "";
  let hadProviderWarning = false;
  let providerWarning = "";

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
      if (jsonStr === "[DONE]") {
        if (!receivedText) {
          if (onReset) onReset();
          return await translateDirectFromBrowser(text, targetLanguage, onDelta, signal);
        }
        if (hadProviderWarning || looksUntranslated(accumulated, text, targetLanguage)) {
          throw new Error(providerWarning || 'A tradução retornou texto sem tradução suficiente.');
        }
        return accumulated;
      }
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.warning) {
          hadProviderWarning = true;
          providerWarning = String(parsed.warning);
          console.warn('Translation warning:', parsed.warning);
        }
        // Server signals that previously streamed text should be wiped
        // (e.g. AI failed mid-stream and Google is about to re-translate).
        if ((parsed.reset || parsed.fallback === "google") && onReset) {
          onReset();
        }
        if (typeof parsed.text === "string" && parsed.text.length > 0) {
          receivedText = true;
          accumulated += parsed.text;
          onDelta(parsed.text);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!receivedText) {
    if (onReset) onReset();
    return await translateDirectFromBrowser(text, targetLanguage, onDelta, signal);
  }

  if (looksUntranslated(accumulated, text, targetLanguage)) {
    throw new Error('A tradução retornou texto sem tradução suficiente.');
  }

  return accumulated;
}

export async function translateChapterStream(
  text: string,
  targetLanguage: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  onReset?: () => void,
): Promise<void> {
  try {
    await translateChapterViaEdgeStream(text, targetLanguage, onDelta, signal, onReset, false);
    return;
  } catch (freeEdgeError) {
    if (signal?.aborted) throw freeEdgeError;
    if (onReset) onReset();

    try {
      await translateChapterViaEdgeStream(text, targetLanguage, onDelta, signal, onReset, true);
      return;
    } catch (aiEdgeError) {
      if (signal?.aborted) throw aiEdgeError;
      if (onReset) onReset();
      await translateDirectFromBrowser(text, targetLanguage, onDelta, signal);
    }
  }
}
