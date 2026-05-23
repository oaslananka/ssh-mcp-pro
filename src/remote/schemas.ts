import { z } from "zod";
import {
  REMOTE_CAPABILITIES,
  REMOTE_ERROR_CODES,
  REMOTE_TOOLS,
  type ActionRequestEnvelope,
  type ActionResultEnvelope,
  type AgentHelloEnvelope,
  type AgentHostMetadata,
  type AgentPolicy,
  type PolicyUpdateEnvelope,
} from "./types.js";

const capabilitySchema = z.enum(REMOTE_CAPABILITIES);
const toolSchema = z.enum(REMOTE_TOOLS);
const errorCodeSchema = z.enum(REMOTE_ERROR_CODES);

export const agentHostMetadataSchema = z
  .object({
    hostname: z.string().min(1).max(255),
    os: z.string().min(1).max(128),
    arch: z.string().min(1).max(64),
    platform: z.string().min(1).max(128),
  })
  .strict();

const capabilityPolicyShape = Object.fromEntries(
  REMOTE_CAPABILITIES.map((capability) => [capability, z.boolean()]),
) as Record<(typeof REMOTE_CAPABILITIES)[number], z.ZodBoolean>;

export const capabilityPolicySchema = z.object(capabilityPolicyShape).strict();

export const agentPolicySchema = z
  .object({
    profile: z.enum(["read-only", "operations", "full-admin", "custom"]),
    capabilities: capabilityPolicySchema,
    allowPaths: z.array(z.string()),
    denyPaths: z.array(z.string()),
    allowServices: z.array(z.string()),
    allowContainers: z.array(z.string()),
    maxOutputBytes: z.number().int().positive().max(10_000_000),
    maxActionTimeoutSeconds: z.number().int().positive().max(3600),
    version: z.number().int().positive(),
  })
  .strict();

export const agentHelloEnvelopeSchema = z
  .object({
    type: z.literal("agent.hello"),
    agent_id: z.string().min(1),
    timestamp: z.string().datetime(),
    nonce: z.string().min(16),
    capabilities: z.array(capabilitySchema),
    agent_version: z.string().min(1).max(128),
    host: agentHostMetadataSchema,
    signature: z.string().min(1),
  })
  .strict();

export const actionRequestEnvelopeSchema = z
  .object({
    type: z.literal("action.request"),
    action_id: z.string().min(1),
    agent_id: z.string().min(1),
    user_id: z.string().min(1),
    tool: toolSchema,
    capability: capabilitySchema,
    args: z.record(z.string(), z.unknown()),
    policy_version: z.number().int().positive(),
    issued_at: z.string().datetime(),
    deadline: z.string().datetime(),
    nonce: z.string().min(16),
    signature: z.string().min(1),
  })
  .strict();

export const actionResultEnvelopeSchema = z
  .object({
    type: z.literal("action.result"),
    action_id: z.string().min(1),
    agent_id: z.string().min(1),
    nonce: z.string().min(16),
    status: z.enum(["ok", "error"]),
    exit_code: z.number().int().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    started_at: z.string().datetime(),
    finished_at: z.string().datetime(),
    truncated: z.boolean(),
    error_code: errorCodeSchema.optional(),
    message: z.string().optional(),
    signature: z.string().min(1),
  })
  .strict();

export const policyUpdateEnvelopeSchema = z
  .object({
    type: z.literal("policy.update"),
    agent_id: z.string().min(1),
    policy: agentPolicySchema,
    policy_version: z.number().int().positive(),
    issued_at: z.string().datetime(),
    nonce: z.string().min(16),
    signature: z.string().min(1),
  })
  .strict();

export function parseAgentHostMetadata(value: unknown): AgentHostMetadata {
  return agentHostMetadataSchema.parse(value);
}

export function parseAgentPolicy(value: unknown): AgentPolicy {
  return agentPolicySchema.parse(value);
}

export function parseAgentHelloEnvelope(value: unknown): AgentHelloEnvelope {
  return agentHelloEnvelopeSchema.parse(value);
}

export function parseActionRequestEnvelope(value: unknown): ActionRequestEnvelope {
  return actionRequestEnvelopeSchema.parse(value);
}

export function parseActionResultEnvelope(value: unknown): ActionResultEnvelope {
  return actionResultEnvelopeSchema.parse(value);
}

export function parsePolicyUpdateEnvelope(value: unknown): PolicyUpdateEnvelope {
  return policyUpdateEnvelopeSchema.parse(value);
}
