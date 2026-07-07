import type { ReactElement } from 'react';
import { Spinner } from '../Spinner/Spinner';
import styles from './PageLoader.module.scss';

/** Centered full-page loading spinner — shared by every route page's loading state. */
export function PageLoader(): ReactElement {
  return (
    <div className={styles.pageLoader}>
      <Spinner size="lg" />
    </div>
  );
}
