// Microsoft Edge TTS (unofficial) — calls speech.platform.bing.com via WebSocket
// and returns MP3 audio. EXPERIMENTAL: depends on a non-documented endpoint that
// Microsoft may change without notice.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function generateSecMsGec(): Promise<string> {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600
  const rounded = ticks - (ticks % 300)
  const windowsTicks = BigInt(rounded) * 10000000n
  const data = new TextEncoder().encode(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function buildConfigMessage(): string {
  return (
    `X-Timestamp:${new Date().toISOString()}Z\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
  )
}

function buildSSML(text: string, voice: string, rate: string, pitch: string, volume: string, lang: string): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
    `${xmlEscape(text)}` +
    `</prosody></voice></speak>`
  )
}

function buildSpeechMessage(reqId: string, ssml: string): string {
  return (
    `X-RequestId:${reqId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${new Date().toISOString()}Z\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  )
}

// Find first occurrence of "Path:audio\r\n" inside a binary frame; audio data follows.
function findAudioStart(buf: Uint8Array): number {
  const needle = new TextEncoder().encode('Path:audio\r\n')
  outer: for (let i = 0; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer
    }
    return i + needle.length
  }
  return -1
}

function bufIncludes(buf: Uint8Array, str: string): boolean {
  const needle = new TextEncoder().encode(str)
  outer: for (let i = 0; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

async function synthesize(opts: { text: string; voice: string; rate: string; pitch: string; volume: string; lang: string }): Promise<Uint8Array> {
  const secMsGEC = await generateSecMsGec()
  const reqId = crypto.randomUUID().replace(/-/g, '')
  const url = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGEC}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${reqId}`

  return await new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const chunks: Uint8Array[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { ws.close() } catch { /* ignore */ }
      reject(new Error('Edge TTS timeout (30s)'))
    }, 30000)

    ws.onopen = () => {
      try {
        ws.send(buildConfigMessage())
        const ssml = buildSSML(opts.text, opts.voice, opts.rate, opts.pitch, opts.volume, opts.lang)
        ws.send(buildSpeechMessage(reqId, ssml))
      } catch (e) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { ws.close() } catch { /* ignore */ }
        reject(e)
      }
    }

    ws.onmessage = (event) => {
      const data = event.data
      if (data instanceof ArrayBuffer) {
        const buf = new Uint8Array(data)
        const start = findAudioStart(buf)
        if (start >= 0) chunks.push(buf.slice(start))
      } else if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try { ws.close() } catch { /* ignore */ }
          if (chunks.length === 0) {
            reject(new Error('No audio received'))
            return
          }
          const total = chunks.reduce((n, c) => n + c.length, 0)
          const out = new Uint8Array(total)
          let offset = 0
          for (const c of chunks) { out.set(c, offset); offset += c.length }
          resolve(out)
        }
      }
    }

    ws.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('Edge TTS WebSocket error'))
    }

    ws.onclose = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (chunks.length === 0) {
        reject(new Error('WebSocket closed before audio received'))
        return
      }
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) { out.set(c, offset); offset += c.length }
      resolve(out)
    }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const text = String(body?.text ?? '').slice(0, 6000)
    if (!text.trim()) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const voice = String(body?.voice ?? 'pt-BR-FranciscaNeural')
    const lang = String(body?.lang ?? voice.slice(0, 5))
    // rate: -100% .. +100%  (we receive a multiplier like 1.0 .. 2.0)
    const rateMul = Number(body?.rate ?? 1)
    const ratePct = Math.round((Math.max(0.5, Math.min(2, rateMul)) - 1) * 100)
    const rate = `${ratePct >= 0 ? '+' : ''}${ratePct}%`
    // pitch: -50Hz .. +50Hz  (we receive a multiplier like 0.5 .. 2.0)
    const pitchMul = Number(body?.pitch ?? 1)
    const pitchHz = Math.round((Math.max(0.5, Math.min(2, pitchMul)) - 1) * 50)
    const pitch = `${pitchHz >= 0 ? '+' : ''}${pitchHz}Hz`
    const volume = '+0%'

    const mp3 = await synthesize({ text, voice, rate, pitch, volume, lang })

    return new Response(mp3, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[edge-tts] error:', msg)
    return new Response(JSON.stringify({ error: msg, fallback: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})