import { notFound } from "next/navigation";

// An unmatched public URL (`/neexistuje`, `/en/neexistuje`) has to 404 INSIDE
// this root layout — there is no `app/layout.tsx` above `[locale]` any more
// (see RootShell), so without this catch-all Next falls back to its bare,
// unstyled, English 404 with no CSP nonce. Specific routes always win over a
// catch-all, so this only ever sees URLs nothing else matched.
export default function CatchAllNotFound(): never {
  notFound();
}
