import { useEffect, useRef, useState } from "react";
import { getSetting } from "../services/store";
import {
  AvailableUpdateRef,
  checkForUpdates,
  relaunchAfterUpdate,
  startBackgroundInstall,
  subscribeUpdateTask,
  UpdateTaskState,
} from "../services/updater";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const ACTIVE_UPDATE_TASK_STATES: UpdateTaskState[] = [
  "checking",
  "downloading",
  "installing",
];

export function UpdaterChecker() {
  const { t } = useTranslation();
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<AvailableUpdateRef | null>(null);
  const [startingInstall, setStartingInstall] = useState(false);
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);
  const lastTaskStateRef = useRef<UpdateTaskState>("idle");

  useEffect(() => {
    async function init() {
      try {
        const autoUpdate = await getSetting<boolean>("autoUpdate", true);
        if (autoUpdate) {
          const result = await checkForUpdates();
          if (result.state === "available" && result.update) {
            setUpdateInfo(result.update);
            setUpdateAvailable(true);
          }
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    }
    init();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeUpdateTask((snapshot) => {
      const previousState = lastTaskStateRef.current;
      lastTaskStateRef.current = snapshot.state;

      if (snapshot.state === "ready_to_restart" && previousState !== "ready_to_restart") {
        setRestartPromptOpen(true);
      }

      if (snapshot.state === "error" && previousState !== "error") {
        toast.error(t("settings.updates.failedUpdate"), {
          description: snapshot.message,
        });
      }
    });
    return unsubscribe;
  }, [t]);

  const handleUpdate = () => {
    if (startingInstall) return;
    try {
      setStartingInstall(true);
      const startResult = startBackgroundInstall(updateInfo);
      if (!startResult.started || ACTIVE_UPDATE_TASK_STATES.includes(startResult.snapshot.state)) {
        toast.info(t("settings.updates.inBackgroundProgress"));
      } else {
        toast.success(t("settings.updates.backgroundStarted"));
      }
      setUpdateAvailable(false);
    } catch (error) {
      console.error("Failed to install update:", error);
      toast.error(t("settings.updates.failedUpdate"));
    } finally {
      setStartingInstall(false);
    }
  };

  return (
    <>
      <AlertDialog open={updateAvailable} onOpenChange={setUpdateAvailable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.updates.updateDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.updates.available", { version: updateInfo?.version })}
              {updateInfo?.body && (
                <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                  {updateInfo.body}
                </div>
              )}
              <br />
              {t("settings.updates.updateDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startingInstall}>
              {t("settings.updates.updateLater")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleUpdate();
              }}
              disabled={startingInstall}
            >
              {startingInstall
                ? t("settings.updates.updating")
                : t("settings.updates.updateNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={restartPromptOpen} onOpenChange={setRestartPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.updates.restartPromptTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.updates.restartPromptDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.updates.restartLater")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void relaunchAfterUpdate();
              }}
            >
              {t("settings.updates.restartNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
