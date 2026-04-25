"use client";

/**
 * Dynamic shim for all Recharts-backed charts. Recharts 3.x transitively
 * imports something that trips Next.js App Router's "Html outside of
 * _document" check during /500 prerender. Wrapping each chart with
 * dynamic({ ssr: false }) keeps recharts out of the server bundle entirely.
 */

import dynamic from "next/dynamic";

const SKELETON = (
  <div className="flex h-full items-center justify-center text-xs text-gray-400">
    Načítám graf…
  </div>
);

export const MonthlyLineChart = dynamic(
  () => import("./charts/monthly-line").then((m) => m.MonthlyLineChart),
  { ssr: false, loading: () => SKELETON },
);

export const YearlyBarChart = dynamic(
  () => import("./charts/yearly-bars").then((m) => m.YearlyBarChart),
  { ssr: false, loading: () => SKELETON },
);

export const TopLocationsChart = dynamic(
  () => import("./charts/top-locations").then((m) => m.TopLocationsChart),
  { ssr: false, loading: () => SKELETON },
);

export const CategoryPieChart = dynamic(
  () => import("./charts/category-pie").then((m) => m.CategoryPieChart),
  { ssr: false, loading: () => SKELETON },
);
