#!/usr/bin/env python3
"""Safely prove an age-encrypted SQLite/signing-key backup can be restored offline.

Reads only the supplied encrypted archive and identity. Never touches production,
prints payloads or keys, or leaves plaintext outside a private temporary directory.
"""
import argparse
import json
from contextlib import closing
import pathlib
import shutil
import sqlite3
# age and OpenSSL require external executables; both use argv lists, never a shell.
import subprocess  # nosec B404
import sys
import tarfile
import tempfile
from urllib.parse import quote

MAX_ENCRYPTED_BYTES = 128 * 1024 * 1024
MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 4096
KEYS = ("control-plane-ed25519.json", "jwt-ed25519.json")
REQUIRED = ("sshautomator.db", *KEYS)
OPTIONAL_SQLITE = ("sshautomator.db-wal", "sshautomator.db-shm")
NEEDED = set(REQUIRED + OPTIONAL_SQLITE)
TABLES = ["agents", "audit_events", "users"]


class VerificationFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def reject(code):
    raise VerificationFailure(code)


def decrypt_to_private_file(encrypted, identity, target):
    if not encrypted.is_file() or not identity.is_file():
        reject("INPUT_NOT_FOUND")
    if encrypted.stat().st_size > MAX_ENCRYPTED_BYTES:
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
        if target.stat().st_size > MAX_ENCRYPTED_BYTES:
            reject("ARCHIVE_TOO_LARGE")
    except (OSError, subprocess.SubprocessError):
        reject("AGE_DECRYPT_FAILED")


def validate_member(member):
    name = member.name
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ".." in pathlib.PurePosixPath(name).parts
        or not (member.isfile() or member.isdir())
    ):
        reject("UNSAFE_ARCHIVE")
    if member.isfile() and (member.size < 0 or member.size > MAX_ENCRYPTED_BYTES):
        reject("UNSAFE_ARCHIVE")


def selected_members(archive):
    selected = {}
    total_bytes = 0
    for index, member in enumerate(archive, 1):
        if index > MAX_MEMBERS:
            reject("UNSAFE_ARCHIVE")
        validate_member(member)
        if member.isdir():
            continue
        total_bytes += member.size
        if total_bytes > MAX_EXTRACTED_BYTES:
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


def validate_sqlite(restore):
    db = restore / "sshautomator.db"
    try:
        uri = "file:" + quote(str(db)) + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=5)) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchall()
            if integrity != [("ok",)]:
                reject("SQLITE_INTEGRITY_FAILED")
            tables = {
                row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            if not set(TABLES).issubset(tables):
                reject("SQLITE_INTEGRITY_FAILED")
            if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
                reject("SQLITE_INTEGRITY_FAILED")
    except sqlite3.DatabaseError:
        reject("SQLITE_INTEGRITY_FAILED")


def openssl_public_der(pem, private):
    args = ["openssl", "pkey", "-outform", "DER"]
    args.append("-pubout" if private else "-pubin")
    try:
        # Fixed OpenSSL pkey flags; untrusted PEM is passed on stdin, never as
        # executable arguments or a shell command.
        result = subprocess.run(  # nosec B603
            args,
            input=pem.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        reject("KEY_PAIR_MISMATCH")
    if result.returncode != 0:
        reject("KEY_PAIR_MISMATCH")
    return result.stdout


def validate_signing_keys(restore):
    if not shutil.which("openssl"):
        reject("OPENSSL_NOT_INSTALLED")
    for filename in KEYS:
        try:
            key_data = json.loads((restore / filename).read_text(encoding="utf-8"))
            if not isinstance(key_data, dict):
                reject("KEY_PAIR_MISMATCH")
            private = key_data["privateKeyPem"]
            public = key_data["publicKeyPem"]
            if not isinstance(private, str) or not isinstance(public, str):
                reject("KEY_PAIR_MISMATCH")
        except (ValueError, KeyError, OSError):
            reject("KEY_PAIR_MISMATCH")
        derived = openssl_public_der(private, private=True)
        supplied = openssl_public_der(public, private=False)
        # 1.3.101.112 is the Ed25519 public-key algorithm object identifier.
        if derived != supplied or b"\x06\x03\x2b\x65\x70" not in supplied:
            reject("KEY_PAIR_MISMATCH")


def verify(encrypted, identity):
    with tempfile.TemporaryDirectory(prefix="ssh-mcp-offline-restore-") as tmp:
        directory = pathlib.Path(tmp)
        plaintext = directory / "snapshot.tar"
        restore = directory / "restored"
        restore.mkdir(mode=0o700)
        decrypt_to_private_file(encrypted, identity, plaintext)
        try:
            with tarfile.open(plaintext, mode="r:*") as archive:
                selected = selected_members(archive)
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
    args = parser.parse_args()
    try:
        outcome = verify(args.archive, args.identity)
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
