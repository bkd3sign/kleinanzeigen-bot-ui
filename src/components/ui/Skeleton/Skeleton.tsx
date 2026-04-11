import type { CSSProperties, ReactElement } from 'react';
import styles from './Skeleton.module.scss';

type SkeletonVariant = 'text' | 'title' | 'card' | 'circle';

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
}

const variantClass: Record<SkeletonVariant, string> = {
  text: styles.skeletonText,
  title: styles.skeletonTitle,
  card: styles.skeletonCard,
  circle: styles.skeletonCircle,
};

export function Skeleton({
  variant = 'text',
  width,
  height,
  className,
}: SkeletonProps): ReactElement {
  const classes = [styles.skeleton, variantClass[variant], className]
    .filter(Boolean)
    .join(' ');

  // Only apply inline styles for dynamic runtime values (width/height overrides)
  const style: CSSProperties | undefined =
    width !== undefined || height !== undefined
      ? { width, height }
      : undefined;

  return <div className={classes} style={style} aria-hidden="true" />;
}
