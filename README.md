# Desert Stampede

A browser-based 3D horse racing game set in the Arizona desert. The game uses
vanilla JavaScript modules and Three.js 0.160.0 loaded from unpkg; there is no
build step or server-side component.

## Run locally

Serve the project over HTTP so the browser can load JavaScript modules:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy with GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes only the app files
(`index.html`, `css/`, and `js/`) when changes are pushed to `main`, or when
manually started from the Actions tab.

For the first deployment, open the repository's **Settings → Pages** and set
the build and deployment source to **GitHub Actions**. The workflow URL will
appear in its deployment summary. The game requires an internet connection to
load Three.js from unpkg.

GitHub Pages availability and site visibility depend on the repository
visibility and the GitHub plan. A public Pages site can expose the game even
when its source repository is private.
