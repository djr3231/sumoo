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
        "bg-primary text-primary-foreground hover:opacity-90",
      ghost:
        "bg-transparent hover:bg-accent text-foreground",
      outline:
        "border border-border bg-transparent hover:bg-accent text-foreground",
      destructive:
        "bg-destructive text-white hover:opacity-90",
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
