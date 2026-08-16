import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedNextInitials, isChainConnected } from "./dueum";

describe("WordChain Dueum Rules (두음법칙)", () => {
  describe("allowedNextInitials", () => {
    it("직접 연결(동일 음절)은 항상 첫 번째 원소로 포함되어야 한다", () => {
      assert.deepEqual(allowedNextInitials("가"), ["가"]);
      assert.deepEqual(allowedNextInitials("하"), ["하"]);
      assert.deepEqual(allowedNextInitials("늘"), ["늘"]);
      assert.equal(allowedNextInitials("라")[0], "라");
      assert.equal(allowedNextInitials("리")[0], "리");
      assert.equal(allowedNextInitials("녀")[0], "녀");
    });

    it("제12항: 'ㄹ' 초성 + 일반 모음 -> 'ㄴ' 변형 허용", () => {
      // 라 -> 나
      assert.deepEqual(allowedNextInitials("라"), ["라", "나"]);
      // 락 -> 낙
      assert.deepEqual(allowedNextInitials("락"), ["락", "낙"]);
      // 란 -> 난
      assert.deepEqual(allowedNextInitials("란"), ["란", "난"]);
      // 래 -> 내
      assert.deepEqual(allowedNextInitials("래"), ["래", "내"]);
      // 로 -> 노
      assert.deepEqual(allowedNextInitials("로"), ["로", "노"]);
      // 록 -> 녹
      assert.deepEqual(allowedNextInitials("록"), ["록", "녹"]);
      // 론 -> 논
      assert.deepEqual(allowedNextInitials("론"), ["론", "논"]);
      // 루 -> 누
      assert.deepEqual(allowedNextInitials("루"), ["루", "누"]);
      // 르 -> 느
      assert.deepEqual(allowedNextInitials("르"), ["르", "느"]);
      // 름 -> 늠
      assert.deepEqual(allowedNextInitials("름"), ["름", "늠"]);
      // 릉 -> 능
      assert.deepEqual(allowedNextInitials("릉"), ["릉", "능"]);
    });

    it("제11항: 'ㄹ' 초성 + 'ㅑ, ㅕ, ㅖ, ㅛ, ㅠ, ㅣ' 모음 -> 'ㅇ' 변형 허용", () => {
      // 랴 -> 야
      assert.deepEqual(allowedNextInitials("랴"), ["랴", "야"]);
      // 량 -> 양
      assert.deepEqual(allowedNextInitials("량"), ["량", "양"]);
      // 려 -> 여
      assert.deepEqual(allowedNextInitials("려"), ["려", "여"]);
      // 력 -> 역
      assert.deepEqual(allowedNextInitials("력"), ["력", "역"]);
      // 련 -> 연
      assert.deepEqual(allowedNextInitials("련"), ["련", "연"]);
      // 렬 -> 열
      assert.deepEqual(allowedNextInitials("렬"), ["렬", "열"]);
      // 례 -> 예
      assert.deepEqual(allowedNextInitials("례"), ["례", "예"]);
      // 료 -> 요
      assert.deepEqual(allowedNextInitials("료"), ["료", "요"]);
      // 류 -> 유
      assert.deepEqual(allowedNextInitials("류"), ["류", "유"]);
      // 륙 -> 육
      assert.deepEqual(allowedNextInitials("륙"), ["륙", "육"]);
      // 률 -> 율
      assert.deepEqual(allowedNextInitials("률"), ["률", "율"]);
      // 리 -> 이
      assert.deepEqual(allowedNextInitials("리"), ["리", "이"]);
      // 린 -> 인
      assert.deepEqual(allowedNextInitials("린"), ["린", "인"]);
      // 림 -> 임
      assert.deepEqual(allowedNextInitials("림"), ["림", "임"]);
      // 립 -> 입
      assert.deepEqual(allowedNextInitials("립"), ["립", "입"]);
    });

    it("제10항: 'ㄴ' 초성 + 'ㅑ, ㅕ, ㅖ, ㅛ, ㅠ, ㅣ' 모음 -> 'ㅇ' 변형 허용", () => {
      // 녀 -> 여
      assert.deepEqual(allowedNextInitials("녀"), ["녀", "여"]);
      // 년 -> 연
      assert.deepEqual(allowedNextInitials("년"), ["년", "연"]);
      // 념 -> 염
      assert.deepEqual(allowedNextInitials("념"), ["념", "염"]);
      // 녕 -> 영
      assert.deepEqual(allowedNextInitials("녕"), ["녕", "영"]);
      // 뇨 -> 요
      assert.deepEqual(allowedNextInitials("뇨"), ["뇨", "요"]);
      // 뉴 -> 유
      assert.deepEqual(allowedNextInitials("뉴"), ["뉴", "유"]);
      // 니 -> 이
      assert.deepEqual(allowedNextInitials("니"), ["니", "이"]);
      // 닉 -> 익
      assert.deepEqual(allowedNextInitials("닉"), ["닉", "익"]);
      // 닌 -> 인
      assert.deepEqual(allowedNextInitials("닌"), ["닌", "인"]);
      // 님 -> 임
      assert.deepEqual(allowedNextInitials("님"), ["님", "임"]);
    });

    it("표준 두음법칙에 해당하지 않는 'ㄴ' 초성은 'ㅇ'으로 바뀌지 않아야 한다", () => {
      // 나 -> 아 (금지)
      assert.deepEqual(allowedNextInitials("나"), ["나"]);
      // 내 -> 애 (금지)
      assert.deepEqual(allowedNextInitials("내"), ["내"]);
      // 노 -> 오 (금지)
      assert.deepEqual(allowedNextInitials("노"), ["노"]);
      // 누 -> 우 (금지)
      assert.deepEqual(allowedNextInitials("누"), ["누"]);
      // 느 -> 으 (금지)
      assert.deepEqual(allowedNextInitials("느"), ["느"]);
    });
  });

  describe("isChainConnected", () => {
    it("직접 연결은 항상 true여야 한다", () => {
      assert.equal(isChainConnected("가", "가"), true);
      assert.equal(isChainConnected("늘", "늘"), true);
      assert.equal(isChainConnected("방", "방"), true);
    });

    it("표준 두음법칙 연결이 통과되어야 한다", () => {
      // 라 -> 나 (신라 -> 나비)
      assert.equal(isChainConnected("라", "나"), true);
      // 로 -> 노 (도로 -> 노을)
      assert.equal(isChainConnected("로", "노"), true);
      // 리 -> 이 (오리 -> 이야기)
      assert.equal(isChainConnected("리", "이"), true);
      // 량 -> 양 (식량 -> 양파)
      assert.equal(isChainConnected("량", "양"), true);
      // 녀 -> 여 (소녀 -> 여행)
      assert.equal(isChainConnected("녀", "여"), true);
      // 류 -> 유 (교류 -> 유리)
      assert.equal(isChainConnected("류", "유"), true);
    });

    it("아무 관계 없는 음절 연결은 거부(false)되어야 한다", () => {
      assert.equal(isChainConnected("가", "나"), false);
      assert.equal(isChainConnected("하", "늘"), false);
      assert.equal(isChainConnected("노", "오"), false);
      assert.equal(isChainConnected("나", "아"), false);
      assert.equal(isChainConnected("사", "자"), false);
    });

    it("빈 문자열 등 부적절한 입력은 false를 반환해야 한다", () => {
      assert.equal(isChainConnected("", "가"), false);
      assert.equal(isChainConnected("가", ""), false);
      assert.equal(isChainConnected("", ""), false);
    });
  });
});
