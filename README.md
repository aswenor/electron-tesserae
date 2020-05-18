# electron-tesserae

Code that bundles Tesserae v5 into a standalone electron application.

Thanks to https://github.com/matbloch/electron-flask for initial guidance.

## Pre-steps

#. Clone https://github.com/jeffkinnison/tesserae-frontend
#. Install `tesserae-frontend` dependencies with `npm install`
#. Change `REACT_APP_REST_API_URL` in `.env` in `tesserae-frontend` to `"http://localhost:4040"`
#. Build `build` directory in `tesserae-frontend` with `npm run build`
#. Copy `build` directory from `tesserae-frontend` into this repository's directory (`cp -r /path/to/tesserae-frontend/build ...`)
