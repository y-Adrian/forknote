import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import {
  applyUiFontPreference,
  resolveInitialUiFontPreference,
} from "./lib/uiFont";
import { initTextZoom } from "./lib/textZoom";
import "./index.css";

applyUiFontPreference(resolveInitialUiFontPreference(), false);
initTextZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
