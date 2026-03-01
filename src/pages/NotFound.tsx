import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold text-foreground">404</h1>
        <p className="mb-4 text-lg text-muted-foreground">Página não encontrada</p>
        <a href="/" className="text-primary underline hover:text-primary/90 py-2 px-3 inline-block active:opacity-70">
          Voltar ao início
        </a>
      </div>
    </div>
  );
};

export default NotFound;
