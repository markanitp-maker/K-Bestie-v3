import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const enabled = process.env.E_LOW_LATENCY_ENABLED !== "false";
  const personalizedReaction = process.env.E_PERSONALIZED_REACTION_ENABLED !== "false";
  return NextResponse.json({ enabled, personalizedReaction });
}
