import { useI18n } from './i18n';
import { useState } from 'react';
import { ArrowDownToLine, Check, CircleAlert, Cpu, LoaderCircle, RefreshCw } from 'lucide-react';
import type { MacEngine, MacEngineStatus } from '../shared/types';

const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** macOS: choose the Wine engine (CrossOver or the experimental Highball engine) and install Highball. */
export function MacEngineCard({ engine, status }: { engine?: MacEngine; status?: MacEngineStatus }) {
  const { t, localize } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const current = engine ?? 'crossover';

  async function choose(next: MacEngine) {
    if (next === current) return;
    setBusy('choose'); setError(undefined);
    try { await window.launcher.updateSettings({ macEngine: next }); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(undefined); }
  }

  async function install() {
    setBusy('install'); setError(undefined);
    try { await window.launcher.installHighballEngine(); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(undefined); }
  }

  async function refresh() {
    setBusy('refresh'); setError(undefined);
    try { await window.launcher.refreshMacEngines(); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(undefined); }
  }

  const installing = Boolean(status?.installing);
  const percent = status?.totalBytes ? Math.min(100, Math.round(((status.downloadedBytes ?? 0) / status.totalBytes) * 100)) : 0;
  const shownError = error ?? status?.error;

  return <section className="settings-card">
    <div className="settings-heading"><div className="settings-icon"><Cpu /></div><div><h2>{t("Wine engine")}</h2><p>{t("Choose which Wine engine launches your games. CrossOver is the default.")}</p></div></div>
    <div className="toggle-row" role="radiogroup" aria-label={t("Wine engine")}>
      <label className="toggle"><input type="radio" name="mac-engine" value="crossover" checked={current === 'crossover'} disabled={Boolean(busy)} onChange={() => void choose('crossover')} /><span>CrossOver</span></label>
      <label className="toggle"><input type="radio" name="mac-engine" value="crossover-preview" checked={current === 'crossover-preview'} disabled={Boolean(busy) || status?.crossoverPreviewInstalled !== true} onChange={() => void choose('crossover-preview')} /><span>CrossOver Preview (Rosetta)</span></label>
      <label className="toggle"><input type="radio" name="mac-engine" value="crossover-preview-fex" checked={current === 'crossover-preview-fex'} disabled={Boolean(busy) || status?.crossoverPreviewFexSupported !== true} onChange={() => void choose('crossover-preview-fex')} /><span>CrossOver Preview (FEX/ARM)</span></label>
      <label className="toggle"><input type="radio" name="mac-engine" value="highball" checked={current === 'highball'} disabled={Boolean(busy)} onChange={() => void choose('highball')} /><span>{t("Highball (experimental)")}</span></label>
      <p>{t("Highball is built from CrossOver’s Wine sources with additional fixes (highball-engine, LGPL-2.1). It uses a separate bottle and CrossOver’s D3DMetal, so CrossOver must remain installed. Some games (for example Forza Horizon 6) have a profile that automatically uses Highball when installed.")}</p>
    </div>
    <p className="fine-print">{status?.crossoverPreviewInstalled ? t("CrossOver Preview detected ({value0}). Uses a separate bottle from regular CrossOver.", { value0: status.crossoverPreviewVersion || t("Unknown version") }) : t("CrossOver Preview was not detected in Applications. Install it, then refresh engine detection.")}</p>
    {status?.crossoverPreviewFexSupported ? <p className="fine-print">{t("FEX/ARM Preview detected ({value0}). Uses its own ARM64 bottle. Game compatibility may differ from Rosetta.", { value0: status.crossoverPreviewFexVersion || t("Unknown version") })}</p> : null}
    {current === 'crossover-preview' || current === 'crossover-preview-fex' ? <p className="fine-print">{t("Preview selection overrides automatic engine recommendations. Per-game environment fixes still apply.")}</p> : null}
    <div className="button-row"><button className="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>{busy === 'refresh' ? <LoaderCircle className="spin" /> : <RefreshCw />}{t("Refresh engine detection")}</button></div>
    {status?.highballInstalled
      ? <p className="fine-print"><Check /> {' '}{t("Highball engine installed ({value0}).", { value0: status.highballTag })}</p>
      : <p className="fine-print">{t("Highball engine is not installed (approximately 335 MB download from GitHub, verified with SHA-256).")}</p>}
    {current === 'highball' && status && !status.highballInstalled ? <div className="alert amber"><CircleAlert /><span>{t("Highball is selected but is not installed. Install it below before launching a game.")}</span></div> : null}
    {installing ? <><p className="runtime-phase">{localize(status?.phase) || t("Installing the Highball engine…")}{status?.totalBytes ? t(" {value0} of {value1}", { value0: mb(status.downloadedBytes ?? 0), value1: mb(status.totalBytes) }) : ''}</p><div className="progress-track"><i style={{ width: `${percent}%` }} /></div></> : null}
    {!installing && status?.phase && !shownError ? <p className="runtime-phase">{localize(status.phase)}</p> : null}
    {shownError ? <div className="alert amber" role="alert"><CircleAlert /><span>{localize(shownError)}</span></div> : null}
    {!status?.highballInstalled ? <div className="button-row end"><button className="primary" disabled={Boolean(busy) || installing} onClick={() => void install()}>{busy === 'install' || installing ? <LoaderCircle className="spin" /> : <ArrowDownToLine />}{t("Install Highball engine")}</button></div> : null}
  </section>;
}
