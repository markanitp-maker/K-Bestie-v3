"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  publishRouteReady,
  revokeRouteReady,
  normalizeRoutePath,
  getRouteReadinessSnapshot,
  SafeRoutePath,
} from "@/lib/pwa/routeReadiness";

interface PwaSafeRouteReadyProps {
  expectedPath: SafeRoutePath | string;
}

export function PwaSafeRouteReady({ expectedPath }: PwaSafeRouteReadyProps) {
  const pathname = usePathname() ?? "";
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const currentNormalized = normalizeRoutePath(pathname);
    const expectedNormalized = normalizeRoutePath(expectedPath);

    if (currentNormalized !== expectedNormalized) {
      return;
    }

    const { routeRevision } = getRouteReadinessSnapshot();
    const token = publishRouteReady(expectedNormalized, routeRevision);
    tokenRef.current = token;

    return () => {
      if (tokenRef.current) {
        revokeRouteReady(tokenRef.current);
        tokenRef.current = null;
      }
    };
  }, [pathname, expectedPath]);

  return null;
}
