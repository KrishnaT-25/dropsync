import { jsx, jsxs } from "react/jsx-runtime";
function AppShell({ children, centered = false }) {
  return /* @__PURE__ */ jsxs("div", { className: "ds-app-shell relative min-h-screen", style: { background: "var(--bg)" }, children: [
    /* @__PURE__ */ jsx(
      "div",
      {
        className: `ds-app-inner relative z-10 flex min-h-screen flex-col ${centered ? "items-center justify-center" : ""}`,
        children
      }
    )
  ] });
}
export {
  AppShell
};
