import type { PackageSize as Size } from '../shared/types';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useI18n } from './i18n';

export function formatPackageBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function PackageSizeDialog({ title, value, close }: { title: string; value?: Size; close: () => void }) {
  const { t } = useI18n();
  const heading = useId();
  const button = useRef<HTMLButtonElement>(null), onClose = useRef(close); onClose.current = close;
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    button.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose.current(); }
      if (event.key === 'Tab') { event.preventDefault(); button.current?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="game-dialog package-size-dialog" role="dialog" aria-modal="true" aria-labelledby={heading}>
      <h2 id={heading}>{t("Download and installed size")}</h2><p>{title}</p>
      <PackageSize value={value} />
      <p className="fine-print">{t("Microsoft Store estimates. Actual sizes can change with updates and selected content.")}</p>
      <div className="dialog-actions"><button ref={button} className="secondary" data-gamepad-cancel onClick={close}>{t("Close")}</button></div>
    </section>
  </div>;
}

export function PackageSizeInfo({ title, value }: { title: string; value?: Size }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="package-size-info" aria-label={t("Download and installed size for {value0}", { value0: title })} title={t("Download and installed size")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Info aria-hidden="true" /></button>
    {open ? createPortal(<PackageSizeDialog title={title} value={value} close={() => setOpen(false)} />, document.body) : null}
  </>;
}

export function PackageSize({ value, loading = false, compact = false, stats = false }: { value?: Size; loading?: boolean; compact?: boolean; stats?: boolean }) {
  const { t } = useI18n();
  const estimate = (bytes?: number) => typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0
    ? t("About {value0}", { value0: formatPackageBytes(bytes) }) : loading ? t("Loading…") : t("Not reported");
  if (stats) return <>{([['downloadBytes', 'Download size'], ['installBytes', 'Installed size']] as const).map(([field, label]) =>
    <div className="gd-stat gd-size-stat" key={field} aria-live="polite"><div><span>{t(label)}</span><strong>{estimate(value?.[field])}</strong></div></div>)}</>;
  return <span className={compact ? 'package-size compact' : 'package-size'} aria-live={compact ? undefined : 'polite'}>
    <span>{t("Download size")}: <strong>{estimate(value?.downloadBytes)}</strong></span>
    {!compact || value?.installBytes ? <span>{t("Installed size")}: <strong>{estimate(value?.installBytes)}</strong></span> : null}
  </span>;
}
