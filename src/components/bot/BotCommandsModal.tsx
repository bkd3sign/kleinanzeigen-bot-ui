'use client';

import { useCallback, useState } from 'react';
import { Modal, Select, Button, useToast } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { Job } from '@/types/bot';
import styles from './BotCommandsModal.module.scss';

interface CommandOption {
  type: 'select_or_custom' | 'checkbox';
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
  icon: string[];
  options: CommandOption[];
  endpoint: string;
  method?: 'GET' | 'POST';
}

interface CommandGroup {
  title: string;
  icon: string[];
  commands: Command[];
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    title: 'Anzeigen',
    icon: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'],
    commands: [
      { id: 'publish', title: 'Publish', icon: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'], description: 'Fällige Anzeigen veröffentlichen oder neu einstellen.', endpoint: '/api/bot/publish',
        options: [
          { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['due', 'all', 'new', 'changed'], default: 'due', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
          { type: 'checkbox', name: 'force', label: 'Erzwingen' },
          { type: 'checkbox', name: 'keep_old', label: 'Alte behalten' },
        ] },
      { id: 'update', title: 'Update', icon: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M20.49 15a9 9 0 0 1-14.85 3.36L1 14'], description: 'Bestehende Anzeigen mit lokalen Änderungen aktualisieren.', endpoint: '/api/bot/update',
        options: [
          { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['changed', 'all'], default: 'changed', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        ] },
      { id: 'extend', title: 'Extend', icon: ['M12 2v10l4.5 4.5', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'], description: 'Laufzeit von Anzeigen verlängern.', endpoint: '/api/bot/extend',
        options: [
          { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['all'], default: 'all', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        ] },
      { id: 'delete', title: 'Delete', icon: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'], description: 'Anzeigen von Kleinanzeigen entfernen.', endpoint: '/api/bot/delete',
        options: [
          { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['all'], default: 'all', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        ] },
      { id: 'download', title: 'Download', icon: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'], description: 'Anzeigen herunterladen und als YAML speichern.', endpoint: '/api/bot/download',
        options: [
          { type: 'select_or_custom', name: 'ads', label: 'Anzeigen', choices: ['new', 'all'], default: 'new', customPlaceholder: 'Anzeigen-ID(s) kommagetrennt' },
        ] },
    ],
  },
  {
    title: 'Prüfen',
    icon: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
    commands: [
      { id: 'verify', title: 'Verify', icon: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'], description: 'Konfiguration und Anzeigen auf Fehler prüfen.', endpoint: '/api/bot/verify',
        options: [] },
      { id: 'diagnose', title: 'Diagnose', icon: ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'], description: 'Browser- und System-Diagnose ausführen.', endpoint: '/api/bot/diagnose', options: [] },
      { id: 'version', title: 'Version', icon: ['M12 2v4', 'M12 18v4', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16V12', 'M12 8h.01'], description: 'Installierte Bot-Version anzeigen.', endpoint: '/api/bot/version', method: 'GET', options: [] },
    ],
  },
  {
    title: 'System',
    icon: ['M12 2v4', 'M12 18v4', 'M4.93 4.93l2.83 2.83', 'M16.24 16.24l2.83 2.83', 'M2 12h4', 'M18 12h4', 'M4.93 19.07l2.83-2.83', 'M16.24 7.76l2.83-2.83'],
    commands: [
      { id: 'update-check', title: 'Update Check', icon: ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78', 'M11.5 1.5l5 5', 'M16.5 6.5l-1.5 1.5'], description: 'Prüfen ob eine neue Bot-Version verfügbar ist.', endpoint: '/api/bot/update-check', options: [] },
      { id: 'update-content-hash', title: 'Content Hash', icon: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'], description: 'Content-Hashes aller Anzeigen neu berechnen.', endpoint: '/api/bot/update-content-hash', options: [] },
      { id: 'create-config', title: 'Create Config', icon: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M12 18v-6', 'M9 15h6'], description: 'Standard-Konfigurationsdatei erstellen.', endpoint: '/api/bot/create-config', options: [] },
    ],
  },
];

interface BotCommandsModalProps {
  open: boolean;
  onClose: () => void;
}

export function BotCommandsModal({ open, onClose }: BotCommandsModalProps) {
  const { toast } = useToast();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [activeCmd, setActiveCmd] = useState<Command | null>(null);
  const [optValues, setOptValues] = useState<Record<string, string | boolean>>({});
  const [customInput, setCustomInput] = useState('');
  const [running, setRunning] = useState(false);

  const selectCommand = useCallback((cmd: Command) => {
    setActiveCmd(cmd);
    const defaults: Record<string, string | boolean> = {};
    for (const opt of cmd.options) {
      if (opt.type === 'checkbox') defaults[opt.name] = false;
      if (opt.type === 'select_or_custom') defaults[opt.name] = opt.default ?? '';
    }
    setOptValues(defaults);
    setCustomInput('');
  }, []);

  const handleExecute = useCallback(async () => {
    if (!activeCmd) return;
    setRunning(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const opt of activeCmd.options) {
        const val = optValues[opt.name];
        if (opt.type === 'checkbox') {
          if (val) payload[opt.name] = true;
        } else if (opt.type === 'select_or_custom') {
          payload[opt.name] = val === '__custom__' ? customInput : val;
        }
      }
      // Always run verbose
      payload.verbose = true;

      if (activeCmd.method === 'GET') {
        const result = await api.get<{ output?: string }>(activeCmd.endpoint);
        toast('success', result.output ?? 'OK');
      } else {
        await api.post<Job>(activeCmd.endpoint, payload);
        toast('success', `${activeCmd.title} gestartet`);
      }
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [activeCmd, optValues, customInput, toast, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Bot-Befehle">
      <div className={styles.grid}>
        {COMMAND_GROUPS.map((group) => {
          const isOpen = openGroup === group.title;
          return (
            <div key={group.title} className={`${styles.panel} ${isOpen ? styles.panelOpen : ''}`}>
              <button
                className={styles.panelHeader}
                onClick={() => { setOpenGroup(isOpen ? null : group.title); setActiveCmd(null); }}
              >
                <span className={styles.panelIcon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {group.icon.map((d, i) => <path key={i} d={d} />)}
                  </svg>
                </span>
                <div className={styles.panelText}>
                  <div className={styles.panelTitle}>{group.title}</div>
                  <div className={styles.panelDesc}>{group.commands.map((c) => c.title).join(', ')}</div>
                </div>
              </button>

              {isOpen && (
                <div className={styles.panelBody}>
                  <div className={styles.cmdList}>
                    {group.commands.map((cmd) => (
                      <button
                        key={cmd.id}
                        className={`${styles.cmdItem} ${activeCmd?.id === cmd.id ? styles.cmdItemActive : ''}`}
                        onClick={() => selectCommand(cmd)}
                      >
                        <span className={styles.cmdItemIcon}>
                          <svg viewBox="0 0 24 24">
                            {cmd.icon.map((d, i) => <path key={i} d={d} />)}
                          </svg>
                        </span>
                        <div className={styles.cmdItemText}>
                          <div className={styles.cmdItemTitle}>{cmd.title}</div>
                          <div className={styles.cmdItemDesc}>{cmd.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {activeCmd && (
                    <div className={styles.cmdDetail}>

                      {activeCmd.options.length > 0 && (
                        <div className={styles.cmdOpts}>
                          {activeCmd.options.filter((o) => o.type === 'select_or_custom').map((opt) => (
                            <div key={opt.name} className={styles.selectWrap}>
                              <select
                                className={styles.select}
                                value={String(optValues[opt.name] ?? '')}
                                onChange={(e) => setOptValues((p) => ({ ...p, [opt.name]: e.target.value }))}
                              >
                                {opt.choices?.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                                <option value="__custom__">Benutzerdefiniert…</option>
                              </select>
                              {optValues[opt.name] === '__custom__' && (
                                <input
                                  className={styles.customInput}
                                  placeholder={opt.customPlaceholder}
                                  value={customInput}
                                  onChange={(e) => setCustomInput(e.target.value)}
                                />
                              )}
                            </div>
                          ))}
                          {activeCmd.options.some((o) => o.type === 'checkbox') && (
                            <div className={styles.cmdOptsRow}>
                              {activeCmd.options.filter((o) => o.type === 'checkbox').map((opt) => (
                                <label key={opt.name} className={styles.checkLabel}>
                                  <input
                                    type="checkbox"
                                    className={styles.checkbox}
                                    checked={!!optValues[opt.name]}
                                    onChange={(e) => setOptValues((p) => ({ ...p, [opt.name]: e.target.checked }))}
                                  />
                                  {opt.label}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <Button variant="primary" size="sm" onClick={handleExecute} loading={running}>
                        Ausführen
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
