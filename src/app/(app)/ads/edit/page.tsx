'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAdByFile, useUpdateAdByFile, useDeleteAdByFile, useDuplicateAd } from '@/hooks/useAds';
import { AdForm, type AdFormData } from '@/components/ads/AdForm/AdForm';
import { SaveAsTemplateModal } from '@/components/ads/SaveAsTemplateModal';
import { Spinner, showConfirm, useToast } from '@/components/ui';
import type { AdCreateInput } from '@/validation/schemas';
import type { Job } from '@/types/bot';
import { api } from '@/lib/api/client';

export default function EditAdPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const file = searchParams.get('file') ?? '';
  const { data: ad, isLoading, isError } = useAdByFile(file || null);
  const updateAd = useUpdateAdByFile();
  const deleteAd = useDeleteAdByFile();
  const duplicateAd = useDuplicateAd();
  const { toast } = useToast();
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSubmit = useCallback(
    async (data: AdCreateInput) => {
      if (!file) return;
      await updateAd.mutateAsync({ filename: file, data });
      router.push('/ads');
    },
    [file, updateAd, router],
  );

  const handlePublish = useCallback(
    async (data: AdCreateInput) => {
      if (!file) return;
      setIsPublishing(true);
      try {
        await updateAd.mutateAsync({ filename: file, data });
        // Use specific ad ID if available, otherwise publish all new
        const adId = ad?.id ? String(ad.id) : 'new';
        const job = await api.post<Job>('/api/bot/publish', { ads: adId });
        toast('success', 'Veröffentlichung gestartet');
        router.push('/ads');
      } catch (err) {
        toast('error', (err as Error).message);
      } finally {
        setIsPublishing(false);
      }
    },
    [file, ad, updateAd, toast, router],
  );

  const handleUpdate = useCallback(
    async (data: AdCreateInput) => {
      if (!file || !ad?.id) return;
      setIsUpdating(true);
      try {
        await updateAd.mutateAsync({ filename: file, data });
        await api.post<Job>('/api/bot/update', { ads: String(ad.id) });
        toast('success', 'Aktualisierung gestartet');
        router.push('/ads');
      } catch (err) {
        toast('error', (err as Error).message);
      } finally {
        setIsUpdating(false);
      }
    },
    [file, ad, updateAd, toast, router],
  );

  const handleDelete = useCallback(async () => {
    const confirmed = await showConfirm(
      'Anzeige löschen',
      `Soll die Anzeige "${ad?.title || file}" wirklich gelöscht werden?\n\nHinweis: Die Anzeige wird nur lokal gelöscht. Eine bereits veröffentlichte Anzeige bleibt auf Kleinanzeigen online.`,
      'Lokal löschen',
      'Abbrechen',
    );
    if (!confirmed) return;
    try {
      await deleteAd.mutateAsync(file);
      toast('success', 'Anzeige gelöscht');
      router.push('/ads');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }, [ad, file, deleteAd, toast, router]);

  const handleDuplicate = useCallback(async () => {
    try {
      const result = await duplicateAd.mutateAsync(file);
      toast('success', 'Anzeige dupliziert');
      // Navigate to the new ad's edit page
      const newFile = (result as { file?: string })?.file;
      if (newFile) {
        router.push(`/ads/edit?file=${encodeURIComponent(newFile)}`);
      }
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }, [file, duplicateAd, toast, router]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !ad) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-10)', textAlign: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h3 style={{ color: 'var(--text-primary)', margin: 0 }}>Anzeige nicht gefunden</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Die Anzeigendatei konnte nicht geladen werden oder existiert nicht mehr.</p>
        <button
          type="button"
          onClick={() => router.push('/ads')}
          style={{ padding: 'var(--space-1-5) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit' }}
        >
          Zurück zur Übersicht
        </button>
      </div>
    );
  }

  // Map Ad to form defaults
  const defaults: AdFormData = {
    title: ad.title,
    description: ad.description,
    category: ad.category,
    price: ad.price,
    price_type: ad.price_type,
    shipping_type: ad.shipping_type,
    shipping_costs: ad.shipping_costs,
    shipping_options: ad.shipping_options ?? [],
    sell_directly: ad.sell_directly,
    images: ad.images ?? [],
    contact_name: ad.contact?.name ?? '',
    contact_zipcode: ad.contact?.zipcode ?? '',
    contact_location: ad.contact?.location ?? '',
    contact_street: ad.contact?.street ?? '',
    contact_phone: ad.contact?.phone ?? '',
    republication_interval: ad.republication_interval,
    active: ad.active,
    type: ad.type,
    description_prefix: ad.description_prefix ?? '',
    description_suffix: ad.description_suffix ?? '',
    special_attributes: ad.special_attributes
      ? Object.fromEntries(Object.entries(ad.special_attributes).map(([k, v]) => [k, String(v)]))
      : {},
    auto_price_reduction: ad.auto_price_reduction ? {
      enabled: ad.auto_price_reduction.enabled,
      strategy: ad.auto_price_reduction.strategy,
      amount: ad.auto_price_reduction.amount,
      min_price: ad.auto_price_reduction.min_price,
      delay_reposts: ad.auto_price_reduction.delay_reposts ?? 0,
      delay_days: ad.auto_price_reduction.delay_days ?? 0,
      on_update: ad.auto_price_reduction.on_update ?? false,
    } : undefined,
  };

  // Bot-managed fields for display
  const botInfo = {
    id: ad.id,
    created_on: ad.created_on,
    updated_on: ad.updated_on,
    content_hash: ad.content_hash,
    repost_count: ad.repost_count,
    price_reduction_count: ad.price_reduction_count,
  };

  return (
    <>
      <AdForm
        defaultValues={defaults}
        onSubmit={handleSubmit}
        onPublishAndSave={handlePublish}
        onUpdateAndSave={ad.id ? handleUpdate : undefined}
        isPublishing={isPublishing}
        isUpdating={isUpdating}
        onDelete={handleDelete}
        isSubmitting={updateAd.isPending}
        isEdit
        adFile={file}
        onDuplicate={handleDuplicate}
        onSaveAsTemplate={() => setTemplateModalOpen(true)}
        botInfo={botInfo}
      />
      <SaveAsTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        adFile={file}
        adTitle={ad.title || ''}
      />
    </>
  );
}
