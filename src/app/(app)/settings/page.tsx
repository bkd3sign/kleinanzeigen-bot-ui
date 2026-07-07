'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAiModels } from '@/lib/api/queries/system';
import { Input, Textarea, Select, Toggle, Button, PageLoader, Section, EmptyState, useToast } from '@/components/ui';
import { InfoTip } from '@/components/ads/AdForm/InfoTip';
import { CarrierCard } from '@/components/shared/CarrierCard';
import { ShippingSizeCards } from '@/components/shared/ShippingSizeCards';
import { SHIPPING_SIZES } from '@/lib/shipping';
import type { AiModelOption } from '@/app/api/system/ai-models/route';
import styles from '@/styles/settingsForm.module.scss';

const MASKED_KEY = '••••••••';

interface ConfigData {
  deleting?: { after_delete?: string };
  publishing?: Record<string, unknown>;
  download?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  browser?: Record<string, unknown>;
}

const PATH_RENAMING_OPTIONS = [
  { value: 'TEMPLATE_MATCH', label: 'Pfade synchron halten (empfohlen)' },
  { value: 'OFF', label: 'Aus (Pfade nie umbenennen)' },
];

const DELETE_OLD_ADS_OPTIONS = [
  { value: 'AFTER_PUBLISH', label: 'Nach dem Veröffentlichen (empfohlen)' },
  { value: 'BEFORE_PUBLISH', label: 'Vor dem Veröffentlichen' },
  { value: 'NEVER', label: 'Nie' },
];

const AFTER_DELETE_OPTIONS = [
  { value: 'NONE', label: 'Nichts (YAML unverändert)' },
  { value: 'RESET', label: 'Zurücksetzen (als neu einstellbar)' },
  { value: 'DISABLE', label: 'Deaktivieren (active: false)' },
];

/** Format one OpenRouter model as a dropdown option (id + prompt price per 1M tokens). */
function modelToOption(m: AiModelOption): { value: string; label: string } {
  const price = m.pricePromptPerM != null ? ` — $${m.pricePromptPerM.toFixed(2)}/M` : '';
  return { value: m.id, label: `${m.id}${price}` };
}

/**
 * Build the Select options for a model field: recommended subset by default, full
 * list when showAll is on. Falls back to the full pool if no model is flagged
 * recommended, and always keeps the currently-saved value selectable.
 */
function buildModelOptions(
  models: AiModelOption[],
  visionOnly: boolean,
  showAll: boolean,
  current: string,
): { value: string; label: string }[] {
  const pool = visionOnly ? models.filter((m) => m.vision) : models;
  const base = showAll
    ? pool
    : pool.filter((m) => (visionOnly ? m.recommendedVision : m.recommendedText));
  const list = base.length ? base : pool;
  const options = list.map(modelToOption);
  if (current && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: `${current} (aktuell)` });
  }
  return options;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Publishing — keep the raw object to preserve unknown sibling keys on write.
  const [publishingConfig, setPublishingConfig] = useState<Record<string, unknown>>({});
  const [pathRenaming, setPathRenaming] = useState('TEMPLATE_MATCH');
  const [deleteOldAds, setDeleteOldAds] = useState('AFTER_PUBLISH');
  const [deleteOldAdsByTitle, setDeleteOldAdsByTitle] = useState(true);

  // Deleting
  const [afterDelete, setAfterDelete] = useState('NONE');

  // Download — raw object preserves siblings (e.g. dir) on write.
  const [downloadConfig, setDownloadConfig] = useState<Record<string, unknown>>({});
  const [folderTemplate, setFolderTemplate] = useState('ad_{id}_{title}');
  const [adFileTemplate, setAdFileTemplate] = useState('ad_{id}');
  const [renameExisting, setRenameExisting] = useState(false);
  const [includeAllShipping, setIncludeAllShipping] = useState(false);
  const [excludedShipping, setExcludedShipping] = useState<string[]>([]);
  const [activeExclSize, setActiveExclSize] = useState<string | null>(null);
  const [preserveLocal, setPreserveLocal] = useState(true);
  const [folderMaxLength, setFolderMaxLength] = useState('100');

  // AI — raw object preserves siblings (referer, app_name) on write.
  const [aiConfig, setAiConfig] = useState<Record<string, unknown>>({});
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiModelVision, setAiModelVision] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPromptVision, setAiPromptVision] = useState('');
  const [showAllModels, setShowAllModels] = useState(false);

  // Browser — raw object preserves siblings (arguments, binary_location, …) on write.
  const [browserConfig, setBrowserConfig] = useState<Record<string, unknown>>({});
  const [browserMode, setBrowserMode] = useState<'auto' | 'headless' | 'visible'>('auto');

  // Diagnostics — raw object preserves siblings (capture_log_copy, output_dir, …) on write.
  const [diagnosticsConfig, setDiagnosticsConfig] = useState<Record<string, unknown>>({});
  const [captureLoginDetection, setCaptureLoginDetection] = useState(false);
  const [capturePublish, setCapturePublish] = useState(false);
  const [captureLogCopy, setCaptureLogCopy] = useState(false);
  const [timingCollection, setTimingCollection] = useState(false);

  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleExcludedShipping = useCallback((id: string) => {
    setExcludedShipping((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const { data: aiModelsData } = useAiModels(isAdmin);
  const models = useMemo(() => aiModelsData?.models ?? [], [aiModelsData]);
  const modelsAvailable = models.length > 0;
  const textModelOptions = useMemo(() => buildModelOptions(models, false, showAllModels, aiModel), [models, showAllModels, aiModel]);
  const visionModelOptions = useMemo(() => buildModelOptions(models, true, showAllModels, aiModelVision), [models, showAllModels, aiModelVision]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    api.get<ConfigData>('/api/system/config')
      .then((data) => {
        setAfterDelete((data.deleting?.after_delete as string) ?? 'NONE');

        const publishing = data.publishing ?? {};
        setPublishingConfig(publishing);
        setPathRenaming(((publishing.local_path_renaming as Record<string, unknown>)?.mode as string) ?? 'TEMPLATE_MATCH');
        setDeleteOldAds((publishing.delete_old_ads as string) ?? 'AFTER_PUBLISH');
        setDeleteOldAdsByTitle(publishing.delete_old_ads_by_title !== false);

        const download = data.download ?? {};
        setDownloadConfig(download);
        setFolderTemplate((download.folder_name_template as string) ?? 'ad_{id}_{title}');
        setAdFileTemplate((download.ad_file_name_template as string) ?? 'ad_{id}');
        setRenameExisting(!!download.rename_existing_folders);
        setIncludeAllShipping(!!download.include_all_matching_shipping_options);
        setExcludedShipping(Array.isArray(download.excluded_shipping_options) ? (download.excluded_shipping_options as string[]) : []);
        setPreserveLocal(download.preserve_local_settings !== false);
        setFolderMaxLength(String(download.folder_name_max_length ?? 100));

        const ai = data.ai ?? {};
        setAiConfig(ai);
        setAiApiKey((ai.api_key as string) ?? '');
        setAiModel((ai.model as string) ?? '');
        setAiModelVision((ai.model_vision as string) ?? '');
        setAiPrompt((ai.prompt as string) ?? '');
        setAiPromptVision((ai.prompt_vision as string) ?? '');

        const browser = data.browser ?? {};
        setBrowserConfig(browser);
        const rawMode = browser.mode as string;
        setBrowserMode(rawMode === 'headless' || rawMode === 'visible' ? rawMode : 'auto');

        const diagnostics = data.diagnostics ?? {};
        setDiagnosticsConfig(diagnostics);
        const captureOn = (diagnostics.capture_on as Record<string, unknown>) ?? {};
        setCaptureLoginDetection(!!captureOn.login_detection);
        setCapturePublish(!!captureOn.publish);
        setCaptureLogCopy(!!diagnostics.capture_log_copy);
        setTimingCollection(!!diagnostics.timing_collection);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.put('/api/system/config', {
        deleting: { after_delete: afterDelete },
        publishing: {
          ...publishingConfig,
          // Nested-spread so any sibling keys the bot stores under
          // local_path_renaming survive — we only own the `mode`.
          local_path_renaming: {
            ...((publishingConfig.local_path_renaming as Record<string, unknown>) ?? {}),
            mode: pathRenaming,
          },
          delete_old_ads: deleteOldAds,
          // The "by title" lookup only applies to BEFORE_PUBLISH; never persist a
          // stale true when the strategy changed and its toggle is hidden.
          delete_old_ads_by_title: deleteOldAds === 'BEFORE_PUBLISH' && deleteOldAdsByTitle,
        },
        download: {
          ...downloadConfig,
          folder_name_template: folderTemplate,
          ad_file_name_template: adFileTemplate,
          rename_existing_folders: renameExisting,
          include_all_matching_shipping_options: includeAllShipping,
          excluded_shipping_options: excludedShipping,
          preserve_local_settings: preserveLocal,
          folder_name_max_length: parseInt(folderMaxLength) || 100,
        },
        ai: {
          ...aiConfig,
          api_key: aiApiKey,
          model: aiModel,
          model_vision: aiModelVision,
          prompt: aiPrompt,
          prompt_vision: aiPromptVision,
        },
        diagnostics: {
          ...diagnosticsConfig,
          capture_log_copy: captureLogCopy,
          timing_collection: timingCollection,
          capture_on: {
            ...((diagnosticsConfig.capture_on as Record<string, unknown>) ?? {}),
            login_detection: captureLoginDetection,
            publish: capturePublish,
          },
        },
        // Spread siblings so unknown browser keys (arguments, binary_location, …)
        // survive a round-trip through the settings form.
        browser: { ...browserConfig, mode: browserMode },
      });
      toast('success', 'Einstellungen gespeichert');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [afterDelete, publishingConfig, pathRenaming, deleteOldAds, deleteOldAdsByTitle, downloadConfig, folderTemplate, adFileTemplate, renameExisting, includeAllShipping, excludedShipping, preserveLocal, folderMaxLength, aiConfig, aiApiKey, aiModel, aiModelVision, aiPrompt, aiPromptVision, diagnosticsConfig, captureLoginDetection, capturePublish, captureLogCopy, timingCollection, browserConfig, browserMode, toast]);

  if (!isAdmin) {
    return (
      <EmptyState
        title="Kein Zugriff"
        message="Diese Einstellungen gelten für alle Workspaces und sind nur für Administratoren zugänglich."
      />
    );
  }

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className={`${styles.settingsPage} animFadeIn`}>
      <div className={styles.stickyHeader}>
        <h2 className={styles.title}>Globale Einstellungen</h2>
        <p className={styles.subtitle}>Bot-weite Standardwerte — gelten für alle Workspaces.</p>
      </div>

      <div className={styles.form}>
        <Section title="Veröffentlichung" desc="Verhalten beim Einstellen und Neu-Veröffentlichen von Anzeigen." open={openSections.has('publishing')} onToggle={() => toggle('publishing')}>
          <Select
            label={<>Alte Anzeigen löschen <InfoTip text="Beim Neu-Veröffentlichen vergibt Kleinanzeigen eine neue ID. Nach dem Veröffentlichen: Die alte Anzeige wird gelöscht, sobald die neue online ist (empfohlen, kein Doppel). Vor dem Veröffentlichen: Erst löschen, dann neu einstellen. Nie: Alte Anzeigen bleiben bestehen (Gefahr von Duplikaten)." /></>}
            options={DELETE_OLD_ADS_OPTIONS}
            value={deleteOldAds}
            onChange={(e) => setDeleteOldAds(e.target.value)}
          />
          {deleteOldAds === 'BEFORE_PUBLISH' && (
            <Toggle label={<>Alte Anzeigen per Titel finden <InfoTip text="Findet die zu löschende alte Anzeige anhand des Titels statt der ID. Wirkt nur mit der Option Vor dem Veröffentlichen. Nützlich, wenn die alte ID nicht mehr bekannt ist." /></>} checked={deleteOldAdsByTitle} onChange={setDeleteOldAdsByTitle} />
          )}
          <Select
            label={<>Lokale Pfade synchron halten <InfoTip text="Beim Neu-Veröffentlichen vergibt Kleinanzeigen eine neue Anzeigen-ID. Synchron halten benennt dann die lokalen Datei- und Ordnernamen automatisch auf die neue ID um, sodass sie zur Kleinanzeigen-ID passen. Es wird nur der ID-Teil ersetzt — manuell vergebene Titel bleiben erhalten, und Namen, die nicht zu deinen Download-Vorlagen passen, werden nicht angefasst. Aus lässt die Pfade unverändert, die alte ID bleibt dann im Namen." /></>}
            options={PATH_RENAMING_OPTIONS}
            value={pathRenaming}
            onChange={(e) => setPathRenaming(e.target.value)}
          />
        </Section>

        <Section title="Löschen" desc="Verhalten nach dem Löschen einer Anzeige per delete-Befehl." open={openSections.has('deleting')} onToggle={() => toggle('deleting')}>
          <Select
            label={<>Nach dem Löschen <InfoTip text="Was soll nach dem Löschen einer Anzeige passieren? Nichts: Die Anzeige bleibt unverändert gespeichert. Zurücksetzen: Sie wird beim nächsten Publish wie eine neue Anzeige behandelt. Deaktivieren: Sie wird nicht mehr automatisch eingestellt, bis du sie manuell reaktivierst." /></>}
            options={AFTER_DELETE_OPTIONS}
            value={afterDelete}
            onChange={(e) => setAfterDelete(e.target.value)}
          />
        </Section>

        <Section title="Download" desc="Verhalten beim Herunterladen von Anzeigen (download-Befehl)." open={openSections.has('download')} onToggle={() => toggle('download')}>
          <Input label={<>Ordnername-Vorlage <InfoTip text="Vorlage für heruntergeladene Anzeigen-Ordner. Platzhalter {id} (Pflicht) und {title} (optional). Text außerhalb der Platzhalter wird wörtlich übernommen. Beispiel: ad_{id}_{title}" /></>} value={folderTemplate} onChange={(e) => setFolderTemplate(e.target.value)} placeholder="ad_{id}_{title}" />
          <Input label={<>Dateiname-Vorlage <InfoTip text="Vorlage für die heruntergeladene YAML-Datei und den Bild-Prefix. Platzhalter {id} (Pflicht) und {title} (optional). Beispiel: ad_{id}" /></>} value={adFileTemplate} onChange={(e) => setAdFileTemplate(e.target.value)} placeholder="ad_{id}" />
          <Input label={<>Max. Ordnernamen-Länge <InfoTip text="Maximale Länge für heruntergeladene Ordnernamen (10–255, Standard 100). Begrenzt nicht die Dateinamen." /></>} type="number" min="10" max="255" value={folderMaxLength} onChange={(e) => setFolderMaxLength(e.target.value)} />
          <Toggle label={<>Bestehende Ordner umbenennen <InfoTip text="Benennt bestehende Ordner ohne Titel beim erneuten Download um, sodass sie den Titel enthalten." /></>} checked={renameExisting} onChange={setRenameExisting} />
          <Toggle label={<>Lokale Einstellungen erhalten <InfoTip text="Bewahrt lokale Werte (Preisreduktion, Republication-Intervall, Repost-/Reduktions-Zähler) beim erneuten Download einer bereits gespeicherten Anzeige. Nützlich, um Live-Änderungen zu übernehmen ohne lokale Konfiguration zu verlieren." /></>} checked={preserveLocal} onChange={setPreserveLocal} />
          <Toggle label={<>Alle passenden Versandoptionen <InfoTip text="Wenn aktiv, werden alle zur Paketgröße passenden Versandoptionen übernommen statt nur der günstigsten." /></>} checked={includeAllShipping} onChange={setIncludeAllShipping} />
          <div>
            <label className="formLabel">Ausgeschlossene Versandoptionen <InfoTip text="Aktivierte Optionen werden beim Download nie übernommen — auch wenn sie zur Paketgröße passen. Nützlich, wenn du z.B. keinen Hermes-Shop in der Nähe hast. Es lassen sich nur Optionen aus EINER Größengruppe kombinieren (S, M oder L)." /></label>
            {(() => {
              const summary = SHIPPING_SIZES
                .map((s) => ({
                  label: s.label,
                  names: s.carriers.filter((c) => excludedShipping.includes(c.value)).map((c) => c.name),
                }))
                .filter((g) => g.names.length > 0);
              return (
                <p className={styles.exclSummary}>
                  {summary.length > 0
                    ? summary.map((g) => (
                        <span key={g.label}>
                          <strong>{g.label}:</strong> {g.names.join(', ')}
                        </span>
                      ))
                    : 'Noch keine Versandoption ausgeschlossen.'}
                </p>
              );
            })()}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <ShippingSizeCards
                options={SHIPPING_SIZES.map((s) => ({ id: s.id, label: s.label, example: s.example }))}
                activeId={activeExclSize}
                onSelect={(id) => setActiveExclSize((prev) => (prev === id ? null : id))}
              />
            </div>
            {SHIPPING_SIZES.filter((s) => s.id === activeExclSize).map((group) => (
              <div key={group.id} className={styles.optionGroup}>
                {group.carriers.map((c) => (
                  <CarrierCard
                    key={c.value}
                    name={c.name}
                    detail={c.detail}
                    tracking={c.tracking}
                    price={c.price}
                    checked={excludedShipping.includes(c.value)}
                    onToggle={() => toggleExcludedShipping(c.value)}
                  />
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="KI" desc="OpenRouter-Zugang und Prompts für die KI-Anzeigenerstellung." open={openSections.has('ai')} onToggle={() => toggle('ai')}>
          <Input
            label={<>OpenRouter API-Key <InfoTip text="API-Key von openrouter.ai für alle KI-Funktionen (Anzeigentexte, Bildanalyse, KI-Nachrichten). Gilt für alle Workspaces. Wird verschlüsselt gespeichert und nie im Klartext angezeigt." /></>}
            type="password"
            value={aiApiKey}
            onChange={(e) => setAiApiKey(e.target.value)}
            onFocus={() => { if (aiApiKey === MASKED_KEY) setAiApiKey(''); }}
            placeholder="sk-or-…"
          />
          {modelsAvailable && (
            <Toggle label={<>Alle Modelle anzeigen <InfoTip text="Standardmäßig wird eine kuratierte Auswahl gängiger, günstiger Modelle gezeigt. Aktiviere dies, um die komplette OpenRouter-Liste (340 Modelle) zu durchsuchen." /></>} checked={showAllModels} onChange={setShowAllModels} />
          )}
          <div className={styles.row}>
            {modelsAvailable ? (
              <>
                <Select label={<>Text-Modell <InfoTip text="OpenRouter-Modell für Anzeigentexte. Preis = Prompt-Kosten pro 1 Mio. Tokens. Beispiel: openai/gpt-4.1-nano" /></>} options={textModelOptions} value={aiModel} onChange={(e) => setAiModel(e.target.value)} />
                <Select label={<>Vision-Modell <InfoTip text="OpenRouter-Modell für die Bildanalyse. Nur bildfähige Modelle werden gelistet. Beispiel: openai/gpt-4.1-mini" /></>} options={visionModelOptions} value={aiModelVision} onChange={(e) => setAiModelVision(e.target.value)} />
              </>
            ) : (
              <>
                <Input label={<>Text-Modell <InfoTip text="OpenRouter-Modell für Anzeigentexte. Beispiel: openai/gpt-4.1-nano" /></>} value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="openai/gpt-4.1-nano" />
                <Input label={<>Vision-Modell <InfoTip text="OpenRouter-Modell für die Bildanalyse. Beispiel: openai/gpt-4.1-mini" /></>} value={aiModelVision} onChange={(e) => setAiModelVision(e.target.value)} placeholder="openai/gpt-4.1-mini" />
              </>
            )}
          </div>
          <Textarea label={<>Prompt (Anzeigentext) <InfoTip text="System-Prompt für die KI-Anzeigenerstellung. Steuert Stil, Struktur und Format der generierten Beschreibung." /></>} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={8} />
          <Textarea label={<>Prompt (Bildanalyse) <InfoTip text="System-Prompt für die Bildanalyse. Steuert, welche Artikelinformationen die KI aus hochgeladenen Bildern extrahiert." /></>} value={aiPromptVision} onChange={(e) => setAiPromptVision(e.target.value)} rows={6} />
        </Section>

        <Section title="Browser" desc="Steuert, in welchem Modus der Browser-Bot gestartet wird." open={openSections.has('browser')} onToggle={() => toggle('browser')}>
          <Select
            label={<>Browser-Modus <InfoTip text={`Auto (empfohlen): läuft unsichtbar; bei Login-Bedarf öffnet ein Anmelde-Fenster.

Immer unsichtbar: läuft komplett im Hintergrund; bricht ab, wenn ein Login nötig ist.

Immer sichtbar: Fenster zum Mitschauen; bleibt dauerhaft offen und braucht mehr Leistung.`} /></>}
            options={[
              { value: 'auto', label: 'Auto (empfohlen)' },
              { value: 'headless', label: 'Immer unsichtbar (headless)' },
              { value: 'visible', label: 'Immer sichtbar (VNC)' },
            ]}
            value={browserMode}
            onChange={(e) => setBrowserMode(e.target.value as 'auto' | 'headless' | 'visible')}
          />
        </Section>

        <Section title="Diagnose" desc="Fehlerdiagnose-Aufnahmen bei Bot-Problemen (Screenshots, HTML, JSON)." open={openSections.has('diagnostics')} onToggle={() => toggle('diagnostics')}>
          <Toggle label={<>Login-Erkennung aufzeichnen <InfoTip text="Erstellt Screenshot und HTML, wenn die Erkennung des Login-Status fehlschlägt. Hilft beim Debuggen von Login-Problemen." /></>} checked={captureLoginDetection} onChange={setCaptureLoginDetection} />
          <Toggle label={<>Veröffentlichung aufzeichnen <InfoTip text="Erstellt Screenshot, HTML und JSON, wenn das Veröffentlichen einer Anzeige fehlschlägt. Hilft bei der Fehlersuche." /></>} checked={capturePublish} onChange={setCapturePublish} />
          <Toggle label={<>Timeout-Timing erfassen <InfoTip text="Sammelt lokale Timeout-Zeitdaten und schreibt sie in die Diagnose-JSON. Nützlich zum Troubleshooting und Feinjustieren von Timeouts." /></>} checked={timingCollection} onChange={setTimingCollection} />
          <Toggle label={<>Log-Kopie in Diagnose <InfoTip text="Kopiert beim Erstellen einer Diagnose-Aufnahme die komplette Bot-Logdatei mit hinein. Kann Log-Inhalte duplizieren, hilft aber bei der Fehlersuche." /></>} checked={captureLogCopy} onChange={setCaptureLogCopy} />
        </Section>

        <Button variant="primary" size="lg" className={styles.saveBtn} onClick={handleSave} loading={saving}>
          Einstellungen speichern
        </Button>
      </div>
    </div>
  );
}
