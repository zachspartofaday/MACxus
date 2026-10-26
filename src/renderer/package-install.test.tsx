import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InstallPlan } from '../shared/types';
import { PackageDialog } from './PackageInstall';

it('shows verified package names, IDs, platform and disabled unsupported choices without auto-selection', () => {
  const plan: InstallPlan = { schema: 1, rootProductId: '9AAAAAAAAAAA', market: 'US', status: 'choice', choices: [
    { productId: '9BBBBBBBBBBB', contentId: '11111111-1111-4111-8111-111111111111', title: 'PC base game', platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true },
    { productId: '9CCCCCCCCCCC', contentId: '22222222-2222-4222-8222-222222222222', title: '<Console game>', platform: 'Xbox.One', packageFormat: 'XVC', kind: 'Game', supported: false },
  ] };
  const html = renderToStaticMarkup(<PackageDialog plan={plan} choose={() => {}} />);
  expect(html).toContain('PC base game'); expect(html).toContain('Windows.Desktop'); expect(html).toContain('9BBBBBBBBBBB');
  expect(html).toContain('&lt;Console game&gt;'); expect(html).toContain('Unsupported');
  expect(html.match(/disabled=""/g)).toHaveLength(2); expect(html).not.toContain('checked=""');
  expect(html).toContain('Cancel'); expect(html).toContain('checks your license');
});

it('shows a ready package and its estimates before enabling explicit installation confirmation', () => {
  const plan: InstallPlan = { schema: 1, rootProductId: '9AAAAAAAAAAA', market: 'US', status: 'ready', choices: [
    { productId: '9AAAAAAAAAAA', contentId: '11111111-1111-4111-8111-111111111111', title: 'PC game', platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true, size: { downloadBytes: 1024 ** 3 } },
  ] };
  const html = renderToStaticMarkup(<PackageDialog plan={plan} choose={() => {}} />);
  expect(html).toContain('checked=""'); expect(html).not.toContain('disabled=""');
  expect(html).toContain('Download size'); expect(html).toContain('About 1.0 GiB');
  expect(html).toContain('Installed size'); expect(html).toContain('Not reported');
  expect(html).not.toContain('0.0 GiB'); expect(html).toContain('Microsoft Store estimates');
});
