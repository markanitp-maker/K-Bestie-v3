import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
import { defineConfig, devices } from "@playwright/test";

// CLAUDE.md §16 — agy E2E QA(§4-D)용 최소 설정. chromium headless 하나만 정의한다.
// baseURL은 실행 시점에 PLAYWRIGHT_BASE_URL로 넘긴다(로컬 서버/Dev/Production 전부 대상 가능,
// CLAUDE.md 안전장치: 어느 환경이든 QA테스트 계정만 사용).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3910",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /qa-078-pwa-safe-update\.spec\.ts/,
      use: { 
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream'
          ]
        }
      },
    },
    {
      name: "android-chrome",
      testIgnore: /qa-078-pwa-safe-update\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
      },
    },
    {
      name: "iphone-webkit",
      testIgnore: /qa-078-pwa-safe-update\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "tablet-portrait-chrome",
      testIgnore: /qa-078-pwa-safe-update\.spec\.ts/,
      use: {
        ...devices["iPad (gen 7)"],
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "tablet-landscape-chrome",
      testIgnore: /qa-078-pwa-safe-update\.spec\.ts/,
      use: {
        ...devices["iPad (gen 7) landscape"],
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "pwa-update-chromium",
      testMatch: /qa-078-pwa-safe-update\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        serviceWorkers: "allow",
        screenshot: "off",
        trace: "off",
        video: "off",
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],
});
