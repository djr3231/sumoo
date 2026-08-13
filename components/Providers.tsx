"use client";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { Direction } from "radix-ui";
import { SessionGuard } from "./SessionGuard";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {/* Radix primitives read direction from this context, not the DOM dir
          attribute — required for RTL dropdown/menu alignment. */}
      <Direction.Provider dir="rtl">
        {/* refetchInterval re-validates the Google grant in a long-open tab;
            the mount fetch and refetchOnWindowFocus (on by default) cover
            page entry and tab switching. */}
        <SessionProvider refetchInterval={5 * 60}>
          <SessionGuard />
          {children}
        </SessionProvider>
        <Toaster richColors position="top-center" dir="rtl" />
      </Direction.Provider>
    </ThemeProvider>
  );
}
