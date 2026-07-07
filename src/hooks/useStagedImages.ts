'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui';
import { applyImageLimits, adImageCapMessage, formatRejectMessage, MAX_AI_IMAGES } from '@/lib/images/formats';
import { resizeImagesForAi } from '@/lib/images/resize-client';

export interface StagedImage {
  file: File;
  url: string;
}

export interface UseStagedImages {
  /** Staged images with stable object URLs for previews. */
  staged: StagedImage[];
  /** Convenience accessor for the staged File objects. */
  stagedFiles: File[];
  /** All files that have been marked as sent to the AI (deduplicated). */
  sentFiles: File[];
  /** Key for the hidden <input> — bumped on every add so the same file can be re-selected. */
  fileInputKey: number;
  /** Filter, toast on rejects, and stage accepted image files with fresh object URLs. */
  addFiles: (files: File[]) => void;
  /** Remove a staged image and revoke its object URL. */
  removeAt: (index: number) => void;
  /** Remove all staged images and revoke their object URLs. */
  clearStaged: () => void;
  /** Record files as sent to the AI (deduplicated by File reference). */
  markSent: (files: File[]) => void;
  /** Clear staged + sent and revoke all staged object URLs. */
  reset: () => void;
  /**
   * Resize the given files into data URLs for an AI vision request. Caps the count at
   * MAX_AI_IMAGES (toasts when capped), batches the resize to protect memory, and toasts
   * any images that failed to decode. Returns only the successfully processed data URLs.
   */
  resizeForAi: (files: File[]) => Promise<string[]>;
}

/**
 * Shared image-staging logic for the AI ad composers (QuickAiCreate, AiGenerator).
 * Owns the object-URL lifecycle (create on add, revoke on remove/clear/unmount) so
 * previews never leak, plus format filtering and sent-file deduplication.
 */
export function useStagedImages(): UseStagedImages {
  const { toast } = useToast();
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [sentFiles, setSentFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);

  // Mirror staged for a stable unmount cleanup without re-subscribing the effect.
  const stagedRef = useRef<StagedImage[]>([]);
  stagedRef.current = staged;

  // Revoke all remaining object URLs when the composer unmounts.
  useEffect(
    () => () => {
      for (const s of stagedRef.current) URL.revokeObjectURL(s.url);
    },
    [],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const { toAdd, rejectedFormat, capExceeded } = applyImageLimits(files, stagedRef.current.length);
      if (rejectedFormat.length > 0) toast('error', formatRejectMessage(rejectedFormat));
      if (capExceeded) toast('error', adImageCapMessage());
      if (toAdd.length > 0) {
        setStaged((prev) => [...prev, ...toAdd.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
      }
      // Re-key the hidden input so selecting the same file again re-fires onChange.
      setFileInputKey((k) => k + 1);
    },
    [toast],
  );

  const removeAt = useCallback((index: number) => {
    setStaged((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearStaged = useCallback(() => {
    setStaged((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.url);
      return [];
    });
  }, []);

  const markSent = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setSentFiles((prev) => {
      const seen = new Set(prev);
      const fresh = files.filter((f) => !seen.has(f));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  const reset = useCallback(() => {
    clearStaged();
    setSentFiles([]);
  }, [clearStaged]);

  const resizeForAi = useCallback(
    async (files: File[]): Promise<string[]> => {
      // The vision model analyzes at most MAX_AI_IMAGES; extra images are still saved with the ad.
      const forAi = files.slice(0, MAX_AI_IMAGES);
      if (files.length > MAX_AI_IMAGES) {
        toast('info', `Die KI wertet die ersten ${MAX_AI_IMAGES} Bilder aus.`);
      }
      const { images, failed } = await resizeImagesForAi(forAi);
      if (failed.length > 0) {
        toast('error', `${failed.length} Bild(er) konnten nicht verarbeitet werden: ${failed.join(', ')}`);
      }
      return images;
    },
    [toast],
  );

  const stagedFiles = useMemo(() => staged.map((s) => s.file), [staged]);

  return { staged, stagedFiles, sentFiles, fileInputKey, addFiles, removeAt, clearStaged, markSent, reset, resizeForAi };
}
