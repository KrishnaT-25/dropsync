import { jsx } from "react/jsx-runtime";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      onClick: toggleTheme,
      "aria-label": isDark ? "Switch to light mode" : "Switch to dark mode",
      className: `group inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-200 hover:scale-105 active:scale-95 ${className}`,
      style: {
        borderColor: "var(--border-strong)",
        background: "var(--bg-elevated)",
        color: "var(--text-secondary)"
      },
      children: isDark ? /* @__PURE__ */ jsx(Sun, { className: "h-[18px] w-[18px] text-accent transition-transform group-hover:rotate-12" }) : /* @__PURE__ */ jsx(Moon, { className: "h-[18px] w-[18px] text-accent transition-transform group-hover:-rotate-12" })
    }
  );
}
export {
  ThemeToggle
};
