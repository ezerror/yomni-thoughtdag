import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { activate } = require("../dist/index.cjs");

test("ThoughtDAG uses Yomni's project-scoped history service", async () => {
  const calls = [];
  const host = {
    signal: new AbortController().signal,
    services: { history: { call: async (method, input, scope) => {
      calls.push({ method, input, projectId: scope.projectId });
      if (method === "list") return [{ id: "session", title: "Example" }];
      return { sessionId: input.sessionId, messages: [{ id: "answer", role: "assistant", text: "Done" }], run: { status: "completed" } };
    } } },
  };
  const module = await activate(host);
  const ui = module.ui[0];
  const context = { projectId: "project", signal: new AbortController().signal };
  assert.equal(ui.slot, "pal.ui.workbench");
  assert.equal((await ui.render({}, context)).conversationView.workspaceKey, "thoughtdag");
  await ui.act({ id: "bridge.history", value: JSON.stringify({ id: "list", kind: "conversations" }) }, context);
  assert.deepEqual((await ui.render({}, context)).data.bridgeResult.value.conversations, [{ id: "session", title: "Example" }]);
  await ui.act({ id: "bridge.history", value: JSON.stringify({ id: "detail", kind: "conversation", sessionId: "session" }) }, context);
  assert.equal((await ui.render({}, context)).data.bridgeResult.value.messages[0].text, "Done");
  assert.deepEqual(calls, [
    { method: "list", input: {}, projectId: "project" },
    { method: "snapshot", input: { sessionId: "session" }, projectId: "project" },
  ]);
  assert.equal((await ui.render({}, { ...context, projectId: "another" })).data.bridgeResult, undefined);
});
