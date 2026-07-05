import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GpuThreeApp } from "./gpu-ui/GpuThreeApp.tsx";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GpuThreeApp />
  </StrictMode>,
);
