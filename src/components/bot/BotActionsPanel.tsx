'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api/client';
import { Button, Badge, useToast } from '@/components/ui';
import styles from './BotActionsPanel.module.scss';

interface CommandOption {
  type: string;
  name: string;
  label: string;
  choices?: string[];
  default?: string;
  customPlaceholder?: string;
}

interface Command {
  id: string;
  title: string;
  description: string;
  options: CommandOption[];
  endpoint: string;
  method?: 'GET' | 'POST';
}

interface CommandGroup {
  title: string;
  icon: 'file' | 'check' | 'terminal';
  commands: Command[];
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    title: 'Anzeigen',
    icon: 'file',
    commands: [
      { id: 'publish', title: 'Publish', description: 'Fällige Anzeigen veröffentlichen oder neu einstellen.', endpoint: '/api/bot/publish', options: [
        { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['due', 'all', 'new', 'changed'], default: 'due', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        { type: 'checkbox', name: 'force', label: 'Erzwingen' },
        { type: 'checkbox', name: 'keep_old', label: 'Alte behalten' },
        { type: 'checkbox', name: 'verbose', label: 'Verbose' },
      ] },
      { id: 'update', title: 'Update', description: 'Bestehende Anzeigen mit lokalen Änderungen aktualisieren.', endpoint: '/api/bot/update', options: [
        { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['changed', 'all'], default: 'changed', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        { type: 'checkbox', name: 'verbose', label: 'Verbose' },
      ] },
      { id: 'extend', title: 'Extend', description: 'Laufzeit von Anzeigen verlängern.', endpoint: '/api/bot/extend', options: [
        { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['all'], default: 'all', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        { type: 'checkbox', name: 'verbose', label: 'Verbose' },
      ] },
      { id: 'delete', title: 'Delete', description: 'Anzeigen von Kleinanzeigen entfernen.', endpoint: '/api/bot/delete', options: [
        { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['all'], default: 'all', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        { type: 'checkbox', name: 'verbose', label: 'Verbose' },
      ] },
      { id: 'download', title: 'Download', description: 'Anzeigen herunterladen und als YAML speichern.', endpoint: '/api/bot/download', options: [
        { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['new', 'all'], default: 'new', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        { type: 'checkbox', name: 'verbose', label: 'Verbose' },
      ] },
    ],
  },
  {
    title: 'Prüfen',
    icon: 'check',
    commands: [
      { id: 'verify', title: 'Verify', description: 'Konfiguration und Anzeigen auf Fehler prüfen.', endpoint: '/api/bot/verify', options: [
        { type: 'checkbox', name: 'verbose', label: 'Verbose' },
      ] },
      { id: 'diagnose', title: 'Diagnose', description: 'Browser- und System-Diagnose ausführen.', endpoint: '/api/bot/diagnose', options: [] },
      { id: 'version', title: 'Version', description: 'Installierte Bot-Version anzeigen.', endpoint: '/api/bot/version', method: 'GET', options: [] },
    ],
  },
  {
    title: 'System',
    icon: 'terminal',
    commands: [
      { id: 'update-check', title: 'Update Check', description: 'Prüfen ob eine neue Bot-Version verfügbar ist.', endpoint: '/api/bot/update-check', options: [] },
      { id: 'update-content-hash', title: 'Content Hash', description: 'Content-Hashes aller Anzeigen neu berechnen.', endpoint: '/api/bot/update-content-hash', options: [] },
      { id: 'create-config', title: 'Create Config', description: 'Standard-Konfigurationsdatei erstellen.', endpoint: '/api/bot/create-config', options: [] },
    ],
  },
];

// SVG icons for group headers
function GroupIcon({ type }: { type: CommandGroup['icon'] }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {type === 'file' && (
        <>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </>
      )}
      {type === 'check' && (
        <>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      )}
      {type === 'terminal' && (
        <>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </>
      )}
    </svg>
  );
}

export function BotActionsPanel() {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ type: 'success' | 'error' | 'output'; text: string } | null>(null);
  const { toast } = useToast();

  const handleGroupClick = useCallback((title: string) => {
    setOpenGroup((prev) => (prev === title ? null : title));
    setActiveCommand(null);
    setResult(null);
  }, []);

  const handleCommandClick = useCallback((cmdId: string) => {
    setActiveCommand((prev) => (prev === cmdId ? null : cmdId));
    setResult(null);
  }, []);

  const executeCommand = useCallback(
    async (cmd: Command, options: Record<string, unknown>) => {
      setRunning((prev) => new Set(prev).add(cmd.id));
      setResult(null);
      try {
        let data: Record<string, unknown>;
        if (cmd.method === 'GET') {
          data = await api.get(cmd.endpoint);
        } else {
          data = await api.post(cmd.endpoint, options);
        }

        if (cmd.method === 'GET') {
          const output = (data as { output?: string }).output ?? JSON.stringify(data, null, 2);
          setResult({ type: 'output', text: output });
        } else {
          const jobId = (data as { job_id?: string }).job_id ?? '';
          setResult({ type: 'success', text: `Gestartet: ${jobId}` });
          toast('success', `Job gestartet: ${jobId}`);
        }
      } catch (err) {
        const message = (err as Error).message;
        setResult({ type: 'error', text: `Fehler: ${message}` });
        toast('error', message);
      } finally {
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(cmd.id);
          return next;
        });
      }
    },
    [toast],
  );

  return (
    <div className={styles.panel}>
      {COMMAND_GROUPS.map((group) => {
        const isOpen = openGroup === group.title;
        return (
          <div key={group.title} className={styles.group}>
            <button
              type="button"
              className={styles.groupHeader}
              onClick={() => handleGroupClick(group.title)}
            >
              <span className={styles.groupHeaderLeft}>
                <GroupIcon type={group.icon} />
                {group.title}
              </span>
              <svg
                className={`${styles.groupChevron} ${isOpen ? styles.groupChevronOpen : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isOpen && (
              <div className={styles.groupBody}>
                <div className={styles.commandBtns}>
                  {group.commands.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      className={`${styles.commandBtn} ${activeCommand === cmd.id ? styles.commandBtnActive : ''}`}
                      onClick={() => handleCommandClick(cmd.id)}
                    >
                      {cmd.title}
                    </button>
                  ))}
                </div>

                {activeCommand && (
                  <CommandDetail
                    command={group.commands.find((c) => c.id === activeCommand)!}
                    isRunning={running.has(activeCommand)}
                    result={result}
                    onExecute={executeCommand}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommandDetail({
  command,
  isRunning,
  result,
  onExecute,
}: {
  command: Command;
  isRunning: boolean;
  result: { type: 'success' | 'error' | 'output'; text: string } | null;
  onExecute: (cmd: Command, opts: Record<string, unknown>) => void;
}) {
  const [options, setOptions] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const opt of command.options) {
      if (opt.type === 'checkbox') defaults[opt.name] = false;
      if ((opt.type === 'select' || opt.type === 'select_or_custom') && opt.default) {
        defaults[opt.name] = opt.default;
      }
    }
    return defaults;
  });

  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({});

  return (
    <div className={styles.commandDetail}>
      <p className={styles.commandDesc}>{command.description}</p>

      {command.options.length > 0 && (
        <div className={styles.optsRow}>
          {command.options.map((opt) => {
            if (opt.type === 'checkbox') {
              return (
                <label key={opt.name} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={!!options[opt.name]}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, [opt.name]: e.target.checked }))
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              );
            }
            if (opt.type === 'select' || opt.type === 'select_or_custom') {
              return (
                <span key={opt.name} style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                  <select
                    className="formSelect"
                    title={opt.label}
                    value={showCustom[opt.name] ? '__custom__' : String(options[opt.name] ?? '')}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setShowCustom((prev) => ({ ...prev, [opt.name]: true }));
                      } else {
                        setShowCustom((prev) => ({ ...prev, [opt.name]: false }));
                        setOptions((prev) => ({ ...prev, [opt.name]: e.target.value }));
                      }
                    }}
                    style={{ width: 'auto', minWidth: 120, padding: 'var(--space-1) var(--space-6) var(--space-1) var(--space-2)', fontSize: 'var(--font-size-xs)' }}
                  >
                    {(opt.choices ?? []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    {opt.type === 'select_or_custom' && (
                      <option value="__custom__">Benutzerdefiniert…</option>
                    )}
                  </select>
                  {showCustom[opt.name] && (
                    <input
                      type="text"
                      className="formInput"
                      placeholder={opt.customPlaceholder ?? ''}
                      value={customValues[opt.name] ?? ''}
                      onChange={(e) => {
                        setCustomValues((prev) => ({ ...prev, [opt.name]: e.target.value }));
                        setOptions((prev) => ({ ...prev, [opt.name]: e.target.value }));
                      }}
                      style={{ fontSize: 'var(--font-size-xs)', width: 'auto', minWidth: 160 }}
                    />
                  )}
                </span>
              );
            }
            return null;
          })}
        </div>
      )}

      {/* Status area */}
      <div className={styles.statusArea}>
        {result && result.type === 'success' && (
          <Badge variant="success">{result.text}</Badge>
        )}
        {result && result.type === 'error' && (
          <Badge variant="danger">{result.text}</Badge>
        )}
        {result && result.type === 'output' && (
          <div className={styles.resultBox}>{result.text}</div>
        )}
      </div>

      <Button
        variant="primary"
        size="sm"
        loading={isRunning}
        disabled={isRunning}
        onClick={() => onExecute(command, options)}
      >
        {command.method === 'GET' ? 'Abfragen' : 'Ausführen'}
      </Button>
    </div>
  );
}
