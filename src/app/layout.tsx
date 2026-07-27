import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthButton } from "@/components/auth-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "lemma — math practice, generated for you",
  description:
    "Build custom math problem sets by course, topic, and difficulty. Every problem is verified and comes with a step-by-step solution.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
            <div className="flex items-center gap-6">
              <Link href="/" className="text-lg font-bold tracking-tight text-indigo-600">
                lemma<span className="text-zinc-300">.</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm text-zinc-600">
                <Link href="/build" className="hover:text-zinc-900">
                  Build a set
                </Link>
                <Link href="/sets" className="hover:text-zinc-900">
                  My sets
                </Link>
              </nav>
            </div>
            <AuthButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-400">
          lemma — practice problems with verified answers and worked solutions
        </footer>
      </body>
    </html>
  );
}
