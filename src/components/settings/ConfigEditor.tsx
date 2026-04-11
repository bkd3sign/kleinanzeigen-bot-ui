'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Button, useToast } from '@/components/ui';
import styles from './ConfigEditor.module.scss';

interface ConfigSection {
  key: string;
  label: string;
  description: string;
  collapsed: boolean;
}

const CONFIG_SECTIONS: ConfigSection[] = [
  { key: 'ad_defaults', label: 'Anzeigen-Standardwerte', description: 'Standardwerte für neue Anzeigen.', collapsed: false },
  { key: 'publishing', label: 'Veröffentlichung', description: 'Einstellungen zum Löschen und Veröffentlichen.', collapsed: true },
  { key: 'download', label: 'Download', description: 'Einstellungen für den Anzeigen-Download.', collapsed: true },
  { key: 'timeouts', label: 'Timeouts', description: 'Timeout-Konfiguration für Browser-Operationen.', collapsed: true },
  { key: 'update_check', label: 'Update-Prüfung', description: 'Automatische Update-Prüfung konfigurieren.', collapsed: true },
];

export function ConfigEditor() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [editedSections, setEditedSections] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(CONFIG_SECTIONS.filter((s) => !s.collapsed).map((s) => s.key)),
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await api.get<Record<string, unknown>>('/api/system/config');
        setConfig(data);
        const texts: Record<string, string> = {};
        for (const section of CONFIG_SECTIONS) {
          const value = data[section.key];
          texts[section.key] = value ? JSON.stringify(value, null, 2) : '{}';
        }
        setEditedSections(texts);
      } catch {
        // Error handled by toast
      }
    };
    loadConfig();
  }, []);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(
    async (sectionKey: string) => {
      setSaving(true);
      try {
        const parsed = JSON.parse(editedSections[sectionKey] ?? '{}');
        await api.put('/api/system/config', { [sectionKey]: parsed });
        toast('success', 'Einstellungen gespeichert');
      } catch (err) {
        if (err instanceof SyntaxError) {
          toast('error', 'Ungültiges JSON');
        }
      } finally {
        setSaving(false);
      }
    },
    [editedSections, toast],
  );

  return (
    <div className={styles.wrapper}>
      {CONFIG_SECTIONS.map((section) => {
        const isOpen = openSections.has(section.key);
        return (
          <div key={section.key} className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => toggleSection(section.key)}
            >
              <div>
                <span>{section.label}</span>
                {section.description && (
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: 'var(--space-1)' }}>
                    {section.description}
                  </div>
                )}
              </div>
              <span className={`${styles.sectionChevron} ${!isOpen ? styles.sectionChevronCollapsed : ''}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>

            {isOpen && (
              <div className={styles.sectionBody}>
                <textarea
                  className={styles.editor}
                  value={editedSections[section.key] ?? '{}'}
                  onChange={(e) =>
                    setEditedSections((prev) => ({
                      ...prev,
                      [section.key]: e.target.value,
                    }))
                  }
                />
                <div className={styles.footer}>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={saving}
                    onClick={() => handleSave(section.key)}
                  >
                    Speichern
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
