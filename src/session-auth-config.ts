import {
  buildAgentAuth,
  discoverPrivateKeys,
  loadPrivateKeyFromPath,
  type SSHAuthConfig,
} from "./session-auth.js";
import { createAuthError } from "./errors.js";
import { logger } from "./logging.js";
import type { ConnectionParams } from "./types.js";

/** Build SSH authentication options while preserving existing strategy priority. */
/**
 * Builds authentication configuration based on the auth strategy
 */
export async function buildSessionAuthConfig(params: ConnectionParams): Promise<SSHAuthConfig> {
  const authStrategy = params.auth ?? "auto";

  logger.debug("Building auth config", { strategy: authStrategy });

  switch (authStrategy) {
    case "password":
      if (!params.password) {
        throw createAuthError("Password required for password authentication");
      }
      return { password: params.password };
    case "key":
      return await buildKeyAuth(params);
    case "agent":
      return buildAgentAuth();
    case "auto":
    default:
      return await buildAutoAuth(params);
  }
}

/**
 * Builds key-based authentication
 */
async function buildKeyAuth(params: ConnectionParams): Promise<SSHAuthConfig> {
  if (params.privateKey) {
    logger.debug("Using inline private key");
    return {
      privateKey: params.privateKey,
      ...(params.passphrase !== undefined ? { passphrase: params.passphrase } : {}),
    };
  }

  if (params.privateKeyPath) {
    logger.debug("Using private key from path", {
      path: params.privateKeyPath,
    });
    return await loadPrivateKeyFromPath(params.privateKeyPath, params.passphrase);
  }

  return await discoverPrivateKeys(params.passphrase, logger);
}

/**
 * Builds automatic authentication (tries password, then key, then agent)
 */
async function buildAutoAuth(params: ConnectionParams): Promise<SSHAuthConfig> {
  if (params.password) {
    logger.debug("Auto auth: trying password");
    return { password: params.password };
  }

  try {
    logger.debug("Auto auth: trying key authentication");
    return await buildKeyAuth(params);
  } catch {
    logger.debug("Auto auth: key authentication failed, trying agent");
  }

  try {
    return buildAgentAuth();
  } catch {
    throw createAuthError(
      "No suitable authentication method found",
      "Provide a password, private key, or ensure SSH agent is running",
    );
  }
}
