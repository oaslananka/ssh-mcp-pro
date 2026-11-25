#!/usr/bin/env python3
"""Safely prove an age-encrypted SQLite/signing-key backup can be restored offline.

Reads only the supplied encrypted archive and identity. Never touches production,
prints payloads or keys, or leaves plaintext outside a private temporary directory.
"""
import argparse
import json
import pathlib
import shutil
# age and OpenSSL require external executables; both use argv lists, never a shell.
import subprocess  # nosec B404
import sys
import tarfile
import tempfile
from backup_validation import (
    MIB, DEFAULT_MAX_BACKUP_MIB, MAX_BACKUP_MIB, MAX_MEMBERS, KEYS, REQUIRED,
    NEEDED, TABLES, VerificationFailure, reject, validate_sqlite,
    validate_signing_keys, capacity_mib,
)

def decrypt_to_private_file(encrypted, identity, target, max_backup_bytes):
    if not encrypted.is_file() or not identity.is_file():
        reject("INPUT_NOT_FOUND")
    if encrypted.stat().st_size > max_backup_bytes:
        reject("ARCHIVE_TOO_LARGE")
    if identity.stat().st_size > 65536:
        reject("AGE_DECRYPT_FAILED")
    age_executable = shutil.which("age")
    if not age_executable:
        reject("AGE_NOT_INSTALLED")

    # Stage the identity under a trusted path, and stream the user-supplied
    # archive via stdin. User filenames never become executable arguments.
    private_identity = target.with_name("age-identity")
    try:
        with identity.open("rb") as source, private_identity.open("xb") as destination:
            private_identity.chmod(0o600)
            shutil.copyfileobj(source, destination, length=32768)
        with encrypted.open("rb") as source, target.open("xb") as destination:
            target.chmod(0o600)
            # Fixed flags, a resolved executable and a trusted temporary identity;
            # the untrusted archive is passed only as an open file descriptor.
            result = subprocess.run(  # nosec B603
                [age_executable, "--decrypt", "--identity", str(private_identity)],
                stdin=source,
                stdout=destination,
                stderr=subprocess.DEVNULL,
                timeout=60,
                check=False,
            )
        if result.returncode != 0:
            reject("AGE_DECRYPT_FAILED")
        if target.stat().st_size > max_backup_bytes:
            reject("ARCHIVE_TOO_LARGE")
    except (OSError, subprocess.SubprocessError):
        reject("AGE_DECRYPT_FAILED")


def validate_member(member, max_backup_bytes):
    name = member.name
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ".." in pathlib.PurePosixPath(name).parts
        or not (member.isfile() or member.isdir())
    ):
        reject("UNSAFE_ARCHIVE")
    if member.isfile() and (member.size < 0 or member.size > max_backup_bytes):
        reject("UNSAFE_ARCHIVE")


def selected_members(archive, max_backup_bytes):
    selected = {}
    total_bytes = 0
    for index, member in enumerate(archive, 1):
        if index > MAX_MEMBERS:
            reject("UNSAFE_ARCHIVE")
        validate_member(member, max_backup_bytes)
        if member.isdir():
            continue
        total_bytes += member.size
        if total_bytes > 2 * max_backup_bytes:
            reject("UNSAFE_ARCHIVE")
        basename = pathlib.PurePosixPath(member.name).name
        if basename not in NEEDED:
            continue
        if basename in selected or (basename in KEYS and member.size > 65536):
            reject("UNSAFE_ARCHIVE")
        selected[basename] = member

    if any(name not in selected for name in REQUIRED):
        reject("MISSING_REQUIRED_MEMBER")
    return selected


def extract_selected(archive, selected, restore):
    for name, member in selected.items():
        original = archive.extractfile(member)
        if original is None:
            reject("UNSAFE_ARCHIVE")
        with original, (restore / name).open("xb") as output:
            (restore / name).chmod(0o600)
            shutil.copyfileobj(original, output, length=1024 * 1024)
        if (restore / name).stat().st_size != member.size:
            reject("UNSAFE_ARCHIVE")


def verify(encrypted, identity, max_backup_mib=DEFAULT_MAX_BACKUP_MIB):
    if not DEFAULT_MAX_BACKUP_MIB <= max_backup_mib <= MAX_BACKUP_MIB:
        reject("INVALID_CAPACITY")
    max_backup_bytes = max_backup_mib * MIB
    with tempfile.TemporaryDirectory(prefix="ssh-mcp-offline-restore-") as tmp:
        directory = pathlib.Path(tmp)
        plaintext = directory / "snapshot.tar"
        restore = directory / "restored"
        restore.mkdir(mode=0o700)
        decrypt_to_private_file(encrypted, identity, plaintext, max_backup_bytes)
        try:
            with tarfile.open(plaintext, mode="r:*") as archive:
                selected = selected_members(archive, max_backup_bytes)
                extract_selected(archive, selected, restore)
        except (tarfile.TarError, EOFError, OSError, ValueError):
            reject("UNSAFE_ARCHIVE")
        validate_sqlite(restore)
        validate_signing_keys(restore)
    return {
        "status": "pass",
        "database": "ok",
        "validatedKeyPairs": 2,
        "requiredTables": TABLES,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Check an encrypted production snapshot using only local files."
    )
    parser.add_argument("--archive", type=pathlib.Path, required=True)
    parser.add_argument("--identity", type=pathlib.Path, required=True)
    parser.add_argument(
        "--max-backup-mib", type=capacity_mib, default=DEFAULT_MAX_BACKUP_MIB,
        help="Maximum archive and individual member size in MiB (128-1024); "
             "the total extracted-size limit is twice this value (default: 128).",
    )
    args = parser.parse_args()
    try:
        outcome = verify(args.archive, args.identity, args.max_backup_mib)
    except VerificationFailure as error:
        print(json.dumps({"status": "fail", "code": error.code}))
        return 2
    except Exception:
        # Never expose private archive contents, keys or filesystem paths.
        print(json.dumps({"status": "fail", "code": "UNEXPECTED_VERIFICATION_FAILURE"}))
        return 2
    print(json.dumps(outcome, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
