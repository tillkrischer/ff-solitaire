import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CanvasV1App } from "./ui/CanvasV1App.tsx";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CanvasV1App />
  </StrictMode>,
);
