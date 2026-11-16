import type { Metadata } from "next";
import { Fraunces, Inter, Unbounded } from "next/font/google";
import "./globals.css";

// Unbounded: the logo and big headings. Fraunces: place names. Inter: everything else.
const unbounded = Unbounded({ variable: "--font-logo", subsets: ["latin"], weight: "600" });
const fraunces = Fraunces({ variable: "--font-serif", subsets: ["latin"], weight: "variable", axes: ["SOFT", "opsz"] });
const inter = Inter({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "four — Boston happy hours, by the hour",
  description: "Food by day, drinks by night. Boston's best happy hour deals, checked every week.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${unbounded.variable} ${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
