"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  publishRouteReady,
  revokeRouteReady,
  getRouteRevision,
  isSafeRoute,
} from "../../lib/pwa/routeReadiness";

export interface PwaSafeRouteReadyProps {
  expectedPath: string;
}

export function PwaSafeRouteReady({ expectedPath }: PwaSafeRouteReadyProps) {
  const pathname = usePathname();

  useEffect(() => {
    const cleanExpected = expectedPath.split("?")[0].split("#")[0];
    const cleanCurrent = (pathname ?? "").split("?")[0].split("#")[0];

    if (!isSafeRoute(cleanExpected)) {
      return;
    }

    if (
      cleanCurrent === cleanExpected &&
      typeof window !== "undefined" &&
      window.location.pathname.split("?")[0].split("#")[0] === cleanExpected
    ) {
      const revision = getRouteRevision();
      publishRouteReady(cleanExpected, revision);
    }

    return () => {
      revokeRouteReady(cleanExpected);
    };
  }, [expectedPath, pathname]);

  return null;
}
