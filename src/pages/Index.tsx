import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTTS } from "@/hooks/use-tts";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { scrapeChapter, translateChapterStream, type ChapterData } from "@/lib/api/novel";
import { getCachedTranslation, setCachedTranslation, clearTranslationCache } from "@/lib/translation-cache";
import { saveReadingProgress, getReadingHistory, deleteReadingEntry } from "@/lib/api/reading-history";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  BookOpen, ChevronLeft, ChevronRight, Globe, Loader2,
  Pause, Play, Square, Volume2, Settings2, Search,
  Moon, Sun, LogIn, LogOut, History, X, Trash2, Minus, Plus, Type,
  RefreshCw, Download,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";

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
  const activeRef = useRef<HTMLSpanElement>(null);
  const prevParaCountRef = useRef(0);
  useEffect(() => {
    if (activeRef.current && isSpeaking) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCharIndex, isSpeaking]);

  const paragraphs = useMemo(() => {
    const result: { text: string; globalStart: number }[] = [];
    let offset = 0;
    for (const line of displayText.split('\n')) {
      if (line.trim()) {
        result.push({ text: line, globalStart: offset });
      }
      offset += line.length + 1; // +1 for \n
    }
    return result;
  }, [displayText]);

  const prevParaCount = prevParaCountRef.current;
  useEffect(() => { prevParaCountRef.current = paragraphs.length; }, [paragraphs.length]);

  return (
    <article style={{ fontFamily: 'var(--font-reading)', fontSize: `${fontSize}px` }}>
      {paragraphs.map((para, pi) => (
        <p
          key={pi}
          className={`mb-4 leading-[1.85] text-foreground/85 ${pi >= prevParaCount ? 'animate-fade-in' : ''}`}
        >
          {para.text.split(/(\s+)/).map((word, wi) => {
            // Calculate this word's global char index
            const localOffset = para.text.indexOf(word, 
              para.text.split(/(\s+)/).slice(0, wi).join('').length
            );
            const globalIndex = para.globalStart + localOffset;

            if (!word.trim()) return <span key={wi}>{word}</span>;

            const isActive = isSpeaking && activeCharIndex >= 0 &&
              globalIndex <= activeCharIndex &&
              activeCharIndex < globalIndex + word.length;

            return (
              <span
                key={wi}
                ref={isActive ? activeRef : undefined}
                onClick={() => onClickWord(globalIndex)}
                className={`cursor-pointer transition-colors duration-150 rounded-sm px-[1px] ${
                  isActive
                    ? 'bg-primary/20 text-primary font-medium'
                    : isSpeaking && activeCharIndex >= 0 && globalIndex < activeCharIndex
                    ? 'text-muted-foreground/60'
                    : 'hover:bg-primary/10'
                }`}
              >
                {word}
              </span>
            );
          })}
        </p>
      ))}
    </article>
  );
});

const Index = () => {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState(() => localStorage.getItem('nr-language') || "Portuguese (Brazilian)");
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [displayText, setDisplayText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('nr-fontSize')) || 18);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [autoRead, setAutoRead] = useState(() => localStorage.getItem('nr-autoRead') === 'true');
  const autoReadRef = useRef(autoRead);
  const tts = useTTS();
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

  useEffect(() => {
    if (user) {
      getReadingHistory(user.id).then(setHistory);
    }
  }, [user]);

  const loadChapter = async (chapterUrl: string) => {
    // Cancel any in-flight translation
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });

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

      // Save progress
      if (user) {
        const urlObj = new URL(chapterUrl);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const novelSlug = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0] || 'unknown';
        const novelName = novelSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        saveReadingProgress(user.id, chapterUrl, novelName, chapterUrl, data.title);
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
      };

      translateChapterStream(data.content, language, (delta) => {
        streamedText += delta;
        if (!needsFlush) { needsFlush = true; rafId = requestAnimationFrame(flushText); }
      }, controller.signal)
        .then(() => {
          cancelAnimationFrame(rafId);
          setDisplayText(streamedText);
          setTranslationProgress(100);
          setCachedTranslation(chapterUrl, language, streamedText);
          if (autoReadRef.current) {
            setTimeout(() => tts.speak(streamedText), 300);
          }
          // Prefetch next chapter
          prefetchNextChapter(data.nextChapterUrl);
        })
        .catch((err: any) => {
          if (err.name === 'AbortError') return;
          toast.error("Erro na tradução: " + err.message);
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
      }, controller.signal);
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
    await deleteReadingEntry(id);
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 sm:py-4">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-primary/10">
                <BookOpen className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
                Novel Reader
              </h1>
            </div>
            <div className="flex items-center gap-1">
              {pwa.canInstall && (
                <Button
                  variant="ghost" size="icon"
                  onClick={pwa.install}
                  className="h-8 w-8 rounded-lg text-primary hover:text-primary"
                  title="Instalar app"
                >
                  <Download className="h-4 w-4" />
                </Button>
              )}
              {user && (
                <Button
                  variant="ghost" size="icon"
                  onClick={() => setShowHistory(!showHistory)}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <History className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost" size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost" size="icon"
                onClick={() => setShowSettings(!showSettings)}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              {user ? (
                <Button
                  variant="ghost" size="icon"
                  onClick={signOut}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                  title="Sair"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost" size="icon"
                  onClick={() => navigate("/auth")}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                  title="Entrar"
                >
                  <LogIn className="h-4 w-4" />
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
            <div className="mt-3 p-4 rounded-xl border border-border/60 bg-card space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Leitura</p>
                <div className="flex items-center gap-3">
                  <Type className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground w-12">Fonte</span>
                  <Button
                    variant="outline" size="icon"
                    className="h-7 w-7 rounded-lg"
                    onClick={() => setFontSize(prev => Math.max(12, prev - 2))}
                    disabled={fontSize <= 12}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="text-xs font-medium text-foreground w-8 text-center">{fontSize}</span>
                  <Button
                    variant="outline" size="icon"
                    className="h-7 w-7 rounded-lg"
                    onClick={() => setFontSize(prev => Math.min(32, prev + 2))}
                    disabled={fontSize >= 32}
                  >
                    <Plus className="h-3 w-3" />
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
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-10">Voz</span>
                  <Select value={tts.selectedVoice} onValueChange={tts.setSelectedVoice}>
                    <SelectTrigger className="h-8 text-xs flex-1 rounded-lg bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tts.voices.map((v) => (
                        <SelectItem key={v.name} value={v.name}>
                          {v.name} ({v.lang})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-muted-foreground w-10">Vel.</span>
                  <Slider
                    value={[tts.rate]}
                    onValueChange={([v]) => tts.setRate(v)}
                    min={0.5} max={2} step={0.1}
                    className="flex-1"
                  />
                  <span className="text-xs font-medium text-foreground w-10 text-right">{tts.rate}x</span>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-muted-foreground w-10">Tom</span>
                  <Slider
                    value={[tts.pitch]}
                    onValueChange={([v]) => tts.setPitch(v)}
                    min={0.5} max={2} step={0.1}
                    className="flex-1"
                  />
                  <span className="text-xs font-medium text-foreground w-10 text-right">{tts.pitch}</span>
                </div>
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
            </div>
          )}
        </div>
      </header>

      {/* Reading History Panel */}
      {showHistory && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 border-b border-border/60 bg-card/50">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Histórico de Leitura</p>
            <Button variant="ghost" size="icon" onClick={() => setShowHistory(false)} className="h-7 w-7">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum capítulo lido ainda.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/40 hover:border-primary/30 transition-colors cursor-pointer group"
                  onClick={() => loadChapter(h.chapter_url)}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <BookOpen className="h-4 w-4 text-primary" />
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
                    </p>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDeleteHistory(h.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 pb-32">
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
                        onClick={() => loadChapter(novel.chapter_url)}
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                          <BookOpen className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">{novel.novel_title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            <span className="text-foreground/60">
                              {(() => {
                                // Show chapter info: prefer chapter_title if different from novel_title, else extract from URL
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
        <div className="fixed bottom-0 left-0 right-0 border-t border-border/60 bg-background/80 backdrop-blur-xl px-4 sm:px-6 py-2.5 sm:py-3" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto max-w-3xl">
            <Progress value={tts.progress} className="mb-2 h-1 rounded-full" />
            <div className="flex items-center justify-center gap-2">
              {/* Auto-read toggle */}
              <Button
                size="sm"
                variant={autoRead ? "default" : "outline"}
                onClick={() => setAutoRead(!autoRead)}
                className={`rounded-xl gap-1.5 px-3 text-xs ${autoRead ? '' : 'border-border/60'}`}
                title={autoRead ? "Leitura contínua ativada" : "Ativar leitura contínua"}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${autoRead ? 'animate-spin' : ''}`} style={autoRead ? { animationDuration: '3s' } : {}} />
                <span className="hidden sm:inline">Auto</span>
              </Button>

              {!tts.isSpeaking ? (
                <Button size="sm" onClick={() => { tts.speak(displayText); }} className="rounded-xl gap-2 px-4 sm:px-5 text-xs sm:text-sm">
                  <Volume2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Ouvir Capítulo</span>
                  <span className="sm:hidden">Ouvir</span>
                </Button>
              ) : (
                <>
                  <Button
                    size="icon" variant="outline"
                    onClick={tts.isPaused ? tts.resume : tts.pause}
                    className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl border-border/60"
                  >
                    {tts.isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => { tts.stop(); setAutoRead(false); }}
                    className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl text-destructive hover:text-destructive"
                  >
                    <Square className="h-4 w-4" />
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
