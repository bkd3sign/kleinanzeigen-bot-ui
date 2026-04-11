'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { useCategoryName } from '@/hooks/useCategories';
import { Button, Badge, DropdownMenu, Spinner, EmptyState } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import { showConfirm } from '@/components/ui/Modal/Modal';
import { useToast } from '@/components/ui/Toast/ToastProvider';
import styles from './TemplateList.module.scss';

interface Template {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  locked_fields?: string[];
  ad_data?: Record<string, unknown>;
}

export function TemplateList() {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await api.get<{ templates: Template[] }>('/api/templates');
      setTemplates(data.templates ?? []);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleDelete = useCallback(
    async (tpl: Template) => {
      const confirmed = await showConfirm(
        'Vorlage löschen',
        `Soll die Vorlage "${tpl.name}" wirklich gelöscht werden?`,
        'Löschen',
      );
      if (confirmed) {
        try {
          await api.delete(`/api/templates/${tpl.slug}`);
          toast('success', 'Vorlage gelöscht');
          loadTemplates();
        } catch {
          // handled
        }
      }
    },
    [loadTemplates, toast],
  );

  const handleUseTemplate = useCallback(
    async (tpl: Template) => {
      try {
        const result = await api.post<{
          ad_data: Record<string, unknown>;
          locked_fields?: string[];
          template_name?: string;
          source_ad_file?: string | null;
        }>(`/api/ads/from-template/${tpl.slug}`);
        sessionStorage.setItem('ai_ad_data', JSON.stringify(result.ad_data));
        if (result.locked_fields?.length) {
          sessionStorage.setItem('template_locked_fields', JSON.stringify(result.locked_fields));
        }
        if (result.template_name) {
          sessionStorage.setItem('template_name', result.template_name);
        }
        if (result.source_ad_file) {
          sessionStorage.setItem('template_source_ad_file', result.source_ad_file);
        }
        router.push('/ads/new');
      } catch (err) {
        toast('error', (err as Error).message);
      }
    },
    [router, toast],
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className={styles.list}>
      <div className={styles.toolbar}>
        <h2 className={styles.pageTitle}>Vorlagen</h2>
        <Button variant="primary" size="sm" onClick={() => router.push('/templates?new=1')}>
          + Neue Vorlage
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
          }
          title="Keine Vorlagen vorhanden"
          message="Erstelle eine Vorlage, um Anzeigen schneller zu erstellen."
          action={
            <Button variant="primary" onClick={() => router.push('/templates?new=1')}>
              Erste Vorlage erstellen
            </Button>
          }
        />
      ) : (
        <div className={styles.grid}>
          {templates.map((tpl, i) => (
            <TemplateCard
              key={tpl.slug}
              template={tpl}
              onUse={handleUseTemplate}
              onEdit={(t) => router.push(`/templates?slug=${encodeURIComponent(t.slug)}`)}
              onDelete={handleDelete}
              style={{ '--anim-delay': `${i * 50}ms` } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template: tpl,
  onUse,
  onEdit,
  onDelete,
  style,
}: {
  template: Template;
  onUse: (t: Template) => void;
  onEdit: (t: Template) => void;
  onDelete: (t: Template) => void;
  style?: React.CSSProperties;
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const catName = useCategoryName();

  const items: DropdownMenuItem[] = [
    {
      label: 'Bearbeiten',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      ),
      onClick: () => onEdit(tpl),
    },
    {
      label: 'Löschen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      ),
      onClick: () => onDelete(tpl),
      danger: true,
      separator: true,
    },
  ];

  return (
    <div className={styles.card} style={style} onClick={() => onUse(tpl)}>
      <div className={styles.cardName}>{tpl.name || tpl.slug}</div>

      {tpl.description && <div className={styles.cardDesc}>{tpl.description}</div>}

      {/* Meta badges: category, locked count */}
      <div className={styles.cardMeta}>
        {tpl.category && <Badge>{catName(tpl.category)}</Badge>}
        {tpl.locked_fields && tpl.locked_fields.length > 0 && (
          <Badge variant="info">{tpl.locked_fields.length} gesperrt</Badge>
        )}
      </div>

      {/* Context menu */}
      <div>
        <button
          className={styles.cardMenuBtn}
          title="Aktionen"
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenuPos(menuPos ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right });
          }}
        >⋮</button>
        {menuPos && (
          <DropdownMenu items={items} pos={menuPos} onClose={() => setMenuPos(null)} />
        )}
      </div>
    </div>
  );
}
