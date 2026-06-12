/** Bridge exposed by the Electron preload (absent in regular browsers). */
interface Window {
  kubedeckDesktop?: {
    setTitleBarOverlay(options: { color: string; symbolColor: string }): void;
  };
}
