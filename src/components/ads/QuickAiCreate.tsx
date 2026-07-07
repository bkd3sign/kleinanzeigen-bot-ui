'use client';

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGenerateAd, useCreateAd } from '@/hooks/useAds';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { useCategoryName } from '@/hooks/useCategories';
import { useStagedImages } from '@/hooks/useStagedImages';
import { Button, ImagePreview, useToast } from '@/components/ui';
import { api } from '@/lib/api/client';
import { AttributeChips } from '@/components/ads/AttributeChips';
import { buildEnumChipLabels } from '@/lib/ads/chip-attrs';
import styles from './QuickAiCreate.module.scss';

export interface QuickAiCreateHandle {
  addFiles: (files: File[]) => void;
}

interface AiPriceHint {
  uvp?: number | null;
  market_low?: number | null;
  market_high?: number | null;
  suggestion?: number | null;
  condition_note?: string;
}

interface GeneratedAd {
  title?: string;
  description?: string;
  price?: number | null;
  price_type?: string;
  category?: string;
  type?: string;
  shipping_type?: string;
  price_hint?: AiPriceHint;
  [key: string]: unknown;
}

export const QuickAiCreate = forwardRef<QuickAiCreateHandle>(function QuickAiCreate(_, ref) {
  const { isAiAvailable } = useAiAvailable();
  const router = useRouter();
  const generateAd = useGenerateAd();
  const createAd = useCreateAd();
  const resolveCategoryName = useCategoryName('full');
  const { toast } = useToast();
  const { staged, stagedFiles, sentFiles, fileInputKey, addFiles, removeAt, markSent, reset, resizeForAi } = useStagedImages();
  const [prompt, setPrompt] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAd, setGeneratedAd] = useState<GeneratedAd | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    addFiles: (files: File[]) => {
      addFiles(files);
      textareaRef.current?.focus();
    },
  }));

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() && stagedFiles.length === 0) return;
    setError(null);
    setIsGenerating(true);

    // Only send files that haven't been sent before
    const toSend = stagedFiles.filter((f) => !sentFiles.includes(f));

    try {
      let images: string[] = [];
      if (toSend.length > 0) {
        images = await resizeForAi(toSend);
        // Abort only if nothing usable remains (no readable image and no text)
        if (images.length === 0 && !prompt.trim()) {
          setError('Keine der ausgewählten Bilder konnte verarbeitet werden.');
          return;
        }
      }

      // For refinement: pass current ad as JSON + change request.
      // Image-only refinement (no text) keeps the current ad as context — identical to the KI-Chat.
      let finalPrompt = prompt.trim();
      if (generatedAd) {
        const change = finalPrompt || (toSend.length > 0 ? 'Analysiere die neuen Bilder und verbessere die Anzeige.' : '');
        if (change) {
          const current = { ...generatedAd, title: editTitle, description: editDesc };
          finalPrompt = `${JSON.stringify(current)}\n\nÄnderungswunsch: ${change}`;
        }
      }

      const result = await generateAd.mutateAsync({ prompt: finalPrompt, images });
      const ad = result.ad as GeneratedAd;
      setGeneratedAd(ad);
      setEditTitle(ad.title ?? '');
      setEditDesc(ad.description ?? '');
      setPrompt('');
      if (toSend.length > 0) markSent(toSend);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, stagedFiles, sentFiles, generatedAd, editTitle, editDesc, generateAd, markSent, resizeForAi]);

  const handleEditAndSave = useCallback(() => {
    if (!generatedAd) return;
    const { images: _imgs, ...rest } = generatedAd;
    const ad = { ...rest, title: editTitle, description: editDesc };
    sessionStorage.setItem('ai_ad_data', JSON.stringify(ad));
    // Hand the collected files to the new-ad form
    if (sentFiles.length) {
      (window as unknown as Record<string, unknown>).__aiStagedFiles = [...sentFiles];
    }
    router.push('/ads/new?from=ai');
  }, [generatedAd, editTitle, editDesc, sentFiles, router]);

  const handleQuickSave = useCallback(async () => {
    if (!generatedAd) return;
    setIsSaving(true);
    try {
      const { price_hint: _, ...adFields } = generatedAd;
      const result = await createAd.mutateAsync({
        ...adFields,
        title: editTitle,
        description: editDesc,
      } as Parameters<typeof createAd.mutateAsync>[0]) as { file: string };

      // Upload images
      if (sentFiles.length > 0) {
        const url = '/api/images/upload?file=' + encodeURIComponent(result.file);
        for (const file of sentFiles) {
          const formData = new FormData();
          formData.append('files', file);
          const res = await api.upload<{ rejected?: { name: string; reason: string }[] }>(url, formData).catch(() => null);
          for (const r of res?.rejected ?? []) {
            toast('error', `${r.name}: ${r.reason}`);
          }
        }
      }
      toast('success', `„${editTitle}" gespeichert`);
      setGeneratedAd(null);
      setError(null);
      setEditTitle('');
      setEditDesc('');
      reset();
      textareaRef.current?.focus();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [generatedAd, editTitle, editDesc, createAd, toast, sentFiles, reset]);

  const handleReset = useCallback(() => {
    setGeneratedAd(null);
    setError(null);
    setEditTitle('');
    setEditDesc('');
    reset();
  }, [reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const all = Array.from(e.clipboardData?.files || []);
    if (!all.length) return;
    e.preventDefault();
    addFiles(all);
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  if (!isAiAvailable) {
    return (
      <div className={styles.box} style={{ opacity: 0.5, pointerEvents: 'none' }}>
        <div className={styles.inputRow}>
          <div className={styles.imgBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <div className={styles.input} style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', minHeight: '40px' }}>
            KI-Anzeigenerstellung nicht aktiv — OpenRouter API-Key in config.yaml eintragen
          </div>
          <Button variant="primary" className={styles.sendBtn} disabled>
            Anzeige generieren
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-quickai
      className={`${styles.box} ${isDragOver ? styles.boxDragOver : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Image strip */}
      {staged.length > 0 && (
        <div className={styles.imageStrip}>
          {staged.map(({ file, url }, i) => (
            <div key={`${file.name}-${i}`} className={styles.thumb}>
              <img
                src={url}
                alt={file.name}
                className={styles.thumbImg}
                onClick={() => setPreviewSrc(url)}
                style={{ cursor: 'pointer' }}
              />
              <button className={styles.thumbRemove} onClick={() => removeAt(i)} type="button">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input — key forces fresh DOM element */}
      <input
        key={fileInputKey}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {/* Input row */}
      <div className={styles.inputRow}>
          <button
            type="button"
            className={styles.imgBtn}
            title="Bilder hinzufügen"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder={generatedAd ? 'Nachbesserung, z.B. „Preis auf 350€ senken“ oder „Beschreibung kürzer“' : 'KI-Anzeige erstellen, z.B. „iPhone 14, 128GB, guter Zustand, 400€“ oder „IKEA Regal weiß, Abholung Düsseldorf“'}
            rows={1}
            value={prompt}
            maxLength={500}
            onChange={(e) => setPrompt(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isGenerating}
          />
          <Button
            variant="primary"
            className={styles.sendBtn}
            onClick={handleSubmit}
            loading={isGenerating}
            disabled={isGenerating || (!prompt.trim() && stagedFiles.length === 0)}
          >
            {isGenerating
              ? (generatedAd ? 'Wird verbessert…' : stagedFiles.length > 0 ? 'Bilder werden analysiert…' : 'Wird generiert…')
              : (generatedAd ? 'Verbessern' : 'Anzeige generieren')}
          </Button>
        </div>

      {/* Error */}
      {error && (
        <div className={styles.error}>
          {error}
          <button type="button" onClick={handleReset} style={{ marginLeft: 'var(--space-3)', color: 'inherit', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' }}>
            Nochmal versuchen
          </button>
        </div>
      )}

      {/* Generated preview */}
      {generatedAd && (
        <div className={styles.preview}>
          <textarea
            ref={autoResize}
            className={styles.previewTitleInput}
            value={editTitle}
            rows={1}
            onChange={(e) => {
              setEditTitle(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            }}
          />
          <div className={styles.previewMeta}>
            {[
              generatedAd.price != null
                ? `${generatedAd.price} €${generatedAd.price_type === 'NEGOTIABLE' ? ' VB' : ''}`
                : generatedAd.price_hint?.suggestion != null
                  ? `ca. ${generatedAd.price_hint.suggestion} € (Vorschlag)`
                  : null,
              resolveCategoryName(generatedAd.category as string) || null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {generatedAd.price_hint?.condition_note && (
            <div className={styles.previewCondition}>
              {generatedAd.price_hint.condition_note}
            </div>
          )}
          <AttributeChips
            attrs={(generatedAd.special_attributes as Record<string, unknown>) ?? {}}
            categoryId={generatedAd.category as string | undefined}
            plainAttrs={buildEnumChipLabels(generatedAd)}
          />
          <textarea
            ref={autoResize}
            className={styles.previewDescEdit}
            value={editDesc}
            onChange={(e) => {
              setEditDesc(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            }}
          />
          <div className={styles.previewActions}>
            <Button variant="warning" onClick={handleQuickSave} loading={isSaving} disabled={isSaving}>
              {isSaving ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleEditAndSave}>
              Im Formular bearbeiten
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Verwerfen
            </Button>
          </div>
        </div>
      )}

      {previewSrc && <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
});
