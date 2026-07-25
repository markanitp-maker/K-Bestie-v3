import { describe, it } from "node:test";
import assert from "node:assert";
import { getVocativeParticle, appendVocative } from "./koreanParticle";

describe("koreanParticle utility", () => {
  it("should return 아 for names with jongseong", () => {
    assert.strictEqual(getVocativeParticle("서현"), "아");
    assert.strictEqual(getVocativeParticle("준호형"), "아");
  });

  it("should return 야 for names without jongseong", () => {
    assert.strictEqual(getVocativeParticle("서아"), "야");
    assert.strictEqual(getVocativeParticle("철수"), "야");
  });

  it("should correctly append vocative particle", () => {
    assert.strictEqual(appendVocative("서현"), "서현아");
    assert.strictEqual(appendVocative("서아"), "서아야");
    assert.strictEqual(appendVocative(""), "");
    assert.strictEqual(appendVocative(null), "");
  });

  it("should fallback to 야 for non-korean names", () => {
    assert.strictEqual(getVocativeParticle("John"), "야");
    assert.strictEqual(appendVocative("John"), "John야");
  });
});
