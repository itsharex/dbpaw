import { describe, expect, test } from "bun:test";
import { validateConnectionFormInput } from "./validate";

const baseForm = {
  driver: "postgres",
  host: "127.0.0.1",
  port: 5432,
  username: "user",
  password: "pwd",
};

describe("validateConnectionFormInput", () => {
  test("requires filePath for file-based drivers", () => {
    const issues = validateConnectionFormInput(
      { driver: "sqlite", filePath: "" } as any,
      "create",
    );
    expect(issues.map((i) => i.key)).toContain(
      "connection.dialog.inputValidation.filePathRequired",
    );
  });

  test("validates ssh fields when sshEnabled", () => {
    const issues = validateConnectionFormInput(
      {
        ...baseForm,
        sshEnabled: true,
        sshHost: "",
        sshUsername: "",
        sshPort: 70000,
        sshPassword: "",
        sshKeyPath: "",
      } as any,
      "create",
    );

    const keys = issues.map((i) => i.key);
    expect(keys).toContain("connection.dialog.inputValidation.sshHostRequired");
    expect(keys).toContain("connection.dialog.inputValidation.sshUsernameRequired");
    expect(keys).toContain("connection.dialog.inputValidation.sshPortRange");
    expect(keys).toContain("connection.dialog.inputValidation.sshAuthRequired");
  });

  test("requires ssl CA cert when verify_ca", () => {
    const issues = validateConnectionFormInput(
      {
        ...baseForm,
        ssl: true,
        sslMode: "verify_ca",
        sslCaCert: "   ",
      } as any,
      "create",
    );
    expect(issues.map((i) => i.key)).toContain(
      "connection.dialog.sslValidation.caRequired",
    );
  });

  test("rejects host:port for drivers that disallow it", () => {
    const issues = validateConnectionFormInput(
      {
        ...baseForm,
        host: "db:5432",
        driver: "postgres",
      } as any,
      "create",
    );
    expect(issues.map((i) => i.key)).toContain(
      "connection.dialog.inputValidation.hostPortNotAllowed",
    );
  });
});
