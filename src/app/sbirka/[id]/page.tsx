import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageGallery } from "@/components/finds/image-gallery";
import { StateBadges } from "@/components/finds/state-badges";
import { formatDateCs, formatDateTimeCs } from "@/lib/format";
import { getFindById, getAllFindIds } from "@/lib/queries/finds";

interface PageProps {
  params: Promise<{ id: string }>;
}

// Must be a literal for Next.js static analysis. Matches FIND_REVALIDATE in
// src/lib/constants.ts (24 hours).
export const revalidate = 86400;

export async function generateStaticParams() {
  // Pre-render finds that exist at build time; further IDs use ISR.
  const ids = await getAllFindIds();
  return ids.map((id) => ({ id: String(id) }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return { title: "Nenalezeno" };
  }
  const find = await getFindById(numId);
  if (!find) {
    return { title: "Nenalezeno" };
  }
  // Anonymized finds must not be indexed and must not leak data in meta tags.
  if (find.isAnonymized) {
    return {
      title: `Nález č. ${find.id}`,
      description: `Anonymizovaný nález č. ${find.id}.`,
      robots: { index: false, follow: false },
    };
  }
  const locationName =
    find.location?.displayName ?? find.location?.code ?? "bez lokality";
  const title = `Nález č. ${find.id} – ${locationName}`;
  const description = `Čtyřlístkový nález, lokalita ${locationName}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
  };
}

export default async function FindDetailPage({ params }: PageProps) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();
  const find = await getFindById(numId);
  if (!find) notFound();

  const locationLabel =
    find.location?.displayName ?? find.location?.code ?? "Bez lokality";

  return (
    <article className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav className="text-sm text-gray-500">
        <Link href="/sbirka" className="hover:text-brand-700">
          ← Zpět na sbírku
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">
          Nález č. {find.id}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <span>{formatDateCs(find.foundAt)}</span>
          <span aria-hidden>·</span>
          <span>{locationLabel}</span>
        </div>
        {find.states.length > 0 && <StateBadges states={find.states} />}
      </header>

      <ImageGallery
        images={find.images}
        altBase={`Nález č. ${find.id}`}
      />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel title="Detaily">
          <KeyValue label="ID nálezu" value={`#${find.id}`} />
          <KeyValue
            label="Datum nálezu"
            value={formatDateTimeCs(find.foundAt)}
          />
          {find.location && (
            <>
              <KeyValue label="Lokalita" value={find.location.displayName} />
              <KeyValue label="Kód lokality" value={find.location.code} />
            </>
          )}
        </Panel>

        <Panel title="Souřadnice a poznámka">
          {find.isAnonymized && (
            <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
              Tento nález je anonymizovaný — přesné souřadnice a poznámka se
              na veřejném webu nezobrazují.
            </p>
          )}
          {find.coordinates ? (
            <KeyValue
              label="GPS"
              value={`${find.coordinates.lat.toFixed(5)}, ${find.coordinates.lng.toFixed(5)}${
                find.isAnonymized ? " (přibližné)" : ""
              }`}
            />
          ) : (
            <KeyValue label="GPS" value="Není k dispozici" />
          )}
          {!find.isAnonymized && find.notes && (
            <div className="mt-2">
              <p className="text-xs font-medium text-gray-500">Poznámka</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                {find.notes}
              </p>
            </div>
          )}
        </Panel>
      </section>
    </article>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}
