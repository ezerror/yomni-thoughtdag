declare module '*host-app/app.js' {
  export const App: import('react').ComponentType;
  export function connect(api: import('@yomni/contracts').PluginHostWorkbenchApi, root: HTMLElement, mode: 'light' | 'dark', locale: string): { ready: Promise<void>; cleanup(): void };
}
declare module '*.css' { const css: string; export default css; }
