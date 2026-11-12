#!/usr/bin/env python3
"""Reproducible CGO-free release builds for the supported desktop hosts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
TARGETS = [(os_name, arch) for os_name in ("darwin", "linux", "windows") for arch in ("amd64", "arm64")]


def source_digest():
    digest = hashlib.sha256()
    paths = sorted(p for p in ROOT.glob("*.go") if not p.name.endswith("_test.go")) + [ROOT / "go.mod"]
    if (ROOT / "go.sum").exists():
        paths.append(ROOT / "go.sum")
    paths.append(ROOT.parent / "mods/codenav/bridge/servers.json")
    for path in paths:
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=[f"{o}-{a}" for o, a in TARGETS], action="append")
    args = parser.parse_args()
    digest = source_digest()
    version = f"0.1.0-{digest[:12]}"
    targets = []
    for goos, goarch in TARGETS:
        target = f"{goos}-{goarch}"
        if args.target and target not in args.target:
            continue
        name = "herdr-engine.exe" if goos == "windows" else "herdr-engine"
        path = ROOT / "dist" / target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "GOCACHE": os.environ.get("GOCACHE", str(ROOT / ".cache/go-build")), "GOOS": goos, "GOARCH": goarch, "CGO_ENABLED": "0"}
        subprocess.run(["go", "build", "-trimpath", "-buildvcs=false", "-ldflags", f"-s -w -buildid= -X main.version={version}", "-o", str(path), "."], cwd=ROOT, env=env, check=True)
        path.chmod(0o755)
        data = path.read_bytes()
        targets.append({"os": goos, "arch": goarch, "file": path.relative_to(ROOT / "dist").as_posix(), "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        print(target, len(data), "bytes", flush=True)
    manifest_path = ROOT / "dist/manifest.json"
    # A partial build cannot silently mix binaries from different source versions.
    if args.target and manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        if previous.get("version") == version:
            selected = {(item["os"], item["arch"]) for item in targets}
            targets.extend(item for item in previous["targets"] if (item["os"], item["arch"]) not in selected)
    manifest = {"engine": "herdr-codebench-go", "version": version, "source_sha256": digest,
                "go": subprocess.check_output(["go", "env", "GOVERSION"], text=True).strip(),
                "targets": sorted(targets, key=lambda item: (item["os"], item["arch"]))}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("Manifest:", manifest_path)


if __name__ == "__main__":
    main()
