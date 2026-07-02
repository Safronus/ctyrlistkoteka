import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/seo";

const SITE_URL = siteBaseUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /api/ = JSON endpoints (no index value); /go/ = QR scan-redirect
        // util. The QR landing pages themselves stay indexable.
        //
        // /admin is DELIBERATELY not listed here: robots.txt is world-
        // readable, so a `Disallow: /admin/` line would advertise the admin
        // path to anyone doing recon — the opposite of hiding it. It is kept
        // out of search indexes by the `X-Robots-Tag: noindex, nofollow,
        // noarchive` header the middleware sets on every /admin response
        // (which, unlike a Disallow, still lets a crawler fetch the page and
        // actually SEE the noindex), and protected by WebAuthn/iron-session
        // auth (plus the optional Nginx IP-allowlist cloak in
        // deploy/nginx.conf.template). Don't add it back.
        disallow: ["/api/", "/go/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
