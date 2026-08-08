import { FamilyInviteContinue } from "@/components/family/FamilyInviteContinue";

export default async function FamilyInviteContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return <FamilyInviteContinue oauthCancelled={params.error === "cancelled"} />;
}
