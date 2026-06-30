import { supabase } from "@/integrations/supabase/client";

export async function saveReadingProgress(
  userId: string,
  novelUrl: string,
  novelTitle: string,
  chapterUrl: string,
  chapterTitle?: string
) {
  // Extract the base novel URL (without chapter). Supports /chapter-... and NovelBin's /cchapter-...
  const baseNovelUrl = novelUrl.replace(/\/c?chapter-.*$/i, '');

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
        // Reset scroll on new chapter load; will be updated as user scrolls
        scroll_position: 0,
        scroll_percent: 0,
        // Reset TTS bookmark on new chapter load; will be updated as TTS plays.
        // Without this, the previous chapter's char index persists on the same
        // base novel_url row and would auto-resume the new chapter mid-text.
        tts_char_index: 0,
        // Restoring from trash if user re-opens a deleted novel
        deleted_at: null,
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
    .is('deleted_at', null)
    .order('last_read_at', { ascending: false });

  if (error) {
    console.error('Error fetching history:', error);
    return [];
  }
  return data || [];
}

export async function getDeletedHistory(userId: string) {
  const { data, error } = await supabase
    .from('reading_history')
    .select('*')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) {
    console.error('Error fetching trash:', error);
    return [];
  }
  return data || [];
}

export async function restoreReadingEntry(id: string) {
  const { error } = await supabase
    .from('reading_history')
    .update({ deleted_at: null })
    .eq('id', id);
  if (error) console.error('Error restoring entry:', error);
}

export async function purgeReadingEntry(id: string) {
  const { error } = await supabase
    .from('reading_history')
    .delete()
    .eq('id', id);
  if (error) console.error('Error purging entry:', error);
}

/** Permanently deletes trash items older than 30 days. */
export async function purgeOldDeleted(userId: string) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('reading_history')
    .delete()
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);
  if (error) console.error('Error auto-purging trash:', error);
}

/** Soft-delete: moves entry to trash. Use purgeReadingEntry to remove permanently. */
export async function deleteReadingEntry(id: string) {
  const { error } = await supabase
    .from('reading_history')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) console.error('Error soft-deleting entry:', error);
}

/** Persist exact reading position within a chapter, keyed by base novel URL. */
export async function saveScrollPosition(
  userId: string,
  baseNovelUrl: string,
  scrollPosition: number,
  scrollPercent: number,
  ttsCharIndex?: number,
) {
  const update: Record<string, number> = {
    scroll_position: Math.max(0, Math.round(scrollPosition)),
    scroll_percent: Math.max(0, Math.min(1, scrollPercent)),
  };
  if (typeof ttsCharIndex === 'number' && ttsCharIndex >= 0) {
    update.tts_char_index = Math.round(ttsCharIndex);
  }
  const { error } = await supabase
    .from('reading_history')
    .update(update)
    .eq('user_id', userId)
    .eq('novel_url', baseNovelUrl);
  if (error) console.error('Error saving scroll position:', error);
}

/** Persist only the TTS bookmark (where the audio reader paused). */
export async function saveTtsBookmark(
  userId: string,
  baseNovelUrl: string,
  ttsCharIndex: number,
) {
  const { error } = await supabase
    .from('reading_history')
    .update({ tts_char_index: Math.max(0, Math.round(ttsCharIndex)) })
    .eq('user_id', userId)
    .eq('novel_url', baseNovelUrl);
  if (error) console.error('Error saving TTS bookmark:', error);
}

/** Compute base novel URL the same way saveReadingProgress does (kept in sync). */
export function computeBaseNovelUrl(chapterUrl: string): string {
  try {
    const urlObj = new URL(chapterUrl);
    const hostname = urlObj.hostname;
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (hostname.includes('webnovel.com')) {
      const novelSlug = pathParts[1] || 'unknown';
      return `${urlObj.origin}/book/${novelSlug}`;
    }
    if (hostname.includes('freewebnovel')) {
      const novelSlug = pathParts[1] || pathParts[0] || 'unknown';
      return `${urlObj.origin}/novel/${novelSlug}`;
    }
  } catch { /* fall through */ }
  return chapterUrl.replace(/\/c?chapter-.*$/i, '');
}
