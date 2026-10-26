import type { PackageSize } from '../shared/types.js';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const bytes = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const maximum = (a?: number, b?: number) => a === undefined ? b : b === undefined ? a : Math.max(a, b);

/** Only retail x64 desktop MSIXVC packages, bound to their actual content IDs.
 * Repeated SKUs describe the same package: retain maxima, never sum them. */
export function catalogPackageSizes(value: unknown): Map<string, PackageSize> {
  const product = object(value), result = new Map<string, PackageSize>();
  if (!product || !['Game', 'GameAddOn'].includes(String(product.ProductType))) return result;
  for (const availability of list(product.DisplaySkuAvailabilities)) {
    const properties = object(object(object(availability)?.Sku)?.Properties);
    if (!properties || properties.IsTrial === true || properties.IsPreOrder === true) continue;
    for (const value of list(properties.Packages)) {
      const pkg = object(value);
      if (!pkg || pkg.PackageFormat !== 'MSIXVC' || typeof pkg.ContentId !== 'string' ||
          !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(pkg.ContentId) ||
          !list(pkg.PlatformDependencies).some(dep => object(dep)?.PlatformName === 'Windows.Desktop') ||
          (Array.isArray(pkg.Architectures) && !pkg.Architectures.includes('x64'))) continue;
      const id = pkg.ContentId.toLowerCase(), old = result.get(id);
      result.set(id, { downloadBytes: maximum(old?.downloadBytes, bytes(pkg.MaxDownloadSizeInBytes)),
        installBytes: maximum(old?.installBytes, bytes(pkg.MaxInstallSizeInBytes)) });
    }
  }
  return result;
}

export function singleCatalogPackageSize(product: unknown): PackageSize | undefined {
  const choices = catalogPackageSizes(product);
  return choices.size === 1 ? choices.values().next().value : undefined;
}
