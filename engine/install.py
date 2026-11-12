#!/usr/bin/env python3
"""Verify and install the current host's prebuilt Go engine; no Go compiler needed."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent


def host_target():
    goos = {"Darwin": "darwin", "Linux": "linux", "Windows": "windows"}.get(platform.system())
    goarch = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    if not goos or not goarch:
        raise SystemExit(f"Unsupported host: {platform.system()} / {platform.machine()}")
    return goos, goarch


def verify(manifest, selected=None):
    if manifest.get("engine") != "herdr-codebench-go":
        raise SystemExit("Unexpected engine manifest")
    entries = manifest["targets"] if selected is None else [selected]
    for entry in entries:
        path = ROOT / "dist" / entry["file"]
        if not path.resolve().is_relative_to((ROOT / "dist").resolve()):
            raise SystemExit("Invalid binary path")
        data = path.read_bytes()
        if len(data) != entry["size"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise SystemExit(f"Binary checksum mismatch: {entry['file']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-home", type=Path, default=Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app")))
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "dist/manifest.json").read_text())
    if args.verify_only:
        verify(manifest)
        print(f"Verified {len(manifest['targets'])} binaries: {manifest['version']}")
        return
    goos, goarch = host_target()
    entry = next((t for t in manifest["targets"] if (t["os"], t["arch"]) == (goos, goarch)), None)
    if entry is None:
        raise SystemExit(f"No build for {goos}/{goarch}; run python3 engine/build.py")
    verify(manifest, entry)
    directory = args.app_home / "data/codebench-engine"
    target = directory / entry["file"]
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = args.app_home / "data/native-ide-backups" / ("go-engine-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    for path in (target, directory / "manifest.json", directory / "GO-LICENSE.txt", directory / "THIRD-PARTY-NOTICES.txt"):
        if path.exists():
            saved = backup / path.relative_to(directory)
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    # A running executable can remain open on Unix. Windows replaces the version
    # only after its owned helper is stopped by the user, rather than killing by name.
    handle, temporary = tempfile.mkstemp(prefix=".engine-", dir=target.parent)
    os.close(handle)
    try:
        shutil.copyfile(ROOT / "dist" / entry["file"], temporary)
        os.chmod(temporary, 0o755)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for name in ("GO-LICENSE.txt", "THIRD-PARTY-NOTICES.txt"):
        if (ROOT / name).exists():
            shutil.copy2(ROOT / name, directory / name)
    print(f"Installed {manifest['version']} for {goos}/{goarch}: {target}")


if __name__ == "__main__":
    main()
