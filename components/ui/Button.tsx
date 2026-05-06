"use client";
import { cn } from "@/lib/utils";
import * as React from "react";

type Variant = "primary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    const sizes: Record<Size, string> = {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
    };
    const variants: Record<Variant, string> = {
      primary:
        "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
      ghost:
        "bg-transparent hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]",
      outline:
        "border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]",
      destructive:
        "bg-[hsl(var(--destructive))] text-white hover:opacity-90",
    };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed",
          sizes[size],
          variants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
