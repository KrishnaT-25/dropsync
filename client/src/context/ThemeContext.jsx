import { jsx } from "react/jsx-runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
const ThemeContext = createContext(null);
function getInitialTheme() {
  try {
    const stored = localStorage.getItem("dropsync-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* The theme still works when browser storage is blocked. */ }
  return "light";
}
function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("dropsync-theme", theme);
    } catch { /* Keep the selected theme for this session. */ }
  }, [theme]);
  const setTheme = useCallback((next) => {
    setThemeState(next);
  }, []);
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => prev === "dark" ? "light" : "dark");
  }, []);
  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme]
  );
  return /* @__PURE__ */ jsx(ThemeContext.Provider, { value, children });
}
function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
export {
  ThemeProvider,
  useTheme
};
