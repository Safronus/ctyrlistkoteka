/**
 * Shared QR option shapes. Kept out of the "use server" modules because
 * such a module may only export async functions — types must live
 * elsewhere so the client forms can import them too.
 */

export interface QrInput {
  label: string;
  target: string;
  locale: string;
  theme: string;
  moduleStyle: string;
  center: string;
  centerScale: string;
  showTitle: boolean;
  titleText: string;
  showCaption: boolean;
  size: string;
  border: string;
  borderRadius: string;
  borderColor: string;
  /** "dense" | "medium" | "compact" — see QrDensity in lib/admin/qr.ts. */
  density: string;
}

/** What the title above a find QR says. The find id is always available;
 *  date and location are looked up per find when rendering a batch. */
export type FindQrTitleMode = "id" | "idDate" | "idLocation" | "none";

export interface FindQrInput {
  /** "id" | "idDate" | "idLocation" | "none" */
  titleMode: FindQrTitleMode;
  theme: string;
  moduleStyle: string;
  center: string;
  centerScale: string;
  border: string;
  borderRadius: string;
  borderColor: string;
  /** "dense" | "medium" | "compact" */
  density: string;
}

/** One rendered find code, as returned by the batch render action. */
export interface FindQrRendered {
  findId: number;
  svg: string;
}
