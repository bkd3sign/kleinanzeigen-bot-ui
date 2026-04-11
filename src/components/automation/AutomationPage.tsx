'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Input, Button, Toggle, Badge, useToast } from '@/components/ui';
import type { Schedule, JobStatus } from '@/types/bot';
import styles from './AutomationPage.module.scss';

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Täglich 06:00', value: '0 6 * * *' },
  { label: 'Täglich 12:00', value: '0 12 * * *' },
  { label: 'Täglich 18:00', value: '0 18 * * *' },
  { label: 'Alle 6 Stunden', value: '0 */6 * * *' },
  { label: 'Alle 12 Stunden', value: '0 */12 * * *' },
  { label: 'Montags 12:00', value: '0 12 * * 1' },
  { label: 'Mittwochs 12:00', value: '0 12 * * 3' },
  { label: 'Freitags 12:00', value: '0 12 * * 5' },
  { label: 'Samstags 08:00', value: '0 8 * * 6' },
  { label: 'Benutzerdefiniert', value: 'custom' },
];

interface CommandOption {
  value: string;
  label: string;
  adminOnly: boolean;
}

const ALL_COMMAND_OPTIONS: CommandOption[] = [
  // Publish
  { value: 'publish --ads=new', label: 'Publish: Neue Anzeigen', adminOnly: false },
  { value: 'publish --ads=due', label: 'Publish: Fällige Anzeigen', adminOnly: false },
  { value: 'publish --ads=changed', label: 'Publish: Geänderte Anzeigen', adminOnly: false },
  { value: 'publish --ads=all', label: 'Publish: Alle Anzeigen', adminOnly: false },
  // Update
  { value: 'update --ads=changed', label: 'Update: Geänderte Anzeigen', adminOnly: false },
  { value: 'update --ads=all', label: 'Update: Alle Anzeigen', adminOnly: false },
  // Download
  { value: 'download --ads=new', label: 'Download: Neue Anzeigen', adminOnly: false },
  { value: 'download --ads=all', label: 'Download: Alle Anzeigen', adminOnly: false },
  // Extend & Verify
  { value: 'extend --ads=all', label: 'Extend: Alle Anzeigen verlängern', adminOnly: false },
  { value: 'verify --verbose', label: 'Verify: Anzeigen prüfen', adminOnly: false },
  // Admin only
  { value: 'update-check', label: 'System: Auf Bot-Updates prüfen', adminOnly: true },
  { value: 'update-content-hash', label: 'System: Content-Hashes aktualisieren', adminOnly: true },
  { value: 'diagnose', label: 'System: Browser-Diagnose', adminOnly: true },
];

function formatCron(cron: string): string {
  const match = CRON_PRESETS.find((p) => p.value === cron);
  if (match && match.value !== 'custom') return match.label;

  // Simple human-readable parsing
  const [minute, hour, , , dayOfWeek] = cron.split(' ');
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  if (dayOfWeek !== '*') {
    const dayNum = parseInt(dayOfWeek, 10);
    return `${days[dayNum] ?? dayOfWeek}s ${hour}:${minute.padStart(2, '0')}`;
  }
  if (hour?.includes('/')) {
    return `Alle ${hour.replace('*/', '')} Stunden`;
  }
  if (hour !== '*' && minute !== '*') {
    return `Täglich ${hour}:${minute.padStart(2, '0')}`;
  }
  return cron;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Heute ${time}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ` ${time}`;
}

function statusBadgeVariant(status: JobStatus | undefined): 'success' | 'danger' | 'warning' | 'muted' {
  if (status === 'completed') return 'success';
  if (status === 'completed_with_errors') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'mfa_required') return 'warning';
  return 'muted';
}

export function AutomationPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCron, setEditCron] = useState('');
  const [editCronPreset, setEditCronPreset] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // New schedule form
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const isAdmin = user?.role === 'admin';
  const commandOptions = ALL_COMMAND_OPTIONS.filter((o) => isAdmin || !o.adminOnly);
  const [newCommand, setNewCommand] = useState(commandOptions[0]?.value ?? '');
  const [newCronPreset, setNewCronPreset] = useState(CRON_PRESETS[0].value);
  const [newCron, setNewCron] = useState(CRON_PRESETS[0].value);
  const [creatingNew, setCreatingNew] = useState(false);

  const fetchSchedules = useCallback(async () => {
    try {
      const data = await api.get<{ schedules: Schedule[] }>('/api/schedules');
      setSchedules(data.schedules);
    } catch {
      toast('error', 'Zeitpläne konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  // Refresh every 30s to update next_run / last_status
  useEffect(() => {
    const interval = setInterval(fetchSchedules, 30000);
    return () => clearInterval(interval);
  }, [fetchSchedules]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setSaving(id);
    try {
      await api.put('/api/schedules', { id, enabled });
      await fetchSchedules();
      toast('success', enabled ? 'Zeitplan aktiviert' : 'Zeitplan deaktiviert');
    } catch {
      toast('error', 'Fehler beim Speichern');
    } finally {
      setSaving(null);
    }
  }, [fetchSchedules, toast]);

  const handleSaveEdit = useCallback(async (id: string) => {
    setSaving(id);
    try {
      await api.put('/api/schedules', { id, cron: editCron, command: editCommand });
      setEditingId(null);
      await fetchSchedules();
      toast('success', 'Zeitplan gespeichert');
    } catch (err) {
      toast('error', (err as Error).message || 'Fehler beim Speichern');
    } finally {
      setSaving(null);
    }
  }, [editCron, editCommand, fetchSchedules, toast]);

  const handleTrigger = useCallback(async (id: string) => {
    setTriggering(id);
    try {
      await api.post('/api/schedules', { action: 'trigger', id });
      toast('success', 'Job gestartet');
      await fetchSchedules();
    } catch {
      toast('error', 'Fehler beim Starten');
    } finally {
      setTriggering(null);
    }
  }, [fetchSchedules, toast]);

  const handleCreateNew = useCallback(async () => {
    if (!newName.trim()) {
      toast('error', 'Name ist erforderlich');
      return;
    }
    setCreatingNew(true);
    try {
      await api.post('/api/schedules', {
        name: newName,
        command: newCommand,
        cron: newCron,
        enabled: false,
      });
      setShowNew(false);
      setNewName('');
      setNewCronPreset(CRON_PRESETS[0].value);
      setNewCron(CRON_PRESETS[0].value);
      await fetchSchedules();
      toast('success', 'Zeitplan erstellt');
    } catch (err) {
      toast('error', (err as Error).message || 'Fehler beim Erstellen');
    } finally {
      setCreatingNew(false);
    }
  }, [newName, newCommand, newCron, fetchSchedules, toast]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete('/api/schedules', { id });
      await fetchSchedules();
      toast('success', 'Zeitplan gelöscht');
    } catch (err) {
      toast('error', (err as Error).message || 'Fehler beim Löschen');
    }
  }, [fetchSchedules, toast]);

  if (loading) {
    return (
      <div className={styles.automationPage}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Automatisierung</h1>
            <p className={styles.subtitle}>Wird geladen…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.automationPage}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Automatisierung</h1>
          <p className={styles.subtitle}>
            Zeitgesteuerte Bot-Befehle konfigurieren
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNew(!showNew)}
        >
          {showNew ? 'Abbrechen' : '+ Neuer Zeitplan'}
        </Button>
      </div>

      {/* New schedule form */}
      {showNew && (
        <div className={`${styles.scheduleCard} ${styles.scheduleCardActive}`}>
          <div className={styles.newScheduleForm}>
            <Input
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
            <div className={styles.editRow}>
              <div>
                <label className={styles.fieldLabel}>
                  Befehl
                </label>
                <select
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  className={styles.selectField}
                >
                  {commandOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.adminOnly ? `* ${opt.label}` : opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel}>
                  Zeitplan
                </label>
                <select
                  value={newCronPreset}
                  onChange={(e) => {
                    setNewCronPreset(e.target.value);
                    if (e.target.value !== 'custom') {
                      setNewCron(e.target.value);
                    }
                  }}
                  className={styles.selectField}
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {newCronPreset === 'custom' && (
              <div>
                <Input
                  label="Cron-Ausdruck"
                  value={newCron}
                  onChange={(e) => setNewCron(e.target.value)}
                  hint="Format: Minute Stunde Tag Monat Wochentag (z.B. 0 8 * * *)"
                />
              </div>
            )}
            <Button
              variant="primary"
              onClick={handleCreateNew}
              loading={creatingNew}
              disabled={creatingNew || !newName.trim()}
            >
              Zeitplan erstellen
            </Button>
          </div>
        </div>
      )}

      {/* Schedule list */}
      {schedules.length === 0 ? (
        <div className={styles.emptyHint}>
          Keine Zeitpläne konfiguriert. Erstelle einen neuen Zeitplan.
        </div>
      ) : (
        schedules.map((schedule) => {
            const isSystem = !schedule.id.startsWith('custom-');
            // Admins can edit everything, users can edit system schedules (creates fork) + their own
            const canEdit = isAdmin || isSystem || schedule.created_by === user?.id;
            return (<div
            key={schedule.id}
            className={`${styles.scheduleCard} ${!schedule.enabled ? styles.scheduleCardDisabled : ''} ${editingId === schedule.id ? styles.scheduleCardActive : ''}`}
          >
            <div className={styles.scheduleHeader}>
              <div className={styles.scheduleInfo}>
                <span className={styles.scheduleName}>{schedule.name}</span>
                <span className={styles.scheduleCommand}>{schedule.command}</span>
              </div>
              <div className={styles.scheduleActions}>
                {canEdit && <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={triggering === schedule.id}
                  onClick={() => handleTrigger(schedule.id)}
                  title="Jetzt ausführen"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>}
                {canEdit && <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => {
                    if (editingId === schedule.id) {
                      setEditingId(null);
                    } else {
                      setEditingId(schedule.id);
                      setEditCron(schedule.cron);
                      setEditCommand(schedule.command);
                      const preset = CRON_PRESETS.find((p) => p.value === schedule.cron);
                      setEditCronPreset(preset ? preset.value : 'custom');
                    }
                  }}
                  title="Bearbeiten"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>}
                {canEdit && <span className={styles.toggleWrap}>
                  <Toggle
                    checked={schedule.enabled}
                    onChange={(checked) => handleToggle(schedule.id, checked)}
                    disabled={saving === schedule.id}
                  />
                </span>}
              </div>
            </div>

            {/* Status details */}
            <div className={styles.scheduleDetails}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Zeitplan:</span>
                <span className={styles.detailValue}>{formatCron(schedule.cron)}</span>
              </div>
              {schedule.enabled && schedule.next_run && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Nächste Ausführung:</span>
                  <span className={styles.detailValue}>{formatDate(schedule.next_run)}</span>
                </div>
              )}
              {schedule.last_run && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Letzte Ausführung:</span>
                  <span className={styles.detailValue}>{formatDate(schedule.last_run)}</span>
                  {schedule.last_status && (
                    <Badge variant={statusBadgeVariant(schedule.last_status)}>
                      {schedule.last_status === 'completed' ? 'OK' : schedule.last_status === 'completed_with_errors' ? 'Mit Fehlern' : schedule.last_status === 'mfa_required' ? 'MFA' : schedule.last_status === 'failed' ? 'Fehler' : '–'}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Edit panel */}
            {editingId === schedule.id && (
              <div className={styles.scheduleEdit}>
                <div className={styles.editRow}>
                  <div>
                    <label className={styles.fieldLabel}>
                      Befehl
                    </label>
                    <select
                      value={commandOptions.some((o) => o.value === editCommand) ? editCommand : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          setEditCommand(e.target.value);
                        }
                      }}
                      className={styles.selectField}
                    >
                      {commandOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.adminOnly ? `* ${opt.label}` : opt.label}</option>
                      ))}
                      {!commandOptions.some((o) => o.value === editCommand) && (
                        <option value="__custom__">{editCommand} (benutzerdefiniert)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className={styles.fieldLabel}>
                      Zeitplan
                    </label>
                    <select
                      value={editCronPreset}
                      onChange={(e) => {
                        setEditCronPreset(e.target.value);
                        if (e.target.value !== 'custom') {
                          setEditCron(e.target.value);
                        }
                      }}
                      className={styles.selectField}
                    >
                      {CRON_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {editCronPreset === 'custom' && (
                  <Input
                    label="Cron-Ausdruck"
                    value={editCron}
                    onChange={(e) => setEditCron(e.target.value)}
                    hint="Format: Minute Stunde Tag Monat Wochentag (z.B. 0 8 * * *)"
                  />
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSaveEdit(schedule.id)}
                    loading={saving === schedule.id}
                  >
                    Speichern
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(null)}
                  >
                    Abbrechen
                  </Button>
                  {schedule.id.startsWith('custom-') && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(schedule.id)}
                    >
                      Löschen
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>);
        })
      )}

      {/* Info box */}
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-lg)',
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-muted)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}>
        <span>Bot-Befehle werden nacheinander ausgeführt (max. 1 gleichzeitig).</span>
        <span>Wenn ein Job läuft, werden neue Jobs in die Warteschlange eingereiht.</span>
        <span>Zeitpläne verwenden die Zeitzone des Servers.</span>
      </div>
    </div>
  );
}
