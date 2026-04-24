import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { NavLink } from "@/components/nav-link";
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
    icon: "/favicon.svg",
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
    <html lang="cs" className={inter.variable}>
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold text-brand-700"
            >
              <span aria-hidden className="text-xl">
                🍀
              </span>
              <span>{SITE_NAME}</span>
            </Link>
            <ul className="flex flex-wrap items-center gap-1">
              <li>
                <NavLink href="/">Domů</NavLink>
              </li>
              <li>
                <NavLink href="/sbirka">Sbírka</NavLink>
              </li>
              <li>
                <NavLink href="/mapa">Mapa</NavLink>
              </li>
              <li>
                <NavLink href="/statistiky">Statistiky</NavLink>
              </li>
            </ul>
          </nav>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-gray-200 bg-gray-50 py-6">
          <div className="mx-auto max-w-7xl px-4 text-center text-sm text-gray-500 sm:px-6 lg:px-8">
            <p>
              © {new Date().getFullYear()} {SITE_NAME} · Soukromá sbírka
              čtyřlístků
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
