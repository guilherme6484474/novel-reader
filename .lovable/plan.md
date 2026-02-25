

## Diagnóstico: Por que as vozes não aparecem no Android

O problema está na **inicialização assíncrona do motor TTS do Android**. Analisando o código Java do plugin:

```text
Fluxo atual (com bug):
  App inicia → Capacitor carrega → useTTS() executa useEffect
      → getNativeVoices() chama getSupportedVoices()
          → Android TTS engine AINDA NÃO TERMINOU de inicializar (onInit)
              → tts.getVoices() retorna null ou vazio
                  → catch silencioso → voices = []
                      → Dropdown vazio
```

O `android.speech.tts.TextToSpeech` precisa de tempo para inicializar (callback `onInit`). O hook `useTTS` chama `getNativeVoices()` imediatamente ao montar o componente, antes do motor estar pronto.

Além disso, ao falar, o código passa apenas `lang` mas **não passa o índice da voz selecionada** (`voice` parameter), então mesmo que as vozes aparecessem, a seleção não teria efeito.

## Plano de Correção

### 1. Adicionar retry com delay na carga de vozes nativas (`src/lib/native-tts.ts`)

Modificar `getNativeVoices()` para tentar carregar vozes múltiplas vezes com intervalo de 500ms (até 6 tentativas = 3 segundos), dando tempo ao motor TTS para inicializar.

```typescript
export async function getNativeVoices(): Promise<NativeVoice[]> {
  const plugin = await getPlugin();
  if (!plugin) return [];
  
  // Retry logic: TTS engine needs time to initialize on Android
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await plugin.getSupportedVoices();
      const voices = result.voices || [];
      if (voices.length > 0) {
        return voices.map(v => ({
          name: v.name || v.voiceURI || 'Unknown',
          lang: v.lang || '',
          localService: v.localService ?? true,
          voiceURI: v.voiceURI || '',
        }));
      }
    } catch (e) {
      console.warn('[NativeTTS] attempt', attempt, 'failed:', e);
    }
    // Wait before retry
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Fallback: use getSupportedLanguages() to create basic entries
  try {
    const langResult = await plugin.getSupportedLanguages();
    return (langResult.languages || []).map(lang => ({
      name: lang, lang, localService: true, voiceURI: '',
    }));
  } catch { return []; }
}
```

### 2. Adicionar `voiceURI` ao tipo `NativeVoice` e `TTSVoice`

O plugin Android usa o **índice** da voz (um número inteiro), não o nome. Precisamos guardar o `voiceURI` para depois localizar o índice correto ao falar.

### 3. Passar o índice da voz ao falar nativamente (`src/lib/native-tts.ts`)

Modificar `nativeSpeak()` para aceitar e passar o parâmetro `voice` (índice inteiro) ao plugin, que é como o Android seleciona a voz específica.

### 4. Atualizar `useTTS` para encontrar o índice da voz selecionada

No `speakChunkNative`, buscar o índice da voz selecionada na lista de vozes e passá-lo a `nativeSpeak()`.

### 5. Adicionar logging temporário para diagnóstico

Adicionar `console.log` no carregamento de vozes para que, caso o problema persista, possamos ver nos logs do Android Studio exatamente o que está sendo retornado.

## Detalhes Técnicos

### Arquivos modificados:
- `src/lib/native-tts.ts` — retry logic, voice index, fallback por idiomas
- `src/hooks/use-tts.ts` — passar índice da voz ao falar, guardar voiceURI

### Sem risco de regressão:
- O fallback web (browser) não é afetado
- A lógica de retry só executa em ambiente nativo
- O fallback por idiomas garante que mesmo sem vozes detalhadas, o TTS funciona

