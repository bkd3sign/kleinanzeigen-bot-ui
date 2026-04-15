'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import { Button, Input } from '@/components/ui';
import { PlzLocationPicker } from '@/components/shared/PlzLocationPicker';
import type { AuthResponse } from '@/types/auth';
import styles from './setup.module.scss';

interface SetupFormData {
  username: string;
  password: string;
  contact_name: string;
  contact_zipcode: string;
  contact_location: string;
  openrouter_api_key: string;
}

const TOTAL_STEPS = 4;

export default function SetupPage() {
  const { login } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);

  // Redirect if setup already completed (owner exists)
  useEffect(() => {
    fetch('/api/system/health')
      .then((r) => r.json())
      .then((data) => { if (!data.setup_required) router.replace('/'); })
      .catch(() => {});
  }, [router]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<SetupFormData>({
    username: '',
    password: '',
    contact_name: '',
    contact_zipcode: '',
    contact_location: '',
    openrouter_api_key: '',
  });

  const updateField = useCallback((field: keyof SetupFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleNext = useCallback(async () => {
    setError(null);

    if (step === 1) {
      if (!formData.username || !formData.password) {
        setError('Bitte E-Mail und Passwort eingeben');
        return;
      }
      if (formData.password.length < 8) {
        setError('Passwort muss mindestens 8 Zeichen lang sein');
        return;
      }
    }

    if (step === 2) {
      if (!formData.contact_name.trim()) {
        setError('Bitte gib deinen Namen ein');
        return;
      }
    }

    if (step === 3) {
      // Submit setup
      setIsSubmitting(true);
      try {
        const payload = {
          ...formData,
          email: formData.username,
          web_password: formData.password,
        };
        const result = await api.post<AuthResponse & { token: string }>('/api/system/setup', payload);
        if (result.token) {
          login(result.token, result.user);
        }
        localStorage.setItem('welcomeConfetti', '1');
        setStep(4);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Einrichtung fehlgeschlagen');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setStep((prev) => prev + 1);
  }, [step, formData, login]);

  return (
    <div className={styles.setupWizard}>
      <div className={styles.setupWizardCard}>
        {step === 0 && <WelcomeStep onStart={() => setStep(1)} />}

        {step >= 1 && step <= 3 && (
          <>
            <StepIndicator current={step} total={TOTAL_STEPS - 1} />

            <div className={styles.setupWizardBody}>
              {error && <div className={styles.setupWizardError}>{error}</div>}

              {step === 1 && (
                <>
                  <h2 className={styles.setupWizardTitle}>Kleinanzeigen Login</h2>
                  <p className={styles.setupWizardDesc}>
                    Gib deine Kleinanzeigen-Zugangsdaten ein. Diese dienen gleichzeitig als Login für die Web-Oberfläche.
                  </p>
                  <Input
                    label="E-Mail-Adresse"
                    type="email"
                    placeholder="deine@email.de"
                    value={formData.username}
                    onChange={(e) => updateField('username', e.target.value)}
                    required
                  />
                  <Input
                    label="Passwort"
                    type="password"
                    placeholder="Dein Kleinanzeigen-Passwort"
                    value={formData.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    required
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <h2 className={styles.setupWizardTitle}>Kontaktdaten</h2>
                  <p className={styles.setupWizardDesc}>
                    Diese Daten werden als Standard für neue Anzeigen verwendet.
                  </p>
                  <Input
                    label="Name"
                    placeholder="Dein Name"
                    value={formData.contact_name}
                    onChange={(e) => updateField('contact_name', e.target.value)}
                    required
                  />
                  <PlzLocationPicker
                    zipValue={formData.contact_zipcode}
                    locationValue={formData.contact_location}
                    onZipChange={(v) => updateField('contact_zipcode', v)}
                    onLocationChange={(v) => updateField('contact_location', v)}
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <h2 className={styles.setupWizardTitle}>KI-Funktion (optional)</h2>
                  <p className={styles.setupWizardDesc}>
                    Für KI-gestützte Anzeigenerstellung wird ein OpenRouter API-Key benötigt.
                    Kostenlose Modelle verfügbar auf openrouter.ai — kann auch später in config.yaml eingetragen werden.
                  </p>
                  <Input
                    label="OpenRouter API-Key"
                    type="password"
                    placeholder="sk-or-... (optional)"
                    value={formData.openrouter_api_key}
                    onChange={(e) => updateField('openrouter_api_key', e.target.value)}
                  />
                </>
              )}
            </div>

            <div className={styles.setupWizardFooter}>
              {step > 1 ? (
                <Button variant="ghost" onClick={() => setStep((prev) => prev - 1)}>
                  Zurück
                </Button>
              ) : (
                <div />
              )}
              <Button
                variant="primary"
                size="lg"
                onClick={handleNext}
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                {step === 3 ? 'Einrichtung abschließen' : 'Weiter'}
              </Button>
            </div>
          </>
        )}

        {step === 4 && <DoneStep router={router} toast={toast} hasAiKey={!!formData.openrouter_api_key} />}
      </div>
    </div>
  );
}

// -- Sub-components --

function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className={styles.setupWizardBody}>
      <div className={styles.setupWizardBrand}>
        <div className={styles.setupWizardBrandIcon}>K</div>
      </div>
      <h1 className={styles.setupWizardTitle}>Willkommen beim Kleinanzeigen Bot UI</h1>
      <p className={styles.setupWizardDesc}>
        In wenigen Schritten richtest du deinen Bot ein. Du brauchst deine
        Kleinanzeigen-Zugangsdaten und optional deine Kontaktdaten für Anzeigen.
      </p>
      <div style={{ textAlign: 'center' }}>
        <Button variant="primary" size="lg" onClick={onStart}>
          Los geht&apos;s
        </Button>
      </div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className={styles.setupWizardSteps}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ display: 'contents' }}>
          {i > 0 && (
            <div
              className={`${styles.setupWizardStepLine} ${i <= current ? styles.setupWizardStepLineDone : ''}`}
            />
          )}
          <div
            className={`${styles.setupWizardStep} ${
              i === current
                ? styles.setupWizardStepActive
                : i < current
                  ? styles.setupWizardStepDone
                  : ''
            }`}
          >
            {i < current ? (
              <svg viewBox="0 0 24 24" width="14" height="14">
                <polyline
                  points="20 6 9 17 4 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              i + 1
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface DoneStepProps {
  router: ReturnType<typeof useRouter>;
  toast: (type: 'success' | 'error' | 'info', message: string) => void;
  hasAiKey: boolean;
}

function DoneStep({ router, toast, hasAiKey }: DoneStepProps) {
  // Show confetti on mount — user just completed setup
  const handleDownload = useCallback(async () => {
    try {
      await api.post('/api/bot/download', { ads: 'all' });
      toast('success', 'Download gestartet');
      router.push('/logs');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Download fehlgeschlagen');
    }
  }, [router, toast]);

  return (
    <>
    <div className={styles.setupWizardBody}>
      <div className={styles.setupWizardSuccess}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--green)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>
      <h2 className={styles.setupWizardTitle}>Einrichtung abgeschlossen!</h2>
      <p className={styles.setupWizardDesc}>
        Dein Kleinanzeigen Bot UI ist einsatzbereit. Was möchtest du als Erstes tun?
      </p>

      <div className={styles.setupWizardActions}>
        {hasAiKey && (
          <button
            type="button"
            className={styles.setupWizardActionCard}
            onClick={() => router.push('/ads/ai')}
          >
            <div className={styles.setupWizardActionCardIcon}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <div className={styles.setupWizardActionCardTitle}>Mit KI erstellen</div>
              <div className={styles.setupWizardActionCardDesc}>Erstelle deine erste Anzeige mit KI-Unterstützung</div>
            </div>
          </button>
        )}

        <button
          type="button"
          className={styles.setupWizardActionCard}
          onClick={handleDownload}
        >
          <div className={styles.setupWizardActionCardIcon}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </div>
          <div>
            <div className={styles.setupWizardActionCardTitle}>Anzeigen herunterladen</div>
            <div className={styles.setupWizardActionCardDesc}>Importiere deine bestehenden Kleinanzeigen</div>
          </div>
        </button>

        <button
          type="button"
          className={styles.setupWizardActionCard}
          onClick={() => router.push('/ads/new')}
        >
          <div className={styles.setupWizardActionCardIcon}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <div>
            <div className={styles.setupWizardActionCardTitle}>Manuell erstellen</div>
            <div className={styles.setupWizardActionCardDesc}>Erstelle eine Anzeige mit dem Formular</div>
          </div>
        </button>
      </div>
    </div>
    </>
  );
}
