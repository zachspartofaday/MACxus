import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { formatMinutes, GameDetailsContent, Gallery } from './GameDetails';
import { PackageSizeDialog } from './PackageSize';
import type { GameActivity, GameStoreDetails } from '../shared/types';
const game=demoSnapshot().games[0];
const details: GameStoreDetails={productId:game.storeId!,title:game.title,description:'<script>literal text</script>',publisher:'Example publisher',categories:['Strategy','Card & board'],screenshots:['https://store-images.s-microsoft.com/example'],releaseDate:'invalid'};
const render=(activity: GameActivity, data: GameStoreDetails|undefined=details)=>renderToStaticMarkup(<GameDetailsContent game={game} details={data} activity={activity} play={<button>Play</button>} manage={<button>Manage content</button>} back={()=>{}} refresh={()=>{}} />);
it.each([[undefined,'Unavailable'],[NaN,'Unavailable'],[-1,'Unavailable'],[0,'0 min'],[0.5,'&lt;1 min'],[12,'12 min'],[60,'1 h'],[2052,'34 h 12 min']] as const)('formats remote minutes %s as %s', (minutes,expected)=>{
  expect(renderToStaticMarkup(<span>{formatMinutes(minutes)}</span>)).toContain(expected);
});
it('renders real metadata as escaped text and gallery thumbnails, never executable HTML',()=>{
  const html=render({status:'available',minutesPlayed:2052,lastPlayed:'2026-01-01T12:00:00Z'});
  expect(html).toContain('34 h 12 min'); expect(html).toContain('From Xbox'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;literal text&lt;/script&gt;');
  expect(html).toContain('Card &amp; board'); expect(html).toContain('Open screenshot 1'); expect(html).not.toContain('Invalid Date'); expect(html).toContain('data-gamepad-detail-back');
  expect(html).toContain('data-gamepad-action-row'); expect(html).not.toContain('data-game-menu');
});
it.each(['unavailable','unsupported','signed-out','error'] as const)('never displays a fabricated zero for %s',status=>{
  const html=render({status},undefined); expect(html).toContain('Unavailable'); expect(html).not.toContain('>0 min<'); expect(html).not.toContain('Sample data');
});
it('shows a not-installed game with its own status and action, without a Manage menu',()=>{
  const html=renderToStaticMarkup(<GameDetailsContent game={game} details={details} activity={{status:'unavailable'}} status={<span className="gd-ready not-installed">Not installed</span>} play={<button>Install</button>} back={()=>{}} refresh={()=>{}} />);
  expect(html).toContain('gd-ready not-installed'); expect(html).not.toContain('>Installed<');
  expect(html).toContain('>Install</button>'); expect(html).not.toContain('More game actions'); expect(html).toContain('About the game');
});

it('places public size estimates in stat segments after activity, outside the Install controls', () => {
  const html = renderToStaticMarkup(<GameDetailsContent game={game} details={{ ...details, size: { downloadBytes: 1024 ** 3, installBytes: 2 * 1024 ** 3 } }} installPreview play={<button>Install</button>} back={() => {}} refresh={() => {}} />);
  expect(html).toContain('About 1.0 GiB'); expect(html).toContain('About 2.0 GiB');
  expect(html.indexOf('Download size')).toBeGreaterThan(html.indexOf('Last played'));
  expect(html.match(/class="gd-stat gd-size-stat"/g)).toHaveLength(2);
  expect(html).toContain('<div class="button-row gd-play-controls"><button>Install</button></div>');
  expect(render({ status: 'unavailable' })).toContain('Download size');
});

it('shows the same published size segments beside Play for installed games', () => {
  const html = render({ status: 'unavailable' }, { ...details, size: { downloadBytes: 3 * 1024 ** 3, installBytes: 4 * 1024 ** 3 } });
  expect(html).toContain('>Play</button>');
  expect(html).toContain('Download size'); expect(html).toContain('About 3.0 GiB');
  expect(html).toContain('Installed size'); expect(html).toContain('About 4.0 GiB');
  expect(html.indexOf('Download size')).toBeGreaterThan(html.indexOf('Last played'));
});

it('prefers measured installation bytes over Store estimates, independently of catalog failures', () => {
  const html = renderToStaticMarkup(<GameDetailsContent game={game} details={{ ...details, size: { installBytes: 2 * 1024 ** 3 } }} installedBytes={3 * 1024 ** 3} metadataError play={<button>Play</button>} back={() => {}} refresh={() => {}} />);
  expect(html).toContain('>3.0 GiB</strong>'); expect(html).not.toContain('About 2.0 GiB');
  expect(html).toContain('Measured from files in the game folder.'); expect(html).toContain('>Play</button>');
  const offline = renderToStaticMarkup(<GameDetailsContent game={game} installedBytes={0} metadataError play={<button>Play</button>} back={() => {}} refresh={() => {}} />);
  expect(offline).toContain('>0 B</strong>');
});

it('keeps the size dialog informational, including honest missing-data text', () => {
  const html = renderToStaticMarkup(<PackageSizeDialog title="A game" value={{ downloadBytes: 1024 ** 3 }} close={() => {}} />);
  expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
  expect(html).toContain('Download size'); expect(html).toContain('About 1.0 GiB');
  expect(html).toContain('Installed size'); expect(html).toContain('Not reported');
  expect(html).toContain('Microsoft Store estimates.'); expect(html).not.toContain('>Install</button>');
});

it('shows separate bundle package estimates while browsing instead of inventing one combined size', () => {
  const choices = [1, 2].map(n => ({ productId: `9AAAAAAAAAA${n}`, contentId: String(n), title: `Edition ${n}`, platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true, size: { downloadBytes: n * 1024 ** 3 } }));
  const html = renderToStaticMarkup(<GameDetailsContent game={game} installPreview installPlan={{ schema: 1, rootProductId: '9AAAAAAAAAAA', market: 'US', status: 'choice', choices }} play={<button>Install</button>} back={() => {}} refresh={() => {}} />);
  expect(html).toContain('Package sizes'); expect(html).toContain('Edition 1'); expect(html).toContain('Edition 2');
  expect(html).toContain('About 1.0 GiB'); expect(html).toContain('About 2.0 GiB'); expect(html).not.toContain('3.0 GiB');
});
it('does not present missing screenshots or failed metadata as an installation blocker',()=>{
  const html=render({status:'unavailable'},{...details,screenshots:[],description:''});
  expect(html).toContain('No screenshots available'); expect(html).toContain('>Play</button>'); expect(html).not.toContain('Open screenshot');
});
it('uses the shared secondary close button and advertises scoped gallery controller shortcuts',()=>{
  const html=renderToStaticMarkup(<Gallery title="Example" images={details.screenshots} initial={0} close={()=>{}} />);
  expect(html).toContain('class="secondary gd-gallery-close"');
  expect(html).toContain('data-gamepad-cancel'); expect(html).toContain('data-gamepad-gallery=""');
  expect(html).toContain('data-gamepad-gallery-previous'); expect(html).toContain('data-gamepad-gallery-next');
  for (const key of ['B','L1','R1']) expect(html).toContain(`aria-hidden="true">${key}</span>`);
  expect(html).toContain('aria-live="polite"'); expect(html).not.toContain('icon-button');
});
