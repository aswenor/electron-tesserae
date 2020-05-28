# electron-tesserae

Code that bundles Tesserae v5 into a standalone electron application.

Thanks to https://github.com/matbloch/electron-flask for initial guidance.

https://github.com/electron/electron-quick-start was instrumental in getting the startup screen to work properly.

## Pre-steps

Unfortunately, each operating system is just different enough that the pre-steps are different for each.

### Ubuntu 18.04 LTS

Open up terminal and follow the instructions below.

```
sudo apt install build-essentials python3-dev python3-venv nodejs npm   # install prerequisites
# cd into the directory where you would like to store the code
git clone https://github.com/nOkuda/electron-tesserae        # clone this repo
git clone https://github.com/jeffkinnison/tesserae-frontend  # clone frontend
cd tesserae-frontend
npm install     # install frontend dependencies
# change .env file so that REACT_APP_REST_API_URL is set to "http://localhost:4040"
# change package.json so that "homepage" is set to "./"
npm run build   # build frontend
cp -r build ../electron-tesserae/frontend    # bundle built frontend
cd ..
python3 -m venv etbuild           # create virtual environment
source etbuild/bin/activate
pip install -U pip
cd electron-tesserae
pip install -r requirements.txt   # install python dependencies
npm install                       # install javascript dependencies
```

### Windows 10

Begin by downloading and installing https://nodejs.org/dist/v12.17.0/node-v12.17.0-x64.msi.

Now open up command prompt as an administrator.

1. Hit the Windows key on your keyboard (or click on the Windows icon on the bottom left of the screen)
2. Type "cmd"
3. Right-click on "Command Prompt" and choose "Run as administrator"

Using administrator-mode command prompt, install git with Chocolatey (which should have been installed with node).
```
choco install git
```

You can run the rest of commands in a normal command prompt
```
# cd into the directory where you would like to store the code
git clone https://github.com/nOkuda/electron-tesserae        # clone this repo
git clone https://github.com/jeffkinnison/tesserae-frontend  # clone frontend
cd tesserae-frontend
npm install     # install frontend dependencies
# change .env file so that REACT_APP_REST_API_URL is set to "http://localhost:4040"
# change package.json so that "homepage" is set to "./"
npm run build   # build frontend
Xcopy /E /I build ..\electron-tesserae\frontend    # bundle built frontend
cd ..
python -m venv etbuild                      # create virtual environment
etbuild\bin\activate.bat
python -m pip install -U pip
cd electron-tesserae
python -m pip install -r requirements.txt   # install python dependencies
npm install                                 # install javascript dependencies
```

## Running in Development

`npm start`

## Create Standalone Application

Remember that you must have the Python virtual environment activated in order to create the standalone application.

```
npm run package
```

The executable should be in `dist`.

## Other Hints

Take a look at `package.json` in this repo to see what the npm scripts actually do.