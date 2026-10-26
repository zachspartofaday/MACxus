import { expect, it, vi } from 'vitest';
import { catalogPackageSizes, singleCatalogPackageSize } from './catalog-sizes';
import { CatalogService, parseCatalogProducts } from './catalog';
import type { InstallPlan } from '../shared/types';

const id = '9AAAAAAAAAAA', cid = '11111111-1111-4111-8111-111111111111';
const pkg = (patch = {}) => ({ ContentId: cid, PackageFormat: 'MSIXVC', Architectures: ['x64'], PlatformDependencies: [{ PlatformName: 'Windows.Desktop' }], MaxDownloadSizeInBytes: 1024 ** 3, MaxInstallSizeInBytes: 2 * 1024 ** 3, ...patch });
const product = (packages = [pkg()], properties = {}) => ({ ProductId: id, ProductType: 'Game', LocalizedProperties: [{ ProductTitle: 'A game' }], DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: packages, ...properties } } }] });
const plan = (): InstallPlan => ({ schema: 1, rootProductId: id, market: 'CA', status: 'ready', choices: [{ productId: id, contentId: cid, title: 'A game', platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true }] });

it('reports only the PC retail package and deduplicates repeated SKUs without summing them', () => {
  const value = product([pkg(), pkg({ MaxDownloadSizeInBytes: 1024 ** 3 + 100 }), pkg({ PackageFormat: 'XVC', MaxDownloadSizeInBytes: 100e9 }), pkg({ PlatformDependencies: [{ PlatformName: 'Windows.Xbox' }], MaxDownloadSizeInBytes: 100e9 }), pkg({ Architectures: ['arm64'], MaxDownloadSizeInBytes: 100e9 })]);
  expect(singleCatalogPackageSize(value)).toEqual({ downloadBytes: 1024 ** 3 + 100, installBytes: 2 * 1024 ** 3 });
  expect(catalogPackageSizes(product([pkg()], { IsTrial: true })).size).toBe(0);
  expect(catalogPackageSizes(product([pkg()], { IsPreOrder: true })).size).toBe(0);
});

it.each([0, -1, NaN, Infinity, '100', 1.5, Number.MAX_SAFE_INTEGER + 1, null])('does not turn invalid or unreported bytes %s into a zero estimate', value => {
  expect(singleCatalogPackageSize(product([pkg({ MaxDownloadSizeInBytes: value, MaxInstallSizeInBytes: value })]))).toEqual({ downloadBytes: undefined, installBytes: undefined });
});

it('never invents one size for multiple content packages', () => {
  expect(singleCatalogPackageSize(product([pkg(), pkg({ ContentId: '22222222-2222-4222-8222-222222222222' })]))).toBeUndefined();
  expect(catalogPackageSizes(product([pkg({ ContentId: 'invalid' })])).size).toBe(0);
});

it('makes the estimate available on library cards and game details before an install starts', async () => {
  const catalog = { Products: [product()] };
  expect(parseCatalogProducts({ productsList: [{ productId: id, title: 'A game' }] }, catalog)[0].size).toEqual({ downloadBytes: 1024 ** 3, installBytes: 2 * 1024 ** 3 });
  const service = new CatalogService(vi.fn(async () => new Response(JSON.stringify(catalog))) as typeof fetch);
  expect((await service.gameDetails(id, 'CA'))?.size).toEqual({ downloadBytes: 1024 ** 3, installBytes: 2 * 1024 ** 3 });
});

it('binds optional estimates to the exact backend-selected product and content ID in the current market', async () => {
  const fetcher = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://displaycatalog.mp.microsoft.com');
    expect(url.searchParams.get('bigIds')).toBe(id);
    expect(url.searchParams.get('market')).toBe('CA');
    return new Response(JSON.stringify({ Products: [product()] }));
  });
  const service = new CatalogService(fetcher as typeof fetch);
  const original = plan();
  expect((await service.installPlanSizes(original)).choices[0].size?.downloadBytes).toBe(1024 ** 3);
  expect(original.choices[0].size).toBeUndefined();
  original.choices[0].contentId = '22222222-2222-4222-8222-222222222222';
  expect((await service.installPlanSizes(original)).choices[0].size).toBeUndefined();
});

it('leaves metadata unknown on request failure without changing package selection or trusting backend size fields', async () => {
  const service = new CatalogService(vi.fn(async () => { throw Error('offline'); }) as typeof fetch);
  const original = plan(); original.choices[0].size = { downloadBytes: 1 };
  expect(await service.installPlanSizes(original)).toEqual({ ...original, choices: [{ ...original.choices[0], size: undefined }] });
});
