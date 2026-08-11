import { NextRequest, NextResponse } from "next/server";
import { requireActiveAccount } from "@/lib/auth/requireActiveAccount";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PremiumRetentionYears = 1 | 3 | 5 | null;

interface RetentionRequestBody {
  premiumRetentionYears?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isPremiumRetentionYears = (value: unknown): value is PremiumRetentionYears => (
  value === null || value === 1 || value === 3 || value === 5
);

const getAccessContext = async (familyId: string, userId: string) => {
  const service = createServiceClient();
  const { data: family } = await service
    .from("families")
    .select("id, premium_retention_years")
    .eq("id", familyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!family) return { service, family: null, role: null, premiumAvailable: false };

  const { data: membership } = await service
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  const { data: premiumChild } = await service
    .from("child_profiles")
    .select("id")
    .eq("family_id", familyId)
    .eq("tier", 3)
    .limit(1)
    .maybeSingle();

  return {
    service,
    family,
    role: membership?.role ?? null,
    premiumAvailable: Boolean(premiumChild),
  };
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeBlock = await requireActiveAccount(user.id);
  if (activeBlock) return activeBlock;

  const context = await getAccessContext(id, user.id);
  if (!context.family) {
    return NextResponse.json({ error: "가족을 찾을 수 없습니다." }, { status: 404 });
  }
  if (!context.role || !["owner_parent", "parent"].includes(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.premiumAvailable) {
    return NextResponse.json({ error: "Care Premium은 현재 준비 중입니다." }, { status: 403 });
  }

  return NextResponse.json({
    premiumRetentionYears: context.family.premium_retention_years as PremiumRetentionYears,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeBlock = await requireActiveAccount(user.id);
  if (activeBlock) return activeBlock;

  let body: RetentionRequestBody;
  try {
    const parsed: unknown = await req.json();
    body = isRecord(parsed) ? parsed : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isPremiumRetentionYears(body.premiumRetentionYears)) {
    return NextResponse.json({ error: "보존기간은 1년, 3년, 5년 또는 무제한만 선택할 수 있습니다." }, { status: 400 });
  }

  const context = await getAccessContext(id, user.id);
  if (!context.family) {
    return NextResponse.json({ error: "가족을 찾을 수 없습니다." }, { status: 404 });
  }
  if (context.role !== "owner_parent") {
    return NextResponse.json({ error: "가족 오너만 보존기간을 변경할 수 있습니다." }, { status: 403 });
  }
  if (!context.premiumAvailable) {
    return NextResponse.json({ error: "Care Premium은 현재 준비 중입니다." }, { status: 403 });
  }

  const { data, error } = await context.service
    .from("families")
    .update({ premium_retention_years: body.premiumRetentionYears })
    .eq("id", id)
    .is("deleted_at", null)
    .select("premium_retention_years")
    .single();

  if (error) {
    console.error("[families/premium-retention/PATCH] update failed");
    return NextResponse.json({ error: "보존기간을 저장하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    premiumRetentionYears: data.premium_retention_years as PremiumRetentionYears,
  });
}
