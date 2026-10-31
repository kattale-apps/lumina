import type { Metadata, Viewport } from "next";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lumina | Solar Sales & System Design",
    template: "%s | Lumina"
  },
  description:
    "Solar customer assessment, system configuration, inventory and quotation management."
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
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
