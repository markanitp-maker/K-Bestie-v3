export type PushTestChildFlags = {
  family_id: string | null;
  is_internal_test: boolean | null;
  is_test_account: boolean | null;
};

export function isPushTestChild(child: PushTestChildFlags, testFamilyIds: ReadonlySet<string>) {
  return Boolean(
    child.is_internal_test ||
    child.is_test_account ||
    (child.family_id && testFamilyIds.has(child.family_id))
  );
}
