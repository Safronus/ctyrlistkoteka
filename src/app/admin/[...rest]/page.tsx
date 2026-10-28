import { notFound } from "next/navigation";

// Same reason as `[locale]/[...rest]`: an unknown `/admin/…` URL 404s inside
// the admin root (Czech, styled, CSP nonce) instead of Next's bare 404.
export default function AdminCatchAllNotFound(): never {
  notFound();
}
