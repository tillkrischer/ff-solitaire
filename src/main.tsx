import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CanvasV1App } from "./ui/CanvasV1App.tsx";
import { DevUiPicker } from "./ui/DevUiPicker.tsx";
import "./ui/styles.css";

function getDevRoute(): JSX.Element {
  const basePath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
  const pathname = window.location.pathname;
  const relativePath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.slice(1);
  const route = relativePath.replace(/^\/+|\/+$/g, "");

  if (route === "canvas") return <CanvasV1App />;
  return <DevUiPicker />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {import.meta.env.DEV ? getDevRoute() : <CanvasV1App />}
  </StrictMode>,
);
