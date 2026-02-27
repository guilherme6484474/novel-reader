/**
 * In-app debug log for TTS — captures messages visible in the UI
 * since we can't use LogCat on the test device.
 */

const MAX_ENTRIES = 80;

interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

const entries: LogEntry[] = [];
const listeners: Set<() => void> = new Set();

function now(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

function push(level: LogEntry['level'], msg: string) {
  entries.push({ time: now(), level, msg });
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach(fn => fn());
}

export function ttsLog(msg: string) { push('info', msg); console.log('[TTS]', msg); }
export function ttsWarn(msg: string) { push('warn', msg); console.warn('[TTS]', msg); }
export function ttsError(msg: string) { push('error', msg); console.error('[TTS]', msg); }

export function getLogEntries(): readonly LogEntry[] { return entries; }
export function clearLog() { entries.length = 0; listeners.forEach(fn => fn()); }

export function subscribeLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
