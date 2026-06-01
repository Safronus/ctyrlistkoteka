"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  hierarchyChildCode,
  hierarchyChildMapDefault,
  type LokaceHierarchie,
} from "@/lib/admin/jsonSchema";
import type { LocationOption } from "./page";
import { saveLokaceHierarchie, type SaveResult } from "./save-action";

interface Props {
  initialHierarchy: LokaceHierarchie;
  locations: LocationOption[];
}

/** One child in the editor. `map` mirrors the `{ "code": ..., "map":
 *  true }` form in LokaceHierarchie.json — true means the child's
 *  polygon overlays the parent on /mapa by default. */
interface ChildEntry {
  code: string;
  map: boolean;
}

interface Group {
  parent: string;
  children: ChildEntry[];
}

function hierarchyToGroups(h: LokaceHierarchie): Group[] {
  return Object.entries(h).map(([parent, children]) => ({
    parent,
    children: children.map((c) => ({
      code: hierarchyChildCode(c),
      map: hierarchyChildMapDefault(c),
    })),
  }));
}

function groupsToHierarchy(groups: Group[]): LokaceHierarchie {
  const out: LokaceHierarchie = {};
  // Serialise back to the union shape: a plain string when the child
  // is default-hidden (the legacy form, keeps diffs minimal) and the
  // `{ code, map: true }` object only for children flagged to overlay
  // the parent on /mapa.
  for (const g of groups) {
    out[g.parent] = g.children.map((c) =>
      c.map ? { code: c.code, map: true } : c.code,
    );
  }
  return out;
}

export function LokaceHierarchieEditor({
  initialHierarchy,
  locations,
}: Props) {
  const [groups, setGroups] = useState<Group[]>(() =>
    hierarchyToGroups(initialHierarchy),
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<
    { path: (string | number)[]; message: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();

  const locationsByCode = useMemo(() => {
    const m = new Map<string, LocationOption>();
    for (const l of locations) m.set(l.code, l);
    return m;
  }, [locations]);

  // Codes that are already used somewhere in the hierarchy (as parent
  // or child). Used to filter the pickers so the user can't double-
  // assign a location.
  const assignedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      set.add(g.parent);
      for (const c of g.children) set.add(c.code);
    }
    return set;
  }, [groups]);

  // Dirty check via order-sensitive structural compare. Insertion
  // order of `groups` and per-group `children` is preserved across
  // edits, so byte-equality of the serialised form matches user-
  // visible state.
  const dirty = useMemo(() => {
    const currentJson = formatJsonCompactArrays(groupsToHierarchy(groups));
    const initialJson = formatJsonCompactArrays(initialHierarchy);
    return currentJson !== initialJson;
  }, [groups, initialHierarchy]);

  const availableForNewParent = useMemo(
    () => locations.filter((l) => !assignedCodes.has(l.code)),
    [locations, assignedCodes],
  );

  function availableForChild(parentCode: string): LocationOption[] {
    return locations.filter(
      (l) => l.code !== parentCode && !assignedCodes.has(l.code),
    );
  }

  function addGroup(parentCode: string) {
    if (!parentCode) return;
    if (groups.some((g) => g.parent === parentCode)) return;
    setGroups((prev) => [...prev, { parent: parentCode, children: [] }]);
    setSavedAt(null);
  }

  function removeGroup(parentCode: string) {
    setGroups((prev) => prev.filter((g) => g.parent !== parentCode));
    setSavedAt(null);
  }

  function addChild(parentCode: string, childCode: string) {
    if (!childCode) return;
    setGroups((prev) =>
      prev.map((g) =>
        g.parent === parentCode
          ? {
              ...g,
              children: [...g.children, { code: childCode, map: false }],
            }
          : g,
      ),
    );
    setSavedAt(null);
  }

  function removeChild(parentCode: string, childCode: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.parent === parentCode
          ? { ...g, children: g.children.filter((c) => c.code !== childCode) }
          : g,
      ),
    );
    setSavedAt(null);
  }

  // Flip a child's "default na mapě" flag — when on, its polygon
  // overlays the parent on /mapa without a sidebar opt-in (the
  // `{ code, map: true }` shape). Off = legacy default-hidden string.
  function toggleChildMap(parentCode: string, childCode: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.parent === parentCode
          ? {
              ...g,
              children: g.children.map((c) =>
                c.code === childCode ? { ...c, map: !c.map } : c,
              ),
            }
          : g,
      ),
    );
    setSavedAt(null);
  }

  function reset() {
    setGroups(hierarchyToGroups(initialHierarchy));
    setSavedAt(null);
    setServerError(null);
    setServerIssues([]);
  }

  function save() {
    // Drop empty groups before serialising — the Zod schema requires
    // each group to have ≥1 child. The user gets a notice about the
    // drop above; this matches the file representation `sync.ts`
    // expects.
    const nonEmpty = groups.filter((g) => g.children.length > 0);
    const payload = groupsToHierarchy(nonEmpty);
    const fd = new FormData();
    fd.set("content", formatJsonCompactArrays(payload));
    setServerError(null);
    setServerIssues([]);
    startTransition(async () => {
      const result: SaveResult = await saveLokaceHierarchie(fd);
      if (result.ok) {
        setSavedAt(result.savedAt ?? new Date().toISOString());
        return;
      }
      if (result.parseError) {
        setServerError(`Parse error: ${result.parseError.message}`);
      } else if (result.error) {
        setServerError(result.error);
      }
      if (result.issues) setServerIssues(result.issues);
    });
  }

  const childlessParents = groups
    .filter((g) => g.children.length === 0)
    .map((g) => g.parent);

  // Server-side issues whose path doesn't match any current group go
  // into a generic block below the cards.
  const globalIssues = serverIssues.filter(
    (iss) => typeof iss.path[0] !== "string" || !groups.some((g) => g.parent === iss.path[0]),
  );

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <p>
          Ikona oka u dítěte přepíná „defaultně na mapě“ — když je{" "}
          <span className="font-medium text-emerald-700">zelená</span>, polygon
          dítěte se na <span className="font-mono">/mapa</span> zobrazí přes
          rodičovský polygon hned po načtení (bez nutnosti zapnout ho v
          postranním panelu). Změny se projeví až po spuštění synchronizace.
        </p>
      </div>

      {childlessParents.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Skupiny bez dětí budou při uložení vynechány:{" "}
          <span className="font-mono">{childlessParents.join(", ")}</span>.
        </div>
      )}

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
          Zatím žádné rodičovské skupiny. Přidej první níže.
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const parentInfo = locationsByCode.get(g.parent);
          const childOptions = availableForChild(g.parent);
          const issuesForGroup = serverIssues.filter(
            (i) => i.path[0] === g.parent,
          );
          return (
            <div
              key={g.parent}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">
                      {g.parent}
                    </span>
                    {parentInfo ? (
                      <span className="text-sm text-gray-700">
                        {parentInfo.name}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                        <AlertCircle className="h-3 w-3" aria-hidden />
                        Nelze najít v DB
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {g.children.length} {pluralChildren(g.children.length)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeGroup(g.parent)}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  Odstranit skupinu
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {g.children.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {g.children.map((c) => {
                      const childInfo = locationsByCode.get(c.code);
                      return (
                        <li key={c.code}>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border py-1 pl-2 pr-1 text-xs ${
                              c.map
                                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                : "border-gray-200 bg-gray-50 text-gray-700"
                            }`}
                          >
                            <span className="font-mono">{c.code}</span>
                            {childInfo ? (
                              <span
                                className={
                                  c.map ? "text-emerald-700" : "text-gray-500"
                                }
                              >
                                — {childInfo.name}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-red-700">
                                <AlertCircle className="h-3 w-3" aria-hidden />
                                není v DB
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleChildMap(g.parent, c.code)}
                              aria-pressed={c.map}
                              className={`ml-0.5 inline-flex items-center rounded-full p-1 ${
                                c.map
                                  ? "text-emerald-700 hover:bg-emerald-100"
                                  : "text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                              }`}
                              title={
                                c.map
                                  ? "Defaultně na mapě — kliknutím skryješ"
                                  : "Defaultně skryté na mapě — kliknutím zobrazíš"
                              }
                            >
                              {c.map ? (
                                <Eye className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeChild(g.parent, c.code)}
                              className="inline-flex items-center rounded-full p-1 text-gray-400 hover:bg-red-100 hover:text-red-600"
                              title="Odebrat dítě"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {childOptions.length > 0 ? (
                  <AddChildPicker
                    options={childOptions}
                    onAdd={(code) => addChild(g.parent, code)}
                  />
                ) : (
                  <p className="text-xs text-gray-400">
                    Žádné další lokality k přiřazení.
                  </p>
                )}
              </div>

              {issuesForGroup.length > 0 && (
                <ul className="mt-2 space-y-0.5 rounded bg-red-50 p-2 text-xs text-red-900">
                  {issuesForGroup.map((iss, idx) => (
                    <li key={idx}>{iss.message}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <NewGroupPicker
        options={availableForNewParent}
        onAdd={addGroup}
        hasGroups={groups.length > 0}
      />

      {globalIssues.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          {globalIssues.map((iss, idx) => (
            <li key={idx}>
              <span className="font-mono">{iss.path.join("/")}</span>:{" "}
              {iss.message}
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
            .
            <Link
              href="/admin/sync"
              className="ml-1 inline-flex items-center gap-1 underline hover:text-emerald-900"
            >
              <Database className="h-3 w-3" aria-hidden />
              Spusť sync pro promítnutí do DB
            </Link>
          </span>
        )}
        {dirty && (
          <span className="text-xs text-gray-500">Neuložené změny</span>
        )}
      </div>
    </div>
  );
}

function AddChildPicker({
  options,
  onAdd,
}: {
  options: LocationOption[];
  onAdd: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-xs"
        aria-label="Vyber dětskou lokaci"
      >
        <option value="">— vyber dítě —</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code} — {o.name}
            {!o.hasFinds && " (bez nálezů)"}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (!value) return;
          onAdd(value);
          setValue("");
        }}
        disabled={!value}
        className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3 w-3" aria-hidden />
        Přidat dítě
      </button>
    </div>
  );
}

function NewGroupPicker({
  options,
  onAdd,
  hasGroups,
}: {
  options: LocationOption[];
  onAdd: (code: string) => void;
  hasGroups: boolean;
}) {
  const [value, setValue] = useState("");
  if (options.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        {hasGroups
          ? "Všechny lokace jsou už zařazené v hierarchii."
          : "Žádné lokace v DB — nejdřív spusť sync."}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-3">
      <span className="text-sm font-medium text-gray-700">
        Nová rodičovská skupina:
      </span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        aria-label="Vyber rodičovskou lokaci"
      >
        <option value="">— vyber lokaci —</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code} — {o.name}
            {!o.hasFinds && " (bez nálezů)"}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (!value) return;
          onAdd(value);
          setValue("");
        }}
        disabled={!value}
        className="inline-flex items-center gap-1 rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Přidat skupinu
      </button>
    </div>
  );
}

function pluralChildren(n: number): string {
  if (n === 1) return "dítě";
  if (n >= 2 && n <= 4) return "děti";
  return "dětí";
}
