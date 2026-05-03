"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  Wand2,
} from "lucide-react";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  SECTION_SCHEMAS,
  type SectionKey,
} from "@/lib/admin/jsonSchema";
import { parseRanges } from "@/lib/parseRanges";
import { saveLokaceStavyPoznamky, type SaveResult } from "./save-action";

interface Props {
  /** Pre-split per-section JSON strings (already pretty-printed). */
  initialSections: Record<SectionKey, string>;
  /** ISO timestamp of the file's last write — shown in the header. */
  fileMtime: string | null;
}

interface SectionStatus {
  ok: boolean;
  parseError: string | null;
  schemaIssues: { path: (string | number)[]; message: string }[];
}

function validateSection(key: SectionKey, content: string): SectionStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      parseError: err instanceof Error ? err.message : String(err),
      schemaIssues: [],
    };
  }
  const schema = SECTION_SCHEMAS[key];
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      parseError: null,
      schemaIssues: result.error.issues.map((i) => ({
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }
  return { ok: true, parseError: null, schemaIssues: [] };
}

export function LokaceStavyPoznamkyEditor({
  initialSections,
  fileMtime,
}: Props) {
  const [sections, setSections] =
    useState<Record<SectionKey, string>>(initialSections);
  const [activeTab, setActiveTab] = useState<SectionKey>("lokace");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<
    { path: (string | number)[]; message: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();

  // Per-section live status — recomputed on edit. Each section
  // validates independently against its own sub-schema, so the user
  // sees which tab(s) need attention without scanning the full file.
  const statuses = useMemo<Record<SectionKey, SectionStatus>>(() => {
    const out = {} as Record<SectionKey, SectionStatus>;
    for (const key of SECTION_KEYS) {
      out[key] = validateSection(key, sections[key]);
    }
    return out;
  }, [sections]);

  const dirty = useMemo(() => {
    for (const key of SECTION_KEYS) {
      if (sections[key] !== initialSections[key]) return true;
    }
    return false;
  }, [sections, initialSections]);

  // Per-tab counter — total IDs (after parseRanges expansion) for
  // anonymizace / stavy / lokace, total entries for poznamky. Computed
  // live so the count tracks the textarea even before save. parseRanges
  // throws on malformed input; we swallow that and surface `?` instead
  // so a half-typed range doesn't flash an error in the tab strip.
  const counts = useMemo(() => {
    const out: Record<SectionKey, number | null> = {
      lokace: null,
      stavy: null,
      poznamky: null,
      anonymizace: null,
    };
    for (const key of SECTION_KEYS) {
      out[key] = computeSectionCount(key, sections[key]);
    }
    return out;
  }, [sections]);

  const allValid = useMemo(
    () => SECTION_KEYS.every((k) => statuses[k].ok),
    [statuses],
  );

  const onChangeSection = (key: SectionKey, value: string) => {
    setSections((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
    setServerError(null);
    setServerIssues([]);
  };

  const onFormat = (key: SectionKey) => {
    try {
      const obj = JSON.parse(sections[key]);
      onChangeSection(key, formatJsonCompactArrays(obj));
    } catch {
      // Format only works when JSON parses; ignore otherwise.
    }
  };

  const onResetSection = (key: SectionKey) => {
    setSections((prev) => ({ ...prev, [key]: initialSections[key] }));
    setSavedAt(null);
    setServerError(null);
    setServerIssues([]);
  };

  const onResetAll = () => {
    setSections(initialSections);
    setSavedAt(null);
    setServerError(null);
    setServerIssues([]);
  };

  const onSave = () => {
    if (isPending || !allValid) return;
    setServerError(null);
    setServerIssues([]);

    // Stitch the four sections back into the canonical full object.
    // Order matches the schema declaration so the on-disk file stays
    // diff-friendly across saves.
    let merged: unknown;
    try {
      merged = {
        anonymizace: JSON.parse(sections.anonymizace),
        lokace: JSON.parse(sections.lokace),
        poznamky: JSON.parse(sections.poznamky),
        stavy: JSON.parse(sections.stavy),
      };
    } catch (err) {
      setServerError(
        err instanceof Error
          ? `Sloučení sekcí selhalo: ${err.message}`
          : "Sloučení sekcí selhalo",
      );
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.append("content", JSON.stringify(merged));
      try {
        const result: SaveResult = await saveLokaceStavyPoznamky(fd);
        if (result.ok) {
          setSavedAt(result.savedAt ?? new Date().toISOString());
        } else {
          setServerError(
            result.error ??
              result.parseError?.message ??
              (result.issues
                ? `${result.issues.length} chyb ve schématu (server)`
                : "Uložení selhalo"),
          );
          if (result.issues) setServerIssues(result.issues);
        }
      } catch (err) {
        setServerError(
          err instanceof Error ? err.message : "Uložení selhalo",
        );
      }
    });
  };

  const activeStatus = statuses[activeTab];
  const showIssues =
    serverIssues.length > 0 ? serverIssues : activeStatus.schemaIssues;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand-600" aria-hidden />
          <span className="font-mono text-xs">
            data/meta/LokaceStavyPoznamky.json
          </span>
          {fileMtime && (
            <span className="text-xs text-gray-500">
              · poslední zápis{" "}
              {new Date(fileMtime).toLocaleString("cs-CZ", {
                timeZone: "Europe/Prague",
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <OverallBadge allValid={allValid} dirty={dirty} />
          {savedAt && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Uloženo{" "}
              {new Date(savedAt).toLocaleTimeString("cs-CZ", {
                timeZone: "Europe/Prague",
              })}
            </span>
          )}
        </div>
      </header>

      <nav
        aria-label="Sekce JSONu"
        className="flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 text-xs"
      >
        {SECTION_KEYS.map((key) => {
          const isActive = key === activeTab;
          const status = statuses[key];
          const isDirty = sections[key] !== initialSections[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {SECTION_LABELS[key]}
              <span
                className={`font-mono tabular-nums ${
                  isActive ? "text-brand-100" : "text-gray-500"
                }`}
                title={
                  key === "poznamky"
                    ? "Počet poznámek (klíčů v sekci)"
                    : "Počet ID nálezů po expanzi rangů"
                }
              >
                {counts[key] !== null ? counts[key]!.toLocaleString("cs-CZ") : "?"}
              </span>
              {!status.ok && (
                <AlertCircle
                  className={`h-3.5 w-3.5 ${
                    isActive ? "text-red-200" : "text-red-600"
                  }`}
                  aria-hidden
                />
              )}
              {isDirty && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive ? "bg-amber-200" : "bg-amber-500"
                  }`}
                  aria-label="Neuložené změny"
                />
              )}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onResetAll}
          disabled={!dirty || isPending}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Vrátit vše
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!allValid || !dirty || isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1 font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3 w-3" aria-hidden />
          )}
          Uložit
        </button>
      </nav>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">Aktivní:</span>
        <span className="font-semibold text-gray-900">
          {SECTION_LABELS[activeTab]}
        </span>
        <button
          type="button"
          onClick={() => onFormat(activeTab)}
          disabled={!activeStatus.ok && activeStatus.parseError !== null}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="h-3 w-3" aria-hidden />
          Naformátovat
        </button>
        <button
          type="button"
          onClick={() => onResetSection(activeTab)}
          disabled={
            sections[activeTab] === initialSections[activeTab] || isPending
          }
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Vrátit sekci
        </button>
      </div>

      {serverError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>Server:</strong> {serverError}
        </p>
      )}

      {activeStatus.parseError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>JSON syntax:</strong> {activeStatus.parseError}
        </p>
      )}

      {showIssues.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs">
          <p className="mb-1 font-semibold text-red-900">
            {showIssues.length}{" "}
            {showIssues.length === 1
              ? "chyba"
              : showIssues.length < 5
                ? "chyby"
                : "chyb"}{" "}
            ve schématu:
          </p>
          <ul className="space-y-1 font-mono text-red-800">
            {showIssues.slice(0, 30).map((i, idx) => (
              <li key={idx}>
                <code>{i.path.length === 0 ? "(root)" : i.path.join(".")}</code>
                : {i.message}
              </li>
            ))}
            {showIssues.length > 30 && (
              <li className="font-sans italic text-red-700">
                … a dalších {showIssues.length - 30}
              </li>
            )}
          </ul>
        </div>
      )}

      <CodeEditor
        value={sections[activeTab]}
        onChange={(v) => onChangeSection(activeTab, v)}
      />

      <p className="text-xs text-gray-500">
        Validace běží live (klient) i znovu při uložení (server, Zod). Při
        uložení server zazálohuje aktuální verzi do{" "}
        <code className="font-mono">data/.trash/&lt;ts&gt;/meta/</code> a
        atomicky přepíše živý soubor.
      </p>
    </div>
  );
}

function OverallBadge({
  allValid,
  dirty,
}: {
  allValid: boolean;
  dirty: boolean;
}) {
  if (!allValid) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        Některá sekce má chybu
      </span>
    );
  }
  if (!dirty) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Beze změn
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      Validní · připraveno k uložení
    </span>
  );
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
}

/** Textarea + line-number gutter. The two share a flex container,
 *  scroll in lockstep via the `onScroll` handler, and live in a
 *  scroll-y wrapper so vertical and horizontal scrollbars stay
 *  attached to the editor (not the page). Keeping this in-house
 *  avoids pulling in CodeMirror just for line numbers. */
function CodeEditor({ value, onChange }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Recomputing the gutter on every keystroke is fine — the line
  // count is a single split() on a string already in memory.
  const lines = useMemo(() => {
    const n = value === "" ? 1 : value.split("\n").length;
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [value]);

  const onScroll = useCallback(() => {
    if (!textareaRef.current || !gutterRef.current) return;
    gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  }, []);

  // Two-way Tab handling: indent rather than shift focus. Plain HTML
  // textareas tab out of the field by default which is annoying for
  // a code editor. Insert two spaces (matches our JSON.stringify
  // indent) on Tab.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const indent = "  ";
      const next =
        value.slice(0, start) + indent + value.slice(end);
      onChange(next);
      // Restore caret right after the inserted indent.
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + indent.length;
      });
    },
    [value, onChange],
  );

  // Keep gutter scroll in sync if `value` changes from outside (e.g.
  // Format / Reset) and the textarea repositions to top.
  useEffect(() => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, [value]);

  return (
    <div className="relative flex h-[60vh] overflow-hidden rounded-lg border border-gray-300 bg-gray-900 font-mono text-xs leading-relaxed shadow-inner">
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none overflow-hidden bg-gray-800 px-2 py-3 text-right text-gray-500"
        style={{ minWidth: "3.5rem" }}
      >
        {lines.map((n) => (
          <div key={n} className="tabular-nums">
            {n}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        wrap="off"
        className="block flex-1 resize-none whitespace-pre overflow-auto bg-gray-900 px-3 py-3 text-gray-100 outline-none"
      />
    </div>
  );
}

/** Counts what each section logically holds:
 *    anonymizace.ANONYMIZOVANE → expanded ID count
 *    stavy → sum of expanded IDs across every state key
 *    lokace → sum of expanded IDs across every map ID
 *    poznamky → number of keys (each key = one note)
 *  Returns null when the textarea isn't valid JSON yet — the tab
 *  strip then shows "?" instead of flashing 0. */
function computeSectionCount(
  section: SectionKey,
  raw: string,
): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const sumRangeArrays = (
    obj: Record<string, unknown>,
  ): number | null => {
    let total = 0;
    for (const value of Object.values(obj)) {
      if (!Array.isArray(value)) continue;
      try {
        total += parseRanges(value as string[]).length;
      } catch {
        return null;
      }
    }
    return total;
  };

  if (section === "anonymizace") {
    const arr = (parsed as { ANONYMIZOVANE?: unknown }).ANONYMIZOVANE;
    if (!Array.isArray(arr)) return null;
    try {
      return parseRanges(arr as string[]).length;
    } catch {
      return null;
    }
  }
  if (section === "poznamky") {
    return Object.keys(parsed as Record<string, unknown>).length;
  }
  // stavy + lokace are both record<string, string[]>
  return sumRangeArrays(parsed as Record<string, unknown>);
}
