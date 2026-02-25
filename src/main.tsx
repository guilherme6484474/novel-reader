import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Global error handler to prevent silent white/black screens
window.addEventListener('error', (event) => {
  console.error('[Novel Reader] Uncaught error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Novel Reader] Unhandled promise rejection:', event.reason);
});

// Configure StatusBar for native Android/iOS
if (typeof (window as any).Capacitor !== 'undefined') {
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#1a1510' }).catch(() => {});
  }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
