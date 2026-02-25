import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";

// Detect if we're running inside a Capacitor native app
const isNativeApp = typeof (window as any).Capacitor !== 'undefined';

export function PWAUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [doUpdate, setDoUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    // Skip PWA registration entirely in native Capacitor app or when SW not supported
    if (isNativeApp || !('serviceWorker' in navigator)) return;

    // Dynamically import to avoid crash when virtual module is unavailable
    (async () => {
      try {
        // @ts-ignore - virtual module from vite-plugin-pwa
        const { useRegisterSW } = await import("virtual:pwa-register/react");
        // We can't use hooks from dynamic import, so use the global registration approach
      } catch {
        // Not available
      }
    })();
  }, []);

  // Since we can't use the React hook dynamically, use a simpler approach
  // that checks for SW updates manually
  useEffect(() => {
    if (isNativeApp || !('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      registration = reg;

      // Check for updates periodically
      const interval = setInterval(() => {
        reg.update().catch(() => {});
      }, 60 * 1000);

      // Listen for new SW waiting
      const onStateChange = () => {
        if (reg.waiting) {
          setNeedRefresh(true);
          setDoUpdate(() => () => {
            reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(() => window.location.reload(), 1000);
          });
        }
      };

      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (newSW) {
          newSW.addEventListener('statechange', onStateChange);
        }
      });

      // Check if there's already a waiting SW
      if (reg.waiting) {
        onStateChange();
      }

      return () => clearInterval(interval);
    });
  }, []);

  if (!needRefresh || !doUpdate) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[100] flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-lg animate-in slide-in-from-bottom-4 sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Nova versão disponível!</p>
        <p className="text-xs text-muted-foreground mt-0.5">Atualize para obter as últimas melhorias.</p>
      </div>
      <Button
        size="sm"
        onClick={doUpdate}
        className="shrink-0 gap-1.5 rounded-lg"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Atualizar
      </Button>
    </div>
  );
}
