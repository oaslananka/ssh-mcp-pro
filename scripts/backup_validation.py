"""Shared offline encrypted-backup validation and capacity policy."""
import argparse
import json
from contextlib import closing
import shutil
import sqlite3
import subprocess  # nosec B404
from urllib.parse import quote

MIB = 1024 * 1024
DEFAULT_MAX_BACKUP_MIB = 128
MAX_BACKUP_MIB = 1024
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


def capacity_mib(value):
    try:
        capacity = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("capacity must be an integer in MiB") from None
    if not DEFAULT_MAX_BACKUP_MIB <= capacity <= MAX_BACKUP_MIB:
        raise argparse.ArgumentTypeError(
            f"capacity must be between {DEFAULT_MAX_BACKUP_MIB} and {MAX_BACKUP_MIB} MiB"
        )
    return capacity
