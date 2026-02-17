import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTTS } from "@/hooks/use-tts";
import { scrapeChapter, translateChapter, type ChapterData } from "@/lib/api/novel";
import { toast } from "sonner";
import {
  BookOpen, ChevronLeft, ChevronRight, Globe, Loader2,
  Pause, Play, Square, Volume2, Settings2,
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
      setDisplayText(data.content); // Show original immediately
      setIsLoading(false);

      // Translate in background
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
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Novel Reader</h1>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Cole o link do capítulo aqui..."
              className="flex-1"
              type="url"
            />
            <Button type="submit" disabled={isLoading || !url.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Carregar"}
            </Button>
          </form>

          <div className="flex items-center gap-2 mt-2">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[180px] h-8 text-sm">
                <Globe className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {chapter && (
              <Button variant="outline" size="sm" onClick={handleRetranslate} disabled={isTranslating}>
                {isTranslating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
                Traduzir
              </Button>
            )}

            <Button
              variant="ghost" size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className="ml-auto"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>

          {/* TTS Settings */}
          {showSettings && (
            <div className="mt-2 p-3 rounded-lg border border-border bg-muted/50 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12">Voz:</span>
                <Select value={tts.selectedVoice} onValueChange={tts.setSelectedVoice}>
                  <SelectTrigger className="h-7 text-xs flex-1">
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
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12">Vel:</span>
                <Slider
                  value={[tts.rate]}
                  onValueChange={([v]) => tts.setRate(v)}
                  min={0.5} max={2} step={0.1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8">{tts.rate}x</span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-6">
        {!chapter && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold text-muted-foreground mb-2">
              Cole um link para começar
            </h2>
            <p className="text-sm text-muted-foreground">
              Suporta novelbin.com e sites similares de novels
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Carregando capítulo...</p>
          </div>
        )}

        {chapter && !isLoading && (
          <>
            <h2 className="text-xl font-bold mb-4 text-foreground">{chapter.title}</h2>

            {isTranslating && (
              <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-muted">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Traduzindo...</span>
              </div>
            )}

            <ScrollArea className="mb-6">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {displayText.split('\n').map((paragraph, i) => (
                  paragraph.trim() ? (
                    <p key={i} className="mb-3 leading-relaxed text-foreground/90">
                      {paragraph}
                    </p>
                  ) : null
                ))}
              </div>
            </ScrollArea>

            {/* Chapter Navigation */}
            <div className="flex items-center justify-between py-4 border-t border-border">
              <Button
                variant="outline"
                onClick={() => chapter.prevChapterUrl && loadChapter(chapter.prevChapterUrl)}
                disabled={!chapter.prevChapterUrl || isLoading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Anterior
              </Button>
              <Button
                onClick={() => chapter.nextChapterUrl && loadChapter(chapter.nextChapterUrl)}
                disabled={!chapter.nextChapterUrl || isLoading}
              >
                Próximo
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </main>

      {/* TTS floating bar */}
      {chapter && displayText && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <Progress value={tts.progress} className="mb-2 h-1" />
            <div className="flex items-center justify-center gap-3">
              {!tts.isSpeaking ? (
                <Button size="sm" onClick={() => tts.speak(displayText)}>
                  <Volume2 className="h-4 w-4 mr-1" />
                  Ouvir
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={tts.isPaused ? tts.resume : tts.pause}>
                    {tts.isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={tts.stop}>
                    <Square className="h-4 w-4" />
                  </Button>
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
