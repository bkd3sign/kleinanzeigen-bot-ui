'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateAd } from '@/hooks/useAds';
import { useConfigDefaults } from '@/lib/api/queries/system';
import { AdForm, type AdFormData } from '@/components/ads/AdForm/AdForm';
import { Spinner, useToast, showConfirm } from '@/components/ui';
import type { AdCreateInput } from '@/validation/schemas';
import type { Job } from '@/types/bot';
import { api } from '@/lib/api/client';

export default function NewAdPage() {
  const router = useRouter();
  const createAd = useCreateAd();
  const { data: configData, isLoading: configLoading } = useConfigDefaults();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [aiData, setAiData] = useState<AdFormData | null>(null);
  const [aiFiles, setAiFiles] = useState<File[]>([]);
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState<string | undefined>();
  const [sourceAdFile, setSourceAdFile] = useState<string | undefined>();
  const [checked, setChecked] = useState(false);
  const pendingFilesRef = useRef<File[]>([]);

  // Check for AI-generated ad data and template info in sessionStorage (one-time read)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ai_ad_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        setAiData(parsed);
        sessionStorage.removeItem('ai_ad_data');
      }
      const win = window as unknown as Record<string, unknown>;
      const staged = win.__aiStagedFiles as File[] | undefined;
      if (staged?.length) {
        setAiFiles(staged);
        delete win.__aiStagedFiles;
      }
      const locked = sessionStorage.getItem('template_locked_fields');
      if (locked) {
        setLockedFields(JSON.parse(locked));
        sessionStorage.removeItem('template_locked_fields');
      }
      const tplName = sessionStorage.getItem('template_name');
      if (tplName) {
        setTemplateName(tplName);
        sessionStorage.removeItem('template_name');
      }
      const srcFile = sessionStorage.getItem('template_source_ad_file');
      if (srcFile) {
        setSourceAdFile(srcFile);
        sessionStorage.removeItem('template_source_ad_file');
      }
    } catch {
      // Ignore parse errors
    }
    setChecked(true);
  }, []);

  const uploadPendingFiles = useCallback(
    async (adFile: string) => {
      const files = pendingFilesRef.current;
      if (!files.length) return;
      const url = '/api/images/upload?file=' + encodeURIComponent(adFile);
      // Upload one file at a time to avoid body size limits (large iPhone photos)
      for (const file of files) {
        const formData = new FormData();
        formData.append('files', file);
        try {
          await api.upload(url, formData);
        } catch (err) {
          toast('error', `Bild „${file.name}" konnte nicht hochgeladen werden: ${(err as Error).message}`);
        }
      }
      pendingFilesRef.current = [];
    },
    [toast],
  );

  const handleSubmit = useCallback(
    async (data: AdCreateInput) => {
      setIsSaving(true);
      try {
        const result = await createAd.mutateAsync(data) as { file: string };
        await uploadPendingFiles(result.file);
        router.push('/ads');
      } catch (err) {
        toast('error', (err as Error).message);
      } finally {
        setIsSaving(false);
      }
    },
    [createAd, router, uploadPendingFiles, toast],
  );

  const handlePublish = useCallback(
    async (data: AdCreateInput) => {
      const confirmed = await showConfirm(
        'Alle neuen Anzeigen veröffentlichen',
        'Da die Anzeige noch keine ID hat, werden alle unveröffentlichten Anzeigen in deinem Workspace veröffentlicht:',
        'Veröffentlichen',
        'Abbrechen',
        [
          'Nicht nur diese Anzeige, sondern alle Entwürfe ohne ID',
          'Der Bot läuft im Hintergrund und veröffentlicht der Reihe nach',
          'Du wirst auf die Anzeigenübersicht weitergeleitet',
        ],
      );
      if (!confirmed) return;

      setIsPublishing(true);
      try {
        const result = await createAd.mutateAsync(data) as { file: string };
        await uploadPendingFiles(result.file);
        // New ad has no ID yet — publish all new (unpublished) ads
        await api.post<Job>('/api/bot/publish', { ads: 'new' });
        toast('success', 'Veröffentlichung gestartet');
        router.push('/ads');
      } catch (err) {
        toast('error', (err as Error).message);
      } finally {
        setIsPublishing(false);
      }
    },
    [createAd, toast, router, uploadPendingFiles],
  );

  // Wait for sessionStorage check and config defaults
  if (!checked || configLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const configDefaults = configData?.ad_defaults ?? {};

  // Merge AI data with config defaults
  const defaultValues: AdFormData = {
    ...aiData,
  };

  return (
    <AdForm
      defaultValues={defaultValues}
      initialFiles={aiFiles.length > 0 ? aiFiles : undefined}
      pendingFilesRef={pendingFilesRef}
      onSubmit={handleSubmit}
      onPublishAndSave={handlePublish}
      onDelete={() => router.push('/ads')}
      deleteLabel="Verwerfen"
      isPublishing={isPublishing}
      isSubmitting={isSaving}
      configDefaults={configDefaults}
      lockedFields={lockedFields.length > 0 ? lockedFields : undefined}
      templateName={templateName}
      adFile={sourceAdFile}
    />
  );
}
