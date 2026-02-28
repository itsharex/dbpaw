import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready_to_restart"
  | "error";

export type UpdateErrorCode =
  | "CHECK_FAILED"
  | "NO_UPDATE"
  | "UPDATE_IN_PROGRESS"
  | "INSTALL_FAILED";

type RawUpdate = Awaited<ReturnType<typeof check>>;

export interface AvailableUpdateRef {
  version: string;
  body?: string;
  raw: Exclude<RawUpdate, null>;
}

export interface UpdateResult {
  state: UpdateState;
  available: boolean;
  update?: AvailableUpdateRef;
  errorCode?: UpdateErrorCode;
  message?: string;
  error?: unknown;
}

export interface CheckForUpdatesOptions {
  onStateChange?: (state: UpdateState) => void;
}

export interface InstallUpdateOptions {
  onStateChange?: (state: UpdateState) => void;
}

let checkInFlight: Promise<UpdateResult> | null = null;
let installInFlight: Promise<UpdateResult> | null = null;

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function checkForUpdates(
  options?: CheckForUpdatesOptions,
): Promise<UpdateResult> {
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    options?.onStateChange?.("checking");
    try {
      const update = await check();
      if (update?.available) {
        options?.onStateChange?.("available");
        return {
          state: "available",
          available: true,
          update: {
            version: update.version,
            body: update.body,
            raw: update,
          },
        };
      }

      options?.onStateChange?.("idle");
      return {
        state: "idle",
        available: false,
        errorCode: "NO_UPDATE",
        message: "You are on the latest version.",
      };
    } catch (error) {
      options?.onStateChange?.("error");
      return {
        state: "error",
        available: false,
        errorCode: "CHECK_FAILED",
        message: normalizeError(error),
        error,
      };
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

export async function installAvailableUpdate(
  updateRef?: AvailableUpdateRef | null,
  options?: InstallUpdateOptions,
): Promise<UpdateResult> {
  if (installInFlight) {
    return {
      state: "downloading",
      available: true,
      errorCode: "UPDATE_IN_PROGRESS",
      message: "Update is already in progress.",
    };
  }

  installInFlight = (async () => {
    try {
      options?.onStateChange?.("downloading");
      let update = updateRef?.raw;
      if (!update?.available) {
        options?.onStateChange?.("checking");
        const latest = await check();
        if (!latest?.available) {
          options?.onStateChange?.("idle");
          return {
            state: "idle",
            available: false,
            errorCode: "NO_UPDATE",
            message: "You are on the latest version.",
          };
        }
        update = latest;
      }

      options?.onStateChange?.("installing");
      await update.downloadAndInstall();
      options?.onStateChange?.("ready_to_restart");

      return {
        state: "ready_to_restart",
        available: false,
        message: "Update installed, restarting...",
      };
    } catch (error) {
      options?.onStateChange?.("error");
      return {
        state: "error",
        available: false,
        errorCode: "INSTALL_FAILED",
        message: normalizeError(error),
        error,
      };
    } finally {
      installInFlight = null;
    }
  })();

  return installInFlight;
}

export async function relaunchAfterUpdate(): Promise<void> {
  await relaunch();
}
