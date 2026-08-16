import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryFromInterestTexts } from "./interestPersonalization";

test("검수된 관심사 키워드를 초성게임 카테고리에 연결한다", () => {
  assert.equal(categoryFromInterestTexts(["포켓몬 캐릭터를 좋아함"]), "캐릭터");
  assert.equal(categoryFromInterestTexts(["주말마다 축구를 함"]), "스포츠");
  assert.equal(categoryFromInterestTexts(["마인크래프트 건축에 관심이 많음"]), "게임");
});

test("매핑되지 않은 관심사는 개인화하지 않는다", () => {
  assert.equal(categoryFromInterestTexts(["피아노 연주를 좋아함"]), undefined);
  assert.equal(categoryFromInterestTexts([]), undefined);
});
