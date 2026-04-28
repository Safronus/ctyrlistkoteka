/**
 * Skeleton placeholders shown inside `<Suspense>` boundaries on
 * /statistiky while each section's data fetcher is in flight. They
 * match the rough layout (paddings, grid columns, row counts) of the
 * real sections so the page doesn't shift once content streams in,
 * and use `animate-pulse` for the active-loading affordance.
 *
 * Pure server components — no interactivity. The `prefers-reduced-motion`
 * fallback that disables the pulse lives in globals.css next to the
 * other motion-sensitive overrides on the project.
 */

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

export function TotalsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TotalCardSkeleton />
      <TotalCardSkeleton />
    </section>
  );
}

function TotalCardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <Block className="mx-auto h-12 w-1/3" />
      <Block className="mx-auto h-4 w-1/4" />
      <div className="grid grid-cols-2 gap-2 pt-3">
        <Block className="h-8" />
        <Block className="h-8" />
        <Block className="h-8" />
        <Block className="h-8" />
      </div>
    </div>
  );
}

export function HighlightsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="space-y-3 rounded-xl border border-gray-200 bg-white p-5"
        >
          <Block className="h-3 w-1/4" />
          <Block className="h-7 w-1/3" />
          <Block className="h-4 w-2/3" />
          <Block className="h-4 w-1/2" />
        </div>
      ))}
    </section>
  );
}

export function PeaksSkeleton() {
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="space-y-2 rounded-xl border border-gray-200 bg-white p-4"
        >
          <Block className="h-3 w-2/3" />
          <Block className="mt-2 h-7 w-1/2" />
          <Block className="h-3 w-3/4" />
        </div>
      ))}
    </section>
  );
}

export function JubileesSkeleton() {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <Block className="h-5 w-40" />
      <Block className="h-3 w-56" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <Block key={i} className="h-12" />
        ))}
      </div>
    </section>
  );
}

export function TopLocationsSkeleton() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 space-y-2">
        <Block className="h-5 w-32" />
        <Block className="h-3 w-56" />
      </div>
      <ol className="space-y-2">
        {Array.from({ length: 10 }, (_, i) => (
          <li
            key={i}
            className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-3"
          >
            <div className="flex items-center gap-3">
              <Block className="h-4 w-6 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <Block className="h-3 w-3/4" />
                <Block className="h-3 w-2/3" />
              </div>
              <Block className="h-7 w-16 shrink-0" />
            </div>
            <Block className="h-2 w-full" />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GeoSkeleton() {
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <Block className="h-5 w-48" />
        <Block className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Block className="h-64" />
        <Block className="h-64" />
      </div>
      <Block className="h-96 w-full" />
    </section>
  );
}

export function CalendarSkeleton() {
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <Block className="h-5 w-40" />
        <Block className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Block className="h-48" />
        <Block className="h-48" />
      </div>
      <Block className="h-72" />
      <Block className="h-64" />
    </section>
  );
}

export function DistanceSkeleton() {
  // Match the histogram's eight-bucket layout. Heights vary so the
  // skeleton suggests "this will be a chart" instead of looking like
  // a flat banner. Static class list — Tailwind needs literal values.
  const HEIGHTS = ["h-16", "h-24", "h-32", "h-20", "h-28", "h-12", "h-20", "h-16"];
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <Block className="h-5 w-56" />
      <Block className="h-3 w-72" />
      <div className="flex h-32 items-end gap-1 pt-2">
        {HEIGHTS.map((h, i) => (
          <Block key={i} className={`flex-1 ${h}`} />
        ))}
      </div>
    </section>
  );
}
