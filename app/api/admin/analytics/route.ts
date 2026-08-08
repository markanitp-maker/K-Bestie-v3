import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import {
  filterCohortsByRange,
  resolveAnalyticsFilters,
  retentionParams,
  subtractCohorts,
  subtractOverview,
  subtractRows,
} from "@/lib/admin/analytics";
import { GET as getOverview } from "@/app/api/admin/retention/overview/route";
import { GET as getCohort } from "@/app/api/admin/retention/cohort/route";
import { GET as getFamilies } from "@/app/api/admin/retention/families/route";
import { GET as getParents } from "@/app/api/admin/retention/parents/route";
import { GET as getChildren } from "@/app/api/admin/retention/children/route";
import { GET as getReporting } from "./reporting/route";

export const runtime = "nodejs";

type RouteHandler = (request: NextRequest) => Promise<Response>;

async function invoke(handler: RouteHandler, original: NextRequest, pathname: string, params: URLSearchParams) {
  const url = new URL(pathname, original.nextUrl.origin);
  url.search = params.toString();
  const response = await handler(new NextRequest(url, { headers: original.headers }));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `${pathname} 조회 실패`);
  return body;
}

async function collectRetentionVariant(req: NextRequest, includeTestAccounts: boolean, filters: ReturnType<typeof resolveAnalyticsFilters>) {
  const shared = retentionParams(filters, includeTestAccounts);
  const cohortParams = new URLSearchParams(shared);
  cohortParams.set("unit", filters.scope);
  cohortParams.set("cohortBasis", "registration");
  const calls = await Promise.allSettled([
    invoke(getOverview, req, "/api/admin/retention/overview", shared),
    invoke(getCohort, req, "/api/admin/retention/cohort", cohortParams),
    invoke(getFamilies, req, "/api/admin/retention/families", shared),
    invoke(getParents, req, "/api/admin/retention/parents", shared),
    invoke(getChildren, req, "/api/admin/retention/children", shared),
  ]);
  const keys = ["overview", "cohort", "families", "parents", "children"] as const;
  const data: Record<string, any> = {};
  const errors: Record<string, string> = {};
  calls.forEach((result, index) => {
    if (result.status === "fulfilled") data[keys[index]] = result.value;
    else errors[keys[index]] = result.reason instanceof Error ? result.reason.message : `${keys[index]} 조회 실패`;
  });
  return { data, errors };
}

function rows(payload: any, key: string): any[] {
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const now = new Date();
  now.setHours(now.getHours() + 9);
  const todayStr = now.toISOString().slice(0, 10);
  let filters;
  try {
    filters = resolveAnalyticsFilters(req.nextUrl.searchParams, todayStr);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "잘못된 조회 기간입니다." }, { status: 400 });
  }

  const reportingParams = new URLSearchParams(req.nextUrl.searchParams);
  reportingParams.set("period", filters.period);
  reportingParams.set("scope", filters.scope);
  reportingParams.set("internalTest", filters.internalTest);
  reportingParams.set("from", filters.from);
  reportingParams.set("to", filters.to);

  const topLevel = await Promise.allSettled([
    filters.internalTest === "only"
      ? Promise.allSettled([
          collectRetentionVariant(req, true, filters),
          collectRetentionVariant(req, false, filters),
        ])
      : collectRetentionVariant(req, filters.internalTest === "include", filters),
    invoke(getReporting, req, "/api/admin/analytics/reporting", reportingParams),
  ]);

  let retention: any = {};
  const errors: Record<string, string> = {};
  if (topLevel[0].status === "rejected") {
    errors.retention = topLevel[0].reason instanceof Error ? topLevel[0].reason.message : "리텐션 조회 실패";
  } else if (filters.internalTest === "only") {
    const variants = topLevel[0].value as PromiseSettledResult<Awaited<ReturnType<typeof collectRetentionVariant>>>[];
    if (variants[0].status === "fulfilled" && variants[1].status === "fulfilled") {
      const include = variants[0].value;
      const exclude = variants[1].value;
      const includeCohort = filterCohortsByRange(include.data.cohort, filters.from, filters.to);
      const excludeCohort = filterCohortsByRange(exclude.data.cohort, filters.from, filters.to);
      retention = {
        overview: include.data.overview && exclude.data.overview ? subtractOverview(include.data.overview, exclude.data.overview) : null,
        cohort: include.data.cohort && exclude.data.cohort ? subtractCohorts(includeCohort, excludeCohort) : null,
        details: {
          families: subtractRows(rows(include.data.families, "families"), rows(exclude.data.families, "families"), ["familyId"]),
          parents: subtractRows(rows(include.data.parents, "parents"), rows(exclude.data.parents, "parents"), ["actorId"]),
          children: subtractRows(rows(include.data.children, "children"), rows(exclude.data.children, "children"), ["childId"]),
        },
      };
      Object.assign(errors, include.errors, exclude.errors);
    } else {
      errors.retention = "테스트 전용 리텐션 집계를 완성하지 못했습니다.";
    }
  } else {
    const variant = topLevel[0].value as Awaited<ReturnType<typeof collectRetentionVariant>>;
    retention = {
      overview: variant.data.overview ?? null,
      cohort: variant.data.cohort ? filterCohortsByRange(variant.data.cohort, filters.from, filters.to) : null,
      details: {
        families: rows(variant.data.families, "families"),
        parents: rows(variant.data.parents, "parents"),
        children: rows(variant.data.children, "children"),
      },
    };
    Object.assign(errors, variant.errors);
  }

  let reporting = null;
  if (topLevel[1].status === "fulfilled") reporting = topLevel[1].value;
  else errors.reporting = topLevel[1].reason instanceof Error ? topLevel[1].reason.message : "리포팅 품질 조회 실패";

  return NextResponse.json({
    filters,
    retention,
    reporting,
    errors,
    meta: {
      timezone: "Asia/Seoul",
      sourceOfTruth: [
        "/api/admin/retention/overview",
        "/api/admin/retention/cohort",
        "/api/admin/retention/families",
        "/api/admin/retention/parents",
        "/api/admin/retention/children",
        "/api/admin/analytics/reporting",
      ],
      generatedAt: new Date().toISOString(),
    },
  }, { headers: { "Cache-Control": "private, max-age=30" } });
}
