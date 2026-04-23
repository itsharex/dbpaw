import type { ConnectionForm } from "@/services/api";
import {
  allowsHostWithPort,
  isFileBasedDriver,
  requiresPasswordOnCreate,
  requiresUsername,
} from "./rules";

type Mode = "create" | "edit";

export interface ConnectionValidationIssue {
  key: string;
}

const hasWhitespace = (value: string | undefined) =>
  !!value && /\s/.test(value);

const isPortInRange = (value: number | undefined) =>
  Number.isInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= 65535;

export const validateConnectionFormInput = (
  form: ConnectionForm,
  mode: Mode,
): ConnectionValidationIssue[] => {
  const issues: ConnectionValidationIssue[] = [];

  if (isFileBasedDriver(form.driver)) {
    if (!form.filePath) {
      issues.push({
        key: "connection.dialog.inputValidation.filePathRequired",
      });
    }
    return issues;
  }

  if (!form.host) {
    issues.push({ key: "connection.dialog.inputValidation.hostRequired" });
  }
  if (requiresUsername(form.driver) && !form.username) {
    issues.push({ key: "connection.dialog.inputValidation.usernameRequired" });
  }
  if (!isPortInRange(form.port)) {
    issues.push({ key: "connection.dialog.inputValidation.portRange" });
  }

  if (
    mode === "create" &&
    requiresPasswordOnCreate(form.driver) &&
    !form.password
  ) {
    issues.push({ key: "connection.dialog.inputValidation.passwordRequired" });
  }

  if (hasWhitespace(form.host)) {
    issues.push({ key: "connection.dialog.inputValidation.hostWhitespace" });
  }

  if (
    form.host &&
    form.host.includes(":") &&
    !allowsHostWithPort(form.driver) &&
    !form.host.startsWith("[")
  ) {
    issues.push({
      key: "connection.dialog.inputValidation.hostPortNotAllowed",
    });
  }

  if (
    form.ssl &&
    form.sslMode === "verify_ca" &&
    !(form.sslCaCert || "").trim()
  ) {
    issues.push({ key: "connection.dialog.sslValidation.caRequired" });
  }

  if (form.sshEnabled) {
    if (!form.sshHost) {
      issues.push({ key: "connection.dialog.inputValidation.sshHostRequired" });
    }
    if (!form.sshUsername) {
      issues.push({
        key: "connection.dialog.inputValidation.sshUsernameRequired",
      });
    }
    if (!isPortInRange(form.sshPort)) {
      issues.push({ key: "connection.dialog.inputValidation.sshPortRange" });
    }
    if (!form.sshPassword && !form.sshKeyPath) {
      issues.push({ key: "connection.dialog.inputValidation.sshAuthRequired" });
    }
  }

  return issues;
};
