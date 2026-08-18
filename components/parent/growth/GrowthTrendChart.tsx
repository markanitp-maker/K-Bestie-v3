"use client";

// 요청서 012 §3-7 — 성장 추세 그래프.
//
// 공식 백분위 곡선(3·50·97)은 lib/growth 의 공식 LMS 에서 산출한 값만 쓴다. 임의 선을 만들지 않는다.
// x축은 초등학생 서비스 범위를 기본으로 하되, 실제 기록이 그보다 넓으면 기록 범위까지 넓힌다.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { buildPercentileCurve, formatKoreanAge, type GrowthIndicator, type GrowthSex } from "@/lib/growth";
import { ELEMENTARY_AGE_MONTHS } from "@/lib/growth/consent";

interface Props {
  indicator: Extract<GrowthIndicator, "heightForAge" | "weightForAge">;
  sex: GrowthSex;
  /** 측정 기록 (월령, 값). 오름차순이 아니어도 된다. */
  points: Array<{ ageMonths: number; value: number; measuredAt: string }>;
  unit: string;
}

export function GrowthTrendChart({ indicator, sex, points, unit }: Props) {
  if (points.length === 0) return null;

  const measuredMonths = points.map((point) => point.ageMonths);
  const fromAgeMonths = Math.max(0, Math.min(ELEMENTARY_AGE_MONTHS.min, ...measuredMonths) - 6);
  const toAgeMonths = Math.max(ELEMENTARY_AGE_MONTHS.max, ...measuredMonths) + 6;

  const curve = buildPercentileCurve(indicator, sex, fromAgeMonths, toAgeMonths);
  const measuredByMonth = new Map(points.map((point) => [point.ageMonths, point.value]));

  const data = curve.map((point) => ({
    ageMonths: point.ageMonths,
    p3: point.values["3"],
    p50: point.values["50"],
    p97: point.values["97"],
    measured: measuredByMonth.get(point.ageMonths) ?? null,
  }));

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="#10315B" strokeOpacity={0.08} />
          <XAxis
            dataKey="ageMonths"
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(value: number) => `${Math.floor(value / 12)}세`}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            width={42}
            domain={["dataMin - 4", "dataMax + 4"]}
            tickFormatter={(value: number) => String(Math.round(value))}
          />
          <Tooltip
            formatter={(value, name) =>
              value === null || value === undefined
                ? ["-", String(name)]
                : [`${value}${unit}`, String(name)]
            }
            labelFormatter={(label) => formatKoreanAge(Number(label))}
            contentStyle={{ borderRadius: 12, fontSize: 12, fontWeight: 600 }}
          />
          <Line type="monotone" dataKey="p97" name="97백분위" stroke="#9CA3AF" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="p50" name="또래 중앙값" stroke="#10315B" strokeOpacity={0.45} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="p3" name="3백분위" stroke="#9CA3AF" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="measured"
            name="우리 아이"
            stroke="var(--color-k-orange)"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "var(--color-k-orange)" }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
