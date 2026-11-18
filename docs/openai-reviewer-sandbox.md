# OpenAI Reviewer Sandbox

The reviewer sandbox provides a dedicated username/password entry point for the OpenAI app review. It is a separate identity and data path; it is not an owner account, a general sign-up flow, or a connection to production devices.

## Configuration

Set both variables in the hosted control-plane deployment's secret configuration:

- `SSH_MCP_REVIEWER_USERNAME`: a dedicated reviewer username.
- `SSH_MCP_REVIEWER_PASSWORD_HASH`: the scrypt password hash described below.

Reviewer access stays disabled unless both values are present and the password hash has the supported format. Never commit either value, the plaintext password, or a generated credential file. Do not put reviewer credentials in issue comments, logs, source files, or Context Ledger. Provide the plaintext password only through the OpenAI Platform's secure reviewer-credentials field.

### Password hash format

The server uses Node.js built-in scrypt with fixed parameters and no additional authentication dependency. The encoded value is:

```text
scrypt$16384$8$1$<salt-base64url>$<derived-key-base64url>
```

Generate it on a trusted workstation with Python 3 (standard library only). This prompts without echoing the password, verifies it twice, and prints only the encoded hash:

```bash
python3 - <<'PY'
import base64
import getpass
import hashlib
import secrets

password = getpass.getpass("Reviewer password: ")
confirmation = getpass.getpass("Confirm reviewer password: ")
if not password or password != confirmation:
    raise SystemExit("Passwords are empty or do not match")
if len(password.encode("utf-8")) > 1024:
    raise SystemExit("Password exceeds the 1024-byte limit")
salt = secrets.token_bytes(16)
derived = hashlib.scrypt(
    password.encode("utf-8"), salt=salt, n=16384, r=8, p=1,
    dklen=64, maxmem=64 * 1024 * 1024,
)
b64url = lambda value: base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")
print(f"scrypt$16384$8$1${b64url(salt)}${b64url(derived)}")
PY
```

Keep the plaintext out of shell arguments and command history; store only the encoded hash in the deployment secret manager. Choose a unique, high-entropy password and deliver the plaintext only through the OpenAI Platform's secure reviewer-credentials field.

## Reviewer login

Use the hosted HTTPS URL:

```text
https://<control-plane-host>/oauth/reviewer/login
```

The page is English-language, labels the environment as **Review sandbox — synthetic data only**, and uses a dedicated 12-hour HttpOnly session. When opened from an OAuth consent request, successful sign-in safely returns to that same-origin consent request; external return targets are rejected. Login and logout forms use same-origin checks and one-use CSRF tokens. Five failed attempts for the same peer and username are temporarily blocked for a 15-minute window.

The reserved identity is `demo:openai-reviewer` with provider `demo`. It has no GitHub ID, Google ID, or real email address. It cannot sign in to the normal owner dashboard.

## Available MCP access

The reviewer grant is restricted to the intersection of the requested scopes and this exact read-only allowlist:

- `hosts:read`
- `agents:read`
- `status:read`

The reviewer MCP listing exposes exactly these three tools:

- `list_hosts`
- `list_agents`
- `get_system_status`

The sample tenant contains two deterministic synthetic devices:

- `reviewer-linux-online` — online sample device.
- `reviewer-linux-offline` — offline sample device.

Every successful sample response includes `sample_data: true` and `source: "synthetic"`. The online status response also identifies its action as synthetic and explicitly says that no command was executed. Requesting status for the offline sample returns `AGENT_OFFLINE`; an unknown sample alias returns `AGENT_NOT_FOUND`.

Reviewer requests are intercepted before production agent lookups and action dispatch. They do not read or write production agent, action, or audit records and cannot enroll, administer, restart, write files, run shell commands, or use sudo.

## Disable and acceptance

Remove either reviewer environment variable and restart/redeploy the control plane to disable reviewer access. Existing reviewer authorization-code exchanges, refresh-token exchanges, and bearer-token requests then fail closed; the normal GitHub/Google login and production device flows remain independent.

Before updating the saved OpenAI app draft, verify the deployed flow from a clean browser session:

1. Sign in using the dedicated reviewer credentials.
2. Connect the saved MCP listing and confirm the consent screen grants only the three scopes above.
3. Confirm the tool list contains exactly the three sample-inspection tools.
4. Inspect both sample devices and retrieve status for the online device.
5. Confirm the offline and unknown aliases return their expected errors.
6. Confirm no write, shell, sudo, service, enrollment, policy, or administrative tool is available or callable.
7. Disable reviewer configuration and confirm existing reviewer access and refresh fail closed.
8. Confirm the owner's existing ChatGPT grant and production devices are unchanged.

Keep the OpenAI app draft unsubmitted and unpublished until live reviewer acceptance and the genuine, accessible video walkthrough are complete. Do not fabricate a walkthrough or claim a portal acceptance result based only on local tests.
