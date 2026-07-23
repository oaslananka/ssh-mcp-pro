import type { Server } from "node:http";

export interface HttpServerLifecycleOptions {
  server: Server;
  host: string;
  port: number;
  registerSignalHandlers?: boolean | undefined;
  exitOnSignal?: boolean | undefined;
  beforeListen?: () => Promise<void> | void;
  afterListen?: (port: number) => Promise<void> | void;
  cleanup: (reason: string) => Promise<void> | void;
}

export interface HttpServerLifecycle {
  start(): Promise<void>;
  close(reason?: string): Promise<void>;
}

export function createHttpServerLifecycle(
  options: HttpServerLifecycleOptions,
): HttpServerLifecycle {
  let started = false;
  let closed = false;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let signalsRegistered = false;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();

  function unregisterSignalHandlers(): void {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    signalHandlers.clear();
    signalsRegistered = false;
  }

  function registerSignalHandlers(): void {
    if (!options.registerSignalHandlers || signalsRegistered) {
      return;
    }
    signalsRegistered = true;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => {
        void close(signal).finally(() => {
          if (options.exitOnSignal !== false) {
            process.exit(0);
          }
        });
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  }

  function beginClosingListeningServer(): Promise<void> {
    if (!options.server.listening) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      options.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      options.server.closeIdleConnections?.();
    });
  }

  async function close(reason = "shutdown"): Promise<void> {
    if (closePromise) {
      return closePromise;
    }
    closed = true;
    closePromise = (async () => {
      unregisterSignalHandlers();
      const results = await Promise.allSettled([
        beginClosingListeningServer(),
        Promise.resolve().then(() => options.cleanup(reason)),
      ]);
      started = false;
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) {
        throw failure.reason;
      }
    })();
    return closePromise;
  }

  async function listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        options.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        options.server.off("error", onError);
        resolve();
      };
      options.server.once("error", onError);
      options.server.once("listening", onListening);
      options.server.listen(options.port, options.host);
    });
  }

  async function start(): Promise<void> {
    if (closed) {
      throw new Error("HTTP server lifecycle is closed");
    }
    if (started) {
      return;
    }
    if (startPromise) {
      return startPromise;
    }
    startPromise = (async () => {
      try {
        await options.beforeListen?.();
        if (closed) {
          throw new Error("HTTP server lifecycle is closed");
        }
        await listen();
        if (closed) {
          await beginClosingListeningServer();
          throw new Error("HTTP server lifecycle is closed");
        }
        started = true;
        registerSignalHandlers();
        const address = options.server.address();
        const listeningPort = address && typeof address === "object" ? address.port : options.port;
        await options.afterListen?.(listeningPort);
      } catch (error) {
        await close("startup-failed");
        throw error;
      }
    })();
    try {
      await startPromise;
    } finally {
      startPromise = undefined;
    }
  }

  return { start, close };
}
