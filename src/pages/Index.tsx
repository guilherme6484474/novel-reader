import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTTS } from "@/hooks/use-tts";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { isNative, getTTSEngine, setTTSEngine, type TTSEnginePreference } from '@/lib/native-tts';
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { scrapeChapter, translateChapterStream, type ChapterData } from "@/lib/api/novel";
import { getCachedTranslation, setCachedTranslation, clearTranslationCache } from "@/lib/translation-cache";
import {
  saveReadingProgress, getReadingHistory, deleteReadingEntry,
  getDeletedHistory, restoreReadingEntry, purgeReadingEntry, purgeOldDeleted,
  saveScrollPosition, computeBaseNovelUrl,
} from "@/lib/api/reading-history";
import { updateMediaSessionMetadata } from "@/lib/keep-awake";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  BookOpen, ChevronLeft, ChevronRight, Globe, Loader2,
  Pause, Play, Square, Volume2, Settings2, Search,
  Moon, Sun, LogIn, LogOut, History, X, Trash2, Minus, Plus, Type,
  RefreshCw, Download, BarChart3, Mic, Undo2, ArchiveRestore,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { TTSDiagnosticsPanel } from "@/components/TTSDiagnostics";

const LANGUAGES = [
  { value: "Portuguese (Brazilian)", label: "🇧🇷 Português" },
  { value: "English", label: "🇺🇸 English" },
  { value: "Spanish", label: "🇪🇸 Español" },
  { value: "French", label: "🇫🇷 Français" },
  { value: "Japanese", label: "🇯🇵 日本語" },
  { value: "Korean", label: "🇰🇷 한국어" },
  { value: "Chinese", label: "🇨🇳 中文" },
];

type HistoryEntry = {
  id: string;
  novel_url: string;
  novel_title: string;
  chapter_url: string;
  chapter_title: string | null;
  last_read_at: string;
  deleted_at?: string | null;
  scroll_position?: number | null;
  scroll_percent?: number | null;
};

// Component that renders text with word-level highlighting and click-to-read
const ChapterArticle = memo(function ChapterArticle({
  displayText,
  activeCharIndex,
  isSpeaking,
  onClickWord,
  fontSize,
}: {
  displayText: string;
  activeCharIndex: number;
  isSpeaking: boolean;
  onClickWord: (charIndex: number) => void;
  fontSize: number;
}) {
  const activeParagraphRef = useRef<HTMLParagraphElement>(null);
  const lastScrolledParagraphRef = useRef(-1);
  const prevParaCountRef = useRef(0);

  const paragraphs = useMemo(() => {
    const result: {
      text: string;
      globalStart: number;
      globalEnd: number;
      tokens: { text: string; globalStart: number; isWord: boolean }[];
    }[] = [];
    let offset = 0;
    for (const line of displayText.split('\n')) {
      const lineStart = offset;
      if (line.trim()) {
        const tokens: { text: string; globalStart: number; isWord: boolean }[] = [];
        const regex = /\S+|\s+/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(line)) !== null) {
          tokens.push({
            text: match[0],
            globalStart: lineStart + match.index,
            isWord: /\S/.test(match[0]),
          });
        }

        result.push({
          text: line,
          globalStart: lineStart,
          globalEnd: lineStart + line.length,
          tokens,
        });
      }
      offset += line.length + 1; // +1 for \n
    }
    return result;
  }, [displayText]);

  const activeParagraphIndex = useMemo(() => {
    if (!isSpeaking || activeCharIndex < 0) return -1;

    return paragraphs.findIndex((para) => (
      activeCharIndex >= para.globalStart && activeCharIndex < para.globalEnd
    ));
  }, [activeCharIndex, isSpeaking, paragraphs]);

  useEffect(() => {
    if (!isSpeaking) {
      lastScrolledParagraphRef.current = -1;
      return;
    }

    if (activeParagraphIndex < 0 || !activeParagraphRef.current) return;
    if (lastScrolledParagraphRef.current === activeParagraphIndex) return;

    lastScrolledParagraphRef.current = activeParagraphIndex;
    activeParagraphRef.current.scrollIntoView({
      behavior: activeParagraphIndex === 0 ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [activeParagraphIndex, isSpeaking]);

  const prevParaCount = prevParaCountRef.current;
  useEffect(() => { prevParaCountRef.current = paragraphs.length; }, [paragraphs.length]);

  return (
    <article style={{ fontFamily: 'var(--font-reading)', fontSize: `${fontSize}px` }}>
      {paragraphs.map((para, pi) => (
        <p
          key={pi}
          ref={pi === activeParagraphIndex ? activeParagraphRef : undefined}
          className={`mb-4 leading-[1.85] text-foreground/85 ${pi >= prevParaCount ? 'animate-fade-in' : ''}`}
        >
          {para.tokens.map((token, wi) => {
            if (!token.isWord) return <span key={wi}>{token.text}</span>;

            const globalIndex = token.globalStart;

            const isActive = isSpeaking && activeCharIndex >= 0 &&
              globalIndex <= activeCharIndex &&
              activeCharIndex < globalIndex + token.text.length;

            return (
              <span
                key={wi}
                onClick={() => onClickWord(globalIndex)}
                className={`cursor-pointer transition-colors duration-150 rounded-sm px-[1px] ${
                  isActive
                    ? 'bg-primary/20 text-primary font-medium'
                    : isSpeaking && activeCharIndex >= 0 && globalIndex < activeCharIndex
                    ? 'text-muted-foreground/60'
                    : 'hover:bg-primary/10'
                }`}
              >
                {token.text}
              </span>
            );
          })}
        </p>
      ))}
    </article>
  );
});

const Index = () => {
  const [url, setUrl] = useState(() => sessionStorage.getItem('nr-currentUrl') || "");
  const [language, setLanguage] = useState(() => localStorage.getItem('nr-language') || "Portuguese (Brazilian)");
  const [chapter, setChapter] = useState<ChapterData | null>(() => {
    try {
      const saved = sessionStorage.getItem('nr-currentChapter');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [displayText, setDisplayText] = useState(() => sessionStorage.getItem('nr-displayText') || "");
  const [isLoading, setIsLoading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('nr-fontSize')) || 18);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [ttsEngine, setTtsEngineState] = useState<TTSEnginePreference>(() => getTTSEngine());
  const [trash, setTrash] = useState<HistoryEntry[]>([]);
  const pendingScrollRestoreRef = useRef<{ pos: number; pct: number } | null>(null);
  const restoredScrollRef = useRef(false);
  const [autoRead, setAutoRead] = useState(() => localStorage.getItem('nr-autoRead') === 'true');
  const autoReadRef = useRef(autoRead);
  const tts = useTTS();
  const { isAdmin } = useIsAdmin();
  const pwa = usePwaInstall();
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const chapterRef = useRef<ChapterData | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchedRef = useRef<{ url: string; data: ChapterData } | null>(null);

  // Keep refs in sync
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);
  useEffect(() => { chapterRef.current = chapter; }, [chapter]);

  // Persist preferences
  useEffect(() => { localStorage.setItem('nr-fontSize', String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem('nr-language', language); }, [language]);
  useEffect(() => { localStorage.setItem('nr-ttsRate', String(tts.rate)); }, [tts.rate]);
  useEffect(() => { localStorage.setItem('nr-ttsPitch', String(tts.pitch)); }, [tts.pitch]);
  useEffect(() => { localStorage.setItem('nr-ttsVoice', tts.selectedVoice); }, [tts.selectedVoice]);
  useEffect(() => { localStorage.setItem('nr-autoRead', String(autoRead)); }, [autoRead]);

  // Persist reading state to sessionStorage
  useEffect(() => { if (url) sessionStorage.setItem('nr-currentUrl', url); }, [url]);
  useEffect(() => {
    if (chapter) sessionStorage.setItem('nr-currentChapter', JSON.stringify(chapter));
  }, [chapter]);
  useEffect(() => {
    if (displayText) sessionStorage.setItem('nr-displayText', displayText);
  }, [displayText]);

  // Restore scroll position on mount
  useEffect(() => {
    const savedScroll = sessionStorage.getItem('nr-scrollPos');
    if (savedScroll && chapter && displayText) {
      setTimeout(() => window.scrollTo(0, Number(savedScroll)), 100);
    }
    // Recover partial translation if available
    const partialText = sessionStorage.getItem('nr-partialTranslation');
    const partialUrl = sessionStorage.getItem('nr-partialTranslationUrl');
    if (partialText && partialUrl && chapter && partialUrl === url && !displayText) {
      setDisplayText(partialText);
      toast.warning("Tradução parcial recuperada. Use 'Retraduzir' para completar.", { duration: 6000 });
    }
  }, []); // only on mount

  // Save scroll position to sessionStorage (always) and to Supabase (debounced)
  useEffect(() => {
    let debounceId: number | undefined;
    const computeAndPersist = (immediate: boolean) => {
      const y = window.scrollY;
      sessionStorage.setItem('nr-scrollPos', String(y));
      const ch = chapterRef.current;
      if (!user || !ch || !displayText) return;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.min(1, Math.max(0, y / max));
      const baseUrl = computeBaseNovelUrl(url);
      const flush = () => saveScrollPosition(user.id, baseUrl, y, pct);
      if (immediate) flush();
      else {
        if (debounceId) window.clearTimeout(debounceId);
        debounceId = window.setTimeout(flush, 2500);
      }
    };
    const onScroll = () => computeAndPersist(false);
    const onLeave = () => computeAndPersist(true);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('pagehide', onLeave);
      if (debounceId) window.clearTimeout(debounceId);
    };
  }, [user, url, displayText]);

  // Apply pending scroll restore when chapter content is rendered
  useEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    if (!pending || !displayText || restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    pendingScrollRestoreRef.current = null;

    const applyScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      let target = pending.pos;
      // If saved px exceeds current page or seems off, fall back to percent
      if (pending.pos <= 0 || pending.pos > max * 1.1 || pending.pos < max * 0.05) {
        target = Math.round(pending.pct * max);
      }
      if (target > 30) {
        window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
        const pct = Math.round(Math.min(1, target / max) * 100);
        toast.success(`Retomado de onde parou (${pct}%)`, {
          duration: 4000,
          action: { label: 'Topo', onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
        });
      }
    };
    // Wait for layout/fonts to settle
    requestAnimationFrame(() => setTimeout(applyScroll, 150));
  }, [displayText]);

  // Load TTS preferences on mount
  useEffect(() => {
    const savedRate = localStorage.getItem('nr-ttsRate');
    if (savedRate) tts.setRate(Number(savedRate));
    const savedPitch = localStorage.getItem('nr-ttsPitch');
    if (savedPitch) tts.setPitch(Number(savedPitch));
    const savedVoice = localStorage.getItem('nr-ttsVoice');
    if (savedVoice) tts.setSelectedVoice(savedVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance: when TTS ends and autoRead is on, go to next chapter
  useEffect(() => {
    tts.setOnEnd(() => {
      if (autoReadRef.current && chapterRef.current?.nextChapterUrl) {
        loadChapter(chapterRef.current.nextChapterUrl);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.setOnEnd]);

  // Wire headphone double-click → next chapter
  useEffect(() => {
    tts.setOnNextChapter(() => {
      if (chapterRef.current?.nextChapterUrl) {
        loadChapter(chapterRef.current.nextChapterUrl);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.setOnNextChapter]);

  useEffect(() => {
    if (user) {
      getReadingHistory(user.id).then(setHistory);
      // Auto-purge trash items older than 30 days, then load trash
      purgeOldDeleted(user.id).finally(() => {
        getDeletedHistory(user.id).then(setTrash);
      });
    }
  }, [user]);

  const loadChapter = async (chapterUrl: string, opts?: { restoreScroll?: { pos: number; pct: number } }) => {
    // Cancel any in-flight translation
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Scroll to top (will be overridden if restore is requested)
    window.scrollTo({ top: 0, behavior: 'instant' });
    restoredScrollRef.current = false;
    pendingScrollRestoreRef.current = opts?.restoreScroll ?? null;

    setIsLoading(true);
    setIsTranslating(false);
    setTranslationProgress(0);
    tts.stop();
    setShowHistory(false);
    try {
      // Use prefetched data if available
      let data: ChapterData;
      if (prefetchedRef.current && prefetchedRef.current.url === chapterUrl) {
        data = prefetchedRef.current.data;
        prefetchedRef.current = null;
      } else {
        data = await scrapeChapter(chapterUrl);
      }

      setChapter(data);
      setUrl(chapterUrl);
      setDisplayText(data.content);
      setIsLoading(false);
      // Update lock screen notification with chapter title
      updateMediaSessionMetadata(data.title, 'Novel Reader');

      // Save progress
      if (user) {
        const urlObj = new URL(chapterUrl);
        const hostname = urlObj.hostname;
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        
        let novelSlug: string;
        let baseUrl: string;
        
        if (hostname.includes('webnovel.com')) {
          // URL: /book/catastrophic-necromancer_29569742908502605/chapterSlug
          // Novel slug is the book part (index 1), strip the numeric ID suffix
          novelSlug = pathParts[1] || 'unknown';
          baseUrl = `${urlObj.origin}/book/${novelSlug}`;
        } else if (hostname.includes('freewebnovel')) {
          // URL: /novel/catastrophic-necromancer/chapter-1
          novelSlug = pathParts[1] || pathParts[0] || 'unknown';
          baseUrl = `${urlObj.origin}/novel/${novelSlug}`;
        } else {
          novelSlug = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0] || 'unknown';
          baseUrl = chapterUrl.replace(/\/chapter.*$/i, '');
        }
        
        // Clean novel name: remove numeric IDs (e.g. _29569742908502605), replace dashes
        const novelName = novelSlug
          .replace(/_\d{10,}$/, '')  // strip long numeric suffixes like _29569742908502605
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        
        saveReadingProgress(user.id, baseUrl, novelName, chapterUrl, data.title);
        getReadingHistory(user.id).then(setHistory);
      }

      // Check cache first
      const cached = await getCachedTranslation(chapterUrl, language);
      if (cached) {
        console.log("Translation loaded from cache");
        setDisplayText(cached);
        setTranslationProgress(100);
        setIsTranslating(false);
        if (autoReadRef.current) {
          setTimeout(() => tts.speak(cached), 300);
        }
        // Prefetch next chapter
        prefetchNextChapter(data.nextChapterUrl);
        return;
      }

      // Translate with abort support
      const controller = new AbortController();
      abortRef.current = controller;
      const originalLength = data.content.length;

      setIsTranslating(true);
      setDisplayText("");
      let streamedText = "";
      let rafId = 0;
      let needsFlush = false;
      const flushText = () => {
        setDisplayText(streamedText);
        setTranslationProgress(Math.min(99, Math.round((streamedText.length / originalLength) * 100)));
        needsFlush = false;
        // Save partial translation to sessionStorage for recovery
        if (streamedText.length > 100) {
          sessionStorage.setItem('nr-partialTranslation', streamedText);
          sessionStorage.setItem('nr-partialTranslationUrl', chapterUrl);
          sessionStorage.setItem('nr-partialTranslationLang', language);
        }
      };

      translateChapterStream(data.content, language, (delta) => {
        streamedText += delta;
        if (!needsFlush) { needsFlush = true; rafId = requestAnimationFrame(flushText); }
      }, controller.signal, () => {
        // Reset callback: AI failed mid-stream, Google will retranslate everything
        streamedText = "";
        cancelAnimationFrame(rafId);
        setDisplayText("");
        setTranslationProgress(0);
        toast.info("Motor de IA indisponível, usando Google Translate...", { duration: 3000 });
      })
        .then(() => {
          cancelAnimationFrame(rafId);
          setDisplayText(streamedText);
          setTranslationProgress(100);
          setCachedTranslation(chapterUrl, language, streamedText);
          // Clear partial cache on success
          sessionStorage.removeItem('nr-partialTranslation');
          sessionStorage.removeItem('nr-partialTranslationUrl');
          sessionStorage.removeItem('nr-partialTranslationLang');
          if (autoReadRef.current) {
            setTimeout(() => tts.speak(streamedText), 300);
          }
          // Prefetch next chapter
          prefetchNextChapter(data.nextChapterUrl);
        })
        .catch((err: any) => {
          if (err.name === 'AbortError') return;
          toast.error("Erro na tradução", {
            description: err.message,
            action: {
              label: "Tentar novamente",
              onClick: () => handleRetranslate(),
            },
            duration: 10000,
          });
          // If we have partial text, keep it visible
          if (streamedText.length > 50) {
            toast.warning("Tradução parcial exibida. Use 'Retraduzir' para completar.", { duration: 5000 });
          }
        })
        .finally(() => {
          if (abortRef.current === controller) {
            setIsTranslating(false);
            abortRef.current = null;
          }
        });
    } catch (err: any) {
      toast.error("Erro ao carregar: " + err.message);
      setIsLoading(false);
    }
  };

  // Prefetch next chapter in background
  const prefetchNextChapter = (nextUrl: string | undefined) => {
    if (!nextUrl) return;
    // Don't prefetch if already prefetched
    if (prefetchedRef.current?.url === nextUrl) return;
    scrapeChapter(nextUrl)
      .then((data) => {
        prefetchedRef.current = { url: nextUrl, data };
        console.log("Next chapter prefetched:", data.title);
        // Also pre-translate to cache if not already cached
        getCachedTranslation(nextUrl, language).then((cached) => {
          if (!cached) {
            let text = "";
            translateChapterStream(data.content, language, (delta) => { text += delta; })
              .then(() => {
                setCachedTranslation(nextUrl, language, text);
                console.log("Next chapter pre-translated and cached");
              })
              .catch(() => { /* silent - non-critical */ });
          }
        });
      })
      .catch(() => { /* silent - non-critical */ });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    loadChapter(url.trim());
  };

  const handleRetranslate = async () => {
    if (!chapter) return;
    // Cancel any in-flight translation
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setIsTranslating(true);
    tts.stop();
    try {
      setDisplayText("");
      let streamedText = "";
      let rafId = 0;
      let needsFlush = false;
      const flushText = () => { setDisplayText(streamedText); needsFlush = false; };
      await translateChapterStream(chapter.content, language, (delta) => {
        streamedText += delta;
        if (!needsFlush) { needsFlush = true; rafId = requestAnimationFrame(flushText); }
      }, controller.signal, () => {
        streamedText = "";
        cancelAnimationFrame(rafId);
        setDisplayText("");
      });
      cancelAnimationFrame(rafId);
      setDisplayText(streamedText);
      // Update cache with new translation
      const currentUrl = url;
      setCachedTranslation(currentUrl, language, streamedText);
      toast.success("Tradução atualizada!");
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      toast.error("Erro: " + err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    const removed = history.find((h) => h.id === id);
    setHistory((prev) => prev.filter((h) => h.id !== id));
    await deleteReadingEntry(id);
    if (user) getDeletedHistory(user.id).then(setTrash);
    toast.success('Movida para a lixeira', {
      duration: 5000,
      action: {
        label: 'Desfazer',
        onClick: async () => {
          await restoreReadingEntry(id);
          if (removed) setHistory((prev) => [{ ...removed, deleted_at: null }, ...prev]);
          if (user) getDeletedHistory(user.id).then(setTrash);
        },
      },
    });
  };

  const handleRestoreFromTrash = async (entry: HistoryEntry) => {
    await restoreReadingEntry(entry.id);
    setTrash((prev) => prev.filter((h) => h.id !== entry.id));
    setHistory((prev) => [{ ...entry, deleted_at: null }, ...prev.filter((h) => h.id !== entry.id)]);
    toast.success('Novel restaurada');
  };

  const handlePurgeFromTrash = async (id: string) => {
    if (!confirm('Excluir permanentemente? Esta ação não pode ser desfeita.')) return;
    await purgeReadingEntry(id);
    setTrash((prev) => prev.filter((h) => h.id !== id));
  };

  const handleHistoryItemClick = (h: HistoryEntry) => {
    loadChapter(h.chapter_url, {
      restoreScroll: {
        pos: Number(h.scroll_position) || 0,
        pct: Number(h.scroll_percent) || 0,
      },
    });
  };

  const safeAreaBottom = 'max(env(safe-area-inset-bottom), 0px)';
  const contentBottomPadding = chapter && displayText
    ? `calc(8.5rem + ${safeAreaBottom})`
    : '8rem';

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors">
      {/* Header */}
      <header
        className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl"
      >
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 sm:py-4">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-3">
            <div
              className="flex items-center gap-2.5 cursor-pointer"
              onClick={() => {
                tts.stop();
                setChapter(null);
                setDisplayText("");
                setUrl("");
                sessionStorage.removeItem('nr-currentChapter');
                sessionStorage.removeItem('nr-displayText');
                sessionStorage.removeItem('nr-currentUrl');
                window.scrollTo({ top: 0, behavior: 'instant' });
              }}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
                Novel Reader
              </h1>
            </div>
            <div className="flex items-center gap-0.5 -mr-2">
              {pwa.canInstall && (
                <Button
                  variant="ghost" size="icon"
                  onClick={pwa.install}
                  className="h-10 w-10 rounded-lg text-primary hover:text-primary"
                  title="Instalar app"
                >
                  <Download className="h-5 w-5" />
                </Button>
              )}
              {user && (
                <Button
                  variant="ghost" size="icon"
                  onClick={() => setShowHistory(!showHistory)}
                  className="h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <History className="h-5 w-5" />
                </Button>
              )}
              <Button
                variant="ghost" size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground"
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost" size="icon"
                onClick={() => setShowSettings(!showSettings)}
                className="h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-5 w-5" />
              </Button>
              {user ? (
                <Button
                  variant="ghost" size="icon"
                  onClick={signOut}
                  className="h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground"
                  title="Sair"
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  variant="ghost" size="icon"
                  onClick={() => navigate("/auth")}
                  className="h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground"
                  title="Entrar"
                >
                  <LogIn className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSubmit} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Cole o link do capítulo..."
              className="pl-9 pr-24 h-10 sm:h-11 rounded-xl bg-card border-border/60 text-sm"
              type="url"
            />
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              size="sm"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg h-7 sm:h-8 px-3 sm:px-4 text-xs font-semibold"
            >
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Carregar"}
            </Button>
          </form>

          {/* Language + translate */}
          <div className="flex items-center gap-2 mt-2.5">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[140px] sm:w-[160px] h-8 text-xs rounded-lg bg-card border-border/60">
                <Globe className="h-3 w-3 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {chapter && (
              <Button
                variant="outline" size="sm"
                onClick={handleRetranslate}
                disabled={isTranslating}
                className="h-8 rounded-lg text-xs border-border/60"
              >
                {isTranslating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
                Retraduzir
              </Button>
            )}
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="mt-3 p-3 sm:p-4 rounded-xl border border-border/60 bg-card space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Leitura</p>
                <div className="flex items-center gap-2 sm:gap-3">
                  <Type className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground w-12">Fonte</span>
                  <Button
                    variant="outline" size="icon"
                    className="h-9 w-9 rounded-lg"
                    onClick={() => setFontSize(prev => Math.max(12, prev - 2))}
                    disabled={fontSize <= 12}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="text-xs font-medium text-foreground w-8 text-center">{fontSize}</span>
                  <Button
                    variant="outline" size="icon"
                    className="h-9 w-9 rounded-lg"
                    onClick={() => setFontSize(prev => Math.min(32, prev + 2))}
                    disabled={fontSize >= 32}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Slider
                    value={[fontSize]}
                    onValueChange={([v]) => setFontSize(v)}
                    min={12} max={32} step={1}
                    className="flex-1"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Voz (TTS)</p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-xs text-muted-foreground sm:w-10">Voz</span>
                  <Select value={tts.selectedVoice} onValueChange={(v) => {
                      tts.setSelectedVoice(v);
                      // Preview: speak a short sample in the voice's language
                      const voice = tts.voices.find(vo => vo.name === v);
                      const lang = voice?.lang?.split('-')[0] || 'pt';
                      const samples: Record<string, string> = {
                        pt: 'Olá, esta é a minha voz.',
                        en: 'Hello, this is my voice.',
                        es: 'Hola, esta es mi voz.',
                        fr: 'Bonjour, voici ma voix.',
                        ja: 'こんにちは、これが私の声です。',
                        ko: '안녕하세요, 이것이 제 목소리입니다.',
                        zh: '你好，这是我的声音。',
                        de: 'Hallo, das ist meine Stimme.',
                        it: 'Ciao, questa è la mia voce.',
                        ru: 'Привет, это мой голос.',
                      };
                      const sample = samples[lang] || samples.pt;
                      // Small delay to let the voice selection apply
                      setTimeout(() => tts.speak(sample), 150);
                    }}>
                    <SelectTrigger className="h-8 text-xs flex-1 rounded-lg bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {(() => {
                        // Group voices by language, prioritize current language
                        const langMap = new Map<string, typeof tts.voices[number][]>();
                        tts.voices.forEach(v => {
                          const lang = v.lang.split('-')[0];
                          if (!langMap.has(lang)) langMap.set(lang, []);
                          langMap.get(lang)!.push(v);
                        });

                        const langLabels: Record<string, string> = {
                          pt: '🇧🇷 Português', en: '🇺🇸 English', es: '🇪🇸 Español',
                          fr: '🇫🇷 Français', ja: '🇯🇵 日本語', ko: '🇰🇷 한국어',
                          zh: '🇨🇳 中文', de: '🇩🇪 Deutsch', it: '🇮🇹 Italiano', ru: '🇷🇺 Русский',
                        };

                        // Target lang code from selected language
                        const targetLang = language.toLowerCase().startsWith('portuguese') ? 'pt'
                          : language.toLowerCase().startsWith('english') ? 'en'
                          : language.toLowerCase().startsWith('spanish') ? 'es'
                          : language.toLowerCase().startsWith('french') ? 'fr'
                          : language.toLowerCase().startsWith('japanese') ? 'ja'
                          : language.toLowerCase().startsWith('korean') ? 'ko'
                          : language.toLowerCase().startsWith('chinese') ? 'zh' : 'pt';

                        // Sort: target language first, then alphabetical
                        const sortedLangs = Array.from(langMap.keys()).sort((a, b) => {
                          if (a === targetLang) return -1;
                          if (b === targetLang) return 1;
                          return a.localeCompare(b);
                        });

                        return sortedLangs.map(lang => {
                          const voices = langMap.get(lang)!;
                          const label = langLabels[lang] || lang.toUpperCase();
                          return (
                            <div key={lang}>
                              <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider sticky top-0 bg-popover">
                                {label}
                              </div>
                              {voices.map(v => {
                                // Clean voice name: remove "Microsoft", "Google", lang suffix
                                const cleanName = v.name
                                  .replace(/Microsoft\s+/i, '')
                                  .replace(/Google\s+/i, '')
                                  .replace(/\s+Online.*$/i, '')
                                  .replace(/\s*\(.*\)\s*$/, '')
                                  .trim();
                                return (
                                  <SelectItem key={v.name} value={v.name}>
                                    {cleanName}
                                    {v.localService ? '' : ' ☁️'}
                                  </SelectItem>
                                );
                              })}
                            </div>
                          );
                        });
                      })()}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 mt-2">
                  <span className="text-xs text-muted-foreground w-8 sm:w-10">Vel.</span>
                  <Slider
                    value={[tts.rate]}
                    onValueChange={([v]) => tts.setRate(v)}
                    min={0.5} max={4} step={0.1}
                    className="flex-1"
                  />
                  <span className="text-xs font-medium text-foreground w-8 sm:w-10 text-right">{tts.rate}x</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 mt-2">
                  <span className="text-xs text-muted-foreground w-8 sm:w-10">Tom</span>
                  <Slider
                    value={[tts.pitch]}
                    onValueChange={([v]) => tts.setPitch(v)}
                    min={0.5} max={2} step={0.1}
                    className="flex-1"
                  />
                  <span className="text-xs font-medium text-foreground w-8 sm:w-10 text-right">{tts.pitch}</span>
                </div>


                <div className="mt-3 pt-3 border-t border-border/40">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Mic className="h-3 w-3" /> Motor de Voz
                  </p>
                  <Select
                    value={ttsEngine}
                    onValueChange={(v) => {
                      const next = v as TTSEnginePreference;
                      setTTSEngine(next);
                      setTtsEngineState(next);
                      toast.success("Motor de voz atualizado", {
                        description: "A mudança se aplica na próxima vez que você iniciar a leitura.",
                        duration: 3000,
                      });
                    }}
                  >
                    <SelectTrigger className="h-9 rounded-lg text-xs border-border/60 mt-1">
                      <SelectValue placeholder="Escolha o motor" />
                    </SelectTrigger>
                    <SelectContent>
                      {isNative() && (
                        <SelectItem value="native">📱 Nativo do Android (toca com tela apagada)</SelectItem>
                      )}
                      <SelectItem value="webspeech">🌐 Navegador (Web Speech API)</SelectItem>
                      <SelectItem value="edge">☁️ Edge TTS (experimental, alta qualidade)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {ttsEngine === 'edge'
                      ? "⚠️ Edge TTS usa um endpoint não-oficial da Microsoft. Qualidade alta, gratuito, toca com tela apagada — mas pode parar de funcionar sem aviso. Há fallback automático para o navegador."
                      : isNative() && ttsEngine === 'native'
                      ? "📱 Motor de voz nativo do dispositivo. Toca com a tela apagada."
                      : "🌐 Web Speech API do navegador. Vozes dependem do sistema operacional."}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Após escolher o motor, selecione uma voz compatível acima (vozes ☁️ Edge funcionam apenas com o motor Edge TTS).
                  </p>
                </div>


                {/* TTS Diagnostics */}
                <TTSDiagnosticsPanel
                  debugInfo={tts.debugInfo}
                  voiceCount={tts.voices.length}
                  runDiagnostics={tts.runDiagnostics}
                  openInstall={tts.openInstall}
                />
              </div>
              {/* Cache */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cache de Traduções</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={async () => {
                      await clearTranslationCache();
                      toast.success("Cache de traduções limpo!");
                    }}
                    className="rounded-lg gap-2 text-xs border-border/60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Limpar cache
                  </Button>
                  <span className="text-xs text-muted-foreground">Capítulos já traduzidos são carregados instantaneamente do cache local.</span>
                </div>
              </div>
              {/* Install App */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Instalar App</p>
                {pwa.isInstalled ? (
                  <p className="text-xs text-muted-foreground">✅ App já instalado!</p>
                ) : pwa.canInstall ? (
                  <Button
                    variant="outline" size="sm"
                    onClick={pwa.install}
                    className="rounded-lg gap-2 text-xs border-border/60"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Instalar no celular
                  </Button>
                ) : (
                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <p className="font-medium text-foreground/80">Para instalar:</p>
                    <p>📱 <strong>iPhone:</strong> Toque em Compartilhar (⬆) → "Adicionar à Tela de Início"</p>
                    <p>🤖 <strong>Android:</strong> Menu do navegador (⋮) → "Instalar app" ou "Adicionar à tela inicial"</p>
                  </div>
                )}
              </div>
              {/* Admin: TTS Usage */}
              {isAdmin && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Administração</p>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => navigate('/tts-usage')}
                    className="rounded-lg gap-2 text-xs border-border/60"
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Consumo TTS
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Reading History Panel */}
      {showHistory && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 border-b border-border/60 bg-card/50">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Histórico de Leitura</p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm"
                onClick={() => setShowTrash(true)}
                className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="Lixeira"
              >
                <ArchiveRestore className="h-4 w-4" />
                Lixeira{trash.length > 0 ? ` (${trash.length})` : ''}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowHistory(false)} className="h-10 w-10">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum capítulo lido ainda.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto overscroll-contain">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/40 active:border-primary/30 transition-colors cursor-pointer group"
                  onClick={() => handleHistoryItemClick(h)}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{h.novel_title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="text-foreground/60">
                        {(() => {
                          if (h.chapter_title && h.chapter_title !== h.novel_title) return h.chapter_title;
                          const match = h.chapter_url.match(/chapter[_-]?(\d+)/i);
                          return match ? `Capítulo ${match[1]}` : 'Último capítulo';
                        })()}
                      </span>
                      {' · '}
                      {new Date(h.last_read_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {(h.scroll_percent ?? 0) > 0.02 && (
                        <> {' · '}<span className="text-primary/80">{Math.round((h.scroll_percent || 0) * 100)}%</span></>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="h-10 w-10 opacity-100 text-destructive/60 active:text-destructive shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDeleteHistory(h.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trash Panel */}
      {showTrash && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 border-b border-border/60 bg-card/50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Lixeira</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Itens são excluídos permanentemente após 30 dias.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setShowTrash(false)} className="h-10 w-10">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {trash.length === 0 ? (
            <p className="text-xs text-muted-foreground">A lixeira está vazia.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto overscroll-contain">
              {trash.map((h) => {
                const deletedAt = h.deleted_at ? new Date(h.deleted_at) : null;
                const daysLeft = deletedAt
                  ? Math.max(0, 30 - Math.floor((Date.now() - deletedAt.getTime()) / 86400000))
                  : 30;
                return (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/40"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{h.novel_title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(() => {
                          if (h.chapter_title && h.chapter_title !== h.novel_title) return h.chapter_title;
                          const match = h.chapter_url.match(/chapter[_-]?(\d+)/i);
                          return match ? `Capítulo ${match[1]}` : 'Último capítulo';
                        })()}
                        {' · '}
                        <span className="text-destructive/70">
                          {daysLeft === 0 ? 'expira hoje' : `${daysLeft}d restantes`}
                        </span>
                      </p>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-10 w-10 text-primary shrink-0"
                      onClick={() => handleRestoreFromTrash(h)}
                      title="Restaurar"
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-10 w-10 text-destructive/70 active:text-destructive shrink-0"
                      onClick={() => handlePurgeFromTrash(h.id)}
                      title="Excluir permanentemente"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8" style={{ paddingBottom: contentBottomPadding }}>
        {/* Empty State */}
        {!chapter && !isLoading && (
          <div className="py-8 sm:py-12">
            {/* Recent novels for logged-in users */}
            {user && history.length > 0 ? (() => {
              // Group by novel, keep only latest chapter per novel
              const novelMap = new Map<string, HistoryEntry>();
              history.forEach((h) => {
                const existing = novelMap.get(h.novel_url);
                if (!existing || new Date(h.last_read_at) > new Date(existing.last_read_at)) {
                  novelMap.set(h.novel_url, h);
                }
              });
              const novels = Array.from(novelMap.values())
                .sort((a, b) => new Date(b.last_read_at).getTime() - new Date(a.last_read_at).getTime());

              return (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-4" style={{ fontFamily: 'var(--font-heading)' }}>
                    Continuar lendo
                  </h2>
                  <div className="space-y-3">
                    {novels.map((novel) => (
                      <div
                        key={novel.novel_url}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/60 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group"
                        onClick={() => handleHistoryItemClick(novel)}
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                          <BookOpen className="h-5 w-5 text-primary" />
                        </div>
                      <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">{novel.novel_title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            <span className="text-foreground/60">
                              {(() => {
                                if (novel.chapter_title && novel.chapter_title !== novel.novel_title) {
                                  return novel.chapter_title;
                                }
                                const match = novel.chapter_url.match(/chapter[_-]?(\d+)/i);
                                return match ? `Capítulo ${match[1]}` : 'Último capítulo';
                              })()}
                            </span>
                          </p>
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {new Date(novel.last_read_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <Button
                          variant="ghost" size="icon"
                          className="h-10 w-10 opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive shrink-0 transition-opacity"
                          title="Remover novel"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteHistory(novel.id);
                            toast.success("Novel removida da lista");
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })() : (
              <div className="flex flex-col items-center justify-center py-8 sm:py-16 text-center">
                <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-primary/5 mb-5 sm:mb-6">
                  <BookOpen className="h-8 w-8 sm:h-10 sm:w-10 text-primary/40" />
                </div>
                <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                  Comece a ler
                </h2>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  Cole o link de um capítulo acima para carregar, traduzir e ouvir
                </p>
                {!user && (
                  <Button
                    variant="outline"
                    onClick={() => navigate("/auth")}
                    className="mt-5 rounded-xl gap-2"
                  >
                    <LogIn className="h-4 w-4" />
                    Entre para salvar seu progresso
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 sm:py-24">
            <Loader2 className="h-10 w-10 sm:h-12 sm:w-12 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Carregando capítulo...</p>
          </div>
        )}

        {/* Chapter */}
        {chapter && !isLoading && (
          <>
            {/* Top Navigation - sticky so it stays visible while scrolling */}
            <nav className="flex items-center justify-between py-3 mb-4 border-b border-border/60 sticky top-0 z-20 bg-background/95 backdrop-blur-sm -mx-4 sm:-mx-6 px-4 sm:px-6">
              <Button
                variant="outline"
                onClick={() => chapter.prevChapterUrl && loadChapter(chapter.prevChapterUrl)}
                disabled={!chapter.prevChapterUrl || isLoading || isTranslating}
                className="rounded-xl border-border/60 gap-1 text-xs sm:text-sm"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>

              <span className="text-xs text-muted-foreground font-medium truncate max-w-[40%] text-center">
                {chapter.title}
              </span>

              <Button
                onClick={() => chapter.nextChapterUrl && loadChapter(chapter.nextChapterUrl)}
                disabled={!chapter.nextChapterUrl || isLoading || isTranslating}
                className="rounded-xl gap-1 text-xs sm:text-sm"
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>

            <header className="mb-6 sm:mb-8">
              <h2
                className="text-xl sm:text-2xl font-bold leading-tight text-foreground mb-2"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {chapter.title}
              </h2>
              {isTranslating && (
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Traduzindo... {translationProgress}%
                  </div>
                  <Progress value={translationProgress} className="flex-1 h-2 max-w-[200px]" />
                </div>
              )}
            </header>

            <ChapterArticle
              displayText={displayText}
              activeCharIndex={tts.activeCharIndex}
              isSpeaking={tts.isSpeaking}
              onClickWord={(charIndex) => tts.speakFromIndex(displayText, charIndex)}
              fontSize={fontSize}
            />

            {/* Nav */}
            <nav className="flex items-center justify-between py-5 sm:py-6 border-t border-border/60 mt-8 mb-16">
              <Button
                variant="outline"
                onClick={() => chapter.prevChapterUrl && loadChapter(chapter.prevChapterUrl)}
                disabled={!chapter.prevChapterUrl || isLoading}
                className="rounded-xl border-border/60 gap-1 text-xs sm:text-sm"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Anterior</span>
              </Button>

              <span className="text-xs text-muted-foreground">
                {displayText.split(/\s+/).length.toLocaleString()} palavras
              </span>

              <Button
                onClick={() => chapter.nextChapterUrl && loadChapter(chapter.nextChapterUrl)}
                disabled={!chapter.nextChapterUrl || isLoading}
                className="rounded-xl gap-1 text-xs sm:text-sm"
              >
                <span className="hidden sm:inline">Próximo</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>
          </>
        )}
      </main>

      {/* TTS Bar */}
      {chapter && displayText && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-background/80 backdrop-blur-xl px-4 sm:px-6 pt-2.5 sm:pt-3"
          style={{ paddingBottom: `calc(0.625rem + ${safeAreaBottom})` }}
        >
          <div className="mx-auto max-w-3xl">
            <Progress value={tts.progress} className="mb-2 h-1 rounded-full" />
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              {/* Auto-read toggle */}
              <Button
                size="sm"
                variant={autoRead ? "default" : "outline"}
                onClick={() => setAutoRead(!autoRead)}
                className={`rounded-xl gap-1.5 px-3 h-10 text-xs ${autoRead ? '' : 'border-border/60'}`}
                title={autoRead ? "Leitura contínua ativada" : "Ativar leitura contínua"}
              >
                <RefreshCw className={`h-4 w-4 ${autoRead ? 'animate-spin' : ''}`} style={autoRead ? { animationDuration: '3s' } : {}} />
                <span className="hidden sm:inline">Auto</span>
              </Button>

              {!tts.isSpeaking ? (
                <Button
                  size="sm"
                  disabled={tts.isLoading}
                  onClick={async () => {
                    // Set chapter info in lock screen notification
                    if (chapter) {
                      updateMediaSessionMetadata(chapter.title, 'Novel Reader');
                    }
                    toast.info("Iniciando leitura...", { duration: 2000 });
                    try {
                      await tts.speak(displayText);
                    } catch (err: any) {
                      toast.error("Erro ao iniciar leitura", {
                        description: err?.message || "Erro desconhecido",
                        duration: 6000,
                      });
                    }
                  }}
                  className="rounded-xl gap-2 px-5 h-10 text-sm"
                >
                  {tts.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                  <span className="hidden sm:inline">{tts.isLoading ? "Iniciando..." : "Ouvir Capítulo"}</span>
                  <span className="sm:hidden">{tts.isLoading ? "..." : "Ouvir"}</span>
                </Button>
              ) : (
                <>
                  <Button
                    size="icon" variant="outline"
                    onClick={tts.isPaused ? tts.resume : tts.pause}
                    className="h-10 w-10 rounded-xl border-border/60"
                  >
                    {tts.isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => { tts.stop(); setAutoRead(false); }}
                    className="h-10 w-10 rounded-xl text-destructive hover:text-destructive"
                  >
                    <Square className="h-5 w-5" />
                  </Button>
                  <span className="text-xs text-muted-foreground ml-1">{Math.round(tts.progress)}%</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
