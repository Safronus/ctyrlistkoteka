import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";

/**
 * Public privacy notice (`/soukromi`, `/en/soukromi`). Static-ish legal
 * text rendered from the `Privacy` message namespace so both locales stay
 * in sync. Controller + contact are fixed constants; the few external
 * links (author e-mail, OpenStreetMap Foundation privacy policy, the
 * Czech DPA) are injected via `t.rich` so the surrounding wording can be
 * translated without hard-coding markup in the JSON.
 *
 * The site processes almost no personal data (self-hosted cookieless
 * analytics, hashed vote fingerprints, security logs), but GDPR Art. 13
 * still requires this transparency notice regardless of consent — hence
 * the page exists and the footer links to it.
 */

const CONTACT_EMAIL = "safronus@gmail.com";
const OSM_PRIVACY_URL = "https://wiki.osmfoundation.org/wiki/Privacy_Policy";
const UOOU_URL = "https://www.uoou.gov.cz/";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("Privacy");
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: seoAlternates("/soukromi", locale),
    openGraph: {
      title,
      description,
      locale: ogLocale(locale),
      url: localePath("/soukromi", locale),
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: ["/og"] },
  };
}

const LINK_CLASS =
  "text-brand-700 underline underline-offset-2 hover:text-brand-800";
const CODE_CLASS =
  "rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-gray-700";

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-gray-900">{heading}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

function Sub({ heading, body }: { heading: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold text-gray-800">{heading}</h3>
      <p className="mt-1 text-gray-700">{body}</p>
    </div>
  );
}

export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");

  const mail = (chunks: ReactNode) => (
    <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
      {chunks}
    </a>
  );
  const osm = (chunks: ReactNode) => (
    <a
      href={OSM_PRIVACY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {chunks}
    </a>
  );
  const uoou = (chunks: ReactNode) => (
    <a
      href={UOOU_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {chunks}
    </a>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
      <p className="mt-2 text-sm text-gray-500">{t("updated")}</p>
      <p className="mt-6 text-gray-700">{t("intro")}</p>

      <Section heading={t("controllerHeading")}>
        <p className="text-gray-700">
          {t.rich("controllerText", { email: mail })}
        </p>
      </Section>

      <Section heading={t("dataHeading")}>
        <Sub heading={t("analyticsHeading")} body={t("analyticsText")} />
        <Sub heading={t("securityHeading")} body={t("securityText")} />
        <Sub heading={t("votingHeading")} body={t("votingText")} />
        <div>
          <h3 className="font-semibold text-gray-800">{t("mapHeading")}</h3>
          <p className="mt-1 text-gray-700">
            {t.rich("mapText", { osm })}
          </p>
        </div>
      </Section>

      <Section heading={t("cookiesHeading")}>
        <p className="text-gray-700">{t("cookiesIntro")}</p>
        <ul className="space-y-2 text-gray-700">
          <li>
            <code className={CODE_CLASS}>{t("cookieVoteName")}</code> —{" "}
            {t("cookieVoteDesc")}
          </li>
          <li>
            <code className={CODE_CLASS}>{t("cookieViewName")}</code> —{" "}
            {t("cookieViewDesc")}
          </li>
          <li>
            <code className={CODE_CLASS}>{t("storageThemeName")}</code> —{" "}
            {t("storageThemeDesc")}
          </li>
        </ul>
        <p className="text-gray-700">{t("cookiesNoBanner")}</p>
      </Section>

      <Section heading={t("retentionHeading")}>
        <p className="text-gray-700">{t("retentionText")}</p>
      </Section>

      <Section heading={t("recipientsHeading")}>
        <p className="text-gray-700">{t("recipientsText")}</p>
      </Section>

      <Section heading={t("rightsHeading")}>
        <p className="text-gray-700">
          {t.rich("rightsText", { email: mail, uoou })}
        </p>
      </Section>

      <Section heading={t("contentHeading")}>
        <p className="text-gray-700">{t("contentText")}</p>
      </Section>

      <Section heading={t("changesHeading")}>
        <p className="text-gray-700">{t("changesText")}</p>
      </Section>
    </div>
  );
}
