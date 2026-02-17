import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTTS } from "@/hooks/use-tts";
import { scrapeChapter, translateChapter, type ChapterData } from "@/lib/api/novel";
import { toast } from "sonner";
import {
  BookOpen, ChevronLeft, ChevronRight, Globe, Loader2,
  Pause, Play, Square, Volume2, Settings2, Search,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";

const LANGUAGES = [
  { value: "Portuguese (Brazilian)", label: "🇧🇷 Português" },
  { value: "English", label: "🇺🇸 English" },
  { value: "Spanish", label: "🇪🇸 Español" },
  { value: "French", label: "🇫🇷 Français" },
  { value: "Japanese", label: "🇯🇵 日本語" },
  { value: "Korean", label: "🇰🇷 한국어" },
  { value: "Chinese", label: "🇨🇳 中文" },
];

const Index = () => {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("Portuguese (Brazilian)");
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [displayText, setDisplayText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const tts = useTTS();

  const loadChapter = async (chapterUrl: string) => {
    setIsLoading(true);
    tts.stop();
    try {
      const data = await scrapeChapter(chapterUrl);
      setChapter(data);
      setUrl(chapterUrl);
      setDisplayText(data.content);
      setIsLoading(false);

      setIsTranslating(true);
      translateChapter(data.content, language)
        .then((translated) => setDisplayText(translated))
        .catch((err: any) => toast.error("Erro na tradução: " + err.message))
        .finally(() => setIsTranslating(false));
    } catch (err: any) {
      toast.error("Erro ao carregar: " + err.message);
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    loadChapter(url.trim());
  };

  const handleRetranslate = async () => {
    if (!chapter) return;
    setIsTranslating(true);
    tts.stop();
    try {
      const translated = await translateChapter(chapter.content, language);
      setDisplayText(translated);
      toast.success("Tradução atualizada!");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <h1 className="text-lg font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
                Novel Reader
              </h1>
            </div>
            <Button
              variant="ghost" size="icon"
              onClick={() => setShowSettings(!showSettings)}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Cole o link do capítulo aqui..."
              className="pl-9 pr-24 h-11 rounded-xl bg-card border-border/60 text-sm"
              type="url"
            />
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              size="sm"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg h-8 px-4 text-xs font-semibold"
            >
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Carregar"}
            </Button>
          </form>

          <div className="flex items-center gap-2 mt-3">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[160px] h-8 text-xs rounded-lg bg-card border-border/60">
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
                {isTranslating ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Globe className="h-3 w-3 mr-1.5" />}
                Retraduzir
              </Button>
            )}
          </div>

          {/* TTS Settings */}
          {showSettings && (
            <div className="mt-3 p-4 rounded-xl border border-border/60 bg-card space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configurações de Voz</p>
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
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-10">Vel.</span>
                <Slider
                  value={[tts.rate]}
                  onValueChange={([v]) => tts.setRate(v)}
                  min={0.5} max={2} step={0.1}
                  className="flex-1"
                />
                <span className="text-xs font-medium text-foreground w-10 text-right">{tts.rate}x</span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-2xl px-5 py-8 pb-28">
        {/* Empty State */}
        {!chapter && !isLoading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/5 mb-6">
              <BookOpen className="h-10 w-10 text-primary/40" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
              Comece a ler
            </h2>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Cole o link de um capítulo de novel acima para carregar, traduzir e ouvir
            </p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative mb-6">
              <div className="h-12 w-12 rounded-full border-2 border-primary/20" />
              <Loader2 className="absolute inset-0 h-12 w-12 animate-spin text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Carregando capítulo...</p>
          </div>
        )}

        {/* Chapter Content */}
        {chapter && !isLoading && (
          <>
            <header className="mb-8">
              <h2
                className="text-2xl font-bold leading-tight text-foreground mb-2"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {chapter.title}
              </h2>
              {isTranslating && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Traduzindo...
                </div>
              )}
            </header>

            <article
              className="mb-10"
              style={{ fontFamily: 'var(--font-reading)' }}
            >
              {displayText.split('\n').map((paragraph, i) => (
                paragraph.trim() ? (
                  <p key={i} className="mb-4 text-lg leading-[1.85] text-foreground/85">
                    {paragraph}
                  </p>
                ) : null
              ))}
            </article>

            {/* Chapter Navigation */}
            <nav className="flex items-center justify-between py-6 border-t border-border/60">
              <Button
                variant="outline"
                onClick={() => chapter.prevChapterUrl && loadChapter(chapter.prevChapterUrl)}
                disabled={!chapter.prevChapterUrl || isLoading}
                className="rounded-xl border-border/60 gap-1.5"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>

              <span className="text-xs text-muted-foreground">
                {displayText.split(/\s+/).length.toLocaleString()} palavras
              </span>

              <Button
                onClick={() => chapter.nextChapterUrl && loadChapter(chapter.nextChapterUrl)}
                disabled={!chapter.nextChapterUrl || isLoading}
                className="rounded-xl gap-1.5"
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>
          </>
        )}
      </main>

      {/* TTS Floating Bar */}
      {chapter && displayText && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border/60 bg-background/80 backdrop-blur-xl px-5 py-3">
          <div className="mx-auto max-w-2xl">
            <Progress value={tts.progress} className="mb-2.5 h-1 rounded-full" />
            <div className="flex items-center justify-center gap-2">
              {!tts.isSpeaking ? (
                <Button
                  size="sm"
                  onClick={() => tts.speak(displayText)}
                  className="rounded-xl gap-2 px-5"
                >
                  <Volume2 className="h-4 w-4" />
                  Ouvir Capítulo
                </Button>
              ) : (
                <>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={tts.isPaused ? tts.resume : tts.pause}
                    className="h-9 w-9 rounded-xl border-border/60"
                  >
                    {tts.isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={tts.stop}
                    className="h-9 w-9 rounded-xl text-destructive hover:text-destructive"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground ml-2">
                    {Math.round(tts.progress)}%
                  </span>
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
