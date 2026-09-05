> **SUPERSEDED (2026-08-27).** Quilltap no longer ships managed Lima (macOS) or
> WSL2 (Windows) VM modes — `quilltap-shell` 4.2.0 removed them, and this repo
> followed: the `lima/` directory, `scripts/build-rootfs.mjs`, the `wsl2` stage
> in `Dockerfile.ci`, and the rootfs jobs in the release workflow are all gone.
> The release assets are now the Docker images and the standalone tarball
> (`quilltap-standalone-*.tar.gz`, which is what both the `quilltap` CLI and the
> Electron shell download). The sandboxed option is Docker, or a virtual machine
> the user builds and manages themselves. Kept for the historical record.

## Restore rootfs tarball builds for Lima/WSL2 VM modes

### Problem

The Quilltap Shell's Lima (macOS) and WSL2 (Windows) runtime modes require Linux rootfs tarballs as release assets:
- `quilltap-linux-arm64.tar.gz` — for Lima VMs on macOS
- `quilltap-linux-amd64.tar.gz` — for WSL2 on Windows

These are no longer being published. Current releases (e.g. `4.0.0-dev.1`) only include the standalone tarball (`quilltap-standalone-*.tar.gz`), which is JS-only and designed for the embedded mode. The Lima and WSL2 modes need a full Linux filesystem with Node.js and compiled native modules included.

When a user selects Lima or WSL2 mode in the shell, they get: **"Download failed: HTTP 404: Not Found"**

### What the rootfs tarballs are

Each rootfs tarball is a `docker export` of the production Docker container filesystem. It contains:
- Alpine Linux base filesystem
- Node.js 22 runtime (`/usr/local/bin/node`, from `node:22-alpine`)
- The Quilltap server application (`/app/`)
- Pre-compiled native modules (`better-sqlite3`, `sharp`) linked against the correct Node ABI
- No `npm rebuild` needed on the VM side — everything is pre-built

### Why a full rootfs is needed

Lima and WSL2 provide an isolated Linux environment where the LLM can execute shell commands directly. The standalone tarball (JS-only, no Node.js binary, no Linux native modules) can't be used because:
1. It has no Node.js binary — embedded mode uses `ELECTRON_RUN_AS_NODE=1`
2. Native modules (`better-sqlite3`, `sharp`) are stripped from the standalone tarball and copied from macOS-compiled Electron app bundles at runtime — these are the wrong platform for a Linux VM
3. Alpine's packaged `nodejs` has SQLite symbol relocation errors with `better-sqlite3` — the Docker image's Node.js (built from `node:22-alpine`) works correctly

### How they were built previously

The release workflow had a `build-docker-and-rootfs` matrix job (amd64 + arm64):

1. Build the Docker image using `Dockerfile.ci` (the `production` target for arm64, `wsl2` target for amd64)
2. Load the image locally
3. Create a temporary container from the image
4. `docker export` the container filesystem to a raw tar
5. Append a `VERSION` file to the tar
6. Gzip compress → `quilltap-linux-{arch}.tar.gz`
7. Write a build-ID sidecar (`{version}+{timestamp}`) for cache invalidation
8. Upload both tarballs as release assets

The arm64 job ran on a native ARM runner (`ubuntu-24.04-arm`) to avoid QEMU emulation.

### Expected release assets per version

| Asset | Purpose |
|-------|---------|
| `quilltap-standalone-{version}.tar.gz` | Embedded mode (JS-only, runs via Electron's Node.js) |
| `quilltap-linux-arm64.tar.gz` | Lima VMs on macOS (Apple Silicon) |
| `quilltap-linux-amd64.tar.gz` | WSL2 on Windows |

### Shell-side expectations

The shell downloads rootfs tarballs from:
```
https://github.com/foundry-9/quilltap/releases/download/{version}/quilltap-linux-arm64.tar.gz
https://github.com/foundry-9/quilltap/releases/download/{version}/quilltap-linux-amd64.tar.gz
```

It caches them locally and uses a `.build-id` sidecar file (format: `{version}+{ISO timestamp}`) to detect when a new rootfs is available and the VM needs reprovisioning.

### How the rootfs is consumed

**Lima (macOS):** The tarball is mounted read-only into the VM at `/mnt/lima-images/`. The provisioning script extracts Node.js and the app:
```sh
tar xzf /mnt/lima-images/quilltap-linux-arm64.tar.gz -C / \
    usr/local/bin/node usr/local/lib/node_modules/ app/
apk add --no-cache libstdc++ libgcc zip unzip
```

**WSL2 (Windows):** The tarball is imported directly as a WSL2 distro via `wsl --import`.
