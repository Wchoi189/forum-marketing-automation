/**
 * Playwright `page.evaluate(fn)` sends the **compiled** function body into the browser.
 * TypeScript may inject `__name(target, "name")` calls; that helper exists in Node, not in the page.
 *
 * Run this via `context.addInitScript({ content: ... })` **before** `page.goto` so every
 * evaluate (including `lib/parser/dom-projector`) runs with `globalThis.__name` defined.
 *
 * Audit checklist if `ReferenceError: __name is not defined` returns:
 * 1. Confirm this init script is registered on the same `BrowserContext` as the `Page`.
 * 2. Confirm navigation happens after `addInitScript` (observer/publisher already do this).
 * 3. Grep for `page.evaluate` / `evaluateHandle` and ensure no `function` declarations slip
 *    back into serialized callbacks (prefer `const fn = () =>` in dom-projector).
 */
export const BROWSER_EVAL_NAME_POLYFILL_SCRIPT =
  "globalThis.__name = globalThis.__name || ((fn, _name) => fn);";
