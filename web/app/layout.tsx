import type { Metadata } from "next";
import { Saira_Condensed, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const saira = Saira_Condensed({
  variable: "--font-saira",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Pit Wall — F1 Dashboard",
  description:
    "Personal Formula 1 dashboard: standings, news, telemetry, live sessions, circuits and records.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${saira.variable} ${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-8 sm:px-6">
          {children}
        </main>
        <footer className="relative z-10 border-t border-line bg-card py-5 text-center text-xs text-muted">
          Data: Fast-F1 · Jolpica-F1 · public RSS · circuit outlines by{" "}
          <a className="underline hover:text-ink" href="https://github.com/julesr0y/f1-circuits-svg">
            julesr0y/f1-circuits-svg
          </a>{" "}
          (CC BY 4.0) — personal, self-hosted dashboard
        </footer>
      </body>
    </html>
  );
}
