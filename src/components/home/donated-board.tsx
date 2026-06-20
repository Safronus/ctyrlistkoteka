import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDonatedBoardForDisplay } from "@/lib/donatedBoard.server";

/**
 * "Kdo už využil nabídky" — a dense field of clover pins at the very
 * bottom of the home page, under the closing apology. Each pin is a find
 * that was donated on the back of the apology's offer; its number sits on
 * a small white badge in the middle, and the pin links to the find
 * detail.
 *
 * Pins lay out in a responsive auto-fill grid (column count follows the
 * width), each one placed inside its square cell with a deterministic
 * per-index offset / rotation / scale so the board reads as a scattered
 * field of clovers rather than a rigid grid — yet stays SSR-stable (no
 * Math.random → no hydration drift). Rotations stay within ±12° so the
 * numbers remain readable. No card frame, matching the apology above it.
 */

const BASE_PX = 58;

export async function DonatedBoardSection() {
  const ids = await getDonatedBoardForDisplay();
  if (ids.length === 0) return null;
  const t = await getTranslations("Home");

  return (
    <section className="mt-5">
      <div className="mx-auto max-w-3xl px-6 text-center sm:px-10">
        <h2 className="text-xl font-bold tracking-tight text-gray-900">
          {t("donatedBoardHeading")}
        </h2>
        <ul
          className="mx-auto mt-6 grid gap-[3px]"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
          }}
        >
          {ids.map((id, i) => {
            // Deterministic pseudo-random per index — a multiplicative hash
            // (XOR'd with a constant so index 0 isn't degenerate) spreads
            // the values well; rendered server-side so the scatter is
            // baked into the HTML, no client recompute / hydration drift.
            const h = ((i * 2654435761) ^ 0x9e3779b9) >>> 0;
            // Rotation always has a visible tilt (±4..12°), never near 0,
            // but stays readable. Position + size vary across the cell.
            const rot = (4 + (h % 9)) * ((h >> 8) & 1 ? 1 : -1); // ±4..12
            const dx = ((h >> 9) % 31) - 15; // -15..+15 % of cell
            const dy = ((h >> 15) % 31) - 15;
            const scale = 0.82 + ((h >> 20) % 33) / 100; // 0.82..1.14
            const px = Math.round(BASE_PX * scale);
            const fontSize = Math.round(8 + scale * 3); // ~10..11 px
            return (
              <li key={id} className="relative aspect-square">
                <Link
                  href={`/sbirka/${id}`}
                  title={`#${id}`}
                  aria-label={t("donatedBoardPinAria", { id })}
                  className="group absolute left-1/2 top-1/2 flex items-center justify-center transition hover:z-10"
                  style={{
                    width: `${px}px`,
                    height: `${px}px`,
                    transform: `translate(calc(-50% + ${dx}%), calc(-50% + ${dy}%)) rotate(${rot}deg)`,
                  }}
                >
                  <svg
                    viewBox="0 0 100 100"
                    className="block h-full w-full drop-shadow-sm transition group-hover:brightness-110"
                    aria-hidden
                  >
                    <g fill="#4d9748">
                      <ellipse
                        cx="35"
                        cy="35"
                        rx="18"
                        ry="22"
                        transform="rotate(-45 35 35)"
                      />
                      <ellipse
                        cx="65"
                        cy="35"
                        rx="18"
                        ry="22"
                        transform="rotate(45 65 35)"
                      />
                      <ellipse
                        cx="35"
                        cy="65"
                        rx="18"
                        ry="22"
                        transform="rotate(45 35 65)"
                      />
                      <ellipse
                        cx="65"
                        cy="65"
                        rx="18"
                        ry="22"
                        transform="rotate(-45 65 65)"
                      />
                    </g>
                  </svg>
                  <span
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-1 font-mono font-medium leading-none text-brand-800 shadow-[0_0_0_1px_rgba(15,110,52,0.25)]"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {id}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
