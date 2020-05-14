"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("path");

// Keep a global reference of the mainWindowdow object, if you don't, the mainWindowdow will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;
let subpy = null;
let subreact = null;

const PY_DIST_FOLDER = "dist-python"; // python distributable folder
const PY_SRC_FOLDER = "tisapi"; // path to the python source
const PY_MODULE = "run_app.py"; // the name of the main module

const isRunningInBundle = () => {
  return require("fs").existsSync(path.join(__dirname, PY_DIST_FOLDER));
};

const getPythonScriptPath = () => {
  if (!isRunningInBundle()) {
    return path.join(__dirname, PY_SRC_FOLDER, PY_MODULE);
  }
  if (process.platform === "win32") {
    return path.join(
      __dirname,
      PY_DIST_FOLDER,
      PY_MODULE.slice(0, -3) + ".exe"
    );
  }
  return path.join(__dirname, PY_DIST_FOLDER, PY_MODULE);
};

const startPythonSubprocess = () => {
  let script = getPythonScriptPath();
  if (isRunningInBundle()) {
    subpy = require("child_process").execFile(script, []);
  } else {
    subpy = require("child_process").spawn("python", [script]);
  }
};

const startReactSubprocess = () => {
  // TODO figure out how to start react subprocess
};

const killSubprocesses = main_pid => {
  const python_script_name = path.basename(getPythonScriptPath());
  // TODO figure out how to kill react subprocess
  let cleanup_completed = false;
  const psTree = require("ps-tree");
  psTree(main_pid, function(err, children) {
    let python_pids = children
      .filter(function(el) {
        return el.COMMAND == python_script_name;
      })
      .map(function(p) {
        return p.PID;
      });
    // kill all the spawned python processes
    python_pids.forEach(function(pid) {
      process.kill(pid);
    });
    subpy = null;
    cleanup_completed = true;
  });
  return new Promise(function(resolve, reject) {
    (function waitForSubProcessCleanup() {
      if (cleanup_completed) return resolve();
      setTimeout(waitForSubProcessCleanup, 30);
    })();
  });
};

const createMainWindow = () => {
  // Create the browser mainWindow
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    // transparent: true, // transparent header bar
    // icon: __dirname + "/icon.png",
    // fullscreen: true,
    // opacity:0.8,
    // darkTheme: true,
    // frame: true,
    resizeable: true
  });

  // Load the index page
  mainWindow.loadURL("http://localhost:3000/");

  // Open the DevTools.
  //mainWindow.webContents.openDevTools();

  // Emitted when the mainWindow is closed.
  mainWindow.on("closed", function() {
    // Dereference the mainWindow object
    mainWindow = null;
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", function() {
  // start the backend server
  startPythonSubprocess();
  startReactSubprocess();
  createMainWindow();

  // TODO make sure that CLTK model files are available
  // TODO make sure that mongodb is installed and running
});

// disable menu
app.on("browser-window-created", function(e, window) {
  window.setMenu(null);
});

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    let main_process_pid = process.pid;
    killSubprocesses(main_process_pid).then(() => {
      app.quit();
    });
  }
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (subpy === null) {
    startPythonSubprocess();
  }
  if (subreact === null) {
    startReactSubprocess();
  }
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("quit", function() {
  // do some additional cleanup
});
