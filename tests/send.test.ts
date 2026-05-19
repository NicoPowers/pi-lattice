import { describe, it, expect } from "bun:test";
import { sendToAgent } from "../extensions/multi-agent/send.js";
import type { Agent } from "../extensions/multi-agent/state.js";

function makeAgent(overrides: Partial<Agent> = {}) {
  const writes: string[] = [];
  const agent: Agent = {
    id: "lead",
    proc: {} as any,
    stdin: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as any,
    status: "idle",
    accumulatedText: "previous answer",
    history: [],
    events: [],
    buffer: "",
    worktreePath: "/tmp/workspace",
    children: [],
    _rpcRequests: new Map(),
    ...overrides,
  };
  return { agent, writes };
}

async function waitForNextTurn(agent: Agent) {
  for (let i = 0; i < 20; i++) {
    if (agent._nextTurn) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("agent turn was not started");
}

describe("sendToAgent", () => {
  it("writes prompt RPC, records user history, and clears previous text", async () => {
    const { agent, writes } = makeAgent();

    const send = sendToAgent(agent, "hello", 1_000);
    await waitForNextTurn(agent);
    agent._nextTurn!.resolve();
    await send;

    expect(writes).toEqual([JSON.stringify({ type: "prompt", message: "hello" }) + "\n"]);
    expect(agent.history).toEqual([{ role: "user", text: "hello" }]);
    expect(agent.accumulatedText).toBe("");
    expect(agent._currentSend).toBeUndefined();
    expect(agent._nextTurn).toBeUndefined();
  });

  it("serializes concurrent sends so prompts do not overlap", async () => {
    const { agent, writes } = makeAgent();

    const first = sendToAgent(agent, "first", 1_000);
    await waitForNextTurn(agent);
    const firstTurn = agent._nextTurn!;

    const second = sendToAgent(agent, "second", 1_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(1);

    firstTurn.resolve();
    await first;
    await waitForNextTurn(agent);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1]!.trim())).toEqual({ type: "prompt", message: "second" });

    agent._nextTurn!.resolve();
    await second;
    expect(agent.history.map((entry) => entry.text)).toEqual(["first", "second"]);
  });

  it("rejects immediately for exited agents without writing", async () => {
    const { agent, writes } = makeAgent({ status: "exited" });

    await expect(sendToAgent(agent, "hello", 1_000)).rejects.toThrow("Agent is exited");
    expect(writes).toHaveLength(0);
  });
});
