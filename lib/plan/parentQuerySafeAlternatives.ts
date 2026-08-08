export type ExpertReviewStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export interface SafeAlternative {
  sourceGrade: number;
  redId: string;
  requestedArea: string;
  alternativeId: string;
  alternativeArea: string;
  parentDraftText: string;
  childQuestionText: string;
  expertReviewStatus: ExpertReviewStatus;
  productionEnabled: boolean;
}

export const SAFE_ALTERNATIVE_ALLOWED_AREA_MAP: Readonly<Record<string, readonly string[]>> = {
  emotion_cause: ["emotion_event_safe"],
  peer_conflict: ["peer_relationship_safe"],
  academic_pressure: ["neutral_learning_experience"],
};

function alternativesForGrade(sourceGrade: number): SafeAlternative[] {
  return [
    {
      sourceGrade,
      redId: "R-01",
      requestedArea: "emotion_cause",
      alternativeId: `SA-G${sourceGrade}-EMOTION-01`,
      alternativeArea: "emotion_event_safe",
      parentDraftText: "어제 기억에 남는 일이 있었는지 물어볼까요?",
      childQuestionText: "어제 기억에 남는 일 있었어?",
      expertReviewStatus: "APPROVED",
      productionEnabled: true,
    },
    {
      sourceGrade,
      redId: "R-02",
      requestedArea: "peer_conflict",
      alternativeId: `SA-G${sourceGrade}-PEER-01`,
      alternativeArea: "peer_relationship_safe",
      parentDraftText: "요즘 친구들과 어떻게 지내는지 물어볼까요?",
      childQuestionText: "요즘 친구들과 지내는 건 어때?",
      expertReviewStatus: "APPROVED",
      productionEnabled: true,
    },
    {
      sourceGrade,
      redId: "R-03",
      requestedArea: "academic_pressure",
      alternativeId: `SA-G${sourceGrade}-LEARNING-01`,
      alternativeArea: "neutral_learning_experience",
      parentDraftText: "요즘 공부하면서 편하거나 어려운 점이 있는지 물어볼까요?",
      childQuestionText: "요즘 공부하면서 편하거나 어려운 점 있어?",
      expertReviewStatus: "APPROVED",
      productionEnabled: true,
    },
  ];
}

export const SAFE_ALTERNATIVE_REGISTRY: readonly SafeAlternative[] = [1, 2, 3, 4, 5, 6]
  .flatMap(alternativesForGrade);

export function resolveApprovedSafeAlternative(input: {
  sourceGrade: number;
  redId: string;
  requestedArea: string;
}): SafeAlternative | null {
  const candidate = SAFE_ALTERNATIVE_REGISTRY.find(
    (item) =>
      item.sourceGrade === input.sourceGrade &&
      item.redId === input.redId &&
      item.requestedArea === input.requestedArea,
  );
  if (!candidate) return null;

  const allowedAreas = SAFE_ALTERNATIVE_ALLOWED_AREA_MAP[input.requestedArea] ?? [];
  if (!allowedAreas.includes(candidate.alternativeArea)) return null;
  if (candidate.expertReviewStatus !== "APPROVED") return null;
  if (!candidate.productionEnabled) return null;
  return candidate;
}

export function getApprovedSafeAlternativeById(
  sourceGrade: number,
  alternativeId: string,
): SafeAlternative | null {
  const candidate = SAFE_ALTERNATIVE_REGISTRY.find(
    (item) => item.sourceGrade === sourceGrade && item.alternativeId === alternativeId,
  );
  if (!candidate) return null;
  return resolveApprovedSafeAlternative({
    sourceGrade,
    redId: candidate.redId,
    requestedArea: candidate.requestedArea,
  });
}
