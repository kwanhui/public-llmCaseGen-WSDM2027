import type { Metadata, Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

// Source Sans 3: a humanist face with open counters, readable at the small
// sizes of the admin tables and in long case text. Exposed as --font-sans,
// which tailwind.config.ts puts ahead of the system stack.
const sans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "PersCase: case study authoring for instructors",
  description:
    "PersCase lets instructors author personalised professional case studies, which students then work through in phases.",
};

// Students often open their team link on a phone, so the case viewer must scale
// to the device width rather than rendering at a fixed desktop width.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
