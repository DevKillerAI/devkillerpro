import type { Metadata, Viewport } from "next";
import {siteOrigin,siteDescription,pageMetadata} from "@/lib/site-metadata";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
 ...pageMetadata('DevKiller — Tools for today. Apps for tomorrow.',siteDescription,'/'),
 metadataBase:new URL(siteOrigin),applicationName:'DevKiller',
 creator:'DevKiller',publisher:'DevKiller',category:'productivity',
 keywords:['DevKiller','DK Tools','DK Create','online image tools','PDF tools','audio tools','SVG editor','AI app builder'],
 icons:{icon:[{url:'/favicon.ico',type:'image/x-icon'},{url:'/tools-assets/dk.png',type:'image/png'}],shortcut:'/tools-assets/dk.png',apple:[{url:'/tools-assets/dk.png',type:'image/png'}]},
 manifest:'/manifest.webmanifest',
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
      <body className="bg-[#F4F6FA] text-slate-800 antialiased min-h-screen font-sans selection:bg-rose-500/20 selection:text-rose-900">
        {children}
      </body>
    </html>
  );
}
