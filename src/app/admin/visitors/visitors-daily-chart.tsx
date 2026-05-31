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
import { BRAND } from "@/components/stats/palette";
import type { DailyPoint } from "@/lib/queries/visitorStats";

/** Daily-hits bar chart for /admin/visitors. Mirrors the YearlyBarChart
 *  on /statistiky shape so the visual language stays consistent across
 *  the project. Two-series tooltip surfaces total + unique side by side
 *  so the operator can eyeball the bounce-rate proxy at a glance. */
export function VisitorsDailyChart({
  data,
}: {
  data: readonly DailyPoint[];
}) {
  if (data.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-gray-400">
        Žádná data za vybrané období.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={[...data]}
        margin={{ top: 8, right: 16, left: -16, bottom: 0 }}
      >
        <CartesianGrid stroke="#e5e7eb" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={(v: string) => {
            // Date axis labels: drop the year to keep the ticks
            // legible at narrow widths. Tooltip still shows the full
            // YYYY-MM-DD so the year is recoverable on hover.
            const parts = v.split("-");
            if (parts.length === 3) return `${parts[2]}.${parts[1]}.`;
            return v;
          }}
          minTickGap={20}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b7280" }}
          allowDecimals={false}
        />
        <Tooltip
          formatter={(v, name) => {
            if (name === "Návštěvníci") return [v as number, "Návštěvníci"];
            return [v as number, "Zobrazení"];
          }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
        <Bar
          dataKey="hits"
          name="Zobrazení"
          fill={BRAND}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="hitsUnique"
          name="Návštěvníci"
          fill="#10b981"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
