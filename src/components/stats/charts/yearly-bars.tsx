"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BRAND } from "../palette";
import type { YearlyPoint } from "@/lib/queries/stats";

export function YearlyBarChart({ data }: { data: readonly YearlyPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-gray-400">
        Žádná data.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...data]} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e5e7eb" vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={(v: number) => String(v)}
        />
        <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
        <Tooltip
          formatter={(v) => [v as number, "🍀"]}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
        <Bar dataKey="count" fill={BRAND} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
