export function isVersionUpToDate(current: string, latest: string): boolean {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((c[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return true;
}
