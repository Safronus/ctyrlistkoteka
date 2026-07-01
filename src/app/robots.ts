import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/seo";

const SITE_URL = siteBaseUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /go/ is the QR scan-redirect util; keep it (and admin) out of
        // the index. The QR landing pages themselves stay indexable.
        disallow: ["/api/", "/go/", "/admin/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
