import { describe, expect, test } from "bun:test";
import {
  allowsHostWithPort,
  buildConnectionFormDefaults,
  formatRedisNodeList,
  getConnectionFormCapabilities,
  getRedisConnectionMode,
  isFileBasedDriver,
  isMysqlFamilyDriver,
  normalizeConnectionFormInput,
  normalizeRedisNodeListInput,
  normalizePortNumber,
  normalizeTextValue,
  parseHostEmbeddedPort,
  requiresPasswordOnCreate,
  requiresUsername,
} from "./rules";

describe("isMysqlFamilyDriver", () => {
  test("recognizes mysql family", () => {
    expect(isMysqlFamilyDriver("mysql")).toBe(true);
    expect(isMysqlFamilyDriver("mariadb")).toBe(true);
    expect(isMysqlFamilyDriver("tidb")).toBe(true);
    expect(isMysqlFamilyDriver("starrocks")).toBe(true);
  });

  test("rejects non-mysql drivers", () => {
    expect(isMysqlFamilyDriver("postgres")).toBe(false);
    expect(isMysqlFamilyDriver("sqlite")).toBe(false);
  });
});

describe("isFileBasedDriver", () => {
  test("recognizes file-based drivers", () => {
    expect(isFileBasedDriver("sqlite")).toBe(true);
    expect(isFileBasedDriver("duckdb")).toBe(true);
  });

  test("rejects network drivers", () => {
    expect(isFileBasedDriver("mysql")).toBe(false);
    expect(isFileBasedDriver("postgres")).toBe(false);
  });
});

describe("allowsHostWithPort / requiresPasswordOnCreate", () => {
  test("mysql family, redis, and elasticsearch allow host:port notation", () => {
    expect(allowsHostWithPort("mysql")).toBe(true);
    expect(allowsHostWithPort("starrocks")).toBe(true);
    expect(allowsHostWithPort("redis")).toBe(true);
    expect(allowsHostWithPort("elasticsearch")).toBe(true);
    expect(allowsHostWithPort("postgres")).toBe(false);
  });

  test("postgres requires password on create while optional-auth drivers do not", () => {
    expect(requiresPasswordOnCreate("postgres")).toBe(true);
    expect(requiresPasswordOnCreate("mysql")).toBe(false);
    expect(requiresPasswordOnCreate("starrocks")).toBe(false);
    expect(requiresPasswordOnCreate("redis")).toBe(false);
    expect(requiresPasswordOnCreate("elasticsearch")).toBe(false);
  });

  test("redis and elasticsearch do not require usernames", () => {
    expect(requiresUsername("postgres")).toBe(true);
    expect(requiresUsername("redis")).toBe(false);
    expect(requiresUsername("elasticsearch")).toBe(false);
  });
});

describe("getConnectionFormCapabilities", () => {
  test("returns file-based capabilities for sqlite", () => {
    expect(getConnectionFormCapabilities("sqlite")).toEqual({
      showHost: false,
      showPort: false,
      showUsername: false,
      showPassword: true,
      showDatabase: false,
      showSchema: false,
      showSsl: false,
      showSsh: false,
      showFilePath: true,
      showSqliteKey: true,
    });
  });

  test("returns redis-specific capabilities", () => {
    expect(getConnectionFormCapabilities("redis")).toEqual({
      showHost: false,
      showPort: false,
      showUsername: true,
      showPassword: true,
      showDatabase: false,
      showSchema: false,
      showSsl: false,
      showSsh: false,
      showFilePath: false,
      showSqliteKey: false,
    });
  });

  test("returns elasticsearch-specific capabilities", () => {
    expect(getConnectionFormCapabilities("elasticsearch")).toEqual({
      showHost: true,
      showPort: true,
      showUsername: true,
      showPassword: true,
      showDatabase: false,
      showSchema: false,
      showSsl: true,
      showSsh: true,
      showFilePath: false,
      showSqliteKey: false,
    });
  });

  test("returns sql network capabilities for postgres", () => {
    expect(getConnectionFormCapabilities("postgres")).toEqual({
      showHost: true,
      showPort: true,
      showUsername: true,
      showPassword: true,
      showDatabase: true,
      showSchema: true,
      showSsl: true,
      showSsh: true,
      showFilePath: false,
      showSqliteKey: false,
    });
  });
});

describe("buildConnectionFormDefaults", () => {
  test("uses driver default port for mysql", () => {
    expect(buildConnectionFormDefaults("mysql").port).toBe(3306);
  });

  test("does not set a port for sqlite", () => {
    expect(buildConnectionFormDefaults("sqlite").port).toBeUndefined();
  });

  test("applies overrides after defaults", () => {
    const form = buildConnectionFormDefaults("redis", { name: "Cache" });
    expect(form.name).toBe("Cache");
    expect(form.port).toBe(6379);
    expect(form.mode).toBe("standalone");
    expect(form.seedNodes).toEqual([]);
    expect(form.connectTimeoutMs).toBe(5000);
  });

  test("sets elasticsearch authentication defaults", () => {
    const form = buildConnectionFormDefaults("elasticsearch");
    expect(form.authMode).toBe("none");
    expect(form.apiKeyId).toBe("");
    expect(form.apiKeySecret).toBe("");
    expect(form.apiKeyEncoded).toBe("");
    expect(form.cloudId).toBe("");
  });
});

describe("normalizeTextValue", () => {
  test("returns undefined for undefined and null", () => {
    expect(normalizeTextValue(undefined)).toBeUndefined();
    expect(normalizeTextValue(null as any)).toBeUndefined();
  });

  test("returns undefined for blank strings when emptyToUndefined is true (default)", () => {
    expect(normalizeTextValue("")).toBeUndefined();
    expect(normalizeTextValue("   ")).toBeUndefined();
  });

  test("returns empty string for blank when emptyToUndefined is false", () => {
    expect(normalizeTextValue("", false)).toBe("");
    expect(normalizeTextValue("  ", false)).toBe("");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeTextValue("  hello  ")).toBe("hello");
  });
});

describe("parseHostEmbeddedPort", () => {
  test("parses host:port when valid", () => {
    expect(parseHostEmbeddedPort("127.0.0.1:3306", undefined)).toEqual({
      host: "127.0.0.1",
      port: 3306,
    });
  });

  test("prefers embedded port over fallback port", () => {
    expect(parseHostEmbeddedPort("127.0.0.1:3307", 3306)).toEqual({
      host: "127.0.0.1",
      port: 3307,
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

  test("uses embedded host port even when a default port is already set", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "starrocks",
      host: " db:9031 ",
      port: 9030,
      password: "",
    } as any);

    expect(normalized.host).toBe("db");
    expect(normalized.port).toBe(9031);
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

  test("normalizes elasticsearch api key and cloud id fields", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "elasticsearch",
      host: " es.local:9201 ",
      authMode: "api_key",
      apiKeyId: " id ",
      apiKeySecret: " secret ",
      apiKeyEncoded: " ",
      cloudId: " deployment:abc ",
    } as any);

    expect(normalized.host).toBe("es.local");
    expect(normalized.port).toBe(9201);
    expect(normalized.authMode).toBe("api_key");
    expect(normalized.apiKeyId).toBe("id");
    expect(normalized.apiKeySecret).toBe("secret");
    expect(normalized.apiKeyEncoded).toBe("");
    expect(normalized.cloudId).toBe("deployment:abc");
  });

  test("normalizes structured redis cluster options", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "redis",
      mode: "cluster",
      seedNodes: [" 10.0.0.1:6379 ", "10.0.0.2:6379"],
      connectTimeoutMs: 4000,
    });

    expect(normalized.mode).toBe("cluster");
    expect(normalized.seedNodes).toEqual(["10.0.0.1:6379", "10.0.0.2:6379"]);
    expect(normalized.connectTimeoutMs).toBe(4000);
  });

  test("derives redis standalone seed node from host and port", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "redis",
      mode: "standalone",
      host: " 127.0.0.1 ",
      port: 6379,
    });

    expect(normalized.seedNodes).toEqual(["127.0.0.1:6379"]);
  });

  test("keeps legacy redis comma-separated host as cluster seed nodes", () => {
    const normalized = normalizeConnectionFormInput({
      driver: "redis",
      host: "10.0.0.1:6379,10.0.0.2:6379",
    });

    expect(normalized.mode).toBe("cluster");
    expect(normalized.seedNodes).toEqual(["10.0.0.1:6379", "10.0.0.2:6379"]);
  });
});

describe("redis helpers", () => {
  test("normalizes node list input from text", () => {
    expect(
      normalizeRedisNodeListInput("10.0.0.1:6379\n10.0.0.2:6379,10.0.0.1:6379"),
    ).toEqual(["10.0.0.1:6379", "10.0.0.2:6379"]);
  });

  test("formats node list back to text", () => {
    expect(formatRedisNodeList(["10.0.0.1:6379", "10.0.0.2:6379"])).toBe(
      "10.0.0.1:6379\n10.0.0.2:6379",
    );
  });

  test("detects redis mode from saved fields", () => {
    expect(
      getRedisConnectionMode({
        driver: "redis",
        mode: undefined,
        host: "10.0.0.1:6379,10.0.0.2:6379",
        seedNodes: undefined,
      }),
    ).toBe("cluster");
  });
});
