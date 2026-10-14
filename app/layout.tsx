import type { Metadata } from "next";
import localFont from "next/font/local";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast";
import { LocaleProvider } from "@/lib/i18n/client";
import { getServerLocale } from "@/lib/i18n/server";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const notoThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lifework POS",
  description: "Point of sale for Lifework fashion retail",
};

/** Root layout. Reads the language cookie so every page renders in the chosen language. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = getServerLocale();
  return (
    <html lang={locale} className={cn("font-sans", geistSans.variable, geistMono.variable, notoThai.variable)}>
      <body className="bg-background text-foreground antialiased">
        <LocaleProvider initialLocale={locale}>
          {children}
          <Toaster />
        </LocaleProvider>
      </body>
    </html>
  );
}
