"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { colorFor } from "../palette";
import type { CategoryPoint } from "@/lib/queries/stats";

export function CategoryPieChart({
  data,
}: {
  data: readonly CategoryPoint[];
}) {
  if (data.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-gray-400">
        Žádná data.
      </p>
    );
  }
  const rows = data.map((r, i) => ({
    ...r,
    label: r.name,
    fill: colorFor(i),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={rows}
          dataKey="count"
          nameKey="label"
          innerRadius="55%"
          outerRadius="90%"
          isAnimationActive={false}
          label={(props: { payload?: { label?: string; count?: number } }) => {
            const p = props.payload;
            if (!p) return "";
            return `${p.label ?? ""} (${p.count ?? 0})`;
          }}
          labelLine={false}
        >
          {rows.map((entry, i) => (
            <Cell key={entry.name + String(i)} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v, name) => [v as number, name as string]}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
