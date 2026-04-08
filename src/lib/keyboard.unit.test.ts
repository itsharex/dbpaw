import { describe, expect, test } from "bun:test";
import { isModKey, isEditableTarget } from "./keyboard";

describe("isModKey", () => {
  test("returns true when metaKey is set", () => {
    expect(isModKey({ metaKey: true, ctrlKey: false })).toBe(true);
  });

  test("returns true when ctrlKey is set", () => {
    expect(isModKey({ metaKey: false, ctrlKey: true })).toBe(true);
  });

  test("returns true when both are set", () => {
    expect(isModKey({ metaKey: true, ctrlKey: true })).toBe(true);
  });

  test("returns false when neither is set", () => {
    expect(isModKey({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe("isEditableTarget", () => {
  test("returns false for null target", () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  // Note: further branches (HTMLElement.isContentEditable, element.closest) require
  // a DOM environment (jsdom/happy-dom) and are covered by integration/E2E tests.
});
