import App from './App';
import { bootProjects } from './store/projects';
import { useAppearance } from './lib/appearance';
import { bindYomniRuntime, type YomniRuntime } from './lib/yomni-runtime';
import './lib/yomni-bridge';
import { useI18n } from './i18n';

let booted: Promise<void> | undefined;
export { App };
export function connect(api: YomniRuntime, root: HTMLElement, mode: 'light' | 'dark', locale: string) {
  const cleanup = bindYomniRuntime(api, root);
  root.dataset.theme = mode;
  root.dataset.paper = useAppearance.getState().paper;
  root.lang = locale;
  useI18n.setState({ lang: locale.startsWith('zh') ? 'zh' : 'en' });
  useAppearance.setState({ lighting: mode, resolved: mode });
  booted ??= bootProjects();
  return { ready: booted, cleanup };
}
