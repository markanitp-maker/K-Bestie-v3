"use client";

import { ParentHeader } from "@/components/ParentHeader";

interface ParentHomeHeaderProps {
  onStartChild?: () => void;
}

export function ParentHomeHeader({ onStartChild }: ParentHomeHeaderProps) {
  return <ParentHeader onStartChild={onStartChild} />;
}
