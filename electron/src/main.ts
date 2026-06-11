import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';
import fixPath from 'fix-path';
import { startServer, type RunningServer } from '@kubedeck/server';

// GUI apps on macOS/Linux don't inherit the shell PATH; kubeconfig exec
// plugins (aws, gke-gcloud-auth-plugin, kubelogin, ...) need it.
fixPath();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | undefined;
let server: RunningServer | undefined;
let closing: Promise<void> | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      server = await startServer({
        port: 0,
        openBrowser: false,
        prettyLogs: false,
        staticRoot: app.isPackaged
          ? path.join(process.resourcesPath, 'client')
          : path.resolve(__dirname, '../../client/dist'),
      });
    } catch (err) {
      console.error('failed to start kubedeck server', err);
      app.quit();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      title: 'Kubedeck',
      show: false,
      icon: path.resolve(__dirname, '../build/icon.png'),
    });
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => {
      mainWindow = undefined;
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    await mainWindow.loadURL(server.url);
  });

  // The server (and its port-forwards) is tied to the window, so quit
  // everywhere — including macOS — instead of lingering headless.
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (!server) return;
    if (!closing) {
      closing = server.close().catch(() => undefined);
      void closing.then(() => {
        server = undefined;
        app.quit();
      });
    }
    event.preventDefault();
  });
}
