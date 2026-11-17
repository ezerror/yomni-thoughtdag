// The application passes authority to this renderer instance. Never install a
// plugin API or a fetch interceptor on the shared host window.
export const inYomniHost = import.meta.env.VITE_YOMNI_HOST === '1';
export type YomniRuntime = {
  requestConversation(input: any): Promise<{ sessionId: string }>;
  pickWorkspaceDirectory(): Promise<string | null>;
  listModels(): Promise<readonly any[]>;
  action(id: string, value?: string): Promise<any>;
  snapshot(): Promise<any>;
  openSettings(page?: string): Promise<void>;
  onThemeChanged?(listener: (theme: { mode: 'light' | 'dark' }) => void): () => void;
  setTheme?(mode: 'system' | 'light' | 'dark'): Promise<void>;
};
let current: YomniRuntime | undefined;
let root: HTMLElement | undefined;
let transport: typeof fetch | undefined;
export const yomniFrontend = inYomniHost ? new Proxy({} as YomniRuntime, {
  get: (_target, key) => (...args: unknown[]) => {
    if (!current) return Promise.reject(new Error('Open ThoughtDAG again to reconnect to Yomni.'));
    return (current[key as keyof YomniRuntime] as Function).apply(current, args);
  },
}) : (window as Window & { yomniPlugin?: YomniRuntime }).yomniPlugin;
export function bindYomniRuntime(api: YomniRuntime, element: HTMLElement): () => void {
  current = api;
  root = element;
  return () => { if (current === api) { current = undefined; root = undefined; } };
}
export const appearanceRoot = () => root ?? document.documentElement;
export function installYomniTransport(value: typeof fetch) { transport = value; }
export const yomniFetch: typeof fetch = (input, init) => (transport ?? globalThis.fetch)(input, init);

let bridgeQueue: Promise<unknown> = Promise.resolve();
export function callYomniBridge(action: string, input: object): Promise<unknown> {
  const run = async () => {
    if (!yomniFrontend) throw new Error('Yomni workbench unavailable');
    const id = crypto.randomUUID();
    const snapshot = await yomniFrontend.action(action, JSON.stringify({ id, ...input }));
    const result = snapshot.view.data?.bridgeResult;
    if (result?.id !== id) throw new Error('Yomni bridge response changed');
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const pending = bridgeQueue.then(run, run);
  bridgeQueue = pending.catch(() => undefined);
  return pending;
}

// Window listeners see a ShadowRoot's host as target; preserve the actual
// control for outside-click and keyboard handling. React events already do.
export const eventTarget = (event: { target: EventTarget | null; composedPath?: () => EventTarget[] }) => event.composedPath?.()[0] ?? event.target;
