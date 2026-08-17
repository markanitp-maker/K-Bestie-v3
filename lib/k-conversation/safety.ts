// K Conversation Engine — Safety 게이트. 로직은 절대 바꾸지 않고 lib/freeChatReactions.ts를
// 그대로 재노출한다. Engine index.ts에서 항상 최우선으로 호출되며, 걸리면 Persona/Action/
// Memory를 전부 스킵하고 안전 응답만 반환한다(하드룰: 안전이 Persona보다 항상 우선).
export {
  pickReaction,
  insertSafetyEventWithDedupe,
  isRecentDuplicateSafetyEvent,
  SAFETY_EVENT_DEDUPE_TTL_MS,
} from "@/lib/freeChatReactions";
export type {
  ReactionResult,
  ReactionCategory,
  SafetySubcategory,
  InsertSafetyEventParams,
} from "@/lib/freeChatReactions";
