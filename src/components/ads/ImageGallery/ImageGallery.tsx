'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { ImagePreview } from '@/components/ui';
import styles from './ImageGallery.module.scss';

interface ImageGalleryProps {
  images: string[];
  adFile?: string;
  isEdit?: boolean;
  initialFiles?: File[];
  pendingFilesRef?: React.MutableRefObject<File[]>;
  onChange: (images: string[]) => void;
  onDropHandlerReady?: (handler: (files: File[]) => void) => void;
}

export function ImageGallery({ images, adFile, isEdit = false, initialFiles, pendingFilesRef, onChange, onDropHandlerReady }: ImageGalleryProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Authoritative source of current images — updated IMMEDIATELY on every change,
  // not waiting for React's re-render cycle. Solves stale closure on iOS camera.
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Stable onChange ref so callbacks don't re-create when parent re-renders
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Update images: writes to ref IMMEDIATELY then notifies parent via onChange.
  // This ensures sequential uploads (iOS camera) always see the latest state.
  const updateImages = useCallback((next: string[]) => {
    imagesRef.current = next;
    onChangeRef.current(next);
  }, []);

  // Local blob URLs for preview of not-yet-uploaded files
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  // Cleanup blob URLs on unmount
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  const createBlobUrl = useCallback((file: File): string => {
    const url = URL.createObjectURL(file);
    blobUrlsRef.current.set(file.name, url);
    return url;
  }, []);

  const getImageUrl = useCallback(
    (name: string): string | null => {
      const blobUrl = blobUrlsRef.current.get(name);
      if (blobUrl) return blobUrl;
      if (!adFile) return null;
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) return null;
      return `/api/images/file?file=${encodeURIComponent(adFile)}&name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
    },
    [adFile],
  );

  const handleRemove = useCallback(
    async (index: number) => {
      const current = imagesRef.current;
      const name = current[index];
      if (isEdit && adFile) {
        try {
          await api.delete(`/api/images/delete?file=${encodeURIComponent(adFile)}&name=${encodeURIComponent(name)}`);
        } catch { /* Continue with local removal */ }
      }
      const blobUrl = blobUrlsRef.current.get(name);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrlsRef.current.delete(name);
      }
      if (pendingFilesRef) {
        pendingFilesRef.current = pendingFilesRef.current.filter((f) => f.name !== name);
      }
      const next = [...current];
      next.splice(index, 1);
      updateImages(next);
    },
    [isEdit, adFile, pendingFilesRef, updateImages],
  );

  // Rename files with duplicate names by appending _2, _3, etc.
  const deduplicateFiles = useCallback(
    (files: File[]): File[] => {
      const existing = new Set(imagesRef.current);
      const result: File[] = [];
      for (const file of files) {
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
        const base = file.name.slice(0, file.name.length - ext.length).replace(/[^a-zA-Z0-9._-]/g, '');
        let name = `${base}${ext}`;
        let counter = 2;
        while (existing.has(name)) {
          name = `${base}_${counter}${ext}`;
          counter++;
        }
        existing.add(name);
        if (name !== file.name) {
          result.push(new File([file], name, { type: file.type }));
        } else {
          result.push(file);
        }
      }
      return result;
    },
    [],
  );

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const uniqueFiles = deduplicateFiles(files);

      if (isEdit && adFile) {
        setUploading(true);
        const url = `/api/images/upload?file=${encodeURIComponent(adFile)}`;
        let latestImages = imagesRef.current;
        try {
          for (const file of uniqueFiles) {
            const formData = new FormData();
            formData.append('files', file);
            const result = await api.upload<{ uploaded: string[]; images: string[] }>(url, formData);
            latestImages = result.images;
          }
          updateImages(latestImages);
        } catch {
          for (const file of uniqueFiles) {
            if (!latestImages.includes(file.name)) {
              createBlobUrl(file);
              latestImages = [...latestImages, file.name];
            }
          }
          updateImages(latestImages);
        } finally {
          setUploading(false);
        }
      } else {
        for (const file of uniqueFiles) {
          createBlobUrl(file);
        }
        if (pendingFilesRef) {
          pendingFilesRef.current = [...pendingFilesRef.current, ...uniqueFiles];
        }
        updateImages([...imagesRef.current, ...uniqueFiles.map((f) => f.name)]);
      }
    },
    [isEdit, adFile, createBlobUrl, deduplicateFiles, pendingFilesRef, updateImages],
  );

  useEffect(() => {
    onDropHandlerReady?.(handleUploadFiles);
  }, [onDropHandlerReady, handleUploadFiles]);

  useEffect(() => {
    if (!initialFiles?.length) return;
    // Create blob URLs and add filenames (skips deduplicateFiles to avoid
    // Strict Mode renaming files that already exist in imagesRef)
    const existing = new Set(imagesRef.current);
    const newFiles: File[] = [];
    for (const file of initialFiles) {
      createBlobUrl(file);
      if (!existing.has(file.name)) newFiles.push(file);
    }
    if (newFiles.length > 0) {
      if (pendingFilesRef) {
        pendingFilesRef.current = [...pendingFilesRef.current, ...newFiles];
      }
      updateImages([...imagesRef.current, ...newFiles.map((f) => f.name)]);
    }
    // Mount-only: pick up staged files from AI generator
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      handleUploadFiles(Array.from(files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [handleUploadFiles],
  );

  const handleUploadDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      handleUploadFiles(files);
    },
    [handleUploadFiles],
  );

  // Drag reorder
  const handleDragStart = useCallback((index: number) => setDragIndex(index), []);
  const handleDragEnd = useCallback(() => { setDragIndex(null); setDragOverIndex(null); }, []);
  const handleDragLeave = useCallback(() => setDragOverIndex(null), []);

  const handleDragOver = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(targetIndex);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      setDragOverIndex(null);
      if (dragIndex === null || dragIndex === targetIndex) return;
      const next = [...imagesRef.current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      updateImages(next);
      setDragIndex(null);
    },
    [dragIndex, updateImages],
  );

  return (
    <div className={styles.gallery}>
      <label className="formLabel">Bilder</label>
      <div className={styles.grid}>
        {images.map((name, index) => {
          const url = getImageUrl(name);
          const isDragging = dragIndex === index;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={`${name}-${index}`}
              className={`${styles.item} ${isDragging ? styles.itemDragging : ''} ${isDragOver ? styles.itemDragOver : ''}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              {url ? (
                <img
                  src={url}
                  alt={name}
                  className={styles.thumb}
                  loading="lazy"
                  onClick={() => setPreviewSrc(url)}
                />
              ) : (
                <div className={styles.placeholder}>{name}</div>
              )}
              <span className={styles.badge}>{index + 1}</span>
              <span className={styles.name} title={name}>{name}</span>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={(e) => { e.stopPropagation(); handleRemove(index); }}
                title="Bild entfernen"
              >×</button>
            </div>
          );
        })}

        {/* Upload card */}
        <div
          className={styles.uploadCard}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleUploadDrop}
        >
          <div className={styles.uploadIcon}>{uploading ? '…' : '+'}</div>
          <div className={styles.uploadText}>{uploading ? 'Wird hochgeladen' : 'Bilder hinzufügen'}</div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {previewSrc && (
        <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      )}
    </div>
  );
}
