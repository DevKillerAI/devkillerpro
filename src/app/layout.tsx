import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  applicationName: "DevKiller",
  title: {
    default: "DevKiller — Your Autonomous Development Department",
    template: "%s | DevKiller",
  },
  description: "Turn a product idea into verified software through an autonomous development department that plans, builds, tests, repairs, and documents every mission.",
  keywords: [
    "autonomous software development",
    "AI development team",
    "AI software engineering",
    "application builder",
    "software quality assurance",
    "multi-agent development",
    "DevKiller",
  ],
  authors: [{ name: "DevKiller" }],
  creator: "DevKiller",
  publisher: "DevKiller",
  category: "technology",
  icons: {
    icon: [{ url: "/logoDX.png", type: "image/png", sizes: "1254x1254" }],
    shortcut: "/logoDX.png",
    apple: [{ url: "/logoDX.png", type: "image/png", sizes: "1254x1254" }],
  },
  openGraph: {
    type: "website",
    siteName: "DevKiller",
    title: "DevKiller — Your Autonomous Development Department",
    description: "From product intent to verified software: coordinated AI specialists, evidence-based QA, recovery, and an integrated development workspace.",
    images: [{ url: "/logoextenso.png", width: 2172, height: 724, alt: "DevKiller" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DevKiller — Your Autonomous Development Department",
    description: "Plan, build, test, repair, and deliver software through a coordinated autonomous development department.",
    images: ["/logoextenso.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#111420",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className="bg-[#F4F6FA] text-slate-800 antialiased min-h-screen font-sans selection:bg-sky-500/20 selection:text-sky-800">
        {children}
      </body>
    </html>
  );
}
