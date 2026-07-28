import { getSupabaseTarget } from "@/lib/supabase/env";

export interface PwaIconSet {
  favicon16: string;
  favicon32: string;
  appleTouchIcon180: string;
  icon192: string;
  icon512: string;
  maskableIcon192: string;
  maskableIcon512: string;
}

// 개발 환경: 말풍선 심볼 아이콘
const DEV_ICONS: PwaIconSet = {
  favicon16: "/icons/favicon-16.png",
  favicon32: "/icons/favicon-32.png",
  appleTouchIcon180: "/icons/apple-touch-icon-180.png",
  icon192: "/icons/icon-192.png",
  icon512: "/icons/icon-512.png",
  maskableIcon192: "/icons/maskable-icon-192.png",
  maskableIcon512: "/icons/maskable-icon-512.png",
};

// Production 환경: K 마스코트 아이콘
// favicon16/32 전용 마스코트 자산은 존재하지 않아(재가공 금지 원칙상 신규 리사이즈 불가),
// 기존 icon-192-v4.png(마스코트) 자산을 favicon 참조로도 재사용한다.
const PROD_ICONS: PwaIconSet = {
  favicon16: "/icons/icon-192-v4.png",
  favicon32: "/icons/icon-192-v4.png",
  appleTouchIcon180: "/icons/apple-touch-icon-180-v4.png",
  icon192: "/icons/icon-192-v4.png",
  icon512: "/icons/icon-512-v4.png",
  maskableIcon192: "/icons/maskable-icon-192-v4.png",
  maskableIcon512: "/icons/maskable-icon-512-v4.png",
};

export function getPwaIcons(): PwaIconSet {
  return getSupabaseTarget() === "prod" ? PROD_ICONS : DEV_ICONS;
}
