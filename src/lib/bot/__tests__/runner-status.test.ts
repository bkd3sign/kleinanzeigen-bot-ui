import { describe, it, expect } from 'vitest';
import { detectJobStatus } from '../runner';

describe('detectJobStatus', () => {
  it('returns completed for clean verify output (exit 0)', () => {
    const output = [
      '[INFO] Suche nach Anzeigendateien...',
      '[INFO] -> 22 Anzeigendateien gefunden',
      '[INFO] 21 Anzeigen geladen',
      '[INFO] FERTIG: Keine Konfigurationsfehler gefunden.',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed');
  });

  it('does not false-positive on compound German words containing "fehler"', () => {
    const output = [
      '[INFO] Keine Konfigurationsfehler gefunden.',
      '[INFO] Keine Validierungsfehler.',
      '[INFO] Keine Zuordnungsfehler.',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed');
  });

  it('detects real failures with "fehlgeschlagen"', () => {
    const output = [
      '[INFO] Veröffentlichung von Anzeige 123 fehlgeschlagen',
      '[INFO] 1 fehlgeschlagen',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed_with_errors');
  });

  it('ignores "0 fehlgeschlagen" in summary', () => {
    const output = [
      '[INFO] 5 erfolgreich, 0 fehlgeschlagen',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed');
  });

  it('returns completed_with_errors for mixed success/failure', () => {
    const output = [
      '[INFO] Anzeige 1 erfolgreich veröffentlicht',
      '[INFO] Anzeige 2 fehlgeschlagen',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed_with_errors');
  });

  it('returns failed for non-zero exit code without successes', () => {
    const output = '[INFO] Verbindungsfehler\n';
    expect(detectJobStatus(output, 1)).toBe('failed');
  });

  it('detects English "failed" keyword', () => {
    const output = '[INFO] Publishing failed for ad 123\n';
    expect(detectJobStatus(output, 0)).toBe('completed_with_errors');
  });

  it('ignores DEBUG lines for status detection', () => {
    const output = [
      '[DEBUG] TimeoutError: page load exceeded 15s',
      '[DEBUG] Retry attempt 2 FEHLER during navigation',
      '[INFO] FERTIG: Keine Konfigurationsfehler gefunden.',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed');
  });

  it('detects standalone FEHLER in INFO lines', () => {
    const output = '[INFO] FEHLER beim Hochladen des Bildes\n';
    expect(detectJobStatus(output, 0)).toBe('completed_with_errors');
  });

  it('handles "Keine Fehler" (standalone) as non-failure', () => {
    const output = '[INFO] Keine Fehler gefunden.\n';
    expect(detectJobStatus(output, 0)).toBe('completed');
  });

  it('returns completed for empty output with exit 0', () => {
    expect(detectJobStatus('', 0)).toBe('completed');
  });

  it('returns failed for empty output with non-zero exit', () => {
    expect(detectJobStatus('', 1)).toBe('failed');
  });
});
