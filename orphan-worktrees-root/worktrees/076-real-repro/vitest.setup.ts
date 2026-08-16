import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

afterEach(() => cleanup());
