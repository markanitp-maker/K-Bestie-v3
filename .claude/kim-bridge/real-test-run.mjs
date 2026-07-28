import { askSecretary } from "./lib/askSecretary.ts";

const answer = await askSecretary({
  projectName: "K-Bestie-v3",
  question: "김비서 브리지 실전 테스트입니다. A로 답하면 작업 재개, B로 답하면 중단합니다.",
  options: { A: "작업 재개", B: "작업 중단" },
  recommendation: "A. 작업 재개",
  context: "Claude ↔ 김비서 브리지 실제 종단 테스트(실전 모드, dry-run 아님)",
}, false, 15000);

console.log("FINAL ANSWER:", answer);
