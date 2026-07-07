/**
 * Encode a workspace-relative ad file path for use in an `/api/ads/by-file/...`
 * or `/api/ads/duplicate/...` URL. Each path segment is encoded individually so
 * the slashes stay intact as path separators while special characters in the
 * folder/file names (spaces, umlauts, `#`, `?`, …) are escaped.
 */
export function encodeAdFilePath(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/');
}
