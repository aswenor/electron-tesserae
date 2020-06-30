"use strict";

const { app, BrowserWindow } = require("electron");
const child_process = require("child_process");
const fs = require("fs");
const mkdirp = require("mkdirp");
const os = require("os");
const path = require("path");
const url = require("url");
const yauzl = require("yauzl");

// Keep a global reference of the window objects. If you don't, the windows will
// be closed automatically when the JavaScript object is garbage collected.
// startupWindow refers to an initial loading screen
let startupWindow = null;
// mainWindow refers to the main interface of the application
let mainWindow = null;

// subpy refers to the backend server that needs to be running for the
// application to work. Under normal conditions, the application will start the
// server as a subprocess.
let subpy = null;

const PY_DIST_FOLDER = "dist-python"; // python distributable folder
const PY_SRC_FOLDER = "tisapi"; // path to the python source
const PY_MODULE = "run_app"; // the name of the main module

/**
 * @returns {boolean} is this instance running in a pre-built executable?
 */
const isRunningInBundle = () => {
  return path.basename(__dirname) === "app.asar";
};

/**
 * @returns {string} path of the directory where the instance should look for files
 */
const getResourcesPath = () => {
  if (isRunningInBundle()) {
    return path.join(path.dirname(__dirname), "app");
  }
  return __dirname;
}

/**
 * @returns {string} URL for system-specific MongoDB download
 */
const getMongoDownloadUrl = () => {
  const osname = os.platform();
  if (osname === "win32") {
    return "https://fastdl.mongodb.org/win32/mongodb-win32-x86_64-2012plus-4.2.6.zip";
  }
  if (osname === "darwin") {
    return "https://fastdl.mongodb.org/osx/mongodb-osx-ssl-x86_64-4.0.19.tgz";
  }
  if (osname === "linux") {
    // assume Ubuntu 18.04 LTS
    return "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu1804-4.2.6.tgz";
  }
  writeStartupError(
    "Could not get download URL",
    "Unsupported operating system"
  );
};

/**
 * @returns {string} path to directory where MongoDB application resides
 */
const getMongodUnpackedPath = () => {
  return path.join(TESS_HOME, path.basename(getMongoDownloadUrl()).slice(0, -4));
};

/**
 * @returns {string} path to mongod exectuable
 */
const getMongodPath = () => {
  const mongodPath = path.join(getMongodUnpackedPath(), "bin", "mongod");
  if (os.platform() === "win32") {
    return mongodPath + ".exe";
  }
  return mongodPath;
};

const TESS_HOME = path.join(os.homedir(), "tesserae"); // application home
const MONGOD_PATH = getMongodPath();
const MONGODB_DBPATH = path.join(TESS_HOME, "tessdb");

/**
 * Initialize the loading screen
 * @returns {Promise<null>}
 * 
 * The loading screen displays messages indicating what stages of application
 * initialization have occurred. The messages are displayed in order such that
 * the newest message comes beneath all of the others.
 * 
 * In order to allow the content of the loading screen to be changed at
 * runtime, the webPreferences option is set to find loading screen changing
 * code in preloadStartup.js.
 */
const loadStartupWindow = () => {
  return new Promise((resolve) => {
    startupWindow = new BrowserWindow({
      width: 800,
      height: 600,
      resizable: true,
      webPreferences: {
        preload: path.join(__dirname, "preloadStartup.js")
      }
    });
    startupWindow.loadFile(path.join(__dirname, "startup.html"));
    // startupWindow.webContents.openDevTools();
    startupWindow.on("closed", () => {
      startupWindow = null
    });
    startupWindow.webContents.once("dom-ready", (event, msg) => {
      resolve();
    });
  });
};

/**
 * @param {string} msg a message to display on the loading screen
 */
const writeStartupMessage = (msg) => {
  console.log(msg);
  if (startupWindow !== null) {
    startupWindow.webContents.send('update', msg);
  }
};

/**
 * Write an error message to the loading screen
 * @param {string} msg an error message to display on the loading screen
 * @param {*} err the error object that was thrown
 * 
 * If an error occurs during application initialization, all resources the
 * application has taken so far should be freed, the error should be displayed
 * on the loading screen, and the loading screen should remain however long the
 * user wishes in order to read the error message. When the user closes the
 * loading screen, the application should be completely shut down.
 */
const writeStartupError = (msg, err) => {
  console.error(msg);
  console.error(err);
  if (startupWindow !== null) {
    if (err !== null) {
      startupWindow.webContents.send('error', msg, err.toString());
    } else {
      startupWindow.webContents.send('error', msg, '');
    }
  }
  if (mainWindow !== null) {
    mainWindow.close();
  }
};

/**
 * Unzip a .zip file
 * @param {string} zipPath path to .zip file
 * @param {string} unzipPath path to where contents of .zip file should be placed
 * @returns {Promise<null>}
 */
const getPromiseUnzip = (zipPath, unzipPath) => {
  return new Promise((resolve) => {
    yauzl.open(
      zipPath,
      {"lazyEntries": true, "autoclose": true},
      (err, zipfile) => {
        if (err) {
          writeStartupError(`Error occurred while opening ${zipPath}`, err);
        }
        zipfile.on("close", () => {
          resolve();
        });
        zipfile.on("error", (inner_err) => {
          writeStartupError(
            `Error occurred in unzipping ${zipPath}`, inner_err
          );
        });
        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // ignore directory entries, since they may or may not be there
            zipfile.readEntry();
          } else {
            // make sure that output directory exists
            const neededDir = path.join(
              unzipPath,
              path.dirname(entry.fileName)
            );
            if (!fs.existsSync(neededDir)) {
              mkdirp.sync(neededDir);
            }
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                writeStartupError(
                  `Error occurred while reading ${entry.fileName}`,
                  err
                );
              }
              readStream.on("end", () => {
                zipfile.readEntry();
              });
              readStream.on("error", (err) => {
                writeStartupError(
                  `Error occurred while decompressing ${entry.fileName}`,
                  err
                );
              });
              const outpath = path.join(
                unzipPath,
                entry.fileName
              );
              const outfile = fs.createWriteStream(outpath);
              readStream.pipe(outfile);
            });
          }
        });
      }
    );
  });
};

/**
 * Decompress and untar a .tgz file
 * @param {string} downloadDest path to .tgz file
 * @returns {Promise<null>}
 * 
 * The contents of the .tgz file will be placed in the same directory as where
 * the .tgz file is located.
 */
const getPromiseUntgz = (downloadDest) => {
  return new Promise((resolve) => {
    const downloadedFileStream = fs.createReadStream(downloadDest);
    downloadedFileStream.on("error", (err) => {
      downloadedFileStream.end();
      writeStartupError(
        `Error reading downloaded file (${downloadDest})`,
        err
      );
    });
    const untarred = require("tar-fs").extract(TESS_HOME);
    untarred.on("finish", () => {
      resolve();
    });
    downloadedFileStream
      .pipe(require("gunzip-maybe")())
      .pipe(untarred);
  });
};

/**
 * Unpack the downloaded MongoDB
 * @param {str} downloadDest path to download location of MongoDB
 */
const unpackMongoInstall = async (downloadDest) => {
  writeStartupMessage(`\tMongoDB downloaded; now installing`);
  if (path.extname(downloadDest) === ".zip") {
    await getPromiseUnzip(downloadDest, TESS_HOME);
  } else {
    // assume .tgz
    await getPromiseUntgz(downloadDest);
  }
};

/**
 * Download a file via https
 * @param {string} downloadUrl URL of file to download
 * @param {string} downloadDest path naming the location of the downloaded file
 * @returns {Promise<null>}
 */
const getPromiseViaHttps = (downloadUrl, downloadDest) => {
  writeStartupMessage(`\tDownloading ${downloadUrl}`);
  var file = fs.createWriteStream(downloadDest);
  return new Promise((resolve) => {
    require("https").get(downloadUrl, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const newUrl = response.headers.location;
        writeStartupMessage(`\tRedirected: ${downloadUrl} => ${newUrl}`);
        return getPromiseViaHttps(newUrl, downloadDest).then(resolve);
      } else {
        response.on("error", (err) => {
          file.end();
          writeStartupError(`Error during download (${downloadUrl})`, err);
        });
        response.on("end", () => {
          resolve();
        });
        response.pipe(file);
      }
    }).on("error", (err) => {
      fs.unlinkSync(downloadDest);
      writeStartupError(`Could not use download URL (${downloadUrl})`, err);
    });
  });
};

/**
 * Launch mongod in the background
 * @param {Object} config MongoDB configuration
 */
const launchMongod = async (config) => {
  mkdirp.sync(MONGODB_DBPATH);
  const mongoPort = config["port"];
  const mongodSpawn = child_process.spawn(
    MONGOD_PATH,
    [
      '--port',
      mongoPort,
      '--dbpath',
      MONGODB_DBPATH
    ]
  );
  mongodSpawn.on("close", (code) => {
    if (code != 0) {
      writeStartupError(
        `mongod (${MONGOD_PATH}) failed with non-zero error code`,
        code
      );
    }
  });
  mongodSpawn.on("error", (err) => {
    if (err !== null) {
      writeStartupError(`mongod refused to start (${MONGOD_PATH})`, err);
    }
  });
};

/**
 * Get MongoDB configuration
 * @returns {Object} MongoDB configuration
 */
const getMongoConfig = () => {
  let mongoOptions = {
    "port": "40404",
  };
  const configpath = path.join(TESS_HOME, "tesserae.cfg");
  if (fs.existsSync(configpath)) {
    const ini = require("ini");
    const config = ini.parse(fs.readFileSync(configpath, "utf-8"));
    if ("MONGO" in config) {
      const dbconfig = config["MONGO"];
      for (const property in dbconfig) {
        mongoOptions[property] = dbconfig[property];
      }
    }
  }
  return mongoOptions
};

/**
 * Get a connection to MongoDB
 * @param {Object} config MongoDB configuration
 * @returns {MongoClient}
 */
const getMongoClient = config => {
  const mongoUrl = `mongodb://localhost:${config["port"]}`;
  const MongoClient = require('mongodb').MongoClient;
  return new MongoClient(mongoUrl, {"useUnifiedTopology": true});
};

/**
 * Ping MongoDB
 * @param {Object} config MongoDB configuration
 * @returns {Promise<null>}
 * 
 * If pinging MongoDB fails, application initialization fails.
 */
const checkMongoConnection = (config) => {
  return new Promise((resolve) => {
    // Make sure that MongoDB server is reachable
    const client = getMongoClient(config);
    client.connect(function(err) {
      if (err === null) {
        resolve();
      } else {
        writeStartupError("Could not connect to MongoDB", err);
      }
    });
  });
};

/**
 * Install CLTK data for a specified language
 * @param {string} lang language code
 * 
 * The backend server needs CLTK data to run.
 */
const installCltkData = async (lang) => {
  writeStartupMessage(`Ensuring data files for "${lang}" are installed`);
  const dataInstallPath = path.join(
    TESS_HOME, "cltk_data", lang, "model"
  );
  const finalName = path.join(dataInstallPath, `${lang}_models_cltk`);
  if (!fs.existsSync(finalName)) {
    writeStartupMessage(`\tData files for "${lang}" not installed`);
    const downloadDest = path.join(TESS_HOME, `${lang}_models_cltk-master.zip`);
    if (!fs.existsSync(downloadDest)) {
      writeStartupMessage(`\tData files for "${lang}" not downloaded`);
      await getPromiseViaHttps(
        `https://github.com/cltk/${lang}_models_cltk/archive/master.zip`,
        downloadDest
      );
    }
    writeStartupMessage(`\tData files for "${lang}" downloaded; now installing`);
    mkdirp.sync(dataInstallPath);
    await getPromiseUnzip(downloadDest, dataInstallPath);
    fs.renameSync(finalName + "-master", finalName);
  }
};

/**
 * Make sure the system is configured for the application to run
 */
const initializeUserSystem = async () => {
  await loadStartupWindow();
  writeStartupMessage(`Ensuring application directory exists (${TESS_HOME})`);
  if (!fs.existsSync(TESS_HOME)) {
    writeStartupMessage(
      `\tApplication directory did not exist; creating ${TESS_HOME}`
    );
    fs.mkdirSync(TESS_HOME);
  }

  writeStartupMessage(`Ensuring MongoDB is installed`);
  if (!fs.existsSync(MONGOD_PATH)) {
    writeStartupMessage(
      `\tMongoDB not installed; now downloading (this could take a while)`
    );
    const downloadUrl = getMongoDownloadUrl();
    const downloadDest = path.join(TESS_HOME, path.basename(downloadUrl));
    if (!fs.existsSync(downloadDest)) {
      await getPromiseViaHttps(downloadUrl, downloadDest);
    }
    await unpackMongoInstall(downloadDest);
  }

  const config = getMongoConfig();
  writeStartupMessage(`Launching MongoDB in the background`);
  await launchMongod(config);

  writeStartupMessage(`Checking MongoDB connection`);
  await checkMongoConnection(config);

  await installCltkData("lat");
  await installCltkData("grc");
  writeStartupMessage(
    `Initialization complete; Tesserae will start momentarily`
  );
};

/**
 * @returns {str} path to backend server executable
 */
const getPythonScriptPath = () => {
  if (!isRunningInBundle()) {
    return path.join(getResourcesPath(), PY_SRC_FOLDER, PY_MODULE + ".py");
  }
  if (os.platform === "win32") {
    return path.join(
      getResourcesPath(),
      PY_DIST_FOLDER,
      PY_MODULE.slice(0, -3) + ".exe"
    );
  }
  return path.join(getResourcesPath(), PY_DIST_FOLDER, PY_MODULE);
};

/**
 * Starts backend server as a subprocess of the application
 */
const startPythonSubprocess = () => {
  let script = getPythonScriptPath();
  if (isRunningInBundle()) {
    subpy = child_process.spawn(
      script,
      []
    );
  } else {
    subpy = child_process.spawn("python", [script]);
  }
};

/**
 * Kill subprocesses of this instance
 * @param {number} main_pid process ID of this instance
 * @returns {Promise<null>}
 */
const killSubprocesses = main_pid => {
  const python_script_name = path.basename(getPythonScriptPath());
  let cleanup_completed = false;
  const psTree = require("ps-tree");
  psTree(main_pid, function(err, children) {
    let to_kill = children
      .filter(function(el) {
        var command_name = 'COMMAND'
        if (os.platform() === 'darwin') {
          command_name = 'COMM'
        }
        if (el[command_name].includes("mongod")) {
          return true;
        }
        if (isRunningInBundle()) {
          return el[command_name] === python_script_name;
        }
        return el[command_name] === "python" && el.PPID === main_pid.toString();
      })
      .map(function(p) {
        return p.PID;
      });
    // kill all the spawned python and mongod processes
    to_kill.forEach(function(pid) {
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

/**
 * Create the main application window
 * 
 * Initially, the main window is invisible so that only the loading screen is
 * visible to the user.
 */
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
    show: false,
    resizeable: true
  });

  // Open the DevTools.
  //mainWindow.webContents.openDevTools();

  // Emitted when the mainWindow is closed.
  mainWindow.on("closed", function() {
    // Dereference the mainWindow object
    mainWindow = null;
  });
};

/**
 * Display the main application window
 * 
 * Once the application has initialized and the system has been verified to be
 * configured for the application, the loading screen will disappear, and the
 * main window will be displayed.
 */
const revealMainWindow = () => {
  if (mainWindow !== null) {
    // Load the index page
    mainWindow.loadURL(
      url.format({
        pathname: path.join(getResourcesPath(), "frontend", "index.html"),
        protocol: 'file:',
        slashes: true
      })
    );
    setTimeout(() => {
      mainWindow.show();
      if (startupWindow !== null) {
        startupWindow.close();
      }
    }, 2000);
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", function() {
  createMainWindow();
  initializeUserSystem().then(() => {
    startPythonSubprocess();
    revealMainWindow();
  });
});

// disable menu
app.on("browser-window-created", function(e, window) {
  window.setMenu(null);
});

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (os.platform !== "darwin") {
    let main_process_pid = process.pid;
    killSubprocesses(main_process_pid).then(() => {
      app.quit();
    });
  }
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // TODO figure out how to make sure that MongoDB is up and running
  if (subpy === null) {
    startPythonSubprocess();
  }
  if (mainWindow === null) {
    createMainWindow();
    revealMainWindow();
  }
});

app.on("quit", function() {
  // do some additional cleanup
});
