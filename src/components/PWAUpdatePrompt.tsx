import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      // Check for updates every 60 seconds
      if (r) {
        setInterval(() => {
          r.update();
        }, 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[100] flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-lg animate-in slide-in-from-bottom-4 sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Nova versão disponível!</p>
        <p className="text-xs text-muted-foreground mt-0.5">Atualize para obter as últimas melhorias.</p>
      </div>
      <Button
        size="sm"
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 gap-1.5 rounded-lg"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Atualizar
      </Button>
    </div>
  );
}
