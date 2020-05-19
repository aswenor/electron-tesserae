# electron-tesserae

Code that bundles Tesserae v5 into a standalone electron application.

Thanks to https://github.com/matbloch/electron-flask for initial guidance.

## Pre-steps

```
# begin by cd'ing into the directory where you would like store the code
git clone https://github.com/nOkuda/electron-tesserae        # clone this repo
git clone https://github.com/jeffkinnison/tesserae-frontend  # clone frontend
cd tesserae-frontend
npm install     # install frontend dependencies
# change .env file so that REACT_APP_REST_API_URL is set to
# "http://localhost:4040"
# change package.json so that "homepage" is set to "./"
npm run build   # build frontend
cp -r build ../electron-tesserae/frontend    # bundle built frontend
cd ..
python3 -m venv etbuild           # create virtual environment
source etbuild/bin/activate
pip install -U pip
cd electron-tesserae
pip install -r requirements.txt   # install python dependencies
```

## Running in Development

`npm start`

## Create and Run Standalone Application

```
npm run package
./dist/Tesserae...
```

## Other Hints

Take a look at `package.json` in this repo to see what the npm scripts actually do.

Because of the way `renderer.js` works, if you've build the Python distributable and run the development server, you'll actually be running with the Python distributable and not with the Python script.
