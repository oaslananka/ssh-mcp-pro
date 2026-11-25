"""Synthetic-only tests for offline backup recovery, with no production credentials."""
import io
import json
import pathlib
import sqlite3
# Test-only invocations use fixed binaries, synthetic fixtures and no shell.
import subprocess  # nosec B404
import sys
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
VERIFIER = ROOT / "scripts" / "verify-encrypted-backup.py"


def run(*args):
    return subprocess.run(  # nosec B603 - fixed test tools and temporary fixtures, shell=False
        args, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15
    ).stdout


def fixture(root, mode="valid", gz=False):
    data = root / "data"
    data.mkdir()
    db = data / "sshautomator.db"
    with sqlite3.connect(db) as connection:
        connection.executescript(
            "CREATE TABLE users(id TEXT PRIMARY KEY);"
            "CREATE TABLE agents(id TEXT PRIMARY KEY);"
            "CREATE TABLE audit_events(id TEXT PRIMARY KEY);"
        )
    if mode == "large-db":
        with sqlite3.connect(db) as connection:
            connection.execute("CREATE TABLE padding(data BLOB)")
            connection.execute("INSERT INTO padding VALUES (zeroblob(?))", (130 * 1024 * 1024,))
    if mode == "bad-db":
        db.write_bytes(b"invalid SQLite")

    for name in ("control-plane-ed25519.json", "jwt-ed25519.json"):
        private = root / (name + ".pem")
        run("openssl", "genpkey", "-algorithm", "ED25519", "-out", str(private))
        public = run("openssl", "pkey", "-in", str(private), "-pubout").decode()
        if mode == "bad-key" and name == "control-plane-ed25519.json":
            different = root / "different.pem"
            run("openssl", "genpkey", "-algorithm", "ED25519", "-out", str(different))
            public = run("openssl", "pkey", "-in", str(different), "-pubout").decode()
        (data / name).write_text(json.dumps({
            "privateKeyPem": private.read_text(),
            "publicKeyPem": public,
        }))
    if mode == "missing-key":
        (data / "jwt-ed25519.json").unlink()

    archive = root / ("backup.tar.gz" if gz else "backup.tar")
    with tarfile.open(archive, "w:gz" if gz else "w") as tar:
        tar.add(data, arcname="data")
        if mode == "traversal":
            item = tarfile.TarInfo("../escape.txt")
            item.size = 4
            tar.addfile(item, io.BytesIO(b"test"))
        if mode == "backslash":
            item = tarfile.TarInfo(r"data\..\escape.txt")
            item.size = 4
            tar.addfile(item, io.BytesIO(b"test"))
        if mode == "symlink":
            item = tarfile.TarInfo("data/unsafe-link")
            item.type = tarfile.SYMTYPE
            item.linkname = "/etc/passwd"
            tar.addfile(item)

    identity = root / "age-identity.txt"
    run("age-keygen", "-o", str(identity))
    recipient = run("age-keygen", "-y", str(identity)).decode().strip()
    encrypted = pathlib.Path(str(archive) + ".age")
    run("age", "-r", recipient, "-o", str(encrypted), str(archive))
    return encrypted, identity


def verify(encrypted, identity, *options):
    outcome = subprocess.run(  # nosec B603 - fixed local verifier path, shell=False
        [sys.executable, str(VERIFIER), "--archive", str(encrypted), "--identity", str(identity), *options],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
    )
    return outcome.returncode, json.loads(outcome.stdout.decode()), outcome.stderr


class OfflineRestoreVerifierTests(unittest.TestCase):
    def test_tar_roundtrip(self):
        self.assert_restores(False)

    def test_gzipped_tar_roundtrip(self):
        self.assert_restores(True)

    def assert_restores(self, gz):
        with tempfile.TemporaryDirectory(prefix="ssh-restore-fixture-") as tmp:
            archive, identity = fixture(pathlib.Path(tmp), gz=gz)
            code, data, stderr = verify(archive, identity)
            self.assertEqual(code, 0)
            self.assertEqual(data, {
                "status": "pass",
                "database": "ok",
                "validatedKeyPairs": 2,
                "requiredTables": ["agents", "audit_events", "users"],
            })
            self.assertEqual(stderr, b"")

    def test_archive_name_beginning_with_dash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            archive, identity = fixture(root)
            unusual = root / "--version.age"
            archive.replace(unusual)
            outcome = subprocess.run(  # nosec B603 - fixture-only input, shell=False
                [sys.executable, str(VERIFIER), "--archive=--version.age",
                 "--identity", str(identity)],
                cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=20,
            )
            self.assertEqual(outcome.returncode, 0)
            self.assertEqual(json.loads(outcome.stdout)["status"], "pass")
            self.assertEqual(outcome.stderr, b"")

    def test_large_backup_requires_explicit_capacity(self):
        with tempfile.TemporaryDirectory(prefix="ssh-restore-large-") as tmp:
            archive, identity = fixture(pathlib.Path(tmp), "large-db", gz=True)
            code, data, stderr = verify(archive, identity)
            self.assertNotEqual(code, 0)
            self.assertEqual(data, {"status": "fail", "code": "UNSAFE_ARCHIVE"})
            self.assertEqual(stderr, b"")
            code, data, stderr = verify(archive, identity, "--max-backup-mib", "512")
            self.assertEqual(code, 0)
            self.assertEqual(data["status"], "pass")
            self.assertEqual(data["validatedKeyPairs"], 2)
            self.assertEqual(stderr, b"")

    def test_invalid_capacity_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive, identity = fixture(pathlib.Path(tmp))
            for capacity in ("0", "1025"):
                with self.subTest(capacity=capacity):
                    outcome = subprocess.run(  # nosec B603 - fixed verifier and synthetic input
                        [sys.executable, str(VERIFIER), "--archive", str(archive),
                         "--identity", str(identity), "--max-backup-mib", capacity],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
                    )
                    self.assertNotEqual(outcome.returncode, 0)
                    self.assertIn(b"128", outcome.stderr)
                    self.assertIn(b"1024", outcome.stderr)

    def test_wrong_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            archive, _identity = fixture(root)
            wrong = root / "wrong.txt"
            run("age-keygen", "-o", str(wrong))
            code, data, stderr = verify(archive, wrong)
            self.assertNotEqual(code, 0)
            self.assertEqual(data, {"status": "fail", "code": "AGE_DECRYPT_FAILED"})
            self.assertEqual(stderr, b"")

    def test_wrong_signing_public_key(self):
        self.assert_rejects("bad-key", "KEY_PAIR_MISMATCH")

    def test_missing_signing_key(self):
        self.assert_rejects("missing-key", "MISSING_REQUIRED_MEMBER")

    def test_broken_sqlite(self):
        self.assert_rejects("bad-db", "SQLITE_INTEGRITY_FAILED")

    def test_tar_traversal(self):
        self.assert_rejects("traversal", "UNSAFE_ARCHIVE")

    def test_tar_symlink(self):
        self.assert_rejects("symlink", "UNSAFE_ARCHIVE")

    def test_backslash_member(self):
        self.assert_rejects("backslash", "UNSAFE_ARCHIVE")

    def assert_rejects(self, mode, expected):
        with tempfile.TemporaryDirectory(prefix="ssh-restore-fixture-") as tmp:
            archive, identity = fixture(pathlib.Path(tmp), mode=mode)
            code, data, stderr = verify(archive, identity)
            self.assertNotEqual(code, 0)
            self.assertEqual(data, {"status": "fail", "code": expected})
            self.assertEqual(stderr, b"")
            self.assertNotIn(b"PRIVATE KEY", stderr)


if __name__ == "__main__":
    unittest.main()
