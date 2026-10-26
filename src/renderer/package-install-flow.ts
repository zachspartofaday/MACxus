import type { InstallPlan, InstallRequest, LauncherApi } from '../shared/types';
import type { Translator } from '../shared/i18n';

/** The confirmation boundary is shared by library, Store and manual installs. */
export async function startConfirmedInstall(request: InstallRequest, api: Pick<LauncherApi, 'getInstallPlan' | 'startInstall'>,
  choose: (plan: InstallPlan) => Promise<string | undefined>, active: () => boolean, t: Translator): Promise<string | undefined> {
  const plan = await api.getInstallPlan(request.productId);
  if (!active()) return;
  if (plan.status === 'unavailable') throw Error(t("No supported Windows.Desktop MSIXVC package was found for this Store offer."));
  const selected = await choose(plan);
  if (!selected || !active()) return;
  if (!plan.choices.some(item => item.supported && item.contentId === selected)) throw Error(t("Choose a supported package from this Store offer before installing."));
  return api.startInstall({ ...request, selectedContentId: selected, selectionMarket: plan.market });
}
