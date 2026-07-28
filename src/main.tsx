import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  applyUiFontPreference,
  resolveInitialUiFontPreference,
} from "./lib/uiFont";
import "./index.css";

applyUiFontPreference(resolveInitialUiFontPreference(), false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
