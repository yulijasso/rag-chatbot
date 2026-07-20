"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  className?: string;
};

/**
 * Animated light/dark toggle button.
 * Shows a Sun in dark mode (click -> light) and a Moon in light mode (click -> dark),
 * crossfading and rotating between the two.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes only knows the resolved theme on the client; wait for mount
  // to avoid a hydration mismatch between server and client markup.
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      aria-label={
        mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"
      }
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-lg",
        "text-sidebar-foreground/70 transition-colors duration-150",
        "hover:bg-sidebar-accent hover:text-sidebar-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      type="button"
    >
      {/* Sun — visible in dark mode */}
      <Sun
        className={cn(
          "absolute size-4 transition-all duration-300",
          mounted && isDark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-0 opacity-0"
        )}
      />
      {/* Moon — visible in light mode */}
      <Moon
        className={cn(
          "absolute size-4 transition-all duration-300",
          mounted && !isDark
            ? "rotate-0 scale-100 opacity-100"
            : "rotate-90 scale-0 opacity-0"
        )}
      />
    </button>
  );
}
