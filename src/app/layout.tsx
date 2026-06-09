import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenWA",
  description: "WhatsApp + AI platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
