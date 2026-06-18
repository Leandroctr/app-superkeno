import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { appConfig } from "@/lib/app-config";

export const metadata: Metadata = {
  title: appConfig.name,
  description: appConfig.description,
  applicationName: appConfig.name,
  manifest: "/manifest.webmanifest",
  metadataBase: appConfig.publicUrl ? new URL(appConfig.publicUrl) : undefined,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: appConfig.shortName,
  },
};

export const viewport: Viewport = {
  themeColor: appConfig.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
