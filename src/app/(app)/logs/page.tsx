'use client';

import { LogViewer } from '@/components/bot/LogViewer';
import { JobTracker } from '@/components/bot/JobTracker';
import styles from './page.module.scss';

export default function BotPage() {
  return (
    <div className={`${styles.botActions} animStagger`}>
      {/* Jobs section */}
      <div className={styles.botSection}>
        <div>
          <h2 className={styles.sectionTitle}>Job-Verlauf</h2>
          <p className={styles.sectionSubtitle}>
            Übersicht aller ausgeführten Bot-Befehle und deren Status.
          </p>
        </div>
        <JobTracker />
      </div>

      {/* Logs section */}
      <div className={styles.botSection}>
        <div>
          <h2 className={styles.sectionTitle}>Logs</h2>
          <p className={styles.sectionSubtitle}>
            Echtzeit-Protokoll aller Bot-Aktivitäten.
          </p>
        </div>
        <LogViewer />
      </div>
    </div>
  );
}
