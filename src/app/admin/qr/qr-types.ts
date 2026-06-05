/**
 * Shared QR option shape. Kept out of qr-actions.ts because a
 * "use server" module may only export async functions — types must live
 * elsewhere so the client form can import them too.
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
}
