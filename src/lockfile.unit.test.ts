import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load and parse the package-lock.json relative to the project root
const lockfilePath = resolve(import.meta.dir, "../package-lock.json");
const lockfile = JSON.parse(readFileSync(lockfilePath, "utf-8"));
const packageJsonPath = resolve(import.meta.dir, "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

describe("package-lock.json integrity", () => {
  test("top-level metadata matches package.json", () => {
    expect(lockfile.name).toBe(packageJson.name);
    expect(lockfile.version).toBe(packageJson.version);
    expect(lockfile.packages[""].name).toBe(packageJson.name);
    expect(lockfile.packages[""].version).toBe(packageJson.version);
  });

  test("root runtime dependencies match package.json", () => {
    expect(lockfile.packages[""].dependencies).toEqual(
      packageJson.dependencies,
    );
  });

  test("uses a modern npm lockfile structure", () => {
    expect(lockfile.lockfileVersion).toBe(3);
    expect(lockfile.requires).toBe(true);
    expect(lockfile.packages[""]).toBeDefined();
  });
});
