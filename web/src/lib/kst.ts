// 한국 시간 도우미 (서버는 UTC로 돈다)

/** 한국 시간의 날짜('YYYY-MM-DD')와 그날 0시부터 분. */
export function kst(at: Date): { day: string; min: number } {
  const k = new Date(at.getTime() + 9 * 3600_000);
  return { day: k.toISOString().slice(0, 10), min: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

/** "2026-10-31T08:30" 처럼 시간대가 없으면 한국 시간으로 본다. 이상하면 null. */
export function parseAt(text: string): Date | null {
  const t = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) return null;
  const d = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
