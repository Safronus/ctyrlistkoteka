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
 *  on /statistiky shape so the visual language stays consistent
 *  across the project.
 *
 *  One `<Bar>` only — when there are two side-by-side series Recharts
 *  splits each category band between them and the first bar sits in
 *  the LEFT half of the band, off-centre from the tick label. Since
 *  total hits and unique visitors aren't additive (a unique visitor
 *  IS one of the hits — stacking would visually double-count) we
 *  collapse the visualization to a single bar for total hits and
 *  surface the unique-visitor count in the tooltip alongside. */
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
          // Custom content so both `hits` and `hitsUnique` show even
          // though only one series is rendered as a Bar. Recharts'
          // default Tooltip pulls only from rendered series; we read
          // the raw data row off `payload[0].payload` instead.
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const row = payload[0]?.payload as DailyPoint | undefined;
            if (!row) return null;
            return (
              <div
                style={{
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  padding: "6px 10px",
                  fontSize: 12,
                  color: "#111827",
                }}
              >
                <div style={{ color: "#6b7280", marginBottom: 2 }}>
                  {String(label)}
                </div>
                <div>
                  <span style={{ color: BRAND, fontWeight: 600 }}>
                    {row.hits}
                  </span>{" "}
                  zobrazení
                </div>
                <div style={{ color: "#6b7280" }}>
                  {row.hitsUnique} návštěvníků
                </div>
              </div>
            );
          }}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <Bar
          dataKey="hits"
          name="Zobrazení"
          fill={BRAND}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
