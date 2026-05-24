import {
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { logger } from "./logging.js";

const DEFAULT_SERVICE_NAME = "ssh-mcp-pro";

export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string | undefined;
  serviceName: string;
  serviceVersion?: string | undefined;
  environment?: string | undefined;
}

type SpanWork<T> = (span: Span) => Promise<T> | T;

let telemetrySdk: NodeSDK | undefined;
let telemetryConfig = getTelemetryConfig();

export function getTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Omit<TelemetryConfig, "enabled">> = {},
): TelemetryConfig {
  const rawEndpoint = overrides.endpoint ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const endpoint = rawEndpoint?.trim() ? normalizeOtlpEndpoint(rawEndpoint) : undefined;
  const serviceName =
    overrides.serviceName?.trim() ?? env.OTEL_SERVICE_NAME?.trim() ?? DEFAULT_SERVICE_NAME;
  const serviceVersion =
    overrides.serviceVersion?.trim() ?? env.OTEL_SERVICE_VERSION?.trim() ?? undefined;
  const environment = overrides.environment?.trim() ?? env.NODE_ENV?.trim() ?? undefined;

  return {
    enabled: Boolean(endpoint),
    endpoint,
    serviceName,
    serviceVersion,
    environment,
  };
}

export function normalizeOtlpEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
}

export function initTelemetry(overrides: Partial<Omit<TelemetryConfig, "enabled">> = {}): boolean {
  if (telemetrySdk) {
    return true;
  }

  telemetryConfig = getTelemetryConfig(process.env, overrides);
  if (!telemetryConfig.enabled || !telemetryConfig.endpoint) {
    logger.debug("OpenTelemetry disabled", {
      reason: "OTEL_EXPORTER_OTLP_ENDPOINT is not configured",
    });
    return false;
  }

  const resourceAttributes: Attributes = {
    [ATTR_SERVICE_NAME]: telemetryConfig.serviceName,
  };

  if (telemetryConfig.serviceVersion) {
    resourceAttributes[ATTR_SERVICE_VERSION] = telemetryConfig.serviceVersion;
  }
  if (telemetryConfig.environment) {
    resourceAttributes[ATTR_DEPLOYMENT_ENVIRONMENT_NAME] = telemetryConfig.environment;
  }

  const exporter = new OTLPTraceExporter({
    url: telemetryConfig.endpoint,
  });

  telemetrySdk = new NodeSDK({
    serviceName: telemetryConfig.serviceName,
    traceExporter: exporter,
    resource: resourceFromAttributes(resourceAttributes),
  });
  telemetrySdk.start();

  logger.info("OpenTelemetry tracing enabled", {
    endpoint: telemetryConfig.endpoint,
    serviceName: telemetryConfig.serviceName,
  });

  return true;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetrySdk) {
    return;
  }

  const sdk = telemetrySdk;
  telemetrySdk = undefined;

  try {
    await sdk.shutdown();
    logger.info("OpenTelemetry tracing shut down");
  } catch (error) {
    logger.warn("Failed to shut down OpenTelemetry cleanly", { error });
  }
}

export async function withSpan<T>(
  name: string,
  work: SpanWork<T>,
  options: SpanOptions = {},
): Promise<T> {
  const tracer = trace.getTracer(telemetryConfig.serviceName || DEFAULT_SERVICE_NAME);

  return tracer.startActiveSpan(name, options, async (span) => {
    try {
      const result = await work(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function isTelemetryEnabled(): boolean {
  return Boolean(telemetrySdk);
}
