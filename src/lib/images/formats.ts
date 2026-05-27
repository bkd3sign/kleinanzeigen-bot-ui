// Matches exactly what kleinanzeigen-bot accepts at publish time
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif']);

export function allowedFormatsLabel(): string {
  return [...ALLOWED_IMAGE_EXTENSIONS].map(e => e.slice(1).toUpperCase()).join(', ');
}

export function filterImageFiles(files: File[]): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      accepted.push(file);
    } else {
      rejected.push(file.name);
    }
  }
  return { accepted, rejected };
}
