**English** | [简体中文](PORTABLE.md)

# Portable use and migration

The portable package supports Windows 10 / 11, 64-bit. Extract the **entire ZIP** to a writable folder and double-click **Start Crate Atlas.cmd**. It opens real-map analysis. Choose **Official maps**, or open a `.map`, `.yrm` or `.mpr` file. Search the catalog by English / Chinese name or filename and filter by version, mode, maximum players or theater. Shared entries still let you choose RA2 or YR analysis rules. The large button at the top switches to the probability demo.

The package contains verified stock Red Alert 2 1.006 and Yuri's Revenge 1.001 rules, terrain, building and unit assets. No game installation, MIX selection or online download is needed. Python and its decoding dependencies, the native search tool, voxel components, Node.js, Canvas and FFmpeg are included.

## Language

On first launch, the tool uses the Windows **display language**: Chinese selects Simplified Chinese; other languages select English. Use **中文 / English** at the top of any of the three pages to change it. Changing language reloads that page and retains its current result URL and saved regions. Later launches use the saved choice, including after a server restart or from another browser connected to the same installation.

`data/ui-language.json` stores this preference. It is local to the installation and excluded from source control and newly built packages. To carry it into an upgrade, copy this file to the new installation. Otherwise the new installation chooses from the system language again. A demo opened directly through `file://` uses the browser language and browser storage instead.

The interface, map / video annotations, explanatory text and diagnostic messages follow the selected language. Map coordinates, numerical results, API identifiers, paths, filenames and user-entered map / region names are preserved. Official maps can be found using either language regardless of the current UI language. English documentation links are available from the English interface and at the top of each document.

## Optional game directory

Use **Game directory (optional)** for another installation or a Mod. Enter its root path or click **Browse…**, then **Save and close**. Saving enables that directory and reanalyzes the current map. Browsing alone does not save; Cancel keeps the previous setting. The default is **Auto · Prefer selected directory**, falling back to bundled YR resources when none is configured. Bundled RA2 and YR can also be selected explicitly. An invalid directory does not replace the previous setting.

Discovery reads loose INI files, numbered expansion MIX archives, standard nested archives and explicit includes. No particular Mod's resource order, configuration or artwork is embedded. Directory probabilities are approximate: uncertain objects are assumed to make final placement fail and retry. Expansion DLL behavior and custom launcher loading are not verified. See [analysis scope](REAL-MAPS.en.md).

New packages start with no Mod path and contain no absolute paths from the build machine. Existing installations keep their saved directory.

| Location | Purpose |
| --- | --- |
| `assets/original` | Bundled stock archives, verified by fixed SHA-256 hashes. Keep them with the tool. |
| `official-maps` | Offline original multiplayer maps and searchable catalog. |
| `data/game-directory.json` | Optional local directory path; excluded from Git and builds. Old local settings retain only the path. |
| `data/ui-language.json` | Saved interface language; excluded from Git and builds. |
| `output` | Analysis results, images, videos and exports. Saved results can be reopened. |
| `runtime` | Bundled runtimes and voxel components. Do not move these separately. |

Region selections are stored in the browser, keyed by the original map's SHA-256. Before changing browser, address / port, or clearing site data, use **Export regions** and later **Restore backup** on the same map. Copying the installation folder alone does not migrate browser storage.

Legacy MIX imports under `data/resources` no longer participate in default loading. Research CLI runs can still explicitly supply `--ra2-mix` and `--yr-mix`.

## Starting and upgrading

Keep the launcher window open. If the default port is occupied, run `"Start Crate Atlas.cmd" --port 8777`. Do not run from inside the ZIP. The tool does not write the registry or modify game files.

For an upgrade, extract into a new folder and close the old launcher window first. If the port is serving another installation or older code, startup reports it instead of silently opening the old tool. A second launch of the same installation and code can reuse the existing server. **Start Demo.cmd** opens the probability demo directly. **Height demo** at the top opens the isolated-high-cell example. The 3D views require WebGL.

The release's `.zip.sha256` checks the download. `release-files.json` records each packaged file's size and SHA-256. `portable-build.json` records the version, build time and runtime versions without the build machine's absolute paths.

**Cannot connect to the local tool service** (formerly `Failed to fetch`) means the browser request failed; it does not mean official maps are missing or a game directory is required. Start the launcher and keep it open, then retry. If an old API is reported, stop the old server, start the new one and refresh. A missing bundled map archive has a separate extraction error.

## Running from source

Use Python 3.11+ and `python -m pip install -r requirements.txt`, and provide the original resource archives. See [README](README.md) for their location. The portable bundle includes `output/realmap-tools/map-search.exe` and its source digest. Editing the C source requires recompilation; select GCC through `CRATE_CC` or PATH.

Vehicles, aircraft and voxel turrets use `voxel-worker.cs` / `output/realmap-tools/voxel-worker.exe` to call `runtime/voxel/CncVxlRenderText.dll` in a hidden x86 process. No map editor installation or running editor is required. A source installation can compile the bridge through Windows .NET Framework; the portable bundle includes it precompiled. `CRATE_VOXEL_DLL` overrides the component path.

Video dependencies can be set with `CODEX_NODE_MODULES` and `FFMPEG_PATH`; bundled runtimes take priority by default. Licenses and component sources are described in [third-party notices](third-party-notices.md) and the package's `runtime/THIRD-PARTY-NOTICES.md`.

The server root opens the map page. Use `index.html` or `--page demo` for the probability demo.
