import test from "node:test";
import assert from "node:assert/strict";
import { runPublisherPlaybook, type PlaybookRuntimeContext, type PublisherPlaybook } from "../../lib/playbookRunner.ts";
import { confirmLoadDraftFromModal } from "../../lib/publisher/ui/draftModal.ts";

type FakeState = {
  selectors: Record<string, number>;
  clicked: string[];
  filled: Array<{ selector: string; value: string }>;
  selected: Array<{ selector: string; label: string }>;
  seenTexts: Set<string>;
};

function fakePage(state: FakeState) {
  const makeGetByText = (text: string) => ({
    first: () => ({
      isVisible: async () => state.seenTexts.has(text),
      waitFor: async (_opts?: { state?: string; timeout?: number }) => {
        if (!state.seenTexts.has(text)) {
          throw new Error("not visible");
        }
      }
    })
  });
  return {
    goto: async () => undefined,
    getByText: (text: string) => makeGetByText(text),
    frames: () => [{ getByText: (text: string) => makeGetByText(text) }],
    locator: (selector: string) => ({
      first: () => ({
        count: async () => state.selectors[selector] ?? 0,
        isVisible: async () => (state.selectors[selector] ?? 0) > 0,
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

type DraftModalMockState = {
  freeze: boolean;
  modalVisible: boolean;
  rowCount: number;
  rowSelectable?: boolean[];
  clickedRowIndexes: number[];
  previewLoadButtonCount: number;
  closeButtonVisible: boolean;
  closeButtonClearsFreeze: boolean;
  fallbackCloseClearsFreeze: boolean;
  escapeClearsFreeze: boolean;
};

function createDraftModalPage(state: DraftModalMockState) {
  const closeButton = {
    first: () => ({
      isVisible: async () => state.closeButtonVisible,
      click: async () => {
        if (state.closeButtonClearsFreeze) state.freeze = false;
      }
    })
  };
  const fallbackCloseButton = {
    first: () => ({
      evaluate: async (fn: (el: unknown) => void) => {
        fn({ click: () => null });
        if (state.fallbackCloseClearsFreeze) state.freeze = false;
      }
    })
  };
  const previewLoadButton = {
    first: () => ({
      count: async () => state.previewLoadButtonCount,
      click: async () => undefined
    })
  };

  const rowLocator = {
    filter: () => rowLocator,
    count: async () => state.rowCount,
    nth: (index: number) => ({
      isVisible: async () => true,
      innerText: async () => `mock-row-${index + 1}`,
      locator: (selector: string) => {
        if (selector === "a:visible, button:visible, td:not([colspan]):visible") {
          const selectable = state.rowSelectable?.[index] ?? true;
          return {
            first: () => ({
              count: async () => (selectable ? 1 : 0),
              isVisible: async () => selectable,
              click: async () => {
                if (!selectable) {
                  throw new Error("element is not visible");
                }
                state.clickedRowIndexes.push(index);
              }
            })
          };
        }
        if (selector === "td:not([colspan]):visible, td:visible") {
          return {
            first: () => ({
              count: async () => 1
            })
          };
        }
        return {
          first: () => ({})
        };
      }
    })
  };

  const modalRoot = {
    filter: () => modalRoot,
    first: () => ({
      isVisible: async () => state.modalVisible,
      waitFor: async () => {
        if (!state.modalVisible) throw new Error("modal not visible");
      },
      locator: (selector: string) => {
        if (selector === "table tr") return rowLocator;
        if (selector === 'button:has-text("불러오기"):visible') return previewLoadButton;
        if (selector === 'button:has-text("닫기"):visible') return closeButton;
        return { first: () => ({ count: async () => 0 }) };
      }
    })
  };

  return {
    locator: (selector: string) => {
      if (
        selector === "div" ||
        selector.includes(".popup_layer:visible") ||
        selector.includes('[class*="layer_popup"]:visible')
      ) {
        return modalRoot;
      }
      if (selector === "td") return {};
      if (selector === "div.tempas-preview") {
        return {
          last: () => ({
            waitFor: async () => undefined,
            locator: (innerSelector: string) =>
              innerSelector === 'button:has-text("불러오기"):visible' ? previewLoadButton : { first: () => ({}) }
          })
        };
      }
      if (selector === "button.btn-tempas-close") return fallbackCloseButton;
      return {
        first: () => ({})
      };
    },
    evaluate: async (fn: () => unknown) => {
      const fnText = String(fn);
      if (fnText.includes("document.body.classList.contains(\"freeze\")")) {
        return state.freeze;
      }
      return undefined;
    },
    waitForFunction: async () => {
      if (state.freeze) throw new Error("still frozen");
    },
    keyboard: {
      press: async (key: string) => {
        if (key === "Escape" && state.escapeClearsFreeze) state.freeze = false;
      }
    },
    _state: state
  };
}

test("confirm-load-draft-modal clears freeze through close lifecycle", async () => {
  const runtime: PlaybookRuntimeContext = { boardEntryUrl: "https://example.com", draftItemIndex: 2 };
  const page = createDraftModalPage({
    freeze: true,
    modalVisible: true,
    rowCount: 3,
    rowSelectable: [true, false, true],
    clickedRowIndexes: [],
    previewLoadButtonCount: 1,
    closeButtonVisible: true,
    closeButtonClearsFreeze: true,
    fallbackCloseClearsFreeze: false,
    escapeClearsFreeze: false
  });

  await assert.doesNotReject(() =>
    confirmLoadDraftFromModal(
      page as never,
      runtime,
      "confirm-load-draft-modal"
    )
  );

  assert.deepEqual((page as unknown as { _state: DraftModalMockState })._state.clickedRowIndexes, [2]);
  assert.deepEqual(runtime.draftRowSelection, {
    requestedDraftIndex: 2,
    clickedRawRowIndex: 3,
    selectableRows: 2,
    totalRows: 3,
    clickedLabel: "mock-row-3"
  });
});

test("confirm-load-draft-modal fails closed when freeze persists after fallbacks", async () => {
  const page = createDraftModalPage({
    freeze: true,
    modalVisible: true,
    rowCount: 1,
    rowSelectable: [true],
    clickedRowIndexes: [],
    previewLoadButtonCount: 1,
    closeButtonVisible: true,
    closeButtonClearsFreeze: false,
    fallbackCloseClearsFreeze: false,
    escapeClearsFreeze: false
  });

  await assert.rejects(
    () =>
      confirmLoadDraftFromModal(
        page as never,
        { boardEntryUrl: "https://example.com", draftItemIndex: 1 },
        "confirm-load-draft-modal"
      ),
    /draft preview modal still open/
  );
});
