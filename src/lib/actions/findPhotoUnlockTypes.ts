/**
 * Types + initial state for the find-photo unlock action. Lives in a
 * sibling file (no `"use server"` directive) because the action file
 * itself can only export async functions — see
 * `feedback_use_server_only_async.md` in memory: a previous incident
 * crashed the production page when the action file co-exported
 * non-function values.
 */

export interface UnlockedPhoto {
  slot: string;
  /** Base64 data URL of the unlocked image; the modal swaps the
   *  placeholder for this. We deliberately ship the bytes inline so
   *  the public URL stays 404 — Nginx never serves the ANON file. */
  dataUrl: string;
}

export interface FindPhotoUnlockState {
  /** "" while idle, "ok" after a successful unlock, or an error label
   *  the form can display under the input. */
  status: "" | "ok" | "invalid" | "missing-config" | "error";
  /** Photos that the action returned on success — keyed by slot so the
   *  modal can swap the matching placeholder. Empty array on failure. */
  photos: readonly UnlockedPhoto[];
}

export const FIND_PHOTO_UNLOCK_INITIAL: FindPhotoUnlockState = {
  status: "",
  photos: [],
};
