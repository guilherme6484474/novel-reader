## Objetivo

Adicionar duas melhorias no histórico de leitura:

1. **Lixeira de novels excluídas** — quando o usuário remove uma novel da biblioteca, em vez de apagar definitivamente, ela vai para uma "lixeira" com possibilidade de restaurar ou apagar de vez.
2. **Retomar exatamente onde parou** — salvar a posição do scroll (parágrafo/offset) dentro do capítulo, não só o capítulo, e restaurar essa posição ao reabrir a novel da biblioteca.

---

## 1. Lixeira de novels removidas

### Banco de dados
Adicionar à tabela `reading_history`:
- `deleted_at timestamptz NULL` (NULL = ativa, preenchido = na lixeira)
- `scroll_position integer DEFAULT 0`
- `scroll_percent real DEFAULT 0` (fallback caso a altura mude entre sessões)

Atualizar todas as policies/queries para filtrar `deleted_at IS NULL` por padrão.

Limpeza automática: itens com `deleted_at` há mais de 30 dias são apagados (via job leve no client ao listar a lixeira, sem cron).

### Backend (`src/lib/api/reading-history.ts`)
Trocar `deleteReadingEntry` por **soft delete** (set `deleted_at = now()`).
Adicionar:
- `getDeletedHistory(userId)` — lista itens com `deleted_at IS NOT NULL`, ordenados por `deleted_at DESC`.
- `restoreReadingEntry(id)` — set `deleted_at = NULL`.
- `purgeReadingEntry(id)` — DELETE definitivo.
- `purgeOldDeleted(userId)` — apaga itens com `deleted_at < now() - 30 dias`.

### UI (Index.tsx — biblioteca)
- Botão/aba **"Lixeira"** ao lado da lista da biblioteca (ícone de lixeira com badge de contagem).
- Drawer/Dialog mostrando novels excluídas com:
  - Título, último capítulo lido, data da exclusão, dias restantes até purga (30d).
  - Botão **Restaurar** (volta para a biblioteca, abre o capítulo se clicar).
  - Botão **Excluir permanentemente** (com confirmação).
- Toast ao excluir: "Movida para a lixeira" + ação **Desfazer** (5s).

---

## 2. Retomar exatamente onde parou

### Estratégia
Atualmente o scroll só é salvo em `sessionStorage` (`nr-scrollPos`), perdido ao fechar o app. Vamos persistir no banco junto ao `reading_history`.

Salvar dois valores para robustez:
- `scroll_position` — `window.scrollY` em px (preciso quando o capítulo já está no cache).
- `scroll_percent` — `scrollY / (scrollHeight - innerHeight)` em [0,1] (fallback quando a altura muda — fonte/tamanho/tradução parcial diferente).

### Persistência (Index.tsx)
- Throttle: salvar no Supabase a cada ~3s de scroll parado (debounce) **e** ao sair da página (`visibilitychange` + `pagehide`), além de continuar atualizando `sessionStorage` em tempo real.
- Só salvar quando há `user`, `chapter` carregado e `displayText` não vazio.

### Restauração
Ao abrir uma novel da biblioteca (clique em item do histórico):
1. Carrega o capítulo (fluxo atual via `chapter_url`).
2. Após `displayText` renderizar e o layout estabilizar (usar `requestAnimationFrame` + pequeno delay), aplicar:
   - Se o tamanho do conteúdo for compatível (~±10%), usar `scroll_position`.
   - Caso contrário, usar `scroll_percent * (scrollHeight - innerHeight)`.
3. Mostrar um toast discreto: **"Retomado de onde parou (76%)"** com ação **"Ir para o topo"**.

### Caso de TTS
Se o TTS estiver tocando, a posição salva continua sendo a do scroll do usuário; o TTS já tem seu próprio rastreio de chunk. Sem mudanças aqui.

---

## Arquivos afetados

- `supabase/migrations/<novo>.sql` — adicionar colunas + índice em `(user_id, deleted_at)`.
- `src/lib/api/reading-history.ts` — soft delete, restore, purge, getDeleted, salvar/ler scroll.
- `src/pages/Index.tsx` — UI da lixeira, salvamento debounced de scroll, restauração ao abrir capítulo.
- (Opcional) Pequeno componente `src/components/TrashDrawer.tsx` para isolar a UI da lixeira.

---

## Detalhes técnicos

```ts
// debounce de scroll (Index.tsx)
const saveScrollDebounced = useDebouncedCallback((y: number, pct: number) => {
  if (!user || !chapter) return;
  supabase.from('reading_history').update({
    scroll_position: y, scroll_percent: pct,
  }).eq('user_id', user.id).eq('novel_url', baseUrl);
}, 2500);
```

```sql
ALTER TABLE reading_history
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN scroll_position integer NOT NULL DEFAULT 0,
  ADD COLUMN scroll_percent real NOT NULL DEFAULT 0;
CREATE INDEX reading_history_user_deleted_idx
  ON reading_history (user_id, deleted_at);
```

Restauração resiliente: tentar `scroll_position` primeiro; se `scrollHeight` mudou >10%, cair em `scroll_percent`.

---

## Fora de escopo
- Sincronização em tempo real entre dispositivos (pode vir depois).
- Marcadores manuais (bookmarks) dentro do capítulo.