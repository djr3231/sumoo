import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "סומו · סורק קבלות",
  description: "סריקת קבלות אישית עם השוואת תדפיסי בנק ואשראי",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "סומו" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
