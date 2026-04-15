// Convert UTC ISO string to local-timezone ISO string
// e.g. "2026-04-14T16:00:00.120Z" → "2026-04-14T18:00:00+02:00" (MESZ)
export function toLocalISO(iso: string): string {
  const d = new Date(iso);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const tz = `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`;
}
