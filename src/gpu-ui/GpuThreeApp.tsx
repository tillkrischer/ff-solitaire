import { useEffect, useRef } from "react";
import { createThreeSolitaireApp } from "./threeSolitaire.ts";

const PAGE_BACKGROUND = {
  backgroundImage:
    "linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};

export function GpuThreeApp(): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const app = createThreeSolitaireApp(mount);
    return () => app.destroy();
  }, []);

  return (
    <main
      className="grid min-h-screen overflow-hidden bg-[#050505] p-2.5 font-ui text-[#ffe4b5] [color-scheme:dark]"
      style={PAGE_BACKGROUND}
    >
      <div ref={mountRef} className="grid min-h-0 w-full items-start justify-items-center" />
    </main>
  );
}
