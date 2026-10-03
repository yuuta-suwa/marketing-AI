import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MARKET RADAR OS", template: "%s · MARKET RADAR OS" },
  description: "公開情報の不満・要望・支払意思から、証拠付きで事業機会を発見するAI市場インテリジェンスOS",
  applicationName: "MARKET RADAR OS",
  appleWebApp: { capable: true, title: "Market Radar", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
