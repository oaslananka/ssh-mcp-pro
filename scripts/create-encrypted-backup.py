#!/usr/bin/env python3
"""Create an encrypted, consistent snapshot for an independent recovery host."""
import argparse
from contextlib import closing
import json
import os
import pathlib
import re
import sqlite3
import subprocess  # nosec B404 - fixed age invocation, no shell
import sys
import tarfile
import tempfile
import time

from backup_validation import (
    MIB, DEFAULT_MAX_BACKUP_MIB, KEYS, REQUIRED, VerificationFailure,
    reject, validate_sqlite, validate_signing_keys, capacity_mib,
)


def validate_source(source, max_bytes):
    for name in REQUIRED:
        item = source / name
        if item.is_symlink() or not item.is_file():
            reject("MISSING_REQUIRED_MEMBER")
        if item.stat().st_size > (65536 if name in KEYS else max_bytes):
            reject("ARCHIVE_TOO_LARGE")


def stage_keys(source, staging):
    # A source directory is operator-controlled; do not rotate signing keys
    # during capture. Compare the staged keys again after the database backup.
    for name in KEYS:
        data = (source / name).read_bytes()
        if len(data) > 65536:
            reject("ARCHIVE_TOO_LARGE")
        with (staging / name).open("xb") as target:
            (staging / name).chmod(0o600)
            target.write(data)


def backup_database(source, staging, max_bytes):
    deadline = time.monotonic() + 120
    db = staging / "sshautomator.db"
    try:
        with db.open("xb"):
            db.chmod(0o600)
        uri = (source / "sshautomator.db").resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=5)) as original:
            page_size = original.execute("PRAGMA page_size").fetchone()[0]

            def progress(_status, _remaining, total):
                if total * page_size > max_bytes:
                    reject("ARCHIVE_TOO_LARGE")
                if time.monotonic() > deadline:
                    reject("SNAPSHOT_TIMEOUT")

            with closing(sqlite3.connect(db)) as snapshot:
                original.backup(snapshot, pages=256, progress=progress, sleep=0.1)
    except sqlite3.DatabaseError:
        reject("SQLITE_INTEGRITY_FAILED")

    if db.stat().st_size > max_bytes:
        reject("ARCHIVE_TOO_LARGE")


def copy_snapshot(source, staging, max_bytes):
    validate_source(source, max_bytes)
    stage_keys(source, staging)
    backup_database(source, staging, max_bytes)
    for name in KEYS:
        if (source / name).read_bytes() != (staging / name).read_bytes():
            reject("SIGNING_KEYS_CHANGED")
    validate_sqlite(staging)
    validate_signing_keys(staging)


def encrypt_archive(archive, output, recipient, max_bytes):
    if not os.access("/usr/bin/age", os.X_OK):
        reject("AGE_NOT_INSTALLED")
    if os.path.lexists(output):
        reject("OUTPUT_EXISTS")
    # Publish only complete ciphertext; link is atomic and refuses overwrite.
    with tempfile.TemporaryDirectory(prefix=".ssh-backup-", dir=pathlib.Path.cwd()) as tmp:
        ciphertext = pathlib.Path(tmp) / "snapshot.age"
        # The validated public recipient is data, not a process argument.
        (pathlib.Path(tmp) / "recipient.txt").write_text(recipient + "\n", encoding="ascii")
        with archive.open("rb") as source, ciphertext.open("xb") as target:
            ciphertext.chmod(0o600)
            # B603 is reviewed: absolute executable, literal argv, private cwd,
            # validated recipient data file, and shell explicitly disabled.
            result = subprocess.run(  # nosec B603
                ["/usr/bin/age", "--encrypt", "--recipients-file", "recipient.txt"],
                cwd=tmp, shell=False,
                stdin=source, stdout=target, stderr=subprocess.DEVNULL,
                timeout=120, check=False,
            )
            if result.returncode != 0:
                reject("AGE_ENCRYPT_FAILED")
            target.flush()
            os.fsync(target.fileno())
        if ciphertext.stat().st_size > max_bytes:
            reject("ARCHIVE_TOO_LARGE")
        publish_ciphertext(pathlib.Path(tmp), output.name)


def publish_ciphertext(staging, filename):
    # The directory descriptors confine publication to the selected directory;
    # a validated single filename cannot traverse out of it.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*[.]age", filename):
        reject("INVALID_OUTPUT_PATH")
    src_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY)
    try:
        dst_fd = os.open(".", os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.link("snapshot.age", filename, src_dir_fd=src_fd,
                    dst_dir_fd=dst_fd, follow_symlinks=False)
        except FileExistsError:
            reject("OUTPUT_EXISTS")
        finally:
            os.close(dst_fd)
    finally:
        os.close(src_fd)


def create(source, recipient, output, capacity):
    # Only native X25519 age recipients; no external recipient plugins.
    if not re.fullmatch(r"age1[023456789acdefghjklmnpqrstuvwxyz]{58}", recipient):
        reject("INVALID_RECIPIENT")
    if output.is_absolute() or len(output.parts) != 1 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*[.]age", output.name):
        reject("INVALID_OUTPUT_PATH")
    if os.path.lexists(output):
        reject("OUTPUT_EXISTS")
    if not source.is_dir():
        reject("INPUT_NOT_FOUND")
    max_bytes = capacity * MIB
    with tempfile.TemporaryDirectory(prefix="ssh-backup-create-") as tmp:
        root = pathlib.Path(tmp)
        staging = root / "snapshot"
        staging.mkdir(mode=0o700)
        copy_snapshot(source, staging, max_bytes)
        archive = root / "snapshot.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            archive.chmod(0o600)
            for name in REQUIRED:
                tar.add(staging / name, arcname=name, recursive=False)
        if archive.stat().st_size > max_bytes:
            reject("ARCHIVE_TOO_LARGE")
        encrypt_archive(archive, output, recipient, max_bytes)
    return {"status": "pass", "encrypted": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=pathlib.Path, required=True)
    parser.add_argument("--recipient", required=True, help="Native age X25519 public recipient")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--max-backup-mib", type=capacity_mib, default=DEFAULT_MAX_BACKUP_MIB)
    args = parser.parse_args()
    try:
        outcome = create(args.source_dir, args.recipient, args.output, args.max_backup_mib)
    except VerificationFailure as error:
        print(json.dumps({"status": "fail", "code": error.code}))
        return 2
    except (OSError, sqlite3.DatabaseError, subprocess.SubprocessError, tarfile.TarError):
        print(json.dumps({"status": "fail", "code": "BACKUP_CREATION_FAILED"}))
        return 2
    except Exception:
        print(json.dumps({"status": "fail", "code": "UNEXPECTED_BACKUP_FAILURE"}))
        return 2
    print(json.dumps(outcome, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
