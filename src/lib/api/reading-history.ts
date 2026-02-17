import { supabase } from "@/integrations/supabase/client";

export async function saveReadingProgress(
  userId: string,
  novelUrl: string,
  novelTitle: string,
  chapterUrl: string,
  chapterTitle?: string
) {
  // Extract the base novel URL (without chapter)
  const baseNovelUrl = novelUrl.replace(/\/chapter-.*$/, '');

  const { error } = await supabase
    .from('reading_history')
    .upsert(
      {
        user_id: userId,
        novel_url: baseNovelUrl,
        novel_title: novelTitle,
        chapter_url: chapterUrl,
        chapter_title: chapterTitle || null,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,novel_url' }
    );

  if (error) console.error('Error saving progress:', error);
}

export async function getReadingHistory(userId: string) {
  const { data, error } = await supabase
    .from('reading_history')
    .select('*')
    .eq('user_id', userId)
    .order('last_read_at', { ascending: false });

  if (error) {
    console.error('Error fetching history:', error);
    return [];
  }
  return data || [];
}

export async function deleteReadingEntry(id: string) {
  const { error } = await supabase
    .from('reading_history')
    .delete()
    .eq('id', id);

  if (error) console.error('Error deleting entry:', error);
}
