#!/usr/bin/env python3
"""Cut SemVer releases from Conventional Commits. Generic; configured by .github/release.json.

Runs in CI after the tests passed on a push to main. Same file in every repo of the family:
change it in presets first, never per repo.

For every component in release.json:
  tag        <tag_prefix>X.Y.Z (default prefix "<name>/v")
  bump       feat -> minor; fix/perf -> patch; feat!/fix! or a "BREAKING CHANGE:" footer -> major.
             While the version is 0.x a breaking change bumps the minor version instead
             (SemVer: anything may change before 1.0.0; 1.0.0 is a deliberate decision).
             Other types (docs, test, refactor, chore, ci, build) never bump.
  paths      only commits touching these paths count for the component.
  Release-As a "Release-As: X.Y.Z" commit footer (git trailer) since the last tag sets exactly
             that version, from any commit and any path, so an empty commit can trigger it:
               git commit --allow-empty -m "chore: release 1.0" -m "Release-As: 1.0.0"
             With several components in release.json, name the artifact:
             "Release-As: <name>@X.Y.Z" (one footer line per artifact); the bare form only
             counts when release.json has exactly one component. Upwards only: a version at or
             below the current one is ignored with a warning. Several footers: the highest wins.

The release:
  1. if a component has a version_file (package.json), writes the new version into it and
     pushes one "chore(release): ..." commit to main carrying the skip-CI token (pushes made
     with GITHUB_TOKEN start no runs anyway; the workflow also skips chore(release) heads);
  2. runs the component's build commands and checks its assets exist;
  3. creates the GitHub release (tag on that commit, notes from the releasable commits,
     assets attached).

Placeholders in build/assets/notes: {name}, {ver}.
Dry run: python3 .github/scripts/release.py --dry-run
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Dict, List, Optional, Tuple

CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "release.json")
SKIP = "[skip " + "ci]"  # split so this file never trips a grep for the token
BOT = ("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com")

RELEASE_AS = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
Version = Tuple[int, int, int]
Row = Tuple[str, str, str]  # (kind, subject, short sha)


def run(args: List[str], check: bool = True, cwd: Optional[str] = None) -> str:
    r = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    if r.stdout.strip():
        print(r.stdout.rstrip())
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").rstrip()
        if err:
            print(err, file=sys.stderr)
        if check:
            raise SystemExit(f"command failed ({r.returncode}): {' '.join(args)}")
    return (r.stdout or "").strip()


def quiet(args: List[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout.strip()


def last_tag(prefix: str) -> Optional[str]:
    tags = [t for t in quiet(["git", "tag", "-l", prefix + "*", "--sort=-v:refname"]).splitlines() if t]
    return tags[0] if tags else None


def parse_semver(tag: str, prefix: str) -> Version:
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", tag[len(prefix):] if tag.startswith(prefix) else tag)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (0, 0, 0)


def bump(ver: Version, kind: str) -> Version:
    major, minor, patch = ver
    if kind == "major" and major == 0:
        kind = "minor"  # pre-1.0: breaking changes bump the minor version
    if kind == "major":
        return (major + 1, 0, 0)
    if kind == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def commit_kind(subject: str, body: str) -> Optional[str]:
    if subject.startswith("chore(release)"):
        return None
    if re.search(r"^BREAKING[ -]CHANGE:", body, re.M) or re.match(r"^\w+(\([^)]+\))?!:", subject):
        return "major"
    m = re.match(r"^(\w+)(\([^)]+\))?:", subject)
    if not m:
        return None
    return {"feat": "minor", "fix": "patch", "perf": "patch"}.get(m.group(1))


def releasable(since: Optional[str], paths: List[str]) -> List[Row]:
    rng = f"{since}..HEAD" if since else "HEAD"
    out = quiet(["git", "log", "--reverse", rng, "--format=%h%x1f%s%x1f%b%x1e", "--"] + paths)
    rows = []
    for rec in out.split("\x1e"):
        if not rec.strip():
            continue
        sha, subj, body = (rec.strip().split("\x1f") + ["", ""])[:3]
        kind = commit_kind(subj.strip(), body)
        if kind:
            rows.append((kind, subj.strip(), sha))
    return rows


_warned = set()


def warn(msg: str) -> None:
    if msg in _warned:
        return
    _warned.add(msg)
    print(("::warning::" if os.environ.get("GITHUB_ACTIONS") else "warning: ") + msg, file=sys.stderr)


def release_as(since: Optional[str], name: str, names: List[str]) -> Optional[Tuple[Version, str]]:
    """Highest Release-As footer for this component since its last tag: (version, short sha)."""
    rng = f"{since}..HEAD" if since else "HEAD"
    out = quiet(["git", "log", rng, "--format=%h%x1f%(trailers:key=Release-As,valueonly,separator=%x1d)%x1e"])
    best = None
    for rec in out.split("\x1e"):
        sha, _, vals = rec.strip().partition("\x1f")
        for raw in (v.strip() for v in vals.split("\x1d")):
            if not raw:
                continue
            target, _, ver = raw.rpartition("@")
            if not target and len(names) > 1:
                warn(f"{sha}: 'Release-As: {raw}' ignored: several artifacts here, use 'Release-As: <name>@{raw}' ({', '.join(names)})")
                continue
            if target and target not in names:
                warn(f"{sha}: 'Release-As: {raw}' ignored: unknown artifact {target!r} ({', '.join(names)})")
                continue
            if target and target != name:
                continue
            m = RELEASE_AS.match(ver)
            if not m:
                warn(f"{sha}: 'Release-As: {raw}' ignored: not X.Y.Z")
                continue
            v = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
            if best is None or v > best[0]:
                best = (v, sha)
    return best


def strongest(kinds: List[str]) -> Optional[str]:
    return next((k for k in ("major", "minor", "patch") if k in kinds), None)


def fmt(s: str, c: Dict, ver: str) -> str:
    return s.replace("{name}", c["name"]).replace("{ver}", ver)


def notes(c: Dict, rows: List[Row], ver: str, prev: Optional[str], forced: Optional[str] = None) -> str:
    out = [] if prev else ["First release.", ""]
    if forced:
        out += [f"Version set by a `Release-As` footer in {forced}.", ""]
    for kind, title in (("major", "Breaking changes"), ("minor", "Features"), ("patch", "Fixes")):
        items = [f"- {s} ({h})" for k, s, h in rows if k == kind]
        if items:
            out += [f"### {title}", ""] + items + [""]
    if c.get("notes"):
        out += [fmt(c["notes"], c, ver), ""]
    if prev and os.environ.get("GITHUB_REPOSITORY"):
        out.append(f"Full diff: https://github.com/{os.environ['GITHUB_REPOSITORY']}/compare/{prev}...{c['tag_prefix']}{ver}")
    return "\n".join(out).strip() + "\n"


def file_version(path: str) -> Optional[str]:
    try:
        return json.load(open(path)).get("version")
    except FileNotFoundError:
        return None


def main() -> int:
    dry = "--dry-run" in sys.argv or os.environ.get("RELEASE_DRY_RUN") == "1"
    comps = json.load(open(CONFIG))["components"]
    names = [c["name"] for c in comps]
    plans = []
    for c in comps:
        c.setdefault("tag_prefix", c["name"] + "/v")
        prev = last_tag(c["tag_prefix"])
        cur = parse_semver(prev, c["tag_prefix"]) if prev else (0, 0, 0)
        rows = releasable(prev, c["paths"])
        kind = strongest([k for k, _, _ in rows])
        forced = release_as(prev, c["name"], names)
        if forced and forced[0] <= cur:
            warn(f"{forced[1]}: 'Release-As' {c['name']} {'.'.join(map(str, forced[0]))} ignored: not above {'.'.join(map(str, cur))}")
            forced = None
        if forced:
            ver, kind = "{}.{}.{}".format(*forced[0]), "Release-As " + forced[1]
        elif kind:
            ver = "{}.{}.{}".format(*bump(cur, kind))
        else:
            print(f"{c['name']}: no releasable commits since {prev or 'start'}")
            continue
        print(f"{c['name']}: {prev or '0.0.0'} -> {c['tag_prefix']}{ver} ({kind}, {len(rows)} commit(s))")
        plans.append((c, ver, notes(c, rows, ver, prev, forced[1] if forced else None)))
    if not plans or dry:
        for _, _, body in plans:
            print(body)
        return 0

    head = quiet(["git", "rev-parse", "HEAD"])
    sha = os.environ.get("GITHUB_SHA") or head
    if sha != head:
        raise SystemExit(f"checkout {head} is not the tested commit {sha}")
    remote = quiet(["git", "ls-remote", "origin", "refs/heads/main"]).split()[0]
    if remote != sha:
        print(f"main moved on ({remote[:7]}); the run for the newer commit will release")
        return 0

    bumped = []
    for c, ver, _ in plans:
        vf = c.get("version_file")
        if vf and file_version(vf) != ver:
            # npm version also updates package-lock.json next to it
            run(["npm", "version", ver, "--no-git-tag-version", "--allow-same-version"], cwd=os.path.dirname(vf) or ".")
            bumped.append((c, ver))
    if bumped:
        subject = "chore(release): " + ", ".join(f"{c['name']} v{v}" for c, v in bumped) + " " + SKIP
        run(["git", "add", "-u"])
        run(["git", "-c", f"user.name={BOT[0]}", "-c", f"user.email={BOT[1]}", "commit", "-m", subject])
        run(["git", "push", "origin", "HEAD:refs/heads/main"])  # fails (no release) if main moved meanwhile
        sha = quiet(["git", "rev-parse", "HEAD"])

    for c, ver, body in plans:
        assets = [fmt(a, c, ver) for a in c.get("assets", [])]
        for d in {os.path.dirname(a) for a in assets if os.path.dirname(a)}:
            os.makedirs(d, exist_ok=True)
        for cmd in c.get("build", []):
            run([fmt(a, c, ver) for a in cmd])
        missing = [a for a in assets if not os.path.exists(a)]
        if missing:
            raise SystemExit(f"missing assets: {', '.join(missing)}")
        tag = c["tag_prefix"] + ver
        run(["gh", "release", "create", tag, "--target", sha, "--title", f"{c['name']} {ver}", "--notes", body] + assets)
    return 0


if __name__ == "__main__":
    sys.exit(main())
