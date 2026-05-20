"use client";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  CLOVER_CATEGORIES,
  CLOVER_KINDS_KNOWN,
  CLOVER_SOURCE_TYPES,
  CLOVER_VIBES,
} from "@/lib/cloverFactsLabels";
import type { CloverEnEntry, CloverText } from "@/lib/cloverTexts";
import { saveCloverTexts, type SaveResult } from "./save-action";

interface Props {
  initialTexts: CloverText[];
  initialTranslations: Readonly<Record<string, CloverEnEntry>>;
}

interface EnEntryForm {
  title: string;
  text: string;
  kind: string;
}

/** Sentinel value used in editingIndex to distinguish "new entry" from
 *  "editing existing index N". -1 = adding new; >=0 = editing index. */
const NEW_ENTRY = -1;

export function CloverTextsEditor({
  initialTexts,
  initialTranslations,
}: Props) {
  const [texts, setTexts] = useState<CloverText[]>(initialTexts);
  const [translations, setTranslations] = useState<
    Record<string, CloverEnEntry>
  >(() => ({ ...initialTranslations }));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Filter state
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterSourceType, setFilterSourceType] = useState<string>("");
  const [filterAuthor, setFilterAuthor] = useState<"any" | "author" | "regular">(
    "any",
  );

  // Save state
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<
    { which: "cs" | "en"; path: (string | number)[]; message: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();

  const dirty = useMemo(() => {
    return (
      JSON.stringify(texts) !== JSON.stringify(initialTexts) ||
      JSON.stringify(translations) !== JSON.stringify(initialTranslations)
    );
  }, [texts, initialTexts, translations, initialTranslations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return texts
      .map((t, idx) => ({ entry: t, idx }))
      .filter(({ entry }) => {
        if (filterCategory && entry.category !== filterCategory) return false;
        if (filterSourceType && entry.source_type !== filterSourceType)
          return false;
        if (filterAuthor === "author" && entry.author !== true) return false;
        if (filterAuthor === "regular" && entry.author === true) return false;
        if (q) {
          const hay = `${entry.title} ${entry.text}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [texts, query, filterCategory, filterSourceType, filterAuthor]);

  const nextAutoId = useMemo(() => {
    let max = 0;
    for (const t of texts) if (t.id > max) max = t.id;
    return max + 1;
  }, [texts]);

  function openNew() {
    setEditingIndex(NEW_ENTRY);
  }

  function openEdit(idx: number) {
    setEditingIndex(idx);
  }

  function closeEditor() {
    setEditingIndex(null);
  }

  function commitEdit(
    next: CloverText,
    enEntry: EnEntryForm,
    originalIdx: number | null,
  ) {
    // Validate id uniqueness against current texts (excluding the entry
    // being edited if any). The Zod schema does this server-side too,
    // but catching it here avoids a round-trip + lets the modal stay open.
    const dupIdx = texts.findIndex(
      (t, i) => t.id === next.id && i !== originalIdx,
    );
    if (dupIdx >= 0) {
      // Returning false from commit signals the modal to surface the
      // error inline rather than closing.
      return `ID ${next.id} už existuje (řádek ${dupIdx + 1})`;
    }
    setTexts((prev) => {
      const copy = [...prev];
      if (originalIdx === null || originalIdx === NEW_ENTRY) {
        copy.push(next);
      } else {
        copy[originalIdx] = next;
      }
      return copy;
    });
    setTranslations((prev) => {
      const copy = { ...prev };
      const key = String(next.id);
      if (enEntry.title.trim() === "" && enEntry.text.trim() === "") {
        // Empty EN form ⇒ remove translation (homepage will fall back
        // to CZ for that id).
        delete copy[key];
      } else {
        copy[key] = {
          title: enEntry.title.trim(),
          text: enEntry.text.trim(),
          ...(enEntry.kind.trim() ? { kind: enEntry.kind.trim() } : {}),
        };
      }
      // If the id changed (edit case), drop the old translation key.
      if (
        originalIdx !== null &&
        originalIdx !== NEW_ENTRY &&
        texts[originalIdx] &&
        texts[originalIdx]!.id !== next.id
      ) {
        delete copy[String(texts[originalIdx]!.id)];
      }
      return copy;
    });
    setSavedAt(null);
    setEditingIndex(null);
    return null;
  }

  function deleteEntry(idx: number) {
    const target = texts[idx];
    if (!target) return;
    if (!confirm(`Opravdu smazat lísteček #${target.id} – "${target.title}"?`))
      return;
    setTexts((prev) => prev.filter((_, i) => i !== idx));
    setTranslations((prev) => {
      const copy = { ...prev };
      delete copy[String(target.id)];
      return copy;
    });
    setEditingIndex(null);
    setSavedAt(null);
  }

  function reset() {
    setTexts(initialTexts);
    setTranslations({ ...initialTranslations });
    setSavedAt(null);
    setServerError(null);
    setServerIssues([]);
  }

  function save() {
    const fd = new FormData();
    fd.set("textsCs", JSON.stringify({ texts }));
    fd.set("translationsEn", JSON.stringify({ translations }));
    setServerError(null);
    setServerIssues([]);
    startTransition(async () => {
      const result: SaveResult = await saveCloverTexts(fd);
      if (result.ok) {
        setSavedAt(result.savedAt ?? new Date().toISOString());
        return;
      }
      if (result.error) setServerError(result.error);
      if (result.issues) setServerIssues(result.issues);
    });
  }

  const editingEntry =
    editingIndex === null
      ? null
      : editingIndex === NEW_ENTRY
        ? null
        : (texts[editingIndex] ?? null);

  return (
    <div className="space-y-3 pb-20">
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        category={filterCategory}
        onCategoryChange={setFilterCategory}
        sourceType={filterSourceType}
        onSourceTypeChange={setFilterSourceType}
        author={filterAuthor}
        onAuthorChange={setFilterAuthor}
        totalCount={texts.length}
        visibleCount={filtered.length}
      />

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
          Žádné lístečky neodpovídají filtru.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-2 text-left">ID</th>
                <th className="px-2 py-2 text-left">Kategorie</th>
                <th className="px-2 py-2 text-left">Title</th>
                <th className="px-2 py-2 text-left">Typ</th>
                <th className="px-2 py-2 text-left">Author</th>
                <th className="px-2 py-2 text-left">EN</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(({ entry, idx }) => (
                <tr key={`${entry.id}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 font-mono text-xs text-gray-600">
                    #{entry.id}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-700">
                    {entry.category}
                  </td>
                  <td
                    className="max-w-[26rem] truncate px-2 py-1.5 text-gray-900"
                    title={entry.title}
                  >
                    {entry.title}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-600">
                    {entry.source_type}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {entry.author ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
                        {entry.vibe ?? "bonus"}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-600">
                    {translations[String(entry.id)] ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <span className="text-amber-600">chybí</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(idx)}
                      className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:border-brand-300 hover:bg-brand-50"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Upravit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={openNew}
        className="inline-flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-brand-400 hover:bg-brand-50"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Přidat nový lísteček
      </button>

      {serverIssues.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          {serverIssues.map((iss, i) => (
            <li key={i}>
              <span className="font-mono">
                [{iss.which.toUpperCase()}] {iss.path.join("/")}
              </span>
              : {iss.message}
            </li>
          ))}
        </ul>
      )}

      {serverError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {serverError}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || isPending}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {isPending ? "Ukládám…" : "Uložit"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!dirty || isPending}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Reset
        </button>
        {savedAt && !dirty && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Uloženo{" "}
            {new Date(savedAt).toLocaleTimeString("cs-CZ", {
              timeZone: "Europe/Prague",
            })}
            . Hlavní stránka se obnoví automaticky.
          </span>
        )}
        {dirty && <span className="text-xs text-gray-500">Neuložené změny</span>}
      </div>

      {editingIndex !== null && (
        <EntryModal
          mode={editingIndex === NEW_ENTRY ? "new" : "edit"}
          entry={editingEntry}
          enEntry={
            editingEntry ? translations[String(editingEntry.id)] : undefined
          }
          defaultNewId={nextAutoId}
          onCommit={(next, enEntry) => commitEdit(next, enEntry, editingIndex)}
          onDelete={
            editingIndex !== NEW_ENTRY
              ? () => deleteEntry(editingIndex)
              : undefined
          }
          onClose={closeEditor}
        />
      )}
    </div>
  );
}

function FilterBar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  sourceType,
  onSourceTypeChange,
  author,
  onAuthorChange,
  totalCount,
  visibleCount,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  sourceType: string;
  onSourceTypeChange: (v: string) => void;
  author: "any" | "author" | "regular";
  onAuthorChange: (v: "any" | "author" | "regular") => void;
  totalCount: number;
  visibleCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-xs">
      <div className="relative">
        <Search
          className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Hledat v titulu nebo textu…"
          className="w-56 rounded border border-gray-300 py-1 pl-7 pr-2"
        />
      </div>
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1"
      >
        <option value="">Všechny kategorie</option>
        {CLOVER_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={sourceType}
        onChange={(e) => onSourceTypeChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1"
      >
        <option value="">Všechny typy</option>
        {CLOVER_SOURCE_TYPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={author}
        onChange={(e) =>
          onAuthorChange(e.target.value as "any" | "author" | "regular")
        }
        className="rounded border border-gray-300 px-2 py-1"
      >
        <option value="any">Vše</option>
        <option value="author">Jen author/bonus</option>
        <option value="regular">Jen regulární</option>
      </select>
      <span className="ml-auto text-gray-500">
        {visibleCount === totalCount
          ? `${totalCount} lístečků`
          : `${visibleCount} z ${totalCount}`}
      </span>
    </div>
  );
}

function EntryModal({
  mode,
  entry,
  enEntry,
  defaultNewId,
  onCommit,
  onDelete,
  onClose,
}: {
  mode: "new" | "edit";
  entry: CloverText | null;
  enEntry?: CloverEnEntry;
  defaultNewId: number;
  onCommit: (next: CloverText, en: EnEntryForm) => string | null;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [id, setId] = useState<number>(entry?.id ?? defaultNewId);
  const [category, setCategory] = useState<string>(
    entry?.category ?? CLOVER_CATEGORIES[0],
  );
  const [sourceType, setSourceType] = useState<string>(
    entry?.source_type ?? CLOVER_SOURCE_TYPES[0],
  );
  const [author, setAuthor] = useState<boolean>(entry?.author === true);
  const [kind, setKind] = useState<string>(entry?.kind ?? "");
  const [vibe, setVibe] = useState<string>(entry?.vibe ?? "");
  const [link, setLink] = useState<string>(entry?.link ?? "");
  const [title, setTitle] = useState<string>(entry?.title ?? "");
  const [text, setText] = useState<string>(entry?.text ?? "");
  const [enTitle, setEnTitle] = useState<string>(enEntry?.title ?? "");
  const [enText, setEnText] = useState<string>(enEntry?.text ?? "");
  const [enKind, setEnKind] = useState<string>(enEntry?.kind ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!title.trim() || !text.trim()) {
      setError("Title a text (CZ) jsou povinné.");
      return;
    }
    const next: CloverText = {
      id,
      category,
      title: title.trim(),
      text: text.trim(),
      source_type: sourceType as CloverText["source_type"],
      ...(author ? { author: true } : {}),
      ...(author && kind.trim() ? { kind: kind.trim() } : {}),
      ...(author && vibe ? { vibe: vibe as CloverText["vibe"] } : {}),
      ...(link.trim() ? { link: link.trim() } : {}),
    };
    const enForm: EnEntryForm = {
      title: enTitle,
      text: enText,
      kind: enKind,
    };
    const err = onCommit(next, enForm);
    if (err) setError(err);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            {mode === "new" ? "Nový lísteček" : `Upravit lísteček #${entry?.id}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Zavřít"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {/* Metadata row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="ID">
              <input
                type="number"
                value={id}
                onChange={(e) => setId(Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                min={1}
              />
            </Field>
            <Field label="Kategorie">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              >
                {CLOVER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source type">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              >
                {CLOVER_SOURCE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Author/bonus">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={author}
                  onChange={(e) => setAuthor(e.target.checked)}
                />
                Bonus entry
              </label>
            </Field>
          </div>

          {author && (
            <div className="grid grid-cols-2 gap-3 rounded-md bg-emerald-50/40 p-3">
              <Field label="Kind (CZ)">
                <input
                  type="text"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  list="clover-kinds-list"
                  placeholder="např. Rada autora"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <datalist id="clover-kinds-list">
                  {CLOVER_KINDS_KNOWN.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </Field>
              <Field label="Vibe">
                <select
                  value={vibe}
                  onChange={(e) => setVibe(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">(default emerald)</option>
                  {CLOVER_VIBES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <Field label="Link (odkaz na detail nálezu apod.)">
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/sbirka/666"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </Field>

          {/* CZ + EN side-by-side */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border border-gray-200 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Čeština (zdrojový text)
              </h3>
              <Field label="Title CZ">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Text CZ">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </Field>
            </div>
            <div className="space-y-2 rounded-md border border-gray-200 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Angličtina (překlad — volitelný)
              </h3>
              <Field label="Title EN">
                <input
                  type="text"
                  value={enTitle}
                  onChange={(e) => setEnTitle(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Text EN">
                <textarea
                  value={enText}
                  onChange={(e) => setEnText(e.target.value)}
                  rows={8}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </Field>
              {author && (
                <Field label="Kind EN (volitelný)">
                  <input
                    type="text"
                    value={enKind}
                    onChange={(e) => setEnKind(e.target.value)}
                    placeholder="např. Author's advice"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </Field>
              )}
              <p className="text-[11px] text-gray-500">
                Prázdné EN pole = překlad bude smazán a homepage spadne na CZ.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">
              <AlertCircle className="mr-1 inline h-3 w-3" aria-hidden />
              {error}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-5 py-3">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              Smazat lísteček
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={submit}
              className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Save className="h-3 w-3" aria-hidden />
              Potvrdit
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}
