import { useEffect, useRef, useState } from "react";
import { getSetting } from "../services/store";
import {
  AvailableUpdateRef,
  checkForUpdates,
  relaunchAfterUpdate,
  startBackgroundInstall,
  subscribeUpdateTask,
  UpdateTaskState,
  enableMock,
  disableMock,
  isMockEnabled,
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

  // Dev mode: expose test helpers globally
  useEffect(() => {
    if (import.meta.env.DEV) {
      const win = window as unknown as {
        __updaterTest: {
          enableMock: typeof enableMock;
          disableMock: typeof disableMock;
          isMockEnabled: typeof isMockEnabled;
          checkNow: () => Promise<void>;
          mockAvailable: () => void;
          mockNoUpdate: () => void;
          mockError: () => void;
          mockSlowDownload: () => void;
        };
      };

      win.__updaterTest = {
        enableMock,
        disableMock,
        isMockEnabled,
        
        // Quick test helpers
        checkNow: async () => {
          console.log('[Updater Test] Triggering check manually...');
          const result = await checkForUpdates();
          console.log('[Updater Test] Check result:', result);
          if (result.state === "available" && result.update) {
            setUpdateInfo(result.update);
            setUpdateAvailable(true);
          }
        },
        
        mockAvailable: () => {
          enableMock('available');
          console.log('%c[Updater Test] Enabled: update available', 'color: #4CAF50');
          console.log('Run __updaterTest.checkNow() to trigger a check');
        },
        
        mockNoUpdate: () => {
          enableMock('no_update');
          console.log('%c[Updater Test] Enabled: no update', 'color: #2196F3');
          console.log('Run __updaterTest.checkNow() to trigger a check');
        },
        
        mockError: () => {
          enableMock('error');
          console.log('%c[Updater Test] Enabled: check failed', 'color: #f44336');
          console.log('Run __updaterTest.checkNow() to trigger a check');
        },
        
        mockSlowDownload: () => {
          enableMock('slow_download');
          console.log('%c[Updater Test] Enabled: slow download', 'color: #FF9800');
          console.log('Run __updaterTest.checkNow() to trigger a check');
        },
      };

      console.log(
        '%c[Updater Test] Debug helpers are mounted on window.__updaterTest',
        'color: #4CAF50; font-weight: bold; font-size: 14px;'
      );
      console.log('Available commands:');
      console.log('  __updaterTest.enableMock(scenario)  - enable mock: available/no_update/error/slow_download');
      console.log('  __updaterTest.disableMock()         - disable mock');
      console.log('  __updaterTest.isMockEnabled()       - get mock status');
      console.log('  __updaterTest.checkNow()            - trigger check manually');
      console.log('  __updaterTest.mockAvailable()       - quick: simulate update available');
      console.log('  __updaterTest.mockNoUpdate()        - quick: simulate no update');
      console.log('  __updaterTest.mockError()           - quick: simulate error');
      console.log('  __updaterTest.mockSlowDownload()    - quick: simulate slow download');
    }
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
