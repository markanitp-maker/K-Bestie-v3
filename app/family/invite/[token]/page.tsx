import { FamilyInviteJoin } from "@/components/family/FamilyInviteJoin";

export default async function FamilyInviteTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FamilyInviteJoin initialToken={token} />;
}
