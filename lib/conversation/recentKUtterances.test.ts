import { describe, it } from "node:test";
import assert from "node:assert";
import { getRecentKUtterances } from "./recentKUtterances";

describe("getRecentKUtterances", () => {
  it("extracts current/previous/older from mixed assistant+user turns (§25 selector test)", () => {
    const turns = [
      { role: "k" as const, text: "assistant A" },
      { role: "child" as const, text: "user 1" },
      { role: "k" as const, text: "assistant B" },
      { role: "child" as const, text: "user 2" },
      { role: "k" as const, text: "assistant C" },
    ];
    const result = getRecentKUtterances(turns);
    assert.strictEqual(result.current, "assistant C");
    assert.strictEqual(result.previous, "assistant B");
    assert.strictEqual(result.older, "assistant A");
  });

  it("never leaks a child turn into current/previous/older", () => {
    const turns = [
      { role: "k" as const, text: "케이 발화" },
      { role: "child" as const, text: "아이 발화 — 화면에 노출되면 안 됨" },
    ];
    const result = getRecentKUtterances(turns);
    assert.strictEqual(result.current, "케이 발화");
    assert.strictEqual(result.previous, "");
    assert.strictEqual(result.older, "");
    assert.notStrictEqual(result.current, "아이 발화 — 화면에 노출되면 안 됨");
  });

  it("handles 0/1/2/3/4+ k utterances without reserving empty slots incorrectly", () => {
    assert.deepStrictEqual(getRecentKUtterances([]), { current: "", previous: "", older: "" });

    assert.deepStrictEqual(
      getRecentKUtterances([{ role: "k", text: "A" }]),
      { current: "A", previous: "", older: "" }
    );

    assert.deepStrictEqual(
      getRecentKUtterances([
        { role: "k", text: "A" },
        { role: "k", text: "B" },
      ]),
      { current: "B", previous: "A", older: "" }
    );

    assert.deepStrictEqual(
      getRecentKUtterances([
        { role: "k", text: "A" },
        { role: "k", text: "B" },
        { role: "k", text: "C" },
      ]),
      { current: "C", previous: "B", older: "A" }
    );

    assert.deepStrictEqual(
      getRecentKUtterances([
        { role: "k", text: "A" },
        { role: "k", text: "B" },
        { role: "k", text: "C" },
        { role: "k", text: "D" },
      ]),
      { current: "D", previous: "C", older: "B" }
    );
  });

  it("partial chunks updating the same trailing k turn in place do not shift previous/older", () => {
    const base = [
      { role: "k" as const, text: "assistant A finalized" },
    ];
    const partial1 = [...base, { role: "k" as const, text: "assistant B partial 1" }];
    const partial2 = [...base, { role: "k" as const, text: "assistant B partial 2" }];
    const final = [...base, { role: "k" as const, text: "assistant B final" }];

    for (const turns of [partial1, partial2, final]) {
      const result = getRecentKUtterances(turns);
      assert.strictEqual(result.previous, "assistant A finalized");
      assert.strictEqual(result.older, "");
    }
    assert.strictEqual(getRecentKUtterances(final).current, "assistant B final");
  });

  it("re-question scenario keeps child's clarifying turn out of the timeline", () => {
    const turns = [
      { role: "k" as const, text: "다시 한 번 말해줄래?" },
      { role: "child" as const, text: "방금 뭐라고 했냐면..." },
      { role: "k" as const, text: "아하, 그런 이야기였구나." },
    ];
    const result = getRecentKUtterances(turns);
    assert.strictEqual(result.current, "아하, 그런 이야기였구나.");
    assert.strictEqual(result.previous, "다시 한 번 말해줄래?");
    assert.strictEqual(result.older, "");
  });
});
