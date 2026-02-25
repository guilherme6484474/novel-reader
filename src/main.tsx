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

createRoot(document.getElementById("root")!).render(<App />);
