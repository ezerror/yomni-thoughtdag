import type { PluginModule } from "@yomni/plugin-sdk";

type HistoryRequest = { id: string; kind: "conversations" | "conversation"; sessionId?: string; cursor?: string };
type BridgeResult = { id: string; value?: unknown; error?: string };

export const activate: PluginModule["activate"] = async (host) => {
  const results = new Map<string, BridgeResult>();
  return {
    ui: [{
      id: "yomni.thoughtdag.workbench",
      slot: "yomni.ui.workbench",
      frontend: "workbench",
      workbench: { title: "ThoughtDAG", icon: "waypoints", order: -105, locales: { "zh-CN": { title: "思维画布" } } },
      conversationView: { title: "ThoughtDAG", placement: "workbench", nativeRequests: true, canvasOnly: true, locales: { "zh-CN": { title: "思维画布" } } },
      requiredPermissions: ["yomni.history.read", "yomni.storage.read", "yomni.storage.write", "yomni.models.generate"],
      actions: ["bridge.history"],
      async render(_request, context) {
        return { title: "ThoughtDAG", conversationView: { workspaceKey: "thoughtdag", hasContent: true }, data: { bridgeResult: context.projectId ? results.get(context.projectId) : undefined }, children: [] };
      },
      async act(action, context) {
        if (action.id !== "bridge.history" || !context.projectId || !host.services?.history) throw new Error("ThoughtDAG history unavailable");
        const input = JSON.parse(action.value ?? "{}") as HistoryRequest;
        if (typeof input.id !== "string" || input.id.length > 100 || !["conversations", "conversation"].includes(input.kind)) throw new Error("Invalid history request");
        if (input.kind === "conversation" && (typeof input.sessionId !== "string" || !input.sessionId || input.sessionId.length > 200)) throw new Error("Invalid conversation identity");
        try {
          const value = input.kind === "conversations"
            ? { conversations: await host.services.history.call("list", {}, { projectId: context.projectId, signal: context.signal }), nextCursor: null }
            : await host.services.history.call("snapshot", { sessionId: input.sessionId }, { projectId: context.projectId, signal: context.signal });
          results.set(context.projectId, { id: input.id, value });
        } catch (cause) {
          results.set(context.projectId, { id: input.id, error: cause instanceof Error ? cause.message : String(cause) });
        }
      },
    }],
  };
};
