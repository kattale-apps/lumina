import type { Metadata, Viewport } from "next";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { RegisterServiceWorker } from "./RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Solar Switch | Solar Sales & System Design",
    template: "%s | Solar Switch"
  },
  description:
    "Solar customer assessment, system configuration, inventory and quotation management.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Solar Switch", statusBarStyle: "black-translucent" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10251f"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <RegisterServiceWorker />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
