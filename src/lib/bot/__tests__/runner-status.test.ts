import { describe, it, expect } from 'vitest';
import { detectJobStatus, finalJobStatus, hasBrowserConnectionError, isLoginPausePrompt } from '../runner';

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

  it('correctly parses output with timestamp prefix per line', () => {
    const output = [
      '2026-05-27 06:37:30,123 [INFO] Suche nach Anzeigendateien...',
      '2026-05-27 06:37:30,456 [INFO] 5 Anzeigen geladen',
      '2026-05-27 06:37:31,001 [INFO] FERTIG: Keine Konfigurationsfehler gefunden.',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed');
  });

  it('detects failures in timestamped output', () => {
    const output = [
      '2026-05-27 06:37:30,123 [INFO] Anzeige 1 erfolgreich veröffentlicht',
      '2026-05-27 06:37:31,456 [INFO] Anzeige 2 fehlgeschlagen',
    ].join('\n');
    expect(detectJobStatus(output, 0)).toBe('completed_with_errors');
  });
});

describe('finalJobStatus', () => {
  it('login_failed output → login_required regardless of exit code', () => {
    expect(finalJobStatus('AssertionError: Auth0-Passwortschritt nicht erreicht', 1)).toBe('login_required');
  });

  it('normal failure stays failed', () => {
    expect(finalJobStatus('[FEHLER] irgendwas', 1)).toBe('failed');
  });

  // Regression: a browser that fails to start logs the cause on [FEHLER] lines, which
  // detectJobStatus's INFO/WARNUNG filter ignores. When the bot then exits 0, the job was
  // wrongly classified 'completed' — which also silently disabled the queue's profile-lock
  // auto-retry (it only fires on status === 'failed').
  it('browser start failure with exit 0 → failed (not completed)', () => {
    const output = [
      '2026-06-26 11:45:42,111 [INFO]  -> Benutzerdefiniertes Browser-Argument: --headless=new',
      '2026-06-26 11:45:45,014 [FEHLER] Fehler beim Starten des Browsers. Dieser Fehler tritt häufig auf, wenn:',
      '2026-06-26 11:45:45,102 [FEHLER] Failed to connect to browser',
    ].join('\n');
    expect(finalJobStatus(output, 0)).toBe('failed');
  });

  it('ConnectionRefusedError with exit 0 → failed', () => {
    expect(finalJobStatus('[FEHLER] ConnectionRefusedError: Connect call failed', 0)).toBe('failed');
  });

  it('browser connection error wins over login_failed (dead browser has no login outcome)', () => {
    const output = [
      '[INFO] Überprüfe, ob bereits eingeloggt...',
      '[FEHLER] Auth0-Passwortschritt nicht erreicht',
      '[FEHLER] Failed to connect to browser',
    ].join('\n');
    expect(finalJobStatus(output, 0)).toBe('failed');
  });
});

describe('hasBrowserConnectionError', () => {
  it('matches the three fatal browser start/connect signatures', () => {
    expect(hasBrowserConnectionError('Failed to connect to browser')).toBe(true);
    expect(hasBrowserConnectionError('ConnectionRefusedError: Connect call failed')).toBe(true);
    expect(hasBrowserConnectionError('Fehler beim Starten des Browsers')).toBe(true);
  });

  it('does not match normal output', () => {
    expect(hasBrowserConnectionError('[INFO] 60 Anzeigen geladen')).toBe(false);
  });
});

describe('isLoginPausePrompt', () => {
  // The bot runs with --lang=de, so the ainput prompts are the German gettext translations.
  // These are the exact strings from the upstream translations.de.yaml.
  it('matches the German ainput pause prompts (actual --lang=de output)', () => {
    expect(isLoginPausePrompt('EINGABETASTE drücken, wenn erledigt...')).toBe(true);
    expect(isLoginPausePrompt('Eine Taste drücken, um fortzufahren...')).toBe(true);
    expect(isLoginPausePrompt('Eine Taste drücken, nachdem die Herausforderung gelöst wurde...')).toBe(true);
    expect(isLoginPausePrompt('# Falls eine Sicherheitsabfrage sichtbar ist, bitte lösen.')).toBe(true);
  });

  it('matches the English literal pause banners (language-independent)', () => {
    expect(isLoginPausePrompt('# Auth0 login flow failed. Browser is paused for manual inspection.')).toBe(true);
    expect(isLoginPausePrompt('# Login detection remained inconclusive. Browser is paused for manual inspection.')).toBe(true);
  });

  it('matches English ainput prompts (fallback when lang is not de)', () => {
    expect(isLoginPausePrompt('Press ENTER when done...')).toBe(true);
    expect(isLoginPausePrompt('Press a key to continue...')).toBe(true);
    expect(isLoginPausePrompt('Press a key after solving the challenge...')).toBe(true);
  });

  it('does not match normal running output', () => {
    expect(isLoginPausePrompt('[INFO] Überprüfe, ob bereits eingeloggt...')).toBe(false);
    expect(isLoginPausePrompt('[INFO] Anmeldung...')).toBe(false);
    expect(isLoginPausePrompt('[FEHLER] Auth0-Passwortschritt nicht erreicht')).toBe(false);
  });
});
