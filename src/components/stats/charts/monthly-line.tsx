"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BRAND } from "../palette";
import type { MonthlyPoint } from "@/lib/queries/stats";

const MONTHS_CS = [
  "led",
  "úno",
  "bře",
  "dub",
  "kvě",
  "čvn",
  "čvc",
  "srp",
  "zář",
  "říj",
  "lis",
  "pro",
];

function formatMonth(iso: string): string {
  const [yearStr, monthStr] = iso.split("-");
  if (!yearStr || !monthStr) return iso;
  const monthIdx = Number(monthStr) - 1;
  const mName = MONTHS_CS[monthIdx] ?? monthStr;
  return `${mName} ${yearStr.slice(2)}`;
}

export function MonthlyLineChart({ data }: { data: readonly MonthlyPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-gray-400">
        Žádná data s datem 🍀.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...data]} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e5e7eb" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={formatMonth}
          minTickGap={24}
        />
        <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
        <Tooltip
          labelFormatter={(v) => formatMonth(String(v))}
          formatter={(v) => [v as number, "🍀"]}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke={BRAND}
          strokeWidth={2}
          dot={{ r: 2, fill: BRAND }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
