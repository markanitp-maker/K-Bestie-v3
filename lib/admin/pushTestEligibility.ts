export type PushTestChildFlags = {
  family_id: string | null;
  is_internal_test: boolean | null;
  is_test_account: boolean | null;
};

export function isPushTestChild(child: PushTestChildFlags, testFamilyIds: ReadonlySet<string>) {
  const belongsToInternalTestFamily = Boolean(
    child.family_id && testFamilyIds.has(child.family_id)
  );

  return child.is_internal_test === true || belongsToInternalTestFamily;
}
