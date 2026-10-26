import { expect, it, vi } from 'vitest';
import { startConfirmedInstall } from './package-install-flow';
import { translate } from '../shared/i18n';
import type { InstallPlan } from '../shared/types';

const cid = '11111111-1111-4111-8111-111111111111';
const request = { productId: '9AAAAAAAAAAA', title: 'A game', destination: '/unused/game' };
const plan = (status: InstallPlan['status'] = 'ready'): InstallPlan => ({ schema: 1, rootProductId: request.productId, market: 'CA', status, choices: [{ productId: request.productId, contentId: cid, title: request.title, platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true, size: { downloadBytes: 1000 } }] });
const t = translate.bind(null, 'en');

it.each(['ready', 'choice'] as const)('does not start a %s download until the size confirmation is accepted', async status => {
  const result = plan(status);
  const api = { getInstallPlan: vi.fn(async () => result), startInstall: vi.fn(async () => 'queued') };
  let accept!: (id?: string) => void;
  const choose = vi.fn(() => new Promise<string | undefined>(resolve => { accept = resolve; }));
  const operation = startConfirmedInstall(request, api, choose, () => true, t);
  await vi.waitFor(() => expect(choose).toHaveBeenCalledWith(result));
  expect(api.startInstall).not.toHaveBeenCalled();
  accept(cid);
  await expect(operation).resolves.toBe('queued');
  expect(api.startInstall).toHaveBeenCalledWith({ ...request, selectedContentId: cid, selectionMarket: 'CA' });
});

it('cancellation, unmounted UI and unsupported choices cannot start a download', async () => {
  const api = { getInstallPlan: vi.fn(async () => plan()), startInstall: vi.fn(async () => 'queued') };
  await startConfirmedInstall(request, api, async () => undefined, () => true, t);
  await startConfirmedInstall(request, api, async () => cid, () => false, t);
  await expect(startConfirmedInstall(request, api, async () => 'foreign', () => true, t)).rejects.toThrow('supported package');
  expect(api.startInstall).not.toHaveBeenCalled();
});

it('unavailable offers fail before opening the confirmation', async () => {
  const api = { getInstallPlan: vi.fn(async () => plan('unavailable')), startInstall: vi.fn(async () => 'queued') };
  const choose = vi.fn(async () => cid);
  await expect(startConfirmedInstall(request, api, choose, () => true, t)).rejects.toThrow('No supported');
  expect(choose).not.toHaveBeenCalled(); expect(api.startInstall).not.toHaveBeenCalled();
});
