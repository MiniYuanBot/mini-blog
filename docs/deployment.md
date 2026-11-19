# Deployment

## Run locally

Use Node.js 24 LTS (or at least 22.23.4) and pnpm 10.33.4. Run these commands from the project directory:

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Astro, normally `http://localhost:4321`.

```sh
pnpm verify         # Type checks, unit tests, build, links, content integration test
pnpm notes --dry-run # Preview notes.config.json imports and chapter order
pnpm notes          # Import course notes; back up changed destination files
pnpm build          # Static output in dist/
pnpm preview        # Preview the production build
```

On Windows PowerShell with script execution disabled, use `pnpm.cmd` instead of `pnpm`.

Course imports read `notes.config.json`; see [Importing course notes](importing-notes.md) for source layouts, shared publication dates, chapter ordering, and backups.

## Any static host

The project generates a static `dist/` directory. No hosted service, account, or original-project path is required to build it. No deployment was performed as part of creating this framework.

1. Set the production origin in `site.config.ts`. Canonical URLs, RSS, and sitemap all use it. The inherited value is `https://miniyuan.site`.
2. Install with `pnpm install --frozen-lockfile`.
3. Populate `.plantuml-cache/` when adding or changing PlantUML, then commit the resulting cache. Production builds need no diagram service.
4. Run `pnpm verify`.
5. Publish `dist/` and configure the host to serve `404.html` for missing paths.

The framework uses root-relative asset URLs and is intended to live at a domain root. Hosting below a subpath would require coordinated changes to URL helpers, assets, and Astro's `base` setting.

For a provider with build settings, choose `pnpm build` as the build command and `dist` as the output directory. Run verification in CI before the provider deploys. Keep Node.js and pnpm consistent with `package.json` and commit `pnpm-lock.yaml`.

Rebuild after changing content, profile metadata, or the site URL. Future-dated entries need a later build to become public; use a hosting schedule if timed publication is required.

## Optional SSH releases

`scripts/deploy.mjs` adapts the old project's release-directory and atomic-symlink deployment model. It does not copy the old server configuration or credentials, import any notes, or execute arbitrary post-deployment hooks.

The target must be a Linux server with `tar`, `readlink`, and GNU `mv`. The local machine needs `ssh`, `scp`, and `tar` on its PATH; current Windows installations include them. Configure key-based SSH and verify the server's host key through your normal SSH setup.

Copy `deploy.config.example.json` to the ignored `deploy.config.json` and replace its example values. The SSH user needs permission to create directories and symlinks inside `remoteDir`. Point the web server at `<remoteDir>/<liveLink>`.

```sh
pnpm ship --dry-run       # Review commands; no build, write, upload, or SSH connection
pnpm ship                 # Check, unit-test, build, validate links, upload, switch
pnpm ship --skip-build    # Validate and upload an existing dist/
pnpm ship --rollback     # Swap current and previous releases
```

Use `--config PATH` for an alternative local configuration file. Keep server addresses and key paths out of version control when appropriate; the default configuration is already ignored. Passwords and private key material are never stored in the configuration.

The layout on the server is:

```text
/var/www/miniyuan-blog/
  releases/
    <unique-release-id>/
      index.html
      ...
  dist -> releases/<current-release-id>
  previous -> releases/<previous-release-id>
```

The actual symlinks use absolute target paths. Uploads enter a new release directory. Extraction and an `index.html` check finish before a temporary symlink replaces the live link using atomic rename. A lock prevents simultaneous switches. The old release remains available; rollback swaps the two symlinks and can itself be reversed.

For an initial deployment, the live path must be absent. For later deployments it must be a symlink pointing inside this project's `releases/` directory. The script refuses to replace a pre-existing real directory or an unrelated symlink. Configure a separate target directory for this independent site rather than pointing it at another application's files.

Releases are retained. Remove obsolete releases manually after confirming they are neither the current nor the previous target. A failed upload can leave an unused release directory, but does not change the live symlink. If an interrupted SSH session leaves `.deploy-lock`, confirm no deployment is active before removing that empty directory.

## CI

The included workflow installs pinned dependencies, runs `pnpm verify`, and uploads `dist/` as an artifact. It has read-only repository permissions and does not deploy. Add a provider-specific release step only when selecting a hosting destination.
