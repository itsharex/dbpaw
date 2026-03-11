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

export type UpdateTaskState =
  | "idle"
  | "checking"
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

export interface UpdateTaskSnapshot {
  state: UpdateTaskState;
  message?: string;
  errorCode?: UpdateErrorCode;
}

export interface BackgroundInstallStartResult {
  started: boolean;
  snapshot: UpdateTaskSnapshot;
}

let checkInFlight: Promise<UpdateResult> | null = null;
let installInFlight: Promise<UpdateResult> | null = null;
let updateTaskSnapshot: UpdateTaskSnapshot = {
  state: "idle",
};
const updateTaskListeners = new Set<(snapshot: UpdateTaskSnapshot) => void>();

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function publishUpdateTaskSnapshot(snapshot: UpdateTaskSnapshot): void {
  updateTaskSnapshot = snapshot;
  updateTaskListeners.forEach((listener) => {
    listener(updateTaskSnapshot);
  });
}

function updateTaskState(
  state: UpdateTaskState,
  patch?: Pick<UpdateTaskSnapshot, "message" | "errorCode">,
): void {
  publishUpdateTaskSnapshot({
    state,
    message: patch?.message,
    errorCode: patch?.errorCode,
  });
}

export function getUpdateTaskSnapshot(): UpdateTaskSnapshot {
  return updateTaskSnapshot;
}

export function subscribeUpdateTask(
  listener: (snapshot: UpdateTaskSnapshot) => void,
): () => void {
  updateTaskListeners.add(listener);
  listener(updateTaskSnapshot);
  return () => {
    updateTaskListeners.delete(listener);
  };
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
  const startResult = startBackgroundInstall(updateRef, options);
  if (!startResult.started) {
    return {
      state:
        startResult.snapshot.state === "ready_to_restart"
          ? "ready_to_restart"
          : "downloading",
      available: true,
      errorCode: "UPDATE_IN_PROGRESS",
      message: "Update is already in progress.",
    };
  }

  const completion = await waitForInstallCompletion();
  if (completion) return completion;
  return {
    state: "idle",
    available: false,
  };
}

export function startBackgroundInstall(
  updateRef?: AvailableUpdateRef | null,
  options?: InstallUpdateOptions,
): BackgroundInstallStartResult {
  if (installInFlight) {
    return {
      started: false,
      snapshot: getUpdateTaskSnapshot(),
    };
  }

  installInFlight = (async () => {
    try {
      let update = updateRef?.raw;
      if (!update?.available) {
        updateTaskState("checking");
        options?.onStateChange?.("checking");
        const latest = await check();
        if (!latest?.available) {
          updateTaskState("idle", {
            message: "You are on the latest version.",
            errorCode: "NO_UPDATE",
          });
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

      updateTaskState("downloading");
      options?.onStateChange?.("downloading");
      updateTaskState("installing");
      options?.onStateChange?.("installing");
      await update.downloadAndInstall();
      updateTaskState("ready_to_restart", {
        message: "Update installed. Restart to apply changes.",
      });
      options?.onStateChange?.("ready_to_restart");

      return {
        state: "ready_to_restart",
        available: false,
        message: "Update installed, restarting...",
      };
    } catch (error) {
      updateTaskState("error", {
        message: normalizeError(error),
        errorCode: "INSTALL_FAILED",
      });
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

  return {
    started: true,
    snapshot: getUpdateTaskSnapshot(),
  };
}

export async function waitForInstallCompletion(): Promise<UpdateResult | null> {
  if (!installInFlight) return null;
  return installInFlight;
}

export async function relaunchAfterUpdate(): Promise<void> {
  await relaunch();
}
