# Offline encrypted backup restore verification

Use this **before** authorizing a hosted release or rollback. It does **not**
change the running service or access live data. Backup existence, filename,
size or encryption header alone does not prove recoverability.

## Independent recovery host

On an authorized isolated Linux host with Python 3, age and OpenSSL, obtain a
**separately stored encrypted backup** and its matching age identity using
your approved secure recovery process. Never paste the identity/private key
into chat, support requests, CI logs or a Git repository. Store the identity
as a private file (for example, file permissions 0600).

From a clean repository checkout, run:

~~~bash
python3 scripts/verify-encrypted-backup.py \
  --archive /secure/offsite/ssh-mcp-pro-backup.tar.gz.age \
  --identity /secure/offsite/age-identity.txt
~~~

The default limit is 128 MiB for the encrypted/decrypted archive and each
individual member, with 256 MiB total extracted size. For a trusted larger
backup, choose an explicit capacity between 128 and 1024 MiB:

~~~bash
python3 scripts/verify-encrypted-backup.py \
  --archive /secure/offsite/ssh-mcp-pro-backup.tar.gz.age \
  --identity /secure/offsite/age-identity.txt \
  --max-backup-mib 512
~~~

This allows archives and members up to 512 MiB and total extracted size up to
1024 MiB. Choose the smallest capacity that accommodates the known backup and
reserve at least three times that capacity in free temporary disk space, in
addition to the original encrypted file and filesystem overhead. All other
archive safety and integrity checks remain unchanged. Do not increase the
capacity for an unknown or untrusted archive.

Both .tar.age and .tar.gz.age formats are supported. The verifier requires a
consistent SQLite sshautomator.db including the users, agents and audit_events
tables, and matching Ed25519 PEM key pairs in control-plane-ed25519.json and
jwt-ed25519.json. It validates database integrity and foreign keys, and
validates each signing-key pair using OpenSSL. The archive is **never**
extracted directly to an embedded path: symbolic links, hardlinks and
parent-path traversal are rejected.

Success prints a small JSON status without database content or key material.
Any failure exits nonzero with a generic error code. Plaintext stays only in
a private temporary directory which is deleted automatically. Live files are
never overwritten.

**Release acceptance remains incomplete** until the backup is fresh and truly
offsite, its decryption identity is independently recoverable, and a controlled
isolated restore proves application startup, signed agent actions, OAuth
continuity, and rollback. Synthetic fixture tests are not production approval.

Run synthetic tests (no production credentials or data):

~~~bash
python3 test/unit/backup_restore_verifier_test.py
~~~
