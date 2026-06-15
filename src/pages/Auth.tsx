import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Mail, Lock, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import logoMark from "@/assets/logo-novel-reader.png";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Login realizado!");
        navigate("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu e-mail para confirmar.");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pb-safe relative overflow-hidden bg-background text-foreground" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Ambient gold glow */}
      <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-[400px] w-[400px] rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[260px] w-[260px] rounded-full bg-primary-glow/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="relative h-20 w-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-full bg-gradient-gold opacity-25 blur-xl" aria-hidden="true" />
            <img src={logoMark} alt="Novel Reader" width={80} height={80}
              className="relative h-20 w-20 object-contain animate-logo-float drop-shadow-[0_0_18px_hsl(var(--primary)/0.45)]" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Novel <span className="text-gold-gradient italic">Reader</span>
          </h1>
          <div className="ornament-divider my-3 max-w-[180px] mx-auto text-xs">❦</div>
          <p className="text-sm text-muted-foreground font-display italic">
            {isLogin ? "Entre para retomar a leitura" : "Comece sua biblioteca pessoal"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!isLogin && (
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nome"
                className="pl-9 h-11 rounded-xl"
              />
            </div>
          )}
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="E-mail"
              required
              className="pl-9 h-11 rounded-xl"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Senha"
              required
              minLength={6}
              className="pl-9 h-11 rounded-xl"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full h-11 rounded-xl font-semibold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isLogin ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-4">
          {isLogin ? "Não tem conta?" : "Já tem conta?"}{" "}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-primary font-medium hover:underline py-2 px-1 active:opacity-70"
          >
            {isLogin ? "Criar conta" : "Entrar"}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Auth;
