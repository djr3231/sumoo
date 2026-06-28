"use client";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { Direction } from "radix-ui";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {/* Radix primitives read direction from this context, not the DOM dir
          attribute — required for RTL dropdown/menu alignment. */}
      <Direction.Provider dir="rtl">
        <SessionProvider>{children}</SessionProvider>
        <Toaster richColors position="top-center" dir="rtl" />
      </Direction.Provider>
    </ThemeProvider>
  );
}
