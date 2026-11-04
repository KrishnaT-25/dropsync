import { jsx, jsxs } from "react/jsx-runtime";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { RoomProvider } from "./context/RoomContext";
import { ThemeProvider } from "./context/ThemeContext";
import { HomePage } from "./pages/HomePage";
import { MeetingPage } from "./pages/MeetingPage";
import { RoomPage } from "./pages/RoomPage";
function App() {
  return /* @__PURE__ */ jsx(ThemeProvider, { children: /* @__PURE__ */ jsx(RoomProvider, { children: /* @__PURE__ */ jsx(BrowserRouter, { children: /* @__PURE__ */ jsxs(Routes, { children: [
    /* @__PURE__ */ jsx(Route, { path: "/", element: /* @__PURE__ */ jsx(HomePage, {}) }),
    /* @__PURE__ */ jsx(Route, { path: "/room/:code", element: /* @__PURE__ */ jsx(RoomPage, {}) }),
    /* @__PURE__ */ jsx(Route, { path: "/meet/:meetingCode", element: /* @__PURE__ */ jsx(MeetingPage, {}) }),
    /* @__PURE__ */ jsx(Route, { path: "*", element: /* @__PURE__ */ jsx(Navigate, { to: "/", replace: true }) })
  ] }) }) }) });
}
export {
  App as default
};
