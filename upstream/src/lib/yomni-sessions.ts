import { makeNode, type ImportableConversation } from './import-chat';
import { autoLayout } from './layout';
import type { ThoughtEdge, ThoughtNode } from '../types';

import { readYomniHistory } from './yomni-bridge';

type Page = { title?: string; messages?: { id: string; role: string; text: string }[]; nextCursor?: string | null };
type Catalog = { conversations?: { id: string; title: string }[]; nextCursor?: string | null };

const read = (kind: 'conversations' | 'conversation', sessionId?: string, cursor?: string) =>
  readYomniHistory({ kind, sessionId, cursor });

export async function yomniConversations(): Promise<ImportableConversation[]> {
  const entries: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const value = await read('conversations', undefined, cursor) as Catalog;
    entries.push(...(value.conversations ?? []));
    if (!value.nextCursor) break;
    cursor = value.nextCursor;
  }
  return Promise.all(entries.map(async entry => {
    const messages: NonNullable<Page['messages']> = [];
    let next: string | undefined;
    for (let page = 0; page < 100; page++) {
      const value = await read('conversation', entry.id, next) as Page;
      messages.push(...(value.messages ?? []));
      if (!value.nextCursor) break;
      next = value.nextCursor;
    }
    return {
      title: entry.title, source: 'yomni' as const, sessionId: entry.id, messageCount: messages.length,
      build: () => {
        const nodes: ThoughtNode[] = [];
        const edges: ThoughtEdge[] = [];
        let pending: { id: string; text: string } | undefined;
        for (const message of messages) {
          if (message.role === 'user') pending = { id: message.id, text: message.text };
          else if (message.role === 'assistant' && pending) {
            const node = makeNode(pending.text, message.text, nodes.length === 0);
            node.data.importSource = { runner: 'yomni', sessionId: entry.id, itemIds: [pending.id, message.id] };
            const previous = nodes.at(-1);
            if (previous) edges.push({ id: `edge-${previous.id}-${node.id}`, source: previous.id, target: node.id, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', data: {} });
            nodes.push(node);
            pending = undefined;
          }
        }
        return { nodes: autoLayout(nodes, edges), edges };
      },
    } satisfies ImportableConversation;
  }));
}
