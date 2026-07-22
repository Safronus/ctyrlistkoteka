"use client";

import { Link } from "@/i18n/navigation";
import { Shuffle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  localizedClover,
  type CloverEnEntry,
  type CloverText,
  type CloverTextSource,
} from "@/lib/cloverTexts";
import {
  cloverCategoryKey,
  cloverKindKey,
} from "@/lib/cloverFactsLabels";
import { rotationSlot, slotFactIndex } from "@/lib/cloverRotation";

const DEFAULT_ROTATION_MS = 120_000;
const TICK_MS = 1_000;

const SOURCE_KEY: Record<CloverTextSource, string> = {
  fact: "cardSourceFact",
  lore: "cardSourceLore",
  creative: "cardSourceCreative",
};

const SOURCE_TONE: Record<CloverTextSource, string> = {
  fact: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  lore: "bg-amber-100 text-amber-800 ring-amber-200",
  creative: "bg-violet-100 text-violet-800 ring-violet-200",
};

interface VibeStyles {
  paperBg: string;
  paperRing: string;
  titleColor: string;
  textColor: string;
  categoryColor: string;
  badgeBg: string;
  badgeText: string;
  pinBody: string;
  pinAccent: string;
  idColor: string;
  /** Decoration overlay on the paper — sparkles for happy, smoke for
   *  demonic. Pure visual flourish; aria-hidden. */
  decoration?: "happy" | "demonic";
}

const AUTHOR_DEFAULT: VibeStyles = {
  paperBg: "bg-gradient-to-br from-emerald-50 via-emerald-50/80 to-emerald-100/70",
  paperRing: "ring-1 ring-emerald-200/70",
  titleColor: "text-emerald-900",
  textColor: "text-emerald-950/80",
  categoryColor: "text-emerald-700",
  badgeBg: "bg-emerald-600",
  badgeText: "text-white",
  // Clover pin filled brand-green with a darker centre.
  pinBody: "fill-emerald-600",
  pinAccent: "fill-emerald-800",
  idColor: "text-emerald-700/60",
};

const VIBE_HAPPY: VibeStyles = {
  paperBg: "bg-gradient-to-br from-amber-50 via-emerald-50/70 to-amber-100/70",
  paperRing: "ring-1 ring-amber-300/70",
  titleColor: "text-emerald-900",
  textColor: "text-emerald-950/85",
  categoryColor: "text-emerald-700",
  badgeBg: "bg-amber-500",
  badgeText: "text-amber-950",
  pinBody: "fill-emerald-600",
  pinAccent: "fill-emerald-800",
  idColor: "text-amber-700/70",
  decoration: "happy",
};

const VIBE_DEMONIC: VibeStyles = {
  paperBg: "bg-gradient-to-br from-gray-900 via-red-950 to-black",
  paperRing: "ring-1 ring-red-900/60",
  titleColor: "text-red-100",
  textColor: "text-red-200/80",
  categoryColor: "text-red-300/80",
  badgeBg: "bg-red-700",
  badgeText: "text-white",
  pinBody: "", // unused — demonic uses a custom "666" disc instead of clover
  pinAccent: "",
  idColor: "text-red-400/60",
  decoration: "demonic",
};

const REGULAR: VibeStyles = {
  paperBg: "bg-[#fffdf7]",
  paperRing: "ring-1 ring-amber-200/60",
  titleColor: "text-gray-900",
  textColor: "text-gray-700",
  categoryColor: "text-gray-600",
  // Regular entries don't use the badge fields below — kept for type
  // shape parity. The component branches on isAuthor before reading.
  badgeBg: "",
  badgeText: "",
  // Pin for regular entries stays the rose disc — set on the element
  // directly rather than via these clover-pin tokens.
  pinBody: "",
  pinAccent: "",
  idColor: "text-gray-600",
};

function vibeFor(text: CloverText): VibeStyles {
  const isAuthor = text.author === true;
  if (!isAuthor) return REGULAR;
  if (text.vibe === "demonic") return VIBE_DEMONIC;
  if (text.vibe === "happy") return VIBE_HAPPY;
  return AUTHOR_DEFAULT;
}

type VibeKey = "regular" | "author" | "happy" | "demonic";

function vibeKeyFor(text: CloverText): VibeKey {
  if (text.author !== true) return "regular";
  if (text.vibe === "demonic") return "demonic";
  if (text.vibe === "happy") return "happy";
  return "author";
}

/**
 * Pinned-paper note next to the home-page hero with a rotating clover
 * curiosity. Three rendering modes:
 *  - Regular text (cream paper, rose thumbtack, source-type badge)
 *  - Author bonus (emerald paper, clover-shaped pin, "BONUS" badge)
 *  - Vibe overrides on top of author: "happy" festive amber/emerald
 *    blend for the poem at #111, "demonic" dark/red treatment for the
 *    clickable #666 entry that links to the matching find detail.
 *
 * SSR renders `texts[0]` as a fallback; on mount the client snaps to the
 * fact the wall clock dictates (see `syncToSlot` / cloverRotation) and
 * advances by slot. Because the pick is time-derived — not per-mount random —
 * a language switch (a full page navigation → a fresh mount) re-renders the
 * SAME fact in the other language with the SAME countdown instead of rotating.
 *
 * Texts + translations are loaded server-side by the parent page so
 * runtime edits via /admin/clover-texts/ show up without a rebuild.
 * The arrays are stable references across re-renders of the same
 * page render — the effect's deps reflect that.
 */
export function CloverFactCard({
  texts,
  translations,
  rotationMs = DEFAULT_ROTATION_MS,
}: {
  texts: ReadonlyArray<CloverText>;
  translations: Readonly<Record<string, CloverEnEntry>>;
  /** Auto-advance interval in ms — server-driven from the admin home
   *  rotation settings; falls back to the 2-minute default. */
  rotationMs?: number;
}) {
  const t = useTranslations("CloverFacts");
  const locale = useLocale();
  // The page ships only a small random seed of facts in the initial HTML;
  // pull the full collection once after mount so the rotator has everything
  // without inlining ~210 entries into every homepage load. On fetch
  // failure the seed set keeps the card fully working.
  const [allTexts, setAllTexts] =
    useState<ReadonlyArray<CloverText>>(texts);
  const [allTranslations, setAllTranslations] =
    useState<Readonly<Record<string, CloverEnEntry>>>(translations);
  useEffect(() => {
    let alive = true;
    fetch("/api/clover-facts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          alive &&
          data &&
          Array.isArray(data.texts) &&
          data.texts.length > 0
        ) {
          setAllTexts(data.texts as CloverText[]);
          setAllTranslations(
            (data.translations ?? {}) as Record<string, CloverEnEntry>,
          );
        }
      })
      .catch(() => {
        /* keep the seed set on error */
      });
    return () => {
      alive = false;
    };
  }, []);
  const [index, setIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(rotationMs);
  // `nextAt` lives in a ref so both the auto-rotation tick AND the
  // shuffle handler can reset it without one stomping the other's
  // closure. Keeping it as state would force a re-render every second,
  // defeating the point of the steady visible countdown.
  const nextAtRef = useRef<number>(Date.now() + rotationMs);

  // Snap the card to the fact + countdown the wall clock says it should show
  // right now. Deterministic per (time window, fact set) — see cloverRotation
  // — so any re-mount at the same moment reproduces the same fact with the
  // same remaining time. That's what keeps a language switch (a full page
  // navigation → a fresh mount) from re-rotating: both locales compute the
  // same slot from the same clock + the same facts. Picking on an id-sorted
  // view keeps server and every client agreeing regardless of array order.
  const syncToSlot = useCallback(() => {
    const n = allTexts.length;
    if (n === 0) return;
    const now = Date.now();
    const slot = rotationSlot(now, rotationMs);
    const sorted = [...allTexts].sort((a, b) => a.id - b.id);
    const pick = sorted[slotFactIndex(slot, n)]!;
    const idx = allTexts.findIndex((tx) => tx.id === pick.id);
    setIndex(idx >= 0 ? idx : 0);
    nextAtRef.current = (slot + 1) * rotationMs;
    setRemainingMs(nextAtRef.current - now);
  }, [allTexts, rotationMs]);

  // In-card shuffle button: jump to a random OTHER fact now and start a fresh
  // countdown. Deliberately ephemeral — the next auto-advance (or any
  // re-mount) snaps back to the wall-clock slot, so it never desyncs the
  // language-stable rotation.
  const shuffle = useCallback(() => {
    const n = allTexts.length;
    nextAtRef.current = Date.now() + rotationMs;
    setRemainingMs(rotationMs);
    if (n <= 1) return;
    setIndex((prev) => {
      const offset = 1 + Math.floor(Math.random() * (n - 1));
      return (prev + offset) % n;
    });
  }, [allTexts, rotationMs]);

  // Single 1 s interval drives both the visible countdown and the flip to the
  // next slot. Wall-clock target (`nextAt`) instead of a tick counter keeps
  // the timer correct after the tab was backgrounded (setInterval throttles
  // while hidden — on resume we just observe that `nextAt` has passed and
  // re-sync).
  useEffect(() => {
    if (allTexts.length === 0) return;
    syncToSlot();
    const tick = setInterval(() => {
      if (Date.now() >= nextAtRef.current) syncToSlot();
      else setRemainingMs(nextAtRef.current - Date.now());
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [allTexts, rotationMs, syncToSlot]);

  const rawText = allTexts[index];
  if (!rawText) return null;
  const text = localizedClover(rawText, locale, allTranslations);

  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mmss = `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, "0")}`;

  const isAuthor = text.author === true;
  const styles = vibeFor(text);
  // `data-fact-vibe` lets dark-theme CSS in globals.css re-tone the
  // paper bg + descendant text colors per variant. The inline Tailwind
  // utilities below set the light/clover look; the override rules win
  // by specificity (attribute selector chain beats single utility class).
  const vibeKey = vibeKeyFor(text);
  const catKey = cloverCategoryKey(text.category);
  const categoryLabel = catKey ? t(catKey) : text.category;
  const kindKey = text.kind ? cloverKindKey(text.kind) : null;
  const kindLabel = kindKey ? t(kindKey) : (text.kind ?? null);

  const card = (
    <aside
      id="clover-fact-card"
      tabIndex={-1}
      aria-live="polite"
      aria-label={isAuthor ? t("cardAriaAuthor") : t("cardAriaRegular")}
      data-fact-vibe={vibeKey}
      className={`relative w-80 max-w-full scroll-mt-24 -rotate-[2deg] rounded-sm p-5 pb-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] outline-none focus:ring-2 focus:ring-brand-500/60 focus:ring-offset-2 sm:w-96 lg:w-[30rem] ${styles.paperBg} ${styles.paperRing} ${
        text.link
          ? "transition-transform duration-300 hover:scale-[1.02] hover:shadow-[0_12px_32px_-12px_rgba(220,38,38,0.55)]"
          : ""
      }`}
    >
      {/* Pin variant: clover for author entries, "666" disc for the
          demonic vibe, rose disc for regular entries. */}
      {styles.decoration === "demonic" ? (
        <DemonicPin />
      ) : isAuthor ? (
        <CloverPin bodyClass={styles.pinBody} accentClass={styles.pinAccent} />
      ) : (
        <RosePin />
      )}

      <div className="flex items-baseline justify-between gap-2">
        <p
          data-fact-cat
          className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${styles.categoryColor}`}
        >
          {isAuthor && kindLabel ? kindLabel : categoryLabel}
        </p>
        {isAuthor ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm ${styles.badgeBg} ${styles.badgeText}`}
          >
            {t("cardBonusBadge")}
          </span>
        ) : (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${SOURCE_TONE[text.source_type]}`}
          >
            {t(SOURCE_KEY[text.source_type])}
          </span>
        )}
      </div>

      {/* Rendered as a <p>, not a heading: this is a decorative rotating
          "did you know" card inside an aria-labelled <aside> landmark, so
          a heading here would break the page's heading order (h1 -> h3
          skip) without adding navigational value. Styling is driven by
          the [data-fact-title] attribute, unaffected by the tag. */}
      <p
        data-fact-title
        className={`mt-1.5 font-serif text-base font-semibold ${styles.titleColor}`}
      >
        {text.title}
      </p>
      <p
        data-fact-body
        className={`mt-2 whitespace-pre-line font-serif text-sm italic leading-relaxed ${styles.textColor}`}
      >
        {text.text}
      </p>

      {/* Decorative sparkles for the happy vibe — three small SVG stars
          scattered diagonally so they read as confetti rather than UI
          chrome. Aria-hidden; purely decorative. */}
      {styles.decoration === "happy" && <HappySparkles />}

      {/* Countdown until the next lísteček + the manual "shuffle now"
          button, inline and centred at the very bottom of the card. The
          shuffle used to be a corner affordance, but bottom-right collided
          with the #id stamp on phones and bottom-left with the watermark
          smiley; next to the countdown it's clear of every corner at all
          sizes. Countdown itself stays a quiet paper-margin annotation
          (italic serif label, monospace digits, muted to the variant). */}
      <div className="mt-1.5 flex items-center justify-center gap-1.5">
        <p
          aria-hidden
          data-fact-id
          className={`select-none text-center text-[10px] ${styles.idColor}`}
          title={t("cardNextInTitle", { time: mmss })}
        >
          <span className="font-serif italic">{t("cardNextInPrefix")}</span>
          <span className="font-mono tracking-wider">{mmss}</span>
        </p>
        {!text.link && (
          <button
            type="button"
            onClick={shuffle}
            aria-label={t("cardNextButtonAria")}
            title={t("cardNextButtonTitle")}
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-45 transition hover:bg-black/[0.06] hover:opacity-90 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-500 ${styles.idColor}`}
          >
            <Shuffle className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      <span
        aria-hidden
        data-fact-id
        className={`absolute bottom-4 right-1 origin-bottom-right -rotate-[30deg] font-serif text-xs italic ${styles.idColor}`}
      >
        #{text.id}
      </span>

      {text.link && (
        <span
          aria-hidden
          className="absolute bottom-2 left-3 -rotate-[2deg] text-[10px] font-medium tracking-wider text-red-300/80"
        >
          {t("cardLinkHint")}
        </span>
      )}

    </aside>
  );

  return (
    <div className="flex justify-center lg:justify-end">
      {text.link ? (
        <Link
          href={text.link}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-sm"
          aria-label={t("cardLinkAria", { title: text.title })}
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </div>
  );
}

/** Clover-shaped pin head replacing the rose disc on author bonuses.
 *  Four overlapping leaves + darker centre, sized to match the previous
 *  pin's ~20×20 footprint. The drop-shadow makes it read as a 3D pin
 *  resting on the paper. */
function CloverPin({
  bodyClass,
  accentClass,
}: {
  bodyClass: string;
  accentClass: string;
}) {
  return (
    <span
      aria-hidden
      className="absolute -top-3 right-6 inline-block drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)]"
    >
      <svg width={22} height={22} viewBox="0 0 24 24">
        <g className={bodyClass}>
          <circle cx={12} cy={6} r={4.5} />
          <circle cx={6} cy={12} r={4.5} />
          <circle cx={18} cy={12} r={4.5} />
          <circle cx={12} cy={18} r={4.5} />
        </g>
        <circle cx={12} cy={12} r={2.5} className={accentClass} />
      </svg>
    </span>
  );
}

/** Rose-coloured disc thumbtack used for non-author texts. Same look as
 *  before the clover-pin refactor so the regular paper variant keeps
 *  its established style. */
function RosePin() {
  return (
    <span
      aria-hidden
      className="absolute -top-3 right-6 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 shadow-[0_2px_4px_rgba(0,0,0,0.25)] ring-2 ring-rose-300"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-rose-200" />
    </span>
  );
}

/** Demonic marker — black disc with a small red "666" stamped in. Sits
 *  in the same position as the clover/rose pins so the rotation between
 *  variants doesn't visually jump. */
function DemonicPin() {
  return (
    <span
      aria-hidden
      className="absolute -top-3 right-6 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black shadow-[0_2px_6px_rgba(220,38,38,0.6)] ring-2 ring-red-700"
    >
      <span className="font-serif text-[8px] font-bold leading-none text-red-500">
        666
      </span>
    </span>
  );
}

/** Three confetti-style sparkle stars in the corners of the happy
 *  variant. The sizes/positions are deliberately asymmetric so the
 *  paper feels celebratory rather than gridded. */
function HappySparkles() {
  return (
    <>
      <Sparkle className="absolute left-3 top-2 h-3 w-3 text-amber-400/80" />
      <Sparkle className="absolute right-2 top-9 h-2.5 w-2.5 text-amber-300/70" />
      <Sparkle className="absolute bottom-8 left-5 h-2 w-2 text-emerald-400/70" />
    </>
  );
}

function Sparkle({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={className}
      fill="currentColor"
    >
      {/* Four-point star — two crossing diamonds give a cleaner "twinkle"
          shape than a five-point star at this size. */}
      <path d="M6 0 L7 5 L12 6 L7 7 L6 12 L5 7 L0 6 L5 5 Z" />
    </svg>
  );
}
