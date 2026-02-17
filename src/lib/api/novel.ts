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
