import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UsageRow {
  id: string;
  characters_count: number;
  engine: string;
  lang: string;
  created_at: string;
  user_id: string | null;
}

interface DailySummary {
  date: string;
  totalChars: number;
  requests: number;
  byEngine: Record<string, { chars: number; requests: number }>;
}

// Google Cloud TTS pricing: $4 per 1M characters (Standard)
const COST_PER_CHAR = 4 / 1_000_000;

export default function TtsUsage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('7d');

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    checkAdminAndLoad();
  }, [user, period]);

  async function checkAdminAndLoad() {
    try {
      // Check admin role
      const { data: roles, error: roleErr } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user!.id)
        .eq('role', 'admin');

      if (roleErr || !roles || roles.length === 0) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setIsAdmin(true);

      // Load usage data
      let query = supabase
        .from('tts_usage')
        .select('*')
        .order('created_at', { ascending: false });

      if (period === '7d') {
        const d = new Date(); d.setDate(d.getDate() - 7);
        query = query.gte('created_at', d.toISOString());
      } else if (period === '30d') {
        const d = new Date(); d.setDate(d.getDate() - 30);
        query = query.gte('created_at', d.toISOString());
      }

      const { data, error } = await query.limit(1000);
      if (error) { toast.error("Erro ao carregar dados: " + error.message); return; }
      setUsage((data as UsageRow[]) || []);
    } catch (e) {
      toast.error("Erro: " + String(e));
    } finally {
      setLoading(false);
    }
  }

  // Aggregate by day
  const dailySummaries: DailySummary[] = (() => {
    const map = new Map<string, DailySummary>();
    for (const row of usage) {
      const date = row.created_at.slice(0, 10);
      let s = map.get(date);
      if (!s) { s = { date, totalChars: 0, requests: 0, byEngine: {} }; map.set(date, s); }
      s.totalChars += row.characters_count;
      s.requests += 1;
      if (!s.byEngine[row.engine]) s.byEngine[row.engine] = { chars: 0, requests: 0 };
      s.byEngine[row.engine].chars += row.characters_count;
      s.byEngine[row.engine].requests += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  })();

  const totalChars = usage.reduce((sum, r) => sum + r.characters_count, 0);
  const totalRequests = usage.length;
  const estimatedCost = totalChars * COST_PER_CHAR;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h1 className="text-xl font-bold text-foreground mb-2">Acesso Restrito</h1>
        <p className="text-muted-foreground text-center mb-4">Você não tem permissão para acessar esta página.</p>
        <Button onClick={() => navigate('/')} variant="outline">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Consumo TTS</h1>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {(['7d', '30d', 'all'] as const).map((p) => (
          <Button
            key={p}
            variant={period === p ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setPeriod(p); setLoading(true); }}
          >
            {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : 'Tudo'}
          </Button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Caracteres</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{totalChars.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Requisições</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{totalRequests.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Custo estimado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              ${estimatedCost.toFixed(4)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Google TTS Standard: $4/1M chars</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consumo diário</CardTitle>
        </CardHeader>
        <CardContent>
          {dailySummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum uso registrado no período.</p>
          ) : (
            <div className="space-y-3">
              {dailySummaries.map((day) => (
                <div key={day.date} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/40">
                  <div>
                    <p className="text-sm font-medium text-foreground">{day.date}</p>
                    <div className="flex gap-2 mt-1">
                      {Object.entries(day.byEngine).map(([eng, data]) => (
                        <span key={eng} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {eng}: {data.chars.toLocaleString('pt-BR')} chars ({data.requests} req)
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{day.totalChars.toLocaleString('pt-BR')}</p>
                    <p className="text-[10px] text-muted-foreground">${(day.totalChars * COST_PER_CHAR).toFixed(4)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
