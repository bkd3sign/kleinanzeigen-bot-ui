'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGenerateAd, useCreateAd } from '@/hooks/useAds';
import { Button } from '@/components/ui/Button/Button';
import { useToast } from '@/components/ui/Toast/ToastProvider';
import { Spinner } from '@/components/ui/Spinner/Spinner';
import { ImagePreview } from '@/components/ui';
import { resizeImageForAi } from '@/lib/images/resize-client';
import { api } from '@/lib/api/client';
import styles from './AiGenerator.module.scss';

const EXAMPLE_PROMPTS = [
  'iPhone 14 Pro, 128GB, Space Black, sehr guter Zustand, 650€',
  'IKEA KALLAX Regal 4x4, weiß, leichte Gebrauchsspuren',
  'Nintendo Switch OLED mit 3 Spielen und Hülle, kaum benutzt',
  'Sony WH-1000XM5 Kopfhörer, ANC, schwarz, OVP',
  'Dyson V15 Detect Akkusauger, neuwertig, alle Aufsätze dabei',
];

interface GeneratedAd {
  title?: string;
  description?: string;
  price?: number;
  price_type?: string;
  category?: string;
  type?: string;
  shipping_type?: string;
  [key: string]: unknown;
}

interface ChatMessage {
  type: 'user' | 'bot' | 'loading' | 'error' | 'preview';
  content: string;
  images?: string[];
  ad?: GeneratedAd;
}

export function AiGenerator() {
  const router = useRouter();
  const generateAd = useGenerateAd();
  const createAd = useCreateAd();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState('');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [currentAd, setCurrentAd] = useState<GeneratedAd | null>(null);
  const [allFiles, setAllFiles] = useState<File[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showExamples, setShowExamples] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  // Pick up staged files from ads page drop
  useEffect(() => {
    const win = window as unknown as Record<string, unknown>;
    const files = win.__aiStagedFiles as File[] | undefined;
    if (files?.length) {
      setStagedFiles(files);
      delete win.__aiStagedFiles;
    }
  }, []);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  // Auto-resize textarea
  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, []);

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim();
    const hasImages = stagedFiles.length > 0;
    const isRefining = !!currentAd;
    if (!text && !hasImages) return;

    // Snapshot and clear staged files immediately to prevent race conditions
    const sentFiles = hasImages ? [...stagedFiles] : [];
    if (hasImages) setStagedFiles([]);
    const previewUrls = sentFiles.map((f) => URL.createObjectURL(f));

    // Add user message with text and/or image previews
    if (text || hasImages) {
      setMessages((prev) => [...prev, { type: 'user', content: text, images: previewUrls }]);
    }
    setPrompt('');
    setShowExamples(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
    setIsGenerating(true);

    try {
      let images: string[] = [];
      if (hasImages) {
        images = await Promise.all(sentFiles.map(resizeImageForAi));
      }

      // For refinement: pass current ad as JSON + change request
      let finalPrompt = text;
      if (isRefining) {
        const change = text || (hasImages ? 'Analysiere die neuen Bilder und verbessere die Anzeige.' : '');
        finalPrompt = `${JSON.stringify(currentAd)}\n\nÄnderungswunsch: ${change}`;
      }

      const result = await generateAd.mutateAsync({
        prompt: finalPrompt || '',
        images,
      });

      const ad = result.ad as GeneratedAd;
      if (sentFiles.length) setAllFiles((prev) => [...prev, ...sentFiles]);
      setCurrentAd(ad);
      setFileInputKey((k) => k + 1);

      // Add preview message
      setMessages((prev) => [
        ...prev,
        {
          type: 'preview',
          content: isRefining ? 'Anzeige aktualisiert:' : 'Anzeige generiert:',
          ad,
        },
      ]);
    } catch (err) {
      toast('error', (err as Error).message);
      setMessages((prev) => [
        ...prev,
        { type: 'error', content: (err as Error).message },
      ]);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, stagedFiles, currentAd, generateAd, toast]);

  const handleEditAndSave = useCallback(() => {
    if (!currentAd) return;
    const { images: _imgs, ...rest } = currentAd;
    sessionStorage.setItem('ai_ad_data', JSON.stringify(rest));
    if (allFiles.length) {
      (window as unknown as Record<string, unknown>).__aiStagedFiles = [...allFiles];
    }
    router.push('/ads/new?from=ai');
  }, [currentAd, allFiles, router]);

  const handleQuickSave = useCallback(async () => {
    if (!currentAd) return;
    setIsSaving(true);
    try {
      const { price_hint: _, ...adFields } = currentAd;
      const result = await createAd.mutateAsync({
        ...adFields,
        title: String(currentAd.title ?? ''),
        description: String(currentAd.description ?? ''),
      } as Parameters<typeof createAd.mutateAsync>[0]) as { file: string };

      // Upload collected images
      if (allFiles.length > 0) {
        const url = '/api/images/upload?file=' + encodeURIComponent(result.file);
        for (const file of allFiles) {
          const formData = new FormData();
          formData.append('files', file);
          try { await api.upload(url, formData); } catch { /* non-critical */ }
        }
      }
      toast('success', `„${currentAd.title}" gespeichert`);
      setCurrentAd(null);
      setMessages([]);
      setStagedFiles([]);
      setAllFiles([]);
      setShowExamples(true);
      textareaRef.current?.focus();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [currentAd, createAd, toast, allFiles]);

  const handleReset = useCallback(() => {
    setCurrentAd(null);
    setMessages([]);
    setStagedFiles([]);
    setAllFiles([]);
    setShowExamples(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setStagedFiles((prev) => [...prev, ...Array.from(files)]);
    }
    // Force fresh input element for next upload
    setFileInputKey((k) => k + 1);
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setStagedFiles((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(URL.createObjectURL(next[index]));
      next.splice(index, 1);
      return next;
    });
  }, []);

  // Paste images from clipboard
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length) {
      e.preventDefault();
      setStagedFiles((prev) => [...prev, ...files]);
    }
  }, []);

  // Drag & drop with fullscreen overlay
  const dragCounter = useRef(0);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length) setStagedFiles((prev) => [...prev, ...files]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  return (
    <div
      className={styles.wrapper}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Global drop overlay */}
      {isDragOver && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayContent}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>Bilder hier ablegen</span>
          </div>
        </div>
      )}

      {/* Scrollable chat area */}
      <div className={styles.chatArea} ref={chatRef}>
        {/* Welcome message */}
        {messages.length === 0 && !currentAd && (
          <div className={styles.messageBot}>
            <strong>Beschreibe oder fotografiere, was du verkaufen möchtest.</strong>
            <br />
            Lade Fotos hoch oder beschreibe deinen Artikel – ich analysiere Zustand, Marke
            und Details und erstelle daraus automatisch eine Anzeige.
          </div>
        )}

        {/* Example chips */}
        {showExamples && messages.length === 0 && (
          <div className={styles.examples}>
            {EXAMPLE_PROMPTS.map((text) => (
              <button
                key={text}
                type="button"
                className={styles.exampleChip}
                onClick={() => {
                  setPrompt(text);
                  textareaRef.current?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          if (msg.type === 'user') {
            return (
              <div key={i} className={styles.messageUser}>
                {msg.images && msg.images.length > 0 && (
                  <div className={styles.messageImages}>
                    {msg.images.map((src, j) => (
                      <img key={j} src={src} alt="" className={styles.messageImage} onClick={() => setPreviewSrc(src)} />
                    ))}
                  </div>
                )}
                {msg.content && <span>{msg.content}</span>}
              </div>
            );
          }
          if (msg.type === 'error') {
            return (
              <div key={i} className={styles.messageBot} style={{ borderColor: 'var(--red)' }}>
                Fehler: {msg.content}
              </div>
            );
          }
          if (msg.type === 'preview' && msg.ad) {
            const ad = msg.ad;
            return (
              <div key={i} className={styles.messageBot}>
                <div style={{ fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)', color: 'var(--text-primary)' }}>
                  {msg.content}
                </div>

                {/* Preview card */}
                <div className={styles.previewCard}>
                  {[
                    ['Titel', ad.title],
                    ['Preis', ad.price != null ? `${ad.price} € (${ad.price_type || 'NEGOTIABLE'})` : '–'],
                    ['Kategorie', ad.category || '–'],
                    ['Typ', ad.type || 'OFFER'],
                    ['Versand', ad.shipping_type || 'SHIPPING'],
                  ].map(([label, value]) => (
                    <div key={label} className={styles.previewRow}>
                      <span className={styles.previewLabel}>{label}</span>
                      <span className={styles.previewValue}>{value}</span>
                    </div>
                  ))}

                  {ad.description && (
                    <div className={styles.previewDesc}>{String(ad.description)}</div>
                  )}
                </div>

                {/* Actions */}
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

                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                  {'Tipp: Schreibe eine Anpassung, z.B. „Preis auf 500€“ oder „Beschreibung kürzer“'}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={styles.messageBot}>
              {msg.content}
            </div>
          );
        })}

        {/* Loading indicator */}
        {isGenerating && (
          <div className={styles.messageBot} style={{ display: 'flex', alignItems: 'center' }}>
            <Spinner size="sm" />
            <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-muted)' }}>
              {currentAd
                ? 'Anzeige wird verbessert…'
                : stagedFiles.length > 0
                  ? 'Bilder werden analysiert und Anzeige generiert…'
                  : 'Anzeige wird generiert…'}
            </span>
          </div>
        )}
      </div>

      {/* Staging strip (above input) */}
      {stagedFiles.length > 0 && (
        <StagingStrip
          files={stagedFiles}
          onRemove={handleRemoveFile}
          onPreview={setPreviewSrc}
        />
      )}

      {/* Fullscreen image preview */}
      {previewSrc && <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />}

      {/* Hidden file input — key forces fresh DOM element after each use */}
      <input
        key={fileInputKey}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}
        onChange={handleFileSelect}
        tabIndex={-1}
      />

      {/* Sticky input area */}
      <div className={styles.inputArea}>
        <button
          type="button"
          className={styles.imageBtn}
          onClick={() => fileInputRef.current?.click()}
          title="Bilder hinzufügen"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className={styles.textInput}
          value={prompt}
          maxLength={500}
          onChange={(e) => { setPrompt(e.target.value); handleInput(); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            currentAd
              ? 'Anzeige verbessern, z.B. „Preis auf 500€" oder „Beschreibung kürzer" …'
              : 'Beschreibe deinen Artikel oder lade Fotos hoch …'
          }
          rows={1}
        />

        <Button
          variant="primary"
          className={styles.sendBtn}
          onClick={handleGenerate}
          loading={isGenerating}
          disabled={!prompt.trim() && stagedFiles.length === 0}
        >
          {currentAd ? 'Verbessern' : 'Generieren'}
        </Button>
      </div>
    </div>
  );
}

// Staging strip with stable blob URLs and click-to-preview
function StagingStrip({
  files,
  onRemove,
  onPreview,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onPreview: (src: string) => void;
}) {
  const urlMapRef = useRef<Map<File, string>>(new Map());

  // Build stable URLs — only create new ones for files we haven't seen
  const urls = files.map((f) => {
    let url = urlMapRef.current.get(f);
    if (!url) {
      url = URL.createObjectURL(f);
      urlMapRef.current.set(f, url);
    }
    return url;
  });

  // Cleanup removed files
  useEffect(() => {
    const currentFiles = new Set(files);
    for (const [file, url] of urlMapRef.current) {
      if (!currentFiles.has(file)) {
        URL.revokeObjectURL(url);
        urlMapRef.current.delete(file);
      }
    }
  }, [files]);

  return (
    <div className={styles.stagingStrip}>
      {files.map((file, i) => (
        <div key={`${file.name}-${i}`} className={styles.stagedThumb}>
          <img
            src={urls[i]}
            alt={file.name}
            onClick={() => onPreview(urls[i])}
            style={{ cursor: 'pointer' }}
          />
          <button
            type="button"
            className={styles.stagedRemove}
            onClick={() => onRemove(i)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

