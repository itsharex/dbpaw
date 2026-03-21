import { describe, expect, test } from "bun:test";
import {
  parseHostEmbeddedPort,
  normalizePortNumber,
  normalizeConnectionFormInput,
} from "./rules";

describe("parseHostEmbeddedPort", () => {
  test("parses host:port when valid", () => {
    expect(parseHostEmbeddedPort("127.0.0.1:3306", undefined)).toEqual({
      host: "127.0.0.1",
      port: 3306,
    });
  });

  test("keeps host and fallback port when no port provided", () => {
    expect(parseHostEmbeddedPort("localhost", 5432)).toEqual({
      host: "localhost",
      port: 5432,
    });
  });

  test("does not parse ipv6 or whitespace hosts", () => {
    expect(parseHostEmbeddedPort("[::1]:3306", 5432)).toEqual({
      host: "[::1]:3306",
      port: 5432,
    });
    expect(parseHostEmbeddedPort("local host:3306", 5432)).toEqual({
      host: "local host:3306",
      port: 5432,
    });
  });

  test("does not parse invalid port", () => {
    expect(parseHostEmbeddedPort("db:abc", 3306)).toEqual({
      host: "db:abc",
      port: 3306,
    });
    expect(parseHostEmbeddedPort("db:3306:1", 3306)).toEqual({
      host: "db:3306:1",
      port: 3306,
    });
  });
});

describe("normalizePortNumber", () => {
  test("returns undefined for invalid values", () => {
    expect(normalizePortNumber(undefined)).toBeUndefined();
    expect(normalizePortNumber(null as unknown as number)).toBeUndefined();
    expect(normalizePortNumber(Number.NaN)).toBeUndefined();
    expect(normalizePortNumber(3306.5)).toBeUndefined();
  });

  test("keeps valid integers", () => {
    expect(normalizePortNumber(3306)).toBe(3306);
  });
});

describe("normalizeConnectionFormInput", () => {
  test("splits host:port for mysql family drivers", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "mysql",
      host: " db:3306 ",
      port: undefined,
      name: "  test  ",
      password: "",
    } as any);

    expect(normalized.host).toBe("db");
    expect(normalized.port).toBe(3306);
    expect(normalized.name).toBe("test");
    expect(normalized.password).toBe("");
  });

  test("does not split host:port for non-mysql drivers", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "postgres",
      host: "db:3306",
      port: 5432,
      password: "",
    } as any);

    expect(normalized.host).toBe("db:3306");
    expect(normalized.port).toBe(5432);
  });

  test("trims text values and keeps empty secrets", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "postgres",
      host: "  db  ",
      database: "  test_db ",
      password: " ",
      sslCaCert: "",
      sshPassword: "",
    } as any);

    expect(normalized.host).toBe("db");
    expect(normalized.database).toBe("test_db");
    expect(normalized.password).toBe("");
    expect(normalized.sslCaCert).toBe("");
    expect(normalized.sshPassword).toBe("");
  });
});
