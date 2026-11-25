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
CREATOR = ROOT / "scripts" / "create-encrypted-backup.py"


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


def invoke(script, *arguments):
    outcome = subprocess.run(  # nosec B603 - fixed local verifier path, shell=False
        [sys.executable, str(script), *arguments],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
    )
    data = json.loads(outcome.stdout.decode()) if outcome.stdout else None
    return outcome.returncode, data, outcome.stderr


def verify(encrypted, identity, *options):
    return invoke(VERIFIER, "--archive", str(encrypted), "--identity", str(identity), *options)


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
                    code, data, stderr = verify(archive, identity, "--max-backup-mib", capacity)
                    self.assertEqual(code, 2)
                    self.assertIsNone(data)
                    self.assertIn(b"128", stderr)
                    self.assertIn(b"1024", stderr)

    def create_snapshot(self, root, identity, output, *options):
        recipient = run("age-keygen", "-y", str(identity)).decode().strip()
        return invoke(CREATOR, "--source-dir", str(root / "data"),
                      "--recipient", recipient, "--output", str(output), *options)

    def test_creates_recoverable_snapshot_with_committed_wal_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            _, identity = fixture(root)
            output = root / "created.tar.gz.age"
            with sqlite3.connect(root / "data" / "sshautomator.db") as source:
                source.execute("PRAGMA journal_mode=WAL")
                source.execute("INSERT INTO users VALUES ('committed-wal-row')")
                source.commit()
                code, data, stderr = self.create_snapshot(root, identity, output)
                self.assertEqual(code, 0)
                self.assertEqual(data["status"], "pass")
                self.assertEqual(stderr, b"")
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                code, data, stderr = verify(output, identity)
                self.assertEqual(code, 0)
                self.assertEqual(data["status"], "pass")
                plaintext = run("age", "--decrypt", "--identity", str(identity), str(output))
                with tarfile.open(fileobj=io.BytesIO(plaintext), mode="r:gz") as tar:
                    db_bytes = tar.extractfile("sshautomator.db").read()
                restored = root / "restored.db"
                restored.write_bytes(db_bytes)
                with sqlite3.connect(restored) as connection:
                    self.assertEqual(connection.execute("SELECT id FROM users").fetchall(),
                                     [("committed-wal-row",)])

    def test_creation_requires_explicit_capacity_for_large_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            _, identity = fixture(root, "large-db", gz=True)
            output = root / "large.tar.gz.age"
            code, data, stderr = self.create_snapshot(root, identity, output)
            self.assertNotEqual(code, 0)
            self.assertEqual(data, {"status": "fail", "code": "ARCHIVE_TOO_LARGE"})
            self.assertFalse(output.exists())
            self.assertEqual(stderr, b"")
            code, data, stderr = self.create_snapshot(
                root, identity, output, "--max-backup-mib", "512"
            )
            self.assertEqual(code, 0)
            self.assertEqual(data["status"], "pass")
            self.assertEqual(stderr, b"")
            self.assertEqual(verify(output, identity, "--max-backup-mib", "512")[0], 0)

    def test_creation_never_overwrites_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            _, identity = fixture(root)
            output = root / "existing.age"
            output.write_bytes(b"keep this")
            code, data, stderr = self.create_snapshot(root, identity, output)
            self.assertNotEqual(code, 0)
            self.assertEqual(data, {"status": "fail", "code": "OUTPUT_EXISTS"})
            self.assertEqual(output.read_bytes(), b"keep this")
            self.assertEqual(stderr, b"")

    def test_creation_rejects_invalid_recipient_without_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            fixture(root)
            output = root / "invalid.age"
            code, data, stderr = invoke(CREATOR, "--source-dir", str(root / "data"),
                                       "--recipient", "invalid", "--output", str(output))
            self.assertNotEqual(code, 0)
            self.assertEqual(data, {"status": "fail", "code": "INVALID_RECIPIENT"})
            self.assertFalse(output.exists())
            self.assertEqual(stderr, b"")

    def test_creation_rejects_incomplete_or_corrupt_source(self):
        for mode, expected in (("missing-key", "MISSING_REQUIRED_MEMBER"),
                               ("bad-db", "SQLITE_INTEGRITY_FAILED"),
                               ("bad-key", "KEY_PAIR_MISMATCH")):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp)
                _, identity = fixture(root, mode)
                output = root / "invalid.age"
                code, data, stderr = self.create_snapshot(root, identity, output)
                self.assertNotEqual(code, 0)
                self.assertEqual(data, {"status": "fail", "code": expected})
                self.assertFalse(output.exists())
                self.assertEqual(stderr, b"")

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
