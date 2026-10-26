import { expect, it, vi } from 'vitest';
import { activateCardOptions } from './gamepad-navigation';

// The options action needs only ancestor/selector lookup, scope containment and
// the normal visibility/enabled guard; it does not depend on card geometry.
function cardFixture() {
  const info = { click: vi.fn() } as unknown as HTMLElement;
  const install = { click: vi.fn() } as unknown as HTMLElement;
  const menu = { click: vi.fn() } as unknown as HTMLElement;
  const card = { querySelector: (selector: string) => selector === '[data-gamepad-card-options]' ? info : install };
  const wrapper = { querySelector: () => menu };
  let installed = false;
  const origin = { closest: (selector: string) => selector === '.library-card-wrap' ? installed ? wrapper : null : selector === '[data-gamepad-card]' ? card : null } as unknown as HTMLElement;
  const scope = { contains: (element: HTMLElement) => [info, install, menu].includes(element) } as unknown as Document;
  return { origin, scope, info, install, menu, installed: () => { installed = true; } };
}

it('X opens only the highlighted product card size dialog without starting an install or using spatial navigation', () => {
  const selected = cardFixture(), neighbor = cardFixture();
  activateCardOptions(selected.origin, selected.scope, () => true);
  expect(selected.info.click).toHaveBeenCalledOnce();
  expect(selected.install.click).not.toHaveBeenCalled();
  expect(selected.menu.click).not.toHaveBeenCalled();
  expect(neighbor.info.click).not.toHaveBeenCalled();
});

it('preserves the installed-game options menu as the primary X action', () => {
  const f = cardFixture(); f.installed();
  activateCardOptions(f.origin, f.scope, () => true);
  expect(f.menu.click).toHaveBeenCalledOnce();
  expect(f.info.click).not.toHaveBeenCalled();
  expect(f.install.click).not.toHaveBeenCalled();
});

it('does not open a size dialog behind a modal or activate a hidden/disabled control', () => {
  const f = cardFixture();
  activateCardOptions(f.origin, { contains: () => false } as unknown as HTMLElement, () => true);
  activateCardOptions(f.origin, f.scope, () => false);
  activateCardOptions(undefined, f.scope, () => true);
  expect(f.info.click).not.toHaveBeenCalled();
  expect(f.install.click).not.toHaveBeenCalled();
  expect(f.menu.click).not.toHaveBeenCalled();
});
