"use client";

/** Client shell for the interactive world globe. */
import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

import { TopBar } from "@/components/TopBar";
import {
  ErrorOverlay,
  LoadingOverlay,
  WebGLUnavailableOverlay,
} from "@/components/Overlays";
import type { GlobeStatus } from "@/components/GlobeView";
import { isWebGL2Available } from "@/map/webglSupport";

// The globe depends on `window`/WebGL, so never render it on the server.
const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
});

export function Explorer() {
  // `null` on the server / first paint, then true|false on the client — via
  // useSyncExternalStore so there is no hydration mismatch and no setState-in-
  // effect cascade.
  const webglSupported = useWebGLSupported();
  const [globeStatus, setGlobeStatus] = useState<GlobeStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleStatus = (status: GlobeStatus, message?: string) => {
    setGlobeStatus(status);
    if (status === "error") setErrorMessage(message ?? "Unknown error.");
  };

  return (
    <main className="relative h-full w-full overflow-hidden bg-background">
      {/* Globe layer */}
      {webglSupported === true && <GlobeView onStatus={handleStatus} />}

      {/* Interface */}
      <TopBar />

      {/* States (topmost) */}
      {webglSupported === null && <LoadingOverlay />}
      {webglSupported === false && <WebGLUnavailableOverlay />}
      {webglSupported === true && globeStatus === "loading" && <LoadingOverlay />}
      {webglSupported === true && globeStatus === "error" && (
        <ErrorOverlay message={errorMessage ?? "Unknown error."} />
      )}
    </main>
  );
}

/**
 * WebGL 2 availability as an external, read-only value. We compute it once
 * (lazily, client-side) and never change it, so `subscribe` is a no-op. The
 * server snapshot is `null` so SSR renders the neutral loading state.
 */
let webglSupportCache: boolean | null = null;
function getWebGLSnapshot(): boolean {
  if (webglSupportCache === null) webglSupportCache = isWebGL2Available();
  return webglSupportCache;
}
function useWebGLSupported(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    () => () => {},
    getWebGLSnapshot,
    () => null,
  );
}
