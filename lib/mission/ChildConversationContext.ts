export interface ChildConversationContext {
  childId: string;
  displayName: string;
  givenName: string | null;
  grade: number;
  knownProfileFacts: Record<string, any>;
}
