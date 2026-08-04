import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeInitScript = `(() => { try { const stored = localStorage.getItem("rocket-theme"); const mode = stored === "dark" || stored === "system" || stored === "light" ? stored : "dark"; const resolved = mode === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode; document.documentElement.dataset.theme = resolved; document.documentElement.dataset.themeMode = mode; const accent = localStorage.getItem("rocket-accent"); if (accent && /^#[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty("--user-accent", accent); } catch {} })();`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3002";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: {
      default: "Co-Roc",
      template: "%s · Co-Roc",
    },
    description:
      "Configuration control for OpenRocket teams: geometry, simulation, component evidence, approvals, releases and launch procedures.",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Co-Roc — Launch vehicle configuration control",
      description:
        "One controlled workspace for OpenRocket models, simulation results, component evidence, release approvals and launch checklists.",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Co-Roc — Launch vehicle configuration control",
      description: "OpenRocket geometry, engineering evidence, controlled releases and launch procedures in one team workspace.",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
