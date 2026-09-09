import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { trackViewport } from "./viewport";
import "./styles.css";

// Before the first render, so the app is never laid out against a height it is
// about to be told is wrong.
trackViewport();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registered after load so it never competes with the first paint. Without a
// service worker iOS treats this as a bookmark rather than an installable app,
// and none of it works offline.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Not fatal: over plain HTTP registration is refused outright, and the
      // app should still run as an ordinary web page.
      console.warn("service worker not registered:", err);
    });
  });
}
