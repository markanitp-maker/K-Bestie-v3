"use client";

import React from "react";
import { CheckCircle, XCircle, AlertCircle, Clock, Info } from "lucide-react";

export type AdminStatusVariant = "success" | "danger" | "warning" | "info" | "neutral";

export interface AdminStatusBadgeProps {
  variant: AdminStatusVariant;
  text: string;
  icon?: boolean;
}

export function AdminStatusBadge({ variant, text, icon = true }: AdminStatusBadgeProps) {
  let color = "var(--admin-text-secondary)";
  let bg = "var(--admin-bg)";
  let IconComponent = Info;

  switch (variant) {
    case "success":
      color = "var(--admin-success)";
      bg = "var(--color-k-success-bg)"; // using existing token mapped in globals.css
      IconComponent = CheckCircle;
      break;
    case "danger":
      color = "var(--admin-danger)";
      bg = "var(--color-k-danger-bg)";
      IconComponent = XCircle;
      break;
    case "warning":
      color = "var(--admin-warning)";
      bg = "var(--color-k-warning-bg)";
      IconComponent = AlertCircle;
      break;
    case "info":
      color = "var(--admin-focus)";
      bg = "var(--color-k-info-bg)";
      IconComponent = Info;
      break;
    case "neutral":
      color = "var(--admin-text-secondary)";
      bg = "var(--admin-border)";
      IconComponent = Clock;
      break;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderRadius: "16px",
        fontSize: "12px",
        fontWeight: 600,
        color,
        backgroundColor: bg,
        whiteSpace: "nowrap"
      }}
    >
      {icon && <IconComponent size={14} />}
      {text}
    </span>
  );
}
