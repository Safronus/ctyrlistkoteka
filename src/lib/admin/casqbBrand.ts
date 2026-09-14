/**
 * CaSQB brand assets — the official vectors, verbatim.
 *
 * Source: the public design manual at https://casqb.visualbook.pro/en
 * (Logos → Symbol, Logos → Main logo; "Logo for screens · RGB · SVG"),
 * downloaded 2026-09-14. Path data is copied 1:1 from
 *   casqb_logo_symbol_q_cervene.svg    (viewBox 0 0 105.068 181.413)
 *   casqb_logo_zakladni_cervene.svg    (viewBox 0 0 605.974 181.664)
 * The white variants (_bile.svg) are the same geometry with a white
 * fill, which is why only the geometry is stored here.
 *
 * The manual's rules, which the QR renderer enforces:
 *   - never recolour: only the two official fills exist — Quality Red on
 *     a light ground, white on a dark one (`casqbLogoFill`);
 *   - protection zone: 25 % of the symbol's height, 40 % of the main
 *     logo's height, on every side — the QR's centre hole is sized from
 *     these, never from taste;
 *   - minimum size: 5 mm (15/16 px) tall — the PDF export refuses a
 *     print width that would shrink the logo below it;
 *   - no shadows, no rotation, no deformation.
 * Palette source: Colors page of the same manual.
 */

export const CASQB_QUALITY_RED = "#EF4635";
export const CASQB_QUALITY_BLUE = "#9DDCF9";
export const CASQB_WHITE = "#FFFFFF";

/** The manual's palettes, darkest (100) to lightest (10). */
export const CASQB_BLUE_SCALE = {
  100: "#151C1F", 90: "#27383F", 80: "#3C545E", 70: "#506F7E", 60: "#638A9C",
  50: "#76A5BB", 40: "#8AC1DA", 30: "#9EDDF9", 20: "#BFE8FB", 10: "#DFF3FD",
} as const;
export const CASQB_RED_SCALE = {
  100: "#2F1311", 90: "#5F1D16", 80: "#912B21", 70: "#BE3A2A", 60: "#EE4836",
  50: "#F06658", 40: "#F38378", 30: "#F7A39A", 20: "#FAC1BC", 10: "#FBDFDB",
} as const;

export interface CasqbVector {
  /** viewBox width and height, in the file's own units. */
  width: number;
  height: number;
  /** Fraction of the logo's height kept clear on every side. */
  protectionZone: number;
  /** Minimum printed height, mm. */
  minHeightMm: number;
  paths: readonly string[];
}

/** Logos → Symbol: the Q. Tall, roughly 0.58 : 1. */
export const CASQB_SYMBOL: CasqbVector = {
  width: 105.068,
  height: 181.413,
  protectionZone: 0.25,
  minHeightMm: 5,
  paths: [
    "M52.659,181.413C21.92,181.413,0,159.744,0,129.76V51.653C0,21.669,21.92,0,52.659,0 c30.487,0,52.409,21.669,52.409,51.653v78.108H78.36V51.653c0-15.119-10.584-25.954-25.701-25.954S26.708,36.534,26.708,51.653 v78.108c0,15.117,10.835,25.952,25.952,25.952V181.413z",
    "M78.611,181.664c0-15.117-10.835-25.952-25.952-25.952v-25.701c30.739,0,52.659,21.669,52.659,51.653 H78.611z",
  ],
};

/** Logos → Main logo: the CaSQB wordmark. Wide, roughly 3.3 : 1. */
export const CASQB_WORDMARK: CasqbVector = {
  width: 605.974,
  height: 181.664,
  protectionZone: 0.4,
  minHeightMm: 5,
  paths: [
    "M0,129.76V51.653C0,21.669,21.92,0,52.659,0c30.487,0,52.409,21.669,52.409,51.653v7.811H78.36v-7.811 c0-15.119-10.584-25.954-25.701-25.954S26.708,36.534,26.708,51.653v78.108c0,15.117,10.835,25.952,25.952,25.952 S78.36,144.877,78.36,129.76v-7.811h26.707v7.811c0,29.984-21.922,51.653-52.409,51.653C21.92,181.413,0,159.744,0,129.76z",
    "M128.503,136.31c0-25.952,19.149-42.58,42.833-42.58c7.559,0,16.881,2.015,23.684,7.055V70.549 c0-12.094-8.82-20.661-20.408-20.661c-11.843,0-20.41,8.567-20.41,20.661v8.567h-25.699v-8.567 c0-25.952,19.652-45.353,46.109-45.353c26.455,0,46.109,19.402,46.109,45.353v65.761c0,25.954-19.654,45.103-46.109,45.103 C148.155,181.413,128.503,162.264,128.503,136.31z M174.612,156.72c11.588,0,20.408-8.567,20.408-20.41 c0-12.094-8.82-20.661-20.408-20.661c-11.843,0-20.41,8.567-20.41,20.661C154.202,148.153,162.769,156.72,174.612,156.72z",
    "M296.058,155.712c15.119,0,25.701-10.835,25.701-25.952c0-8.567-2.773-14.614-7.308-18.896 c-12.597-11.59-38.045-4.032-56.188-21.419c-9.321-9.321-14.864-22.423-14.864-37.793C243.399,21.669,265.319,0,296.058,0 c30.489,0,52.409,21.669,52.409,51.653v7.811h-26.707v-7.811c0-15.119-10.582-25.954-25.701-25.954 c-15.117,0-25.952,10.835-25.952,25.954c0,8.567,2.771,14.614,7.308,18.896c12.597,11.59,38.045,4.032,56.186,21.417 c9.576,9.323,14.866,22.425,14.866,37.795c0,29.984-21.92,51.653-52.409,51.653c-30.739,0-52.659-21.669-52.659-51.653v-7.811 h26.707v7.811C270.107,144.877,280.941,155.712,296.058,155.712z",
    "M422.294,181.413c-30.739,0-52.659-21.669-52.659-51.653V51.653C369.635,21.669,391.555,0,422.294,0 c30.487,0,52.409,21.669,52.409,51.653v78.108h-26.707V51.653c0-15.119-10.584-25.954-25.701-25.954 c-15.117,0-25.952,10.835-25.952,25.954v78.108c0,15.117,10.835,25.952,25.952,25.952V181.413z",
    "M448.246,181.664c0-15.117-10.835-25.952-25.952-25.952v-25.701c30.739,0,52.659,21.669,52.659,51.653 H448.246z",
    "M605.974,50.644c0,17.385-8.062,31.998-21.164,40.062c13.102,8.314,21.164,22.676,21.164,40.062 c0,27.967-20.408,48.124-48.88,48.124h-55.432V2.52h55.432C585.566,2.52,605.974,22.676,605.974,50.644z M554.827,77.857 c14.361,0,24.44-10.331,24.44-24.945c0-14.361-10.079-24.693-24.44-24.693h-26.455v49.638H554.827z M554.827,153.192 c14.361,0,24.44-10.329,24.44-24.691c0-14.614-10.079-24.945-24.44-24.945h-26.455v49.636H554.827z",
  ],
};
