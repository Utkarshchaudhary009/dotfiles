# Installing Without npm

If you want to use, share, or deploy `agenv` without publishing it to the public npm registry, you have several options depending on your environment.

## Methods

### A) Source via Git + Bun (Best for Development)
Clone the repository directly and link it globally. This is recommended if you plan to modify `agenv` or contribute to its development.

```bash
git clone https://github.com/<your-gh-user>/<repo-url>.git
cd <repo-url>
bun install
bun run build
bun link
```
*(Ensure you have [Bun installed](https://bun.sh/docs/installation) on Windows, macOS, or Linux).*

### B) Single-File Download (Best for CI/VM)
The built CLI is a self-contained Node.js script. You can simply download the pre-compiled file from your repository and run it directly. (Requires Node 18+).

```bash
curl -O https://raw.githubusercontent.com/<your-gh-user>/<repo-url>/main/dist/agenv.js
chmod +x agenv.js
node agenv.js --version
```
*Tip: You can set up an alias (e.g., `alias agenv="node /path/to/agenv.js"`) for convenience.*

### C) Global Install from GitHub
You can use `npm` to install globally directly from the GitHub repository. It will automatically use the `"prepare": "bun run build"` script defined in the package.

```bash
npm install -g github:<your-gh-user>/<repo-url>
```
*(Requires both npm and Bun to be present on the system for the build step).*

### D) Offline / Airgapped / Git-Free (Best for USB Drives)
For completely offline environments, copy the bundled `dist/agenv.js` alongside an exported environment bundle on a USB drive.

```bash
# On the offline machine:
node agenv.js import env.bundle.tar.gz
```

---

## Comparison Summary

| Method | Needs | Best for |
|--------|-------|----------|
| **A) Source via Git** | Git, Bun | Developers, local modifications |
| **B) Single-File** | Node 18+, `curl` | CI/CD pipelines, disposable VMs, quick bootstrapping |
| **C) Install from GitHub** | npm, Git, Bun | Standard installation from a private/forked repo |
| **D) Offline / USB** | Node 18+, `agenv.js`, bundle file | Airgapped machines, high-security offline setups |

**Recommendation:**
- For everyday development or configuration: **Method A**.
- For CI environments, disposable VMs, or restricted airgapped networks: **Method B** or **Method D**.
