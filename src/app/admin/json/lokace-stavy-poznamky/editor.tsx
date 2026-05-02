"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  Wand2,
} from "lucide-react";
import { lokaceStavyPoznamkySchema } from "@/lib/admin/jsonSchema";
import { saveLokaceStavyPoznamky, type SaveResult } from "./save-action";

interface Props {
  /** Current on-disk content, pretty-printed. Editor starts with
   *  exactly this string so the first render diff is empty. */
  initialContent: string;
  /** ISO timestamp of the file's last write — shown in the header so
   *  the user can see when the version was last touched, separate
   *  from the post-save toast. */
  fileMtime: string | null;
}

interface ParseStatus {
  ok: boolean;
  /** `null` when the JSON couldn't be parsed at all. */
  jsonValid: boolean;
  /** `null` when JSON parse failed; otherwise the Zod result summary. */
  schemaError: string | null;
  /** Field-level issues (only when JSON parsed but schema failed). */
  issues: { path: (string | number)[]; message: string }[];
  parseErrorMessage: string | null;
  parseErrorLine?: number;
  parseErrorColumn?: number;
}

function validate(content: string): ParseStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const posMatch = /position (\d+)/.exec(message);
    let line: number | undefined;
    let column: number | undefined;
    if (posMatch) {
      const pos = Number(posMatch[1]);
      let l = 1;
      let c = 1;
      for (let i = 0; i < pos && i < content.length; i++) {
        if (content[i] === "\n") {
          l += 1;
          c = 1;
        } else {
          c += 1;
        }
      }
      line = l;
      column = c;
    }
    return {
      ok: false,
      jsonValid: false,
      schemaError: null,
      issues: [],
      parseErrorMessage: message,
      parseErrorLine: line,
      parseErrorColumn: column,
    };
  }
  const result = lokaceStavyPoznamkySchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      jsonValid: true,
      schemaError: `${result.error.issues.length} chyb ve schématu`,
      issues: result.error.issues.map((i) => ({
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
      parseErrorMessage: null,
    };
  }
  return {
    ok: true,
    jsonValid: true,
    schemaError: null,
    issues: [],
    parseErrorMessage: null,
  };
}

export function LokaceStavyPoznamkyEditor({
  initialContent,
  fileMtime,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<
    { path: (string | number)[]; message: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();

  const status = useMemo(() => validate(content), [content]);
  const dirty = content !== initialContent;

  const onFormat = () => {
    try {
      const obj = JSON.parse(content);
      setContent(JSON.stringify(obj, null, 2) + "\n");
    } catch {
      // Format only works when JSON parses; ignore otherwise.
    }
  };

  const onReset = () => {
    setContent(initialContent);
    setSavedAt(null);
    setServerError(null);
    setServerIssues([]);
  };

  const onSave = () => {
    if (isPending || !status.ok) return;
    setServerError(null);
    setServerIssues([]);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("content", content);
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
        setServerError(err instanceof Error ? err.message : "Uložení selhalo");
      }
    });
  };

  const issues = serverIssues.length > 0 ? serverIssues : status.issues;

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
          <StatusBadge status={status} dirty={dirty} />
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onFormat}
          disabled={!status.jsonValid || isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden />
          Naformátovat (Prettify)
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!dirty || isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Vrátit změny
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSave}
          disabled={!status.ok || !dirty || isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          Uložit (vytvoří backup do .trash/)
        </button>
      </div>

      {serverError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>Server:</strong> {serverError}
        </p>
      )}

      {!status.jsonValid && status.parseErrorMessage && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>Syntax:</strong> {status.parseErrorMessage}
          {status.parseErrorLine !== undefined && (
            <>
              {" "}
              — řádek {status.parseErrorLine}, sloupec{" "}
              {status.parseErrorColumn}
            </>
          )}
        </p>
      )}

      {issues.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs">
          <p className="mb-1 font-semibold text-red-900">
            {issues.length}{" "}
            {issues.length === 1 ? "chyba" : issues.length < 5 ? "chyby" : "chyb"}{" "}
            ve schématu:
          </p>
          <ul className="space-y-1 font-mono text-red-800">
            {issues.slice(0, 30).map((i, idx) => (
              <li key={idx}>
                <code>{i.path.length === 0 ? "(root)" : i.path.join(".")}</code>
                : {i.message}
              </li>
            ))}
            {issues.length > 30 && (
              <li className="font-sans italic text-red-700">
                … a dalších {issues.length - 30}
              </li>
            )}
          </ul>
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setSavedAt(null);
          setServerError(null);
          setServerIssues([]);
        }}
        spellCheck={false}
        className="block h-[60vh] w-full resize-y rounded-lg border border-gray-300 bg-gray-900 p-4 font-mono text-xs leading-relaxed text-gray-100 shadow-inner focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />

      <p className="text-xs text-gray-500">
        Validace běží live (klient) i znovu při uložení (server, Zod).
        Při uložení server zazálohuje aktuální verzi do{" "}
        <code className="font-mono">data/.trash/&lt;ts&gt;/meta/</code> a
        atomicky přepíše živý soubor.
      </p>
    </div>
  );
}

function StatusBadge({
  status,
  dirty,
}: {
  status: ParseStatus;
  dirty: boolean;
}) {
  if (!status.jsonValid) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        JSON syntaktická chyba
      </span>
    );
  }
  if (status.schemaError) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        {status.schemaError}
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
