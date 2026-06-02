"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, RotateCw } from "lucide-react";
import {
  HOME_ROTATION_BOUNDS,
  HOME_ROTATION_DEFAULTS,
  type HomeRotationSettings,
} from "@/lib/homeRotation";
import { saveHomeRotation, type SaveRotationResult } from "./save-action";

const FIELDS: ReadonlyArray<{
  key: keyof HomeRotationSettings;
  label: string;
  hint: string;
}> = [
  {
    key: "cloverFactSeconds",
    label: "Rotace lístečků",
    hint: "Zajímavosti v kartě hrdiny na hlavní stránce.",
  },
  {
    key: "randomFindSeconds",
    label: "Rotace náhodného čtyřlístku",
    hint: "Widget „Náhodný čtyřlístek“ na hlavní stránce.",
  },
  {
    key: "screensaverSeconds",
    label: "Rotace ve full-screen spořiči",
    hint: "Celoobrazovkový spořič spuštěný z náhodného čtyřlístku.",
  },
];

export function HomeRotationForm({
  initial,
}: {
  initial: HomeRotationSettings;
}) {
  const [result, setResult] = useState<SaveRotationResult | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      setResult(await saveHomeRotation(fd));
    });
  };

  const issueFor = (key: string) =>
    result?.issues?.find((i) => i.field === key)?.message;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl border border-gray-200 bg-white p-5"
    >
      <div className="space-y-4">
        {FIELDS.map(({ key, label, hint }) => {
          const bounds = HOME_ROTATION_BOUNDS[key];
          const issue = issueFor(key);
          return (
            <div key={key} className="flex flex-col gap-1">
              <label
                htmlFor={key}
                className="text-sm font-medium text-gray-900"
              >
                {label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={key}
                  name={key}
                  type="number"
                  inputMode="numeric"
                  min={bounds.min}
                  max={bounds.max}
                  step={1}
                  required
                  defaultValue={initial[key]}
                  className={`w-28 rounded-md border bg-white px-2 py-1.5 text-sm tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                    issue ? "border-red-400" : "border-gray-300"
                  }`}
                />
                <span className="text-sm text-gray-500">s</span>
                <span className="text-xs text-gray-400">
                  ({bounds.min}–{bounds.max} s, výchozí{" "}
                  {HOME_ROTATION_DEFAULTS[key]} s)
                </span>
              </div>
              <p className="text-xs text-gray-500">{hint}</p>
              {issue && <p className="text-xs text-red-600">{issue}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <RotateCw
            className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
            aria-hidden
          />
          Uložit
        </button>
        {result?.ok && (
          <span className="inline-flex items-center gap-1 text-sm text-green-700">
            <Check className="h-4 w-4" aria-hidden />
            Uloženo{" "}
            {result.savedAt
              ? new Date(result.savedAt).toLocaleTimeString("cs-CZ")
              : ""}
          </span>
        )}
        {result && !result.ok && (
          <span className="text-sm text-red-600">{result.error}</span>
        )}
      </div>
    </form>
  );
}
