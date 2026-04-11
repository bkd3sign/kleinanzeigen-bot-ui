'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api/client';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { Input, Textarea, Select, Toggle, Button, Spinner, useToast } from '@/components/ui';
import { InfoTip } from '@/components/ads/AdForm/InfoTip';
import { PlzLocationPicker } from '@/components/shared/PlzLocationPicker';
import styles from './page.module.scss';

interface ConfigData {
  login?: { username?: string; password?: string };
  ad_defaults?: {
    active?: boolean;
    type?: string;
    price_type?: string;
    shipping_type?: string;
    sell_directly?: boolean;
    contact?: Record<string, string>;
    description_prefix?: string;
    description_suffix?: string;
    republication_interval?: number;
    auto_price_reduction?: Record<string, unknown>;
  };
}

const STRATEGY_OPTIONS = [
  { value: '', label: '– Keine –' },
  { value: 'PERCENTAGE', label: 'Prozentual' },
  { value: 'FIXED', label: 'Fester Betrag' },
];

const TYPE_OPTIONS = [
  { value: 'OFFER', label: 'Angebot' },
  { value: 'WANTED', label: 'Gesuch' },
];

const PRICE_TYPE_OPTIONS = [
  { value: 'FIXED', label: 'Festpreis' },
  { value: 'NEGOTIABLE', label: 'Verhandlungsbasis' },
  { value: 'GIVE_AWAY', label: 'Zu verschenken' },
];

const SHIPPING_TYPE_OPTIONS = [
  { value: 'PICKUP', label: 'Nur Abholung' },
  { value: 'SHIPPING', label: 'Versand' },
  { value: 'NOT_APPLICABLE', label: 'Nicht zutreffend' },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const { isAiAvailable } = useAiAvailable();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [adActive, setAdActive] = useState(true);
  const [adType, setAdType] = useState('OFFER');
  const [priceType, setPriceType] = useState('NEGOTIABLE');
  const [shippingType, setShippingType] = useState('SHIPPING');
  const [sellDirectly, setSellDirectly] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactStreet, setContactStreet] = useState('');
  const [contactZip, setContactZip] = useState('');
  const [contactLocation, setContactLocation] = useState('');
  const [republication, setRepublication] = useState('7');
  const [descPrefix, setDescPrefix] = useState('');
  const [descSuffix, setDescSuffix] = useState('');
  const [aprEnabled, setAprEnabled] = useState(false);
  const [aprStrategy, setAprStrategy] = useState('');
  const [aprAmount, setAprAmount] = useState('');
  const [aprMinPrice, setAprMinPrice] = useState('');
  const [aprDelayReposts, setAprDelayReposts] = useState('0');
  const [aprDelayDays, setAprDelayDays] = useState('0');
  const [aprOnUpdate, setAprOnUpdate] = useState(false);

  // AI Messaging settings
  const [aiMsgMode, setAiMsgMode] = useState('off');
  const [aiMsgPersonality, setAiMsgPersonality] = useState('');
  const [aiMsgRules, setAiMsgRules] = useState('');
  const [aiMsgEscalate, setAiMsgEscalate] = useState('');
  const [aiMsgAvailability, setAiMsgAvailability] = useState<Array<{ days: string; from: string; to: string }>>([]);

  const addAvailability = useCallback(() => {
    setAiMsgAvailability(prev => [...prev, { days: 'Werktags', from: '08:00', to: '20:00' }]);
  }, []);

  const updateAvailability = useCallback((index: number, field: string, value: string) => {
    setAiMsgAvailability(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }, []);

  const removeAvailability = useCallback((index: number) => {
    setAiMsgAvailability(prev => prev.filter((_, i) => i !== index));
  }, []);

  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['profile', 'login', 'contact']));
  const toggle = useCallback((key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    api.get<ConfigData>('/api/system/config')
      .then((data) => {
        const login = data.login ?? {};
        const ad = data.ad_defaults ?? {};
        const contact = ad.contact ?? {};
        const apr = ad.auto_price_reduction ?? {};
        setLoginEmail(login.username ?? '');
        setLoginPassword(login.password ?? '');
        setAdActive(ad.active !== false);
        setAdType((ad.type as string) ?? 'OFFER');
        setPriceType((ad.price_type as string) ?? 'NEGOTIABLE');
        setShippingType((ad.shipping_type as string) ?? 'SHIPPING');
        setSellDirectly(!!(ad.sell_directly));
        setContactName(contact.name ?? '');
        setContactPhone(contact.phone ?? '');
        setContactStreet(contact.street ?? '');
        setContactZip(contact.zipcode ?? '');
        setContactLocation(contact.location ?? '');
        setRepublication(String(ad.republication_interval ?? 7));
        setDescPrefix(ad.description_prefix ?? '');
        setDescSuffix(ad.description_suffix ?? '');
        setAprEnabled(!!(apr.enabled));
        setAprStrategy((apr.strategy as string) ?? '');
        setAprAmount(apr.amount != null ? String(apr.amount) : '');
        setAprMinPrice(apr.min_price != null ? String(apr.min_price) : '');
        setAprDelayReposts(String(apr.delay_reposts ?? 0));
        setAprDelayDays(String(apr.delay_days ?? 0));
        setAprOnUpdate(!!(apr.on_update));
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load AI messaging rules
    api.get<Record<string, unknown>>('/api/messages/responder/config')
      .then((data) => {
        setAiMsgMode((data.mode as string) ?? 'off');
        setAiMsgPersonality((data.personality as string) ?? '');
        setAiMsgAvailability((data.availability as Array<{ days: string; from: string; to: string }>) ?? []);
        setAiMsgRules((data.rules as string) ?? '');
        setAiMsgEscalate((data.escalate_keywords as string) ?? '');
      })
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    if (aprEnabled && !aprMinPrice) {
      toast('error', 'Mindestpreis ist Pflicht wenn Preisreduktion aktiviert ist');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/system/config', {
        login: { username: loginEmail, password: loginPassword },
        ad_defaults: {
          active: adActive,
          type: adType,
          price_type: priceType,
          shipping_type: shippingType,
          sell_directly: sellDirectly,
          contact: { name: contactName, street: contactStreet, zipcode: contactZip, location: contactLocation, phone: contactPhone },
          republication_interval: parseInt(republication) || 7,
          description_prefix: descPrefix,
          description_suffix: descSuffix,
          auto_price_reduction: {
            enabled: aprEnabled, strategy: aprStrategy || null,
            amount: aprAmount ? parseFloat(aprAmount) : null,
            min_price: aprMinPrice ? parseFloat(aprMinPrice) : null,
            delay_reposts: parseInt(aprDelayReposts) || 0,
            delay_days: parseInt(aprDelayDays) || 0,
            on_update: aprOnUpdate,
          },
        },
      });
      // Save AI messaging config separately
      await api.put('/api/messages/responder/config', {
        mode: aiMsgMode,
        personality: aiMsgPersonality,
        availability: aiMsgAvailability.filter(a => a.from && a.to),
        rules: aiMsgRules,
        escalate_keywords: aiMsgEscalate,
      }).catch(() => {}); // Non-critical

      toast('success', 'Einstellungen gespeichert');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [loginEmail, loginPassword, adActive, adType, priceType, shippingType, sellDirectly, contactName, contactPhone, contactStreet, contactZip, contactLocation, republication, descPrefix, descSuffix, aprEnabled, aprStrategy, aprAmount, aprMinPrice, aprDelayReposts, aprDelayDays, aprOnUpdate, aiMsgMode, aiMsgPersonality, aiMsgRules, aiMsgEscalate, aiMsgAvailability, toast]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}><Spinner size="lg" /></div>;
  }

  return (
    <div className={`${styles.settingsPage} animFadeIn`}>
      <div className={styles.stickyHeader}>
        <h2 className={styles.title}>Einstellungen</h2>
      </div>

      <div className={styles.form}>
        <Section title="Zugangsdaten" desc="Login für kleinanzeigen.de und dieses System." open={openSections.has('login')} onToggle={() => toggle('login')}>
          <div className={styles.row}>
            <Input label={<>E-Mail / Benutzername <InfoTip text="Login-E-Mail für kleinanzeigen.de" /></>} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
            <Input
              label={<>Passwort <InfoTip text="Login-Passwort für kleinanzeigen.de" /></>}
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onFocus={() => { if (loginPassword === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022') setLoginPassword(''); }}
              placeholder="Passwort eingeben"
            />
          </div>
        </Section>

        <Section title="Kontaktdaten" desc="Standard-Kontaktdaten für alle Anzeigen." open={openSections.has('contact')} onToggle={() => toggle('contact')}>
          <div className={styles.row}>
            <Input label={<>Name <InfoTip text="Anzeigename für alle Anzeigen" /></>} value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <Input label={<>Telefon <InfoTip text="Wird in Anzeigen angezeigt (optional)" /></>} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          <div className={styles.row}>
            <PlzLocationPicker
              zipValue={contactZip}
              locationValue={contactLocation}
              onZipChange={setContactZip}
              onLocationChange={setContactLocation}
              locationLabel={<>Ort <InfoTip text="Wird von Kleinanzeigen anhand der PLZ bestimmt" /></>}
            />
          </div>
          <Input label="Straße/Nr." value={contactStreet} onChange={(e) => setContactStreet(e.target.value)} placeholder="Optional" />
        </Section>

        <Section title="Anzeigen-Inhalte" desc="Standardwerte, Typ, Versand und Beschreibungs-Prefixe für neue Anzeigen." open={openSections.has('prefix')} onToggle={() => toggle('prefix')}>
          <Toggle label={<>Anzeigen standardmäßig aktiv <InfoTip text="Neue Anzeigen sind standardmäßig aktiv und werden vom Bot verarbeitet" /></>} checked={adActive} onChange={setAdActive} />
          <div className={styles.row}>
            <Select label={<>Angebotstyp <InfoTip text="Standard-Typ für neue Anzeigen" /></>} options={TYPE_OPTIONS} value={adType} onChange={(e) => setAdType(e.target.value)} />
            <Select label={<>Preistyp <InfoTip text="Standard-Preistyp für neue Anzeigen" /></>} options={PRICE_TYPE_OPTIONS} value={priceType} onChange={(e) => setPriceType(e.target.value)} />
          </div>
          <div className={styles.row}>
            <Select label={<>Versandart <InfoTip text="Standard-Versandart für neue Anzeigen" /></>} options={SHIPPING_TYPE_OPTIONS} value={shippingType} onChange={(e) => setShippingType(e.target.value)} />
          </div>
          <Toggle label={<>Direktverkauf <InfoTip text="Käufer können den Artikel direkt kaufen ohne Nachricht" /></>} checked={sellDirectly} onChange={setSellDirectly} />
          <Textarea label={<>Beschreibungs-Prefix <InfoTip text="Text, der vor jeder Anzeigenbeschreibung eingefügt wird" /></>} value={descPrefix} onChange={(e) => setDescPrefix(e.target.value)} rows={3} />
          <Textarea label={<>Beschreibungs-Suffix <InfoTip text="Text, der nach jeder Anzeigenbeschreibung eingefügt wird" /></>} value={descSuffix} onChange={(e) => setDescSuffix(e.target.value)} rows={3} />
        </Section>

        <Section title="Republication & Preisreduktion" desc="Intervall für Neueinstellungen und automatische Preissenkung." open={openSections.has('apr')} onToggle={() => toggle('apr')}>
          <Input label={<>Republication-Intervall (Tage) <InfoTip text="Alle N Tage wird die Anzeige automatisch neu eingestellt" /></>} type="number" min="1" value={republication} onChange={(e) => setRepublication(e.target.value)} placeholder="z.B. 7" />
          <Toggle label={<>Preisreduktion aktiviert <InfoTip text="Preis automatisch senken bei Republication" /></>} checked={aprEnabled} onChange={setAprEnabled} />
          {aprEnabled && (
            <>
              <div className={styles.row}>
                <Select label={<>Strategie <InfoTip text="PERCENTAGE: z.B. 5% pro Repost. FIXED: z.B. 5€ pro Repost." /></>} options={STRATEGY_OPTIONS} value={aprStrategy} onChange={(e) => setAprStrategy(e.target.value)} />
                <Input label={<>Betrag <InfoTip text="Reduktionsbetrag (% oder €)" /></>} type="number" min="0" step="0.1" value={aprAmount} onChange={(e) => setAprAmount(e.target.value)} />
              </div>
              <div className={styles.row}>
                <Input label={<>Mindestpreis (€) <InfoTip text="Preisuntergrenze" /></>} type="number" min="0" value={aprMinPrice} onChange={(e) => setAprMinPrice(e.target.value)} />
                <Input label={<>Verzögerung (Reposts) <InfoTip text="Erst nach N Reposts beginnen" /></>} type="number" min="0" value={aprDelayReposts} onChange={(e) => setAprDelayReposts(e.target.value)} />
              </div>
              <Input label={<>Verzögerung (Tage) <InfoTip text="Erst nach N Tagen beginnen" /></>} type="number" min="0" value={aprDelayDays} onChange={(e) => setAprDelayDays(e.target.value)} />
              <Toggle label={<>Auch bei Update anwenden <InfoTip text="Preis auch senken, wenn die Anzeige nur aktualisiert wird (z.B. Text- oder Bildänderungen) — nicht nur beim Neu-Einstellen. Die Tage-Verzögerung wird berücksichtigt, die Repost-Verzögerung nicht." /></>} checked={aprOnUpdate} onChange={setAprOnUpdate} />
            </>
          )}
        </Section>

        <Section title="KI-Nachrichten" desc="Automatische Antworten auf Kleinanzeigen-Nachrichten per LLM." open={openSections.has('ai-msg')} onToggle={() => toggle('ai-msg')}>
          {!isAiAvailable && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-4)',
              border: '1px solid var(--border-color)',
            }}>
              KI-Nachrichten benötigen einen OpenRouter API-Key. Trage ihn in der config.yaml unter <code>ai.api_key</code> ein.
            </div>
          )}
          <Select
            label={<>Modus <InfoTip text="Auto: Antwortet sofort automatisch. Review: Schlägt Antworten vor, du bestätigst. Aus: Keine KI-Antworten." /></>}
            options={[
              { value: 'off', label: 'Aus' },
              { value: 'review', label: 'Review (Vorschlag bestätigen)' },
              { value: 'auto', label: 'Auto (sofort senden)' },
            ]}
            value={aiMsgMode}
            onChange={(e) => setAiMsgMode(e.target.value)}
            disabled={!isAiAvailable}
          />
          {aiMsgMode !== 'off' && isAiAvailable && (
            <>
              {/* Availability schedule builder */}
              <div>
                <label className="formLabel">Verfügbarkeitszeiten <InfoTip text="Wann bist du für Abholung erreichbar? Die KI nennt diese Zeiten bei Terminanfragen." /></label>
                {aiMsgAvailability.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 20px', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                    <span className="formLabel">Tage</span>
                    <span className="formLabel">Von</span>
                    <span className="formLabel">Bis</span>
                    <span />
                  </div>
                )}
                {aiMsgAvailability.map((slot, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 20px', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <Select
                      options={[
                        { value: 'Werktags', label: 'Werktags (Mo–Fr)' },
                        { value: 'Wochenende', label: 'Wochenende (Sa–So)' },
                        { value: 'Montag', label: 'Montag' },
                        { value: 'Dienstag', label: 'Dienstag' },
                        { value: 'Mittwoch', label: 'Mittwoch' },
                        { value: 'Donnerstag', label: 'Donnerstag' },
                        { value: 'Freitag', label: 'Freitag' },
                        { value: 'Samstag', label: 'Samstag' },
                        { value: 'Sonntag', label: 'Sonntag' },
                        { value: 'Täglich', label: 'Täglich' },
                      ]}
                      value={slot.days}
                      onChange={(e) => updateAvailability(i, 'days', e.target.value)}
                    />
                    <Input type="time" value={slot.from} onChange={(e) => updateAvailability(i, 'from', e.target.value)} />
                    <Input type="time" value={slot.to} min={slot.from} onChange={(e) => updateAvailability(i, 'to', e.target.value)} />
                    <button type="button" onClick={() => removeAvailability(i)} title="Entfernen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, height: 'var(--space-9)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 'var(--space-5)' }}>×</button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addAvailability}>+ Zeitfenster hinzufügen</Button>
              </div>

              <Textarea
                label={<>Persönlichkeit <InfoTip text="Beschreibe wie die KI schreiben soll: Charakter, Tonalität, Begrüßung, Verabschiedung — alles in einem Prompt. Preisregeln, Sicherheit und Termin-Schutz sind fest eingebaut und können hier nicht überschrieben werden." /></>}
                value={aiMsgPersonality}
                onChange={(e) => setAiMsgPersonality(e.target.value)}
                rows={5}
                placeholder={"Du bist freundlich und locker. Duze den Käufer. Schreibe kurz in 2-3 Sätzen, maximal 4. Benutze gelegentlich Emojis aber übertreibe nicht. Klinge wie ein netter Nachbar, nicht wie ein Geschäft.\n\nStarte Nachrichten mit \"Hey\" oder \"Moin\".\nVerabschiede dich mit \"VG\" oder \"Beste Grüße\"."}
              />
              <Textarea
                label={<>Eigene Regeln <InfoTip text="Eine Regel pro Zeile. Ergänzt die eingebauten Sicherheits- und Preisregeln (die nicht überschrieben werden können)." /></>}
                value={aiMsgRules}
                onChange={(e) => setAiMsgRules(e.target.value)}
                rows={5}
                placeholder={"Bei 'Ist noch da?' → Ja + Versand anbieten\nBei Fragen zum Zustand → auf Beschreibung verweisen\nBei PayPal-Anfrage → nur Friends & Family"}
              />
              <Textarea
                label={<>Eskalations-Keywords <InfoTip text="Ein Wort pro Zeile. Bei diesen Wörtern wird die Nachricht zur manuellen Prüfung weitergeleitet statt automatisch beantwortet." /></>}
                value={aiMsgEscalate}
                onChange={(e) => setAiMsgEscalate(e.target.value)}
                rows={3}
                placeholder={"Tausch\nPaySafe\nRatenzahlung\nWestern Union\nGeschenkkarte\nKäuferschutz-Link"}
              />
            </>
          )}
        </Section>

        <Button variant="primary" size="lg" className={styles.saveBtn} onClick={handleSave} loading={saving}>
          Einstellungen speichern
        </Button>
      </div>
    </div>
  );
}

function Section({ title, desc, open, onToggle, children }: { title: string; desc: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionTitleCol}>
          <span className={styles.sectionTitle}>{title}</span>
          {desc && <span className={styles.sectionDesc}>{desc}</span>}
        </div>
        <span className={`${styles.sectionChevron} ${!open ? styles.sectionChevronCollapsed : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>
      <div className={`${styles.sectionBodyWrap} ${!open ? styles.sectionBodyWrapCollapsed : ''}`}>
        <div className={styles.sectionBody}>{children}</div>
      </div>
    </div>
  );
}
