// 2026-08-20 대표님 실사용 — 아이가 판정에 항의한 문장을 낱말로 채점했다.
//
//   아이: 이빨 이 "이"로 시작하는 단어자나?
//   케이: "단어자나"는 내가 아직 잘 모르는 단어네!
//
// 아이 입장에서는 케이가 말을 아예 못 알아듣는 것으로 보인다.
//
// 구조(문장 길이·토큰 수)로는 가를 수 없다. 아이는 군말을 늘어놓고 마지막에 낱말을
// 말하기도 한다("아 진짜 한참 째 끝말잇기 하긴 하는 구나 귀찮냐 차표").
// 그래서 **내용**으로 가른다 — 판정 이의, 실력 비난, 규칙 질문.

import assert from "node:assert/strict";
import test from "node:test";

import {
  extractChildCandidateWordForTest as extract,
  isWordChainDispute,
} from "./wordChainSkill";

test("실측: 판정에 항의한 문장은 이의로 걸러진다", () => {
  assert.equal(isWordChainDispute('이빨 이 "이"로 시작하는 단어자나?'), true);
});

test("실측: 실력 비난·개선 요구도 이의다", () => {
  assert.equal(isWordChainDispute("헐… 단어도 몰라? 개판이네"), true);
  assert.equal(
    isWordChainDispute("여전히 멍청하다. 끝말잇기는 전혀 개선이 안됨. 대폭 고도화 이모"),
    true
  );
});

test("규칙·방법을 묻는 말도 이의로 본다", () => {
  assert.equal(isWordChainDispute("이거 규칙이 뭐야"), true);
  assert.equal(isWordChainDispute("이거 어떻게 하는 거야"), true);
});

test("평범한 낱말과 기분 표현은 이의가 아니다", () => {
  // 이것들은 낱말 채점 경로로 가야 한다.
  assert.equal(isWordChainDispute("사과"), false);
  assert.equal(isWordChainDispute("범고래"), false);
  assert.equal(isWordChainDispute("아 진짜 한참 째 끝말잇기 하긴 하는 구나 귀찮냐 차표"), false);
  assert.equal(isWordChainDispute("재미있다"), false);
  assert.equal(isWordChainDispute(""), false);
});

test("낱말 추출: 한 낱말 단답과 \"정답은 X\" 는 그대로 받는다", () => {
  assert.equal(extract("사과", "사"), "사과");
  assert.equal(extract("기차야", "기"), "기차");
  assert.equal(extract("정답은 기차", "기"), "기차");
});

test("낱말 추출: 군말이 섞이면 규칙에 맞는 낱말을 고른다", () => {
  assert.equal(extract("음 사과", "사"), "사과");
  // 두 후보가 다 규칙에 맞고 사전에 있으면 아이가 나중에 말한 것이 최종 답이다.
  assert.equal(extract("사과 아니고 사슴", "사"), "사슴");
});

test("낱말 추출: 사전이 몰라도 규칙에 맞으면 낱말 시도로 본다", () => {
  // 사전 부족을 "말을 못 알아듣는 것" 으로 보이게 하지 않는다.
  // (LLM 판정이 이어서 실제 낱말인지 확인한다)
  assert.equal(extract("아마 이빨", "이"), "이빨");
});

test("낱말 추출: 기존 동작을 깨지 않는다", () => {
  assert.equal(
    extract("아 진짜 한참 째 끝말잇기 하긴 하는 구나 귀찮냐 차표"),
    "차표"
  );
  assert.equal(extract("음... 사과!"), "사과");
});
