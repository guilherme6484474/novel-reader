import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Settings2, Volume2, ExternalLink, AlertTriangle, Trash2, ScrollText, Download } from "lucide-react";
import { isNative, nativeSpeak, type TTSDiagnostics as DiagData } from "@/lib/native-tts";
import { toast } from "sonner";
import { getLogEntries, clearLog, subscribeLog } from "@/lib/tts-debug-log";

interface TTSDiagnosticsProps {
  debugInfo: string;
  voiceCount: number;
  runDiagnostics: () => Promise<DiagData>;
  openInstall: () => Promise<boolean>;
}

const REFRESH_INTERVAL_MS = 3000;

/** Quick test: speak a short sentence using Web Speech API directly */
function testWebSpeechDirect(): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  try {
    speechSynthesis.cancel();
    const voices = speechSynthesis.getVoices();
    const utt = new SpeechSynthesisUtterance("Teste de voz. Voice test.");
    utt.lang = 'pt-BR';
    utt.rate = 1;
    utt.volume = 1;
    const ptVoice = voices.find(v => v.lang.startsWith('pt'));
    if (ptVoice) utt.voice = ptVoice;
    else if (voices.length > 0) utt.voice = voices[0];

    utt.onerror = (e) => {
      toast.error("Erro no teste de voz", { description: e.error || "Falha desconhecida" });
    };
    utt.onend = () => {
      toast.success("Teste de voz concluído!");
    };

    speechSynthesis.speak(utt);
    return true;
  } catch (e) {
    return false;
  }
}

function openGoogleTtsStore() {
  if (typeof window === 'undefined') return;
  window.open('https://play.google.com/store/apps/details?id=com.google.android.tts', '_blank', 'noopener,noreferrer');
}

function useLogEntries() {
  return useSyncExternalStore(
    subscribeLog,
    getLogEntries,
    getLogEntries,
  );
}

export function TTSDiagnosticsPanel({ debugInfo, voiceCount, runDiagnostics, openInstall }: TTSDiagnosticsProps) {
  const [showDiag, setShowDiag] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [diagData, setDiagData] = useState<DiagData | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const native = isNative();
  const logEntries = useLogEntries();

  const handleRunDiag = useCallback(async () => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const result = await runDiagnostics();
      setDiagData(result);
    } catch (err: any) {
      setDiagError(err.message);
    } finally {
      setDiagLoading(false);
    }
  }, [runDiagnostics]);

  useEffect(() => {
    if (!showDiag) return;
    void handleRunDiag();
    const interval = setInterval(() => void handleRunDiag(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [showDiag, handleRunDiag]);

  const handleOpenInstall = async () => {
    const opened = await openInstall();
    if (!opened) {
      toast.info("Instale um motor de voz", {
        description: "No Android: Configurações → Idioma e entrada → Motor de texto para fala. No Chrome/Edge, a Web Speech API é usada automaticamente.",
        duration: 8000,
      });
    }
  };

  const handleDownloadTts = () => {
    openGoogleTtsStore();
    toast.info("Abrindo Google Text-to-Speech na Play Store");
  };

  const handleTestVoice = async () => {
    if (native) {
      try {
        const result = await nativeSpeak({
          text: "Teste de voz no Android.",
          lang: typeof navigator !== 'undefined' ? navigator.language : 'pt-BR',
          rate: 1,
          pitch: 1,
        });
        toast.success("Teste de voz concluído!", {
          description: `Motor: ${result.engine}`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Erro no teste de voz", {
          description: msg.length > 120 ? `${msg.slice(0, 120)}…` : msg,
        });
      }
      return;
    }

    const ok = testWebSpeechDirect();
    if (!ok) {
      toast.error("Web Speech API indisponível", {
        description: "Seu navegador não suporta síntese de voz. Tente o Chrome ou Edge.",
        duration: 5000,
      });
    }
  };

  const levelColor = (level: string) => {
    if (level === 'error') return 'text-destructive';
    if (level === 'warn') return 'text-yellow-500';
    return 'text-muted-foreground';
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="p-2 rounded-lg bg-muted/50 border border-border/40">
        <p className="text-[10px] font-mono text-muted-foreground break-all">
          🔧 {debugInfo} | Voices: {voiceCount}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowDiag(!showDiag)}
          className="rounded-lg gap-1.5 text-xs border-border/60">
          <Settings2 className="h-3 w-3" />
          {showDiag ? 'Ocultar' : 'Diagnóstico'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleTestVoice}
          className="rounded-lg gap-1.5 text-xs border-border/60">
          <Volume2 className="h-3 w-3" />
          Testar voz
        </Button>
        <Button variant="outline" size="sm" onClick={handleOpenInstall}
          className="rounded-lg gap-1.5 text-xs border-border/60">
          <ExternalLink className="h-3 w-3" />
          {native ? "Config. motor" : "Instalar TTS"}
        </Button>
        {native && (
          <Button variant="outline" size="sm" onClick={handleDownloadTts}
            className="rounded-lg gap-1.5 text-xs border-border/60">
            <Download className="h-3 w-3" />
            Baixar TTS
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowLog(!showLog)}
          className="rounded-lg gap-1.5 text-xs border-border/60">
          <ScrollText className="h-3 w-3" />
          {showLog ? 'Ocultar log' : 'Ver log'}
        </Button>
      </div>

      {/* In-app TTS log — visible on device without LogCat */}
      {showLog && (
        <div className="p-2 rounded-lg bg-card border border-border/60 space-y-1 animate-fade-in max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-card pb-1">
            <p className="text-[10px] font-semibold text-foreground">Log TTS ({logEntries.length})</p>
            <Button variant="ghost" size="sm" onClick={clearLog} className="h-5 px-1.5 text-[9px]">
              <Trash2 className="h-2.5 w-2.5 mr-1" /> Limpar
            </Button>
          </div>
          {logEntries.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nenhum log ainda. Tente usar o TTS.</p>
          ) : (
            [...logEntries].reverse().map((entry, i) => (
              <div key={i} className="text-[9px] font-mono leading-tight">
                <span className="text-muted-foreground/60">{entry.time}</span>{' '}
                <span className={levelColor(entry.level)}>{entry.level === 'error' ? '❌' : entry.level === 'warn' ? '⚠️' : 'ℹ️'}</span>{' '}
                <span className={levelColor(entry.level)}>{entry.msg}</span>
              </div>
            ))
          )}
        </div>
      )}

      {showDiag && (
        <div className="p-3 rounded-lg bg-card border border-border/60 space-y-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Diagnóstico TTS</p>
            <Button variant="ghost" size="sm" onClick={handleRunDiag} disabled={diagLoading} className="h-6 px-2 text-[10px]">
              {diagLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          {diagData && !diagError ? (
            <div className="text-[11px] font-mono space-y-1.5 text-muted-foreground">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>Plataforma:</span>
                <span className={diagData.isNativePlatform ? 'text-primary' : 'text-muted-foreground'}>
                  {diagData.isNativePlatform ? '✅ Android nativo' : '⚠️ Web'}
                </span>
                {diagData.isNativePlatform && (
                  <>
                    <span>Plugin:</span>
                    <span className={diagData.pluginAvailable ? 'text-primary' : 'text-destructive'}>
                      {diagData.pluginAvailable ? '✅ OK' : '❌ Ausente'}
                    </span>
                    <span>Engine:</span>
                    <span className={diagData.pluginReady ? 'text-primary' : 'text-muted-foreground'}>
                      {diagData.pluginReady ? '✅ Pronto' : '⏳ Aguardando'}
                    </span>
                    <span>Vozes nativas:</span>
                    <span className={diagData.voiceCount > 0 ? 'text-primary' : 'text-muted-foreground'}>
                      {diagData.voiceCount}
                    </span>
                  </>
                )}
                <span>WebSpeech:</span>
                <span className={diagData.webSpeechAvailable ? 'text-primary' : 'text-destructive'}>
                  {diagData.webSpeechAvailable ? `✅ ${diagData.webSpeechVoiceCount} vozes` : '❌'}
                </span>
              </div>

              {!diagData.isNativePlatform && diagData.webSpeechVoiceCount === 0 && (
                <div className="mt-2 p-2 rounded bg-accent/50 border border-border/40">
                  <div className="flex gap-1.5 items-start">
                    <AlertTriangle className="h-3 w-3 text-accent-foreground mt-0.5 shrink-0" />
                    <div className="text-[10px] text-accent-foreground">
                      <p className="font-semibold mb-1">Sem vozes</p>
                      <p>Use <strong>Chrome</strong> ou <strong>Edge</strong>. No Android, instale <strong>Google Text-to-Speech</strong> pela Play Store.</p>
                    </div>
                  </div>
                </div>
              )}

              {diagData.isNativePlatform && !diagData.pluginReady && (
                <div className="mt-2 p-2 rounded bg-accent/50 border border-border/40">
                  <div className="flex gap-1.5 items-start">
                    <AlertTriangle className="h-3 w-3 text-accent-foreground mt-0.5 shrink-0" />
                    <div className="text-[10px] text-accent-foreground">
                      <p className="font-semibold mb-1">Motor TTS não pronto</p>
                      <p>Verifique em <strong>Configurações → Idioma → Texto para fala</strong> se o Google TTS está ativo.</p>
                      <p className="mt-1">Toque em "Config. motor" acima para abrir.</p>
                    </div>
                  </div>
                </div>
              )}

              {diagData.supportedLanguages.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold text-foreground/70 mb-1">
                    Idiomas ({diagData.supportedLanguages.length}):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {diagData.supportedLanguages.slice(0, 20).map((lang: string) => (
                      <span key={lang} className="px-1.5 py-0.5 rounded bg-muted text-[9px]">{lang}</span>
                    ))}
                    {diagData.supportedLanguages.length > 20 && (
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[9px]">+{diagData.supportedLanguages.length - 20}</span>
                    )}
                  </div>
                </div>
              )}
              {diagData.lastError && (
                <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/20">
                  <p className="text-[10px] font-semibold text-destructive mb-0.5">Último erro:</p>
                  <p className="text-[10px] text-destructive/80 break-all">{diagData.lastError}</p>
                </div>
              )}
            </div>
          ) : diagError ? (
            <p className="text-[10px] text-destructive">Erro: {diagError}</p>
          ) : diagLoading ? (
            <p className="text-[10px] text-muted-foreground">Carregando...</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
