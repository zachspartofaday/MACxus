import type { PackageSize as Size } from '../shared/types';
import { useI18n } from './i18n';

export function formatPackageBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
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
