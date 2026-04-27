import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import { Github, Linkedin, Sparkles } from "lucide-react";
import { MainNav } from "@/components/main-nav";
import { ThemeScript } from "@/components/theme-script";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: `%s · ${SITE_NAME}`,
    default: SITE_NAME,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  icons: {
    icon: [
      { url: "/clover.png", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "cs_CZ",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="cs" className={inter.variable} data-theme="clover">
      <body className="flex min-h-screen flex-col">
        <ThemeScript />
        <MainNav />

        <main className="flex-1">{children}</main>

        <footer className="border-t border-gray-200 bg-gray-50 py-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 text-center text-sm text-gray-500 sm:px-6 lg:px-8">
            <span>
              © {new Date().getFullYear()} {SITE_NAME} · Soukromá sbírka
              čtyřlístků
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              vytvořil
              <Image
                src="/safronus.png"
                alt=""
                aria-hidden
                width={20}
                height={20}
                className="h-5 w-5"
              />
              <span className="font-medium text-gray-700">Safronus</span>
              {/* The LinkedIn slug carries Czech diacritics — JSX/React
                  serialises the href verbatim and the browser
                  percent-encodes on navigation, so leaving the literal
                  characters in is fine and most readable in source. */}
              <a
                href="https://www.linkedin.com/in/petr-žáček-9a2473b7/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn profil autora"
                title="LinkedIn"
                className="ml-1 rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
              >
                <Linkedin className="h-4 w-4" aria-hidden />
              </a>
              <a
                href="https://github.com/Safronus"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub profil autora"
                title="GitHub"
                className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
              >
                <Github className="h-4 w-4" aria-hidden />
              </a>
            </span>
            <span aria-hidden>·</span>
            {/* AI-assistance credit. Sparkles icon nods at the "AI"
                flavour without being too cute; both anchors open in
                a new tab so the visitor can read up on Anthropic /
                Claude Code without losing their place here. */}
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-500" aria-hidden />
              <span>s asistencí</span>
              <a
                href="https://www.anthropic.com/claude"
                target="_blank"
                rel="noopener noreferrer"
                title="Claude od Anthropic"
                className="font-medium text-gray-700 underline-offset-2 hover:text-brand-700 hover:underline"
              >
                Claude Opus 4.7
              </a>
              <span className="text-gray-400">přes</span>
              <a
                href="https://claude.com/claude-code"
                target="_blank"
                rel="noopener noreferrer"
                title="Claude Code"
                className="font-medium text-gray-700 underline-offset-2 hover:text-brand-700 hover:underline"
              >
                Claude Code
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
