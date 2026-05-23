import { ErrorCode, SSHMCPError } from "./types.js";

/**
 * Creates an authentication error
 */
export function createAuthError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EAUTH,
    message,
    hint,
    "SSH authentication failed. Please check your credentials or SSH key.",
    true,
    "Use ssh_open_session with different auth method (password, key, or agent)",
  );
}

/**
 * Creates a connection error
 */
export function createConnectionError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.ECONN,
    message,
    hint,
    "Unable to connect to the SSH server. The server may be down or unreachable.",
    true,
    "Check network connectivity and verify host/port are correct",
  );
}

/**
 * Creates a timeout error
 */
export function createTimeoutError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.ETIMEOUT,
    message,
    hint,
    "The operation timed out. The server may be slow or unresponsive.",
    true,
    "Try increasing timeout or check server load",
  );
}

/**
 * Creates a sudo error
 */
export function createSudoError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.ENOSUDO,
    message,
    hint,
    "Root/sudo privileges are required but not available.",
    true,
    "Configure a restricted NOPASSWD sudoers profile for approved commands",
  );
}

/**
 * Creates a package manager error
 */
export function createPackageManagerError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EPMGR,
    message,
    hint,
    "Package manager operation failed. Check if the package name is correct.",
    true,
    "Verify package name and try ensure_package with correct packageName",
  );
}

/**
 * Creates a filesystem error
 */
export function createFilesystemError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EFS,
    message,
    hint,
    "File system operation failed. Check path and permissions.",
    true,
    "Verify the path exists and you have proper permissions",
  );
}

/**
 * Creates a patch error
 */
export function createPatchError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EPATCH,
    message,
    hint,
    "Failed to apply text patch. The file content may have changed.",
    true,
    "Re-read the file with fs_read and try again with updated content",
  );
}

/**
 * Creates a bad request error
 */
export function createBadRequestError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EBADREQ,
    message,
    hint,
    "Invalid request parameters.",
    false,
    "Check the parameter format and values",
  );
}

/**
 * Creates a policy denial error
 */
export function createPolicyError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EPOLICY,
    message,
    hint,
    "The operation was denied by the configured safety policy.",
    false,
    "Review the policy or run the request in explain mode before changing guardrails",
  );
}

/**
 * Creates a host key verification error
 */
export function createHostKeyError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EHOSTKEY,
    message,
    hint,
    "SSH host key verification failed.",
    true,
    "Verify known_hosts or expectedHostKeySha256 before reconnecting",
  );
}

/**
 * Creates a configured limit error
 */
export function createLimitError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.ELIMIT,
    message,
    hint,
    "The operation exceeded a configured safety limit.",
    false,
    "Use a smaller request, transfer the file, or raise the configured limit intentionally",
  );
}

/**
 * Creates an unsupported platform/capability error
 */
export function createUnsupportedError(message: string, hint?: string): SSHMCPError {
  return new SSHMCPError(
    ErrorCode.EUNSUPPORTED,
    message,
    hint,
    "The requested operation is not supported for this host or transport.",
    false,
    "Use a supported tool for this platform or check the capability resource",
  );
}

/**
 * Wraps an unknown error into an SSH MCP error
 */
export function wrapError(error: unknown, code: ErrorCode, hint?: string): SSHMCPError {
  if (error instanceof SSHMCPError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new SSHMCPError(
    code,
    message,
    hint,
    "An unexpected error occurred.",
    true,
    "Try the operation again or check server status",
  );
}
