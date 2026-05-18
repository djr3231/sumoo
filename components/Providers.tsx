"use client";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <SessionProvider>{children}</SessionProvider>
      <Toaster richColors position="top-center" dir="rtl" />
    </ThemeProvider>
  );
}
