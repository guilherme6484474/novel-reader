import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Settings2, Volume2 } from "lucide-react";
import type { TTSDiagnostics as DiagData } from "@/lib/native-tts";

interface TTSDiagnosticsProps {
  debugInfo: string;
  voiceCount: number;
  runDiagnostics: () => Promise<DiagData>;
  openInstall: () => Promise<boolean>;
}

export function TTSDiagnosticsPanel({ debugInfo, voiceCount, runDiagnostics, openInstall }: TTSDiagnosticsProps) {
  const [showDiag, setShowDiag] = useState(false);
  const [diagData, setDiagData] = useState<DiagData | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const handleRunDiag = async () => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const result = await runDiagnostics();
      setDiagData(result);
    } catch (err: any) {
      setDiagError(err.message);
    }
    setDiagLoading(false);
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="p-2 rounded-lg bg-muted/50 border border-border/40">
        <p className="text-[10px] font-mono text-muted-foreground break-all">
          🔧 {debugInfo} | Voices: {voiceCount}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => { setShowDiag(!showDiag); if (!showDiag && !diagData) handleRunDiag(); }}
          className="rounded-lg gap-1.5 text-xs border-border/60"
        >
          <Settings2 className="h-3 w-3" />
          {showDiag ? 'Ocultar diagnóstico' : 'Diagnóstico TTS'}
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={() => openInstall()}
          className="rounded-lg gap-1.5 text-xs border-border/60"
          title="Abrir configurações de voz do Android"
        >
          <Volume2 className="h-3 w-3" />
          Config. motor
        </Button>
      </div>
      {showDiag && (
        <div className="p-3 rounded-lg bg-card border border-border/60 space-y-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Diagnóstico do Motor TTS</p>
            <Button variant="ghost" size="sm" onClick={handleRunDiag} disabled={diagLoading} className="h-6 px-2 text-[10px]">
              {diagLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          {diagData && !diagError ? (
            <div className="text-[11px] font-mono space-y-1.5 text-muted-foreground">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>Plataforma nativa:</span>
                <span className={diagData.isNativePlatform ? 'text-green-500' : 'text-yellow-500'}>
                  {diagData.isNativePlatform ? '✅ Sim' : '⚠️ Web'}
                </span>
                <span>Plugin Capacitor:</span>
                <span className={diagData.pluginAvailable ? 'text-green-500' : 'text-destructive'}>
                  {diagData.pluginAvailable ? '✅ Disponível' : '❌ Indisponível'}
                </span>
                <span>Engine pronto:</span>
                <span className={diagData.pluginReady ? 'text-green-500' : 'text-yellow-500'}>
                  {diagData.pluginReady ? '✅ Sim' : '⏳ Não/Inicializando'}
                </span>
                <span>Vozes plugin:</span>
                <span className={diagData.voiceCount > 0 ? 'text-green-500' : 'text-yellow-500'}>
                  {diagData.voiceCount}
                </span>
                <span>WebSpeech API:</span>
                <span className={diagData.webSpeechAvailable ? 'text-green-500' : 'text-destructive'}>
                  {diagData.webSpeechAvailable ? `✅ ${diagData.webSpeechVoiceCount} vozes` : '❌ Indisponível'}
                </span>
              </div>
              {diagData.supportedLanguages.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold text-foreground/70 mb-1">
                    Idiomas suportados ({diagData.supportedLanguages.length}):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {diagData.supportedLanguages.slice(0, 30).map((lang: string) => (
                      <span key={lang} className="px-1.5 py-0.5 rounded bg-muted text-[9px]">{lang}</span>
                    ))}
                    {diagData.supportedLanguages.length > 30 && (
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[9px]">+{diagData.supportedLanguages.length - 30}</span>
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
