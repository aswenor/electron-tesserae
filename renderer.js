"use strict";

const { app, BrowserWindow } = require("electron");
const child_process = require("child_process");
const fs = require("fs");
const mkdirp = require("mkdirp");
const os = require("os");
const path = require("path");
const yauzl = require("yauzl");

// Keep a global reference of the mainWindow object, if you don't, the
// mainWindow will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;
let subpy = null;

const PY_DIST_FOLDER = "dist-python"; // python distributable folder
const PY_SRC_FOLDER = "tisapi"; // path to the python source
const PY_MODULE = "run_app"; // the name of the main module

const getMongodPath = () => {
  const mongodPath = path.join(MONGO_INSTALL_PATH, "bin", "mongod");
  if (os.platform() === "win32") {
    return mongodPath + ".exe";
  }
  return mongodPath;
};

const TESS_HOME = path.join(os.homedir(), "tesserae"); // application home
const MONGO_INSTALL_PATH = path.join(TESS_HOME, "mongodb");
const MONGOD_PATH = getMongodPath();
const MONGODB_DBPATH = path.join(TESS_HOME, "tessdb");

const getMongoDownloadUrl = () => {
  const osname = os.platform();
  if (osname === "win32") {
    return "https://fastdl.mongodb.org/win32/mongodb-win32-x86_64-2012plus-4.2.6.zip";
  }
  if (osname === "darwin") {
    return "https://fastdl.mongodb.org/osx/mongodb-macos-x86_64-4.2.6.tgz";
  }
  if (osname === "linux") {
    // assume Ubuntu 18.04 LTS
    return "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu1804-4.2.6.tgz";
  }
  throw "Unsupported operating system";
};

const renameMongoInstall = (downloadDest) => {
  const untarredPath = downloadDest.slice(0, -4);
  fs.renameSync(untarredPath, MONGO_INSTALL_PATH);
  console.log(`\tMongoDB installed (${MONGOD_PATH})`);
};

const getPromiseUnzip = (zipPath, unzipPath) => {
  return new Promise((resolve) => {
    yauzl.open(
      zipPath,
      {"lazyEntries": true},
      (err, zipfile) => {
        if (err) {
          console.error(`Error occurred while opening ${zipPath}`);
          throw err;
        }
        zipfile.on("close", () => {
          resolve();
        });
        zipfile.on("error", (inner_err) => {
          console.error(`Error occurred in unzipping ${zipPath}`);
          throw inner_err;
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
                console.error(
                  `Error occurred while reading ${entry.fileName}`
                );
                throw err;
              }
              readStream.on("end", () => {
                zipfile.readEntry();
              });
              readStream.on("error", (err) => {
                console.error(
                  `Error occurred while decompressing ${entry.fileName}`
                );
                throw err;
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

const getPromiseUntgz = (downloadDest) => {
  return new Promise((resolve) => {
    const downloadedFileStream = fs.createReadStream(downloadDest);
    downloadedFileStream.on("error", (err) => {
      downloadedFileStream.end();
      console.error(`Error reading downloaded file (${downloadDest})`);
      console.error(`${err}`);
      throw `Error reading downloaded file (${downloadDest})`;
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

const unpackMongoInstall = async (downloadDest) => {
  console.log(`\tMongoDB downloaded; now installing`);
  if (path.extname(downloadDest) === ".zip") {
    await getPromiseUnzip(downloadDest, TESS_HOME);
  } else {
    // assume .tgz
    await getPromiseUntgz(downloadDest);
  }
  renameMongoInstall(downloadDest);
};

const getPromiseViaHttps = (downloadUrl, downloadDest) => {
  console.log(`\tDownloading ${downloadUrl}`);
  var file = fs.createWriteStream(downloadDest);
  return new Promise((resolve) => {
    require("https").get(downloadUrl, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const newUrl = response.headers.location;
        console.log(`\tRedirected: ${downloadUrl} => ${newUrl}`);
        return getPromiseViaHttps(newUrl, downloadDest).then(resolve);
      } else {
        response.on("error", (err) => {
          file.end();
          console.error(`Error during download (${downloadUrl})`);
          throw err;
        });
        response.on("end", () => {
          resolve();
        });
        response.pipe(file);
      }
    }).on("error", (err) => {
      fs.unlinkSync(downloadDest);
      console.error(`Could not use download URL (${downloadUrl})`);
      throw err;
    });
  });
};

const launchMongod = async (config) => {
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
  mongodSpawn.on("error", (err) => {
    if (err !== null) {
      console.error(`mongod refused to start (${MONGOD_PATH})`);
      throw err;
    }
  });
};

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

const getMongoClient = config => {
  const mongoUrl = `mongodb://localhost:${config["port"]}`;
  const MongoClient = require('mongodb').MongoClient;
  return new MongoClient(mongoUrl, {"useUnifiedTopology": true});
};

const checkMongoConnection = (config) => {
  return new Promise((resolve) => {
    // Make sure that MongoDB server is reachable
    const client = getMongoClient(config);
    client.connect(function(err) {
      if (err === null) {
        resolve();
      } else {
        console.error("Could not connect to MongoDB");
        throw err;
      }
    });
  });
};

const installCltkData = async (lang) => {
  console.log(`(Ensuring data files for "${lang}" are installed)`);
  const dataInstallPath = path.join(
    TESS_HOME, "cltk_data", lang, "model"
  );
  const finalName = path.join(dataInstallPath, `${lang}_models_cltk`);
  if (!fs.existsSync(finalName)) {
    console.log(`\tData files for "${lang}" not installed`);
    const downloadDest = path.join(TESS_HOME, `${lang}_models_cltk-master.zip`);
    if (!fs.existsSync(downloadDest)) {
      console.log(`\tData files for "${lang}" not downloaded`);
      await getPromiseViaHttps(
        `https://github.com/cltk/${lang}_models_cltk/archive/master.zip`,
        downloadDest
      );
    }
    console.log(`\tData files for "${lang}" downloaded; now installing`);
    mkdirp.sync(dataInstallPath);
    await getPromiseUnzip(downloadDest, dataInstallPath);
    fs.renameSync(finalName + "-master", finalName);
  }
};

const initializeUserSystem = async () => {
  console.log(`Ensuring application directory exists (${TESS_HOME})`);
  if (!fs.existsSync(TESS_HOME)) {
    console.log(`\tApplication directory did not exist; creating ${TESS_HOME}`);
    fs.mkdirSync(TESS_HOME);
  }

  console.log(`Ensuring MongoDB is installed`);
  if (!fs.existsSync(MONGOD_PATH)) {
    console.log(`\tMongoDB not installed`);
    const downloadUrl = getMongoDownloadUrl();
    const downloadDest = path.join(TESS_HOME, path.basename(downloadUrl));
    if (!fs.existsSync(downloadDest)) {
      await getPromiseViaHttps(downloadUrl, downloadDest);
    }
    await unpackMongoInstall(downloadDest);
  }

  const config = getMongoConfig();
  console.log(`Launching MongoDB in the background`);
  await launchMongod(config);

  console.log(`Checking MongoDB connection`);
  await checkMongoConnection(config);

  console.log(`Ensuring that relevant CLTK data files are installed`);
  await installCltkData("lat");
  await installCltkData("grc");
};

const isRunningInBundle = () => {
  return path.basename(__dirname) === "app.asar";
};

const getResourcesPath = () => {
  if (isRunningInBundle()) {
    return path.join(path.dirname(__dirname), "app");
  }
  return __dirname;
}

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

const killSubprocesses = main_pid => {
  const python_script_name = path.basename(getPythonScriptPath());
  let cleanup_completed = false;
  const psTree = require("ps-tree");
  psTree(main_pid, function(err, children) {
    let to_kill = children
      .filter(function(el) {
        if (el.COMMAND.includes("mongod")) {
          return true;
        }
        if (isRunningInBundle()) {
          return el.COMMAND === python_script_name;
        }
        return el.COMMAND === "python" && el.PPID === main_pid.toString();
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
  mainWindow.loadURL(
    require("url").format({
      pathname: path.join(getResourcesPath(), "frontend", "index.html"),
      protocol: 'file:',
      slashes: true
    })
  );

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
  initializeUserSystem().then(() => {
    startPythonSubprocess();
    createMainWindow();
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
  if (subpy === null) {
    startPythonSubprocess();
  }
  if (mainWindow === null) {
    createMainWindow();
  }
});

app.on("quit", function() {
  // do some additional cleanup
});
