import test from "node:test";
import assert from "node:assert/strict";
import { runPublisherPlaybook, type PublisherPlaybook } from "../../lib/playbookRunner.ts";

type FakeState = {
  selectors: Record<string, number>;
  clicked: string[];
  filled: Array<{ selector: string; value: string }>;
  selected: Array<{ selector: string; label: string }>;
  seenTexts: Set<string>;
};

function fakePage(state: FakeState) {
  return {
    goto: async () => undefined,
    getByText: (text: string) => ({
      first: () => ({
        isVisible: async () => state.seenTexts.has(text)
      })
    }),
    locator: (selector: string) => ({
      first: () => ({
        count: async () => state.selectors[selector] ?? 0,
        click: async () => {
          state.clicked.push(selector);
        },
        fill: async (value: string) => {
          state.filled.push({ selector, value });
        },
        selectOption: async ({ label }: { label: string }) => {
          state.selected.push({ selector, label });
        },
        evaluate: async (fn: (el: unknown) => void) => {
          state.clicked.push(selector);
          fn({ click: () => null });
        }
      })
    })
  };
}

test("playbook runner uses selector fallback chain deterministically", async () => {
  const state: FakeState = {
    selectors: {
      ".missing": 0,
      ".fallback": 1
    },
    clicked: [],
    filled: [],
    selected: [],
    seenTexts: new Set(["ok"])
  };
  const playbook: PublisherPlaybook = {
    playbook_version: "1.0.0",
    workflow_id: "test",
    steps: [
      {
        step_id: "click-fallback",
        action: "click",
        selectors: [[".missing"], [".fallback"]]
      },
      {
        step_id: "verify",
        action: "verify_text",
        expected_text: "ok"
      }
    ]
  };
  await runPublisherPlaybook(fakePage(state) as never, playbook, { boardEntryUrl: "https://example.com" });
  assert.deepEqual(state.clicked, [".fallback"]);
});

test("playbook runner fails closed on unsupported action", async () => {
  const state: FakeState = {
    selectors: { ".x": 1 },
    clicked: [],
    filled: [],
    selected: [],
    seenTexts: new Set()
  };
  const playbook = {
    playbook_version: "1.0.0",
    workflow_id: "test",
    steps: [{ step_id: "bad", action: "unknown", selector: ".x" }]
  } as unknown as PublisherPlaybook;
  await assert.rejects(
    () => runPublisherPlaybook(fakePage(state) as never, playbook, { boardEntryUrl: "https://example.com" }),
    /unsupported action/
  );
});
