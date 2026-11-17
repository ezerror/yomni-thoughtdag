// Adapt the existing ThoughtDAG SPA's proxy protocol to Yomni's native
// conversation workbench. This module only installs inside a Yomni frontend.
import { useProjects } from '../store/projects';
import { getModelsOnce } from './use-models';
import { yomniFrontend, installYomniTransport, callYomniBridge } from './yomni-runtime';
import { useI18n } from '../i18n';
type BridgeResult = { id: string; value?: unknown; error?: string };
type YomniFrontend = {
  requestConversation(input: { workspaceKey: string; canvasId?: string; content: string; contextInput?: string; references: []; hidden?: boolean; modelId?: string; reasoningEffort?: string; workspacePath?: string; workspaceGuard?: 'ask' | 'allow' }): Promise<{ sessionId: string }>;
  pickWorkspaceDirectory(): Promise<string | null>;
  listModels(): Promise<readonly { id: string; name: string; provider: string; vision: boolean; efforts: readonly string[]; defaultEffort: string; agentRuntime?: string }[]>;
  action(id: string, value?: string): Promise<{ view: { data?: { bridgeResult?: BridgeResult } } }>;
  snapshot(): Promise<{ conversation?: { sessionId: string; live?: { text: string; thinking: string }; run?: { status: string }; messages: { role: string; text: string }[] } }>;
};

const frontend = yomniFrontend as YomniFrontend | undefined;
export { yomniFrontend };

export function readYomniHistory(input: { kind: 'conversations' | 'conversation'; sessionId?: string; cursor?: string }): Promise<unknown> {
  return callYomniBridge('bridge.history', input);
}

if (frontend) {
  const originalFetch = window.fetch.bind(window);
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const failureMessage = (cause: unknown) => {
    console.warn('[ThoughtDAG] Native conversation request failed', cause);
    return useI18n.getState().lang === 'zh'
      ? '生成未能完成。请检查原生会话和模型设置，确认结果后重试。'
      : 'Generation could not finish. Check the native conversation and model settings before retrying.';
  };
  const history = async (sessionId: string): Promise<{ messages?: { role: string; text: string }[]; run?: { status: string } }> =>
    await readYomniHistory({ kind: 'conversation', sessionId }) as { messages?: { role: string; text: string }[]; run?: { status: string } };
  const questionOf = (body: unknown): string => {
    const messages = (body as { messages?: { role: string; content: string }[] })?.messages;
    return [...(messages ?? [])].reverse().find(item => item.role === 'user')?.content?.trim() ?? '';
  };
  const contextOf = (body: unknown): string => {
    const messages = (body as { messages?: { role: string; content: string }[] })?.messages ?? [];
    const content = questionOf(body);
    let latestUser = -1;
    messages.forEach((item, index) => { if (item.role === 'user') latestUser = index; });
    const previous = messages.filter((item, index) => index !== latestUser && typeof item.content === 'string');
    return previous.length ? `${content}\n\n[ThoughtDAG context]\n${previous.map(item => `<${item.role}>\n${item.content}\n</${item.role}>`).join('\n\n')}` : content;
  };
  const modelOf = (body: unknown): string | undefined => {
    const id = (body as { model?: unknown })?.model;
    // Existing canvases may retain the pre-rename native placeholder.
    return typeof id === 'string' && id !== 'yomni/native' ? id : undefined;
  };
  const effortOf = (body: unknown): string | undefined => {
    const effort = (body as { reasoningEffort?: unknown })?.reasoningEffort;
    return typeof effort === 'string' && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'].includes(effort) ? effort : undefined;
  };
  const workspaceOf = (): { workspacePath?: string } => {
    const state = useProjects.getState();
    const project = state.projects.find(item => item.id === state.activeId);
    return {
      ...(project?.agentCwd ? { workspacePath: project.agentCwd } : {}),
    };
  };
  const nativeInput = async (body: unknown) => {
    const question = questionOf(body);
    const context = contextOf(body);
    const requested = modelOf(body);
    const models = await getModelsOnce();
    const selected = requested ?? models?.default;
    const agent = models?.models.find(item => item.id === selected)?.agentRuntime;
    return {
      workspaceKey: 'thoughtdag',
      ...(useProjects.getState().activeId ? { canvasId: useProjects.getState().activeId! } : {}),
      content: agent ? context : question,
      ...(!agent ? { contextInput: context } : {}),
      references: [] as [], hidden: true,
      ...(requested ? { modelId: requested } : {}),
      ...(effortOf(body) ? { reasoningEffort: effortOf(body) } : {}),
      ...workspaceOf(),
      ...(agent ? { workspaceGuard: requested && useProjects.getState().projects.find(item => item.id === useProjects.getState().activeId)?.agentGuard?.mode === 'allow' ? 'allow' as const : 'ask' as const } : {}),
    };
  };
  const answer = async (body: unknown, signal?: AbortSignal): Promise<{ text: string; sessionId: string }> => {
    const content = questionOf(body);
    if (!content) throw new Error('A question is required');
    const receipt = await frontend.requestConversation(await nativeInput(body));
    for (let attempt = 0; attempt < 240; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const transcript = await history(receipt.sessionId);
      const status = transcript.run?.status;
      const text = (transcript.messages ?? []).filter(item => item.role === 'assistant').at(-1)?.text ?? '';
      if (status === 'completed' || (!status && text)) return { text, sessionId: receipt.sessionId };
      if (status === 'failed' || status === 'cancelled') throw new Error(`Native run ${status}`);
      await sleep(500);
    }
    throw new Error('Native run is still active; open its conversation to inspect the result');
  };
  const streamAnswer = (body: unknown, signal?: AbortSignal): Response => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        try {
          const content = questionOf(body);
          if (!content) throw new Error('A question is required');
          const receipt = await frontend.requestConversation(await nativeInput(body));
          let emitted = '';
          let reasoning = '';
          send({ harnessSession: receipt.sessionId });
          for (let attempt = 0; attempt < 600; attempt++) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const snapshot = await frontend.snapshot();
            const current = snapshot.conversation?.sessionId === receipt.sessionId ? snapshot.conversation : undefined;
            if (current) {
              const liveText = current.live?.text ?? '';
              if (liveText.startsWith(emitted) && liveText.length > emitted.length) {
                send({ text: liveText.slice(emitted.length) });
                emitted = liveText;
              }
              const liveThinking = current.live?.thinking ?? '';
              if (liveThinking.startsWith(reasoning) && liveThinking.length > reasoning.length) {
                send({ reasoning: liveThinking.slice(reasoning.length) });
                reasoning = liveThinking;
              }
              if (current.run?.status === 'failed' || current.run?.status === 'cancelled') throw new Error(`Native run ${current.run.status}`);
              if (current.run?.status === 'completed') {
                const final = current.messages.filter(item => item.role === 'assistant').at(-1)?.text ?? '';
                if (final.startsWith(emitted) && final.length > emitted.length) send({ text: final.slice(emitted.length) });
                else if (!emitted && final) send({ text: final });
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }
            }
            await sleep(200);
          }
          throw new Error('Native run is still active; open its conversation to inspect the result');
        } catch (cause) {
          if (!signal?.aborted) send({ error: failureMessage(cause) });
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  installYomniTransport(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (url.pathname === '/api/models') {
      const models = await frontend.listModels();
      return json({ models, default: models[0]?.id ?? null, capabilities: { webSearch: false, searchEngine: 'none', scholarSearch: false, vision: false } });
    }
    if (url.pathname !== '/api/stream' && url.pathname !== '/api/claude') return originalFetch(input, init);
    try {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.pathname === '/api/stream') return streamAnswer(body, init?.signal ?? undefined);
      const result = await answer(body, init?.signal ?? undefined);
      return json({ text: result.text, model: 'yomni/native' });
    } catch (cause) {
      return json({ error: failureMessage(cause) }, 500);
    }
  });
}
