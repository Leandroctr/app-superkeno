import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { OneSignalInitializer } from "@/components/onesignal-initializer";
import { getAppSettings } from "@/lib/app-settings.server";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();

  return {
    title: settings.appName,
    description: settings.appDescription,
    applicationName: settings.appName,
    manifest: "/manifest.webmanifest",
    metadataBase: settings.publicUrl ? new URL(settings.publicUrl) : undefined,
    icons: {
      icon: settings.faviconUrl || settings.icon192Url || "/icons/icon-192.svg",
      apple: {
        url: settings.icon192Url || "/icons/icon-192.svg",
        sizes: "180x180",
      },
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: settings.appShortName,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const settings = await getAppSettings();

  return {
    themeColor: settings.themeColor,
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getAppSettings();

  return (
    <html lang="pt-BR">
      <head>
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href={settings.icon192Url || "/icons/icon-192.svg"}
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        <OneSignalInitializer />
        {children}
      </body>
    </html>
  );
}
