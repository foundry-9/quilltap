"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/dist/qtap-plugin-ollama/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// lib/logging/transports/console.ts
var ConsoleTransport = class {
  /**
   * Write a log entry to the console
   * @param logData The structured log data to write
   */
  write(logData) {
    const logString = JSON.stringify(logData);
    switch (logData.level) {
      case "error" /* ERROR */:
        console.error(logString);
        break;
      case "warn" /* WARN */:
        console.warn(logString);
        break;
      case "info" /* INFO */:
        console.info(logString);
        break;
      case "debug" /* DEBUG */:
        console.debug(logString);
        break;
      default:
        console.log(logString);
    }
  }
};

// lib/logging/transports/file.ts
var import_fs = require("fs");
var import_path = require("path");
var FileTransport = class {
  /**
   * Create a new FileTransport instance
   * @param logDir Directory where log files will be stored
   * @param maxFileSize Maximum size of a log file in bytes (default: 10MB)
   * @param maxFiles Maximum number of rotated files to keep (default: 5)
   */
  constructor(logDir, maxFileSize = 10485760, maxFiles = 5) {
    this.fileSizes = /* @__PURE__ */ new Map();
    this.logDir = logDir;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.initializeDirectory();
  }
  /**
   * Initialize the log directory and track existing file sizes
   */
  async initializeDirectory() {
    try {
      await import_fs.promises.mkdir(this.logDir, { recursive: true });
      const combinedLogPath = (0, import_path.join)(this.logDir, "combined.log");
      const errorLogPath = (0, import_path.join)(this.logDir, "error.log");
      try {
        const combinedStats = await import_fs.promises.stat(combinedLogPath);
        this.fileSizes.set("combined.log", combinedStats.size);
      } catch {
        this.fileSizes.set("combined.log", 0);
      }
      try {
        const errorStats = await import_fs.promises.stat(errorLogPath);
        this.fileSizes.set("error.log", errorStats.size);
      } catch {
        this.fileSizes.set("error.log", 0);
      }
    } catch (error) {
      console.error(
        "Failed to initialize logging directory:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  /**
   * Write a log entry to the appropriate file(s)
   * @param logData The structured log data to write
   */
  async write(logData) {
    const logString = JSON.stringify(logData);
    const lineWithNewline = logString + "\n";
    await this.writeToFile("combined.log", lineWithNewline);
    if (logData.level === "error" /* ERROR */) {
      await this.writeToFile("error.log", lineWithNewline);
    }
  }
  /**
   * Write a line to a specific log file with rotation support
   * @param filename The log filename (combined.log or error.log)
   * @param content The log line to write
   */
  async writeToFile(filename, content) {
    try {
      const filePath = (0, import_path.join)(this.logDir, filename);
      const contentSize = Buffer.byteLength(content, "utf-8");
      const currentSize = this.fileSizes.get(filename) || 0;
      if (currentSize + contentSize > this.maxFileSize) {
        await this.rotateFile(filename);
      }
      await import_fs.promises.appendFile(filePath, content, "utf-8");
      const newSize = (this.fileSizes.get(filename) || 0) + contentSize;
      this.fileSizes.set(filename, newSize);
    } catch (error) {
      console.error(
        `Failed to write to ${filename}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  /**
   * Rotate a log file when it exceeds maxFileSize
   * Renames existing rotated files and starts fresh
   * Old rotations beyond maxFiles are deleted
   * @param filename The log filename to rotate
   */
  async rotateFile(filename) {
    try {
      const basePath = (0, import_path.join)(this.logDir, filename);
      const oldestPath = (0, import_path.join)(this.logDir, `${filename}.${this.maxFiles}`);
      try {
        await import_fs.promises.unlink(oldestPath);
      } catch {
      }
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldPath = (0, import_path.join)(this.logDir, `${filename}.${i}`);
        const newPath = (0, import_path.join)(this.logDir, `${filename}.${i + 1}`);
        try {
          await import_fs.promises.rename(oldPath, newPath);
        } catch {
        }
      }
      const rotatedPath = (0, import_path.join)(this.logDir, `${filename}.1`);
      try {
        await import_fs.promises.rename(basePath, rotatedPath);
      } catch {
      }
      this.fileSizes.set(filename, 0);
    } catch (error) {
      console.error(
        `Failed to rotate ${filename}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
};

// lib/env.ts
var import_zod = require("zod");
var envSchema = import_zod.z.object({
  // Node environment
  NODE_ENV: import_zod.z.enum(["development", "production", "test"]).default("development"),
  // Database (optional - JSON store is now the default)
  DATABASE_URL: import_zod.z.string().url().optional(),
  // NextAuth
  NEXTAUTH_URL: import_zod.z.string().url().min(1, "NEXTAUTH_URL is required"),
  NEXTAUTH_SECRET: import_zod.z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  // OAuth Providers (all optional - configured via auth plugins)
  GOOGLE_CLIENT_ID: import_zod.z.string().optional(),
  GOOGLE_CLIENT_SECRET: import_zod.z.string().optional(),
  APPLE_ID: import_zod.z.string().optional(),
  APPLE_SECRET: import_zod.z.string().optional(),
  GITHUB_ID: import_zod.z.string().optional(),
  GITHUB_SECRET: import_zod.z.string().optional(),
  // Encryption
  ENCRYPTION_MASTER_PEPPER: import_zod.z.string().min(32, "ENCRYPTION_MASTER_PEPPER must be at least 32 characters"),
  // Rate Limiting (optional)
  RATE_LIMIT_API_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_API_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_AUTH_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_AUTH_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_CHAT_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_CHAT_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_GENERAL_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_GENERAL_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  // Logging (optional)
  LOG_LEVEL: import_zod.z.enum(["error", "warn", "info", "debug"]).optional().default("info"),
  LOG_OUTPUT: import_zod.z.enum(["console", "file", "both"]).optional().default("console"),
  LOG_FILE_PATH: import_zod.z.string().optional().default("./logs"),
  LOG_FILE_MAX_SIZE: import_zod.z.string().regex(/^\d+$/).optional(),
  LOG_FILE_MAX_FILES: import_zod.z.string().regex(/^\d+$/).optional(),
  // Production SSL (optional)
  DOMAIN: import_zod.z.string().optional(),
  SSL_EMAIL: import_zod.z.string().email().optional(),
  // Data Backend Configuration
  DATA_BACKEND: import_zod.z.enum(["json", "mongodb", "dual"]).optional().default("json"),
  // MongoDB Configuration (optional - only required when DATA_BACKEND is 'mongodb' or 'dual')
  MONGODB_URI: import_zod.z.string().optional().default("mongodb://localhost:27017"),
  MONGODB_DATABASE: import_zod.z.string().optional().default("quilltap"),
  MONGODB_MODE: import_zod.z.enum(["external", "embedded"]).optional().default("external"),
  MONGODB_DATA_DIR: import_zod.z.string().optional().default("/data/mongodb"),
  MONGODB_CONNECTION_TIMEOUT_MS: import_zod.z.string().regex(/^\d+$/).optional(),
  MONGODB_MAX_POOL_SIZE: import_zod.z.string().regex(/^\d+$/).optional(),
  // S3 Configuration (optional - file storage backend)
  S3_MODE: import_zod.z.enum(["embedded", "external", "disabled"]).optional().default("disabled"),
  S3_ENDPOINT: import_zod.z.string().url().optional(),
  S3_REGION: import_zod.z.string().optional().default("us-east-1"),
  S3_ACCESS_KEY: import_zod.z.string().optional(),
  S3_SECRET_KEY: import_zod.z.string().optional(),
  S3_BUCKET: import_zod.z.string().optional().default("quilltap-files"),
  S3_PATH_PREFIX: import_zod.z.string().optional(),
  S3_PUBLIC_URL: import_zod.z.string().url().optional(),
  S3_FORCE_PATH_STYLE: import_zod.z.enum(["true", "false"]).optional()
});
function validateEnv() {
  try {
    const env2 = envSchema.parse(process.env);
    return env2;
  } catch (error) {
    if (error instanceof import_zod.z.ZodError) {
      const missingVars = error.errors.map((err) => {
        return `  - ${err.path.join(".")}: ${err.message}`;
      });
      console.error("\u274C Environment validation failed:");
      console.error(missingVars.join("\n"));
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      console.error("See .env.example for reference.\n");
      if (process.env.NODE_ENV !== "test") {
        process.exit(1);
      }
      throw error;
    }
    throw error;
  }
}
var env = validateEnv();
var isProduction = env.NODE_ENV === "production";
var isDevelopment = env.NODE_ENV === "development";
var isTest = env.NODE_ENV === "test";

// lib/logger.ts
var LOG_LEVELS = {
  ["error" /* ERROR */]: 0,
  ["warn" /* WARN */]: 1,
  ["info" /* INFO */]: 2,
  ["debug" /* DEBUG */]: 3
};
var CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || "info" /* INFO */];
function initializeTransports() {
  const transports = [];
  const output = env.LOG_OUTPUT || "console";
  if (output === "console" || output === "both") {
    transports.push(new ConsoleTransport());
  }
  if (output === "file" || output === "both") {
    const maxFileSize = env.LOG_FILE_MAX_SIZE ? Number.parseInt(env.LOG_FILE_MAX_SIZE) : void 0;
    const maxFiles = env.LOG_FILE_MAX_FILES ? Number.parseInt(env.LOG_FILE_MAX_FILES) : void 0;
    transports.push(new FileTransport(
      env.LOG_FILE_PATH || "./logs",
      maxFileSize,
      maxFiles
    ));
  }
  return transports;
}
var Logger = class _Logger {
  constructor(context = {}, transports, minLevel) {
    this.context = context;
    this.transports = transports || initializeTransports();
    this.minLevel = minLevel ? LOG_LEVELS[minLevel] : CURRENT_LEVEL;
  }
  /**
   * Create a child logger with additional context
   */
  child(additionalContext) {
    const levelKey = Object.keys(LOG_LEVELS).find((key) => LOG_LEVELS[key] === this.minLevel);
    return new _Logger({ ...this.context, ...additionalContext }, this.transports, levelKey);
  }
  /**
   * Log an error message
   */
  error(message, context, error) {
    this.log("error" /* ERROR */, message, context, error);
  }
  /**
   * Log a warning message
   */
  warn(message, context) {
    this.log("warn" /* WARN */, message, context);
  }
  /**
   * Log an info message
   */
  info(message, context) {
    this.log("info" /* INFO */, message, context);
  }
  /**
   * Log a debug message
   */
  debug(message, context) {
    this.log("debug" /* DEBUG */, message, context);
  }
  /**
   * Internal logging implementation
   */
  log(level, message, context, error) {
    if (LOG_LEVELS[level] > this.minLevel) {
      return;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const logData = {
      timestamp,
      level,
      message,
      context: {
        ...this.context,
        ...context
      },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : void 0
    };
    for (const transport of this.transports) {
      try {
        const result = transport.write(logData);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error("Transport write failed:", err);
          });
        }
      } catch (err) {
        console.error("Transport write failed:", err);
      }
    }
  }
  /**
   * Log an HTTP request
   */
  logRequest(method, path, statusCode, duration, context) {
    this.info("HTTP request", {
      method,
      path,
      statusCode,
      duration,
      ...context
    });
  }
  /**
   * Log an API key operation (without exposing the key)
   */
  logApiKeyOperation(operation, provider, userId, success) {
    this.info("API key operation", {
      operation,
      provider,
      userId,
      success
    });
  }
  /**
   * Log LLM API call (without exposing API key or full content)
   */
  logLLMCall(provider, model, tokenCount, success, duration) {
    this.info("LLM API call", {
      provider,
      model,
      tokenCount,
      success,
      duration
    });
  }
  /**
   * Log authentication events
   */
  logAuth(event, provider, userId, success) {
    this.info("Authentication event", {
      event,
      provider,
      userId,
      success
    });
  }
};
var logger = new Logger({
  service: "quilltap",
  environment: process.env.NODE_ENV || "development"
});

// plugins/dist/qtap-plugin-ollama/provider.ts
var OllamaProvider = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.supportsFileAttachments = false;
    this.supportedMimeTypes = [];
    this.supportsImageGeneration = false;
    this.supportsWebSearch = false;
    logger.debug("Initializing Ollama provider", { context: "OllamaProvider.constructor", baseUrl });
  }
  // Helper to collect attachment failures for unsupported provider
  collectAttachmentFailures(params) {
    const failed = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: "Ollama file attachment support not yet implemented (requires multimodal model detection)"
          });
        }
      }
    }
    return { sent: [], failed };
  }
  async sendMessage(params, apiKey) {
    logger.debug("Ollama sendMessage called", { context: "OllamaProvider.sendMessage", model: params.model, baseUrl: this.baseUrl });
    const attachmentResults = this.collectAttachmentFailures(params);
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    const requestBody = {
      model: params.model,
      messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 1e3,
        top_p: params.topP ?? 1,
        stop: params.stop
      }
    };
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to request", { context: "OllamaProvider.sendMessage", toolCount: params.tools.length });
      requestBody.tools = params.tools;
    }
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Ollama API error response", { context: "OllamaProvider.sendMessage", status: response.status, error: errorText });
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }
      const data = await response.json();
      logger.debug("Received Ollama response", {
        context: "OllamaProvider.sendMessage",
        model: params.model,
        done: data.done,
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count
      });
      return {
        content: data.message.content,
        finishReason: data.done ? "stop" : "length",
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0)
        },
        raw: data,
        attachmentResults
      };
    } catch (error) {
      logger.error("Ollama sendMessage failed", { context: "OllamaProvider.sendMessage", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      throw error;
    }
  }
  async *streamMessage(params, apiKey) {
    logger.debug("Ollama streamMessage called", {
      context: "OllamaProvider.streamMessage",
      model: params.model,
      baseUrl: this.baseUrl,
      messageCount: params.messages.length,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      topP: params.topP
    });
    const attachmentResults = this.collectAttachmentFailures(params);
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    logger.debug("Ollama request messages", {
      context: "OllamaProvider.streamMessage",
      messages: messages.map((m, i) => ({
        index: i,
        role: m.role,
        contentLength: m.content.length,
        contentPreview: m.content.substring(0, 100) + (m.content.length > 100 ? "..." : "")
      }))
    });
    const requestBody = {
      model: params.model,
      messages,
      stream: true,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 1e3,
        top_p: params.topP ?? 1
      }
    };
    logger.debug("Ollama request body", {
      context: "OllamaProvider.streamMessage",
      model: requestBody.model,
      messageCount: requestBody.messages.length,
      options: requestBody.options
    });
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to stream request", { context: "OllamaProvider.streamMessage", toolCount: params.tools.length });
      requestBody.tools = params.tools;
    }
    try {
      logger.debug("Sending request to Ollama", {
        context: "OllamaProvider.streamMessage",
        url: `${this.baseUrl}/api/chat`
      });
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      logger.debug("Ollama response received", {
        context: "OllamaProvider.streamMessage",
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });
      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Ollama streaming API error", { context: "OllamaProvider.streamMessage", status: response.status, error: errorText });
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get response reader");
      }
      const decoder = new TextDecoder();
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let chunkCount = 0;
      let totalContent = "";
      let toolCalls = [];
      let lastModel = params.model;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logger.debug("Stream reader done", {
              context: "OllamaProvider.streamMessage",
              chunkCount,
              totalContentLength: totalContent.length,
              toolCallCount: toolCalls.length
            });
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter(Boolean);
          logger.debug("Processing stream chunk", {
            context: "OllamaProvider.streamMessage",
            chunkLength: chunk.length,
            lineCount: lines.length,
            rawChunkPreview: chunk.substring(0, 200)
          });
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              logger.debug("Parsed Ollama stream data", {
                context: "OllamaProvider.streamMessage",
                hasMessage: !!data.message,
                messageContent: data.message?.content?.substring(0, 50),
                hasToolCalls: !!data.message?.tool_calls,
                toolCallCount: data.message?.tool_calls?.length,
                done: data.done,
                model: data.model
              });
              if (data.model) {
                lastModel = data.model;
              }
              if (data.message?.tool_calls && Array.isArray(data.message.tool_calls)) {
                logger.debug("Captured tool calls from Ollama response", {
                  context: "OllamaProvider.streamMessage",
                  toolCalls: data.message.tool_calls.map((tc) => ({
                    id: tc.id,
                    name: tc.function?.name
                  }))
                });
                toolCalls = [...toolCalls, ...data.message.tool_calls];
              }
              if (data.message?.content) {
                chunkCount++;
                totalContent += data.message.content;
                yield {
                  content: data.message.content,
                  done: false
                };
              } else if (data.message && !data.message.content && !data.done && !data.message.tool_calls) {
                logger.debug("Ollama message without content or tool calls", {
                  context: "OllamaProvider.streamMessage",
                  message: data.message,
                  done: data.done
                });
              }
              if (data.prompt_eval_count) {
                totalPromptTokens = data.prompt_eval_count;
              }
              if (data.eval_count) {
                totalCompletionTokens = data.eval_count;
              }
              if (data.done) {
                logger.debug("Stream completed", {
                  context: "OllamaProvider.streamMessage",
                  model: params.model,
                  chunkCount,
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                  hasToolCalls: toolCalls.length > 0,
                  toolCallCount: toolCalls.length
                });
                const rawResponse = {
                  model: lastModel,
                  message: {
                    role: "assistant",
                    content: totalContent
                  }
                };
                if (toolCalls.length > 0) {
                  const normalizedToolCalls = toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                      name: tc.function?.name,
                      // Arguments may already be an object (Ollama) or string (OpenAI)
                      arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
                    }
                  }));
                  rawResponse.tool_calls = normalizedToolCalls;
                  logger.debug("Including normalized tool calls in rawResponse", {
                    context: "OllamaProvider.streamMessage",
                    originalFormat: toolCalls.map((tc) => ({
                      id: tc.id,
                      name: tc.function?.name,
                      argsType: typeof tc.function?.arguments
                    })),
                    normalizedFormat: normalizedToolCalls.map((tc) => ({
                      id: tc.id,
                      type: tc.type,
                      name: tc.function?.name
                    }))
                  });
                }
                yield {
                  content: "",
                  done: true,
                  usage: {
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens: totalPromptTokens + totalCompletionTokens
                  },
                  attachmentResults,
                  rawResponse
                };
              }
            } catch (e) {
              logger.warn("Failed to parse Ollama stream line", {
                context: "OllamaProvider.streamMessage",
                provider: "ollama",
                line: line.substring(0, 100),
                error: e instanceof Error ? e.message : String(e)
              });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      logger.error("Ollama streamMessage failed", { context: "OllamaProvider.streamMessage", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      throw error;
    }
  }
  async validateApiKey(apiKey) {
    logger.debug("Validating Ollama server", { context: "OllamaProvider.validateApiKey", baseUrl: this.baseUrl });
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET"
      });
      const isValid = response.ok;
      logger.debug("Ollama server validation result", { context: "OllamaProvider.validateApiKey", isValid, baseUrl: this.baseUrl });
      return isValid;
    } catch (error) {
      logger.error("Ollama server validation failed", { context: "OllamaProvider.validateApiKey", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    logger.debug("Fetching available Ollama models", { context: "OllamaProvider.getAvailableModels", baseUrl: this.baseUrl });
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET"
      });
      if (!response.ok) {
        logger.error("Failed to fetch Ollama models", { context: "OllamaProvider.getAvailableModels", status: response.status });
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      const models = data.models?.map((m) => m.name) ?? [];
      logger.debug("Retrieved Ollama models", { context: "OllamaProvider.getAvailableModels", modelCount: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Ollama models", { context: "OllamaProvider.getAvailableModels", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      return [];
    }
  }
  async generateImage(params, apiKey) {
    logger.warn("Image generation not supported", { context: "OllamaProvider.generateImage" });
    throw new Error("Ollama does not support image generation. Use a multimodal model for image analysis.");
  }
};

// plugins/dist/qtap-plugin-ollama/icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function OllamaIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-gray-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "ollama-icon",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "11", fill: "none", stroke: "currentColor", strokeWidth: "2" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M12 2A10 10 0 1 1 2 12A10 10 0 0 1 12 2Z",
            fill: "currentColor",
            opacity: "0.1"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "text",
          {
            x: "50%",
            y: "50%",
            textAnchor: "middle",
            dominantBaseline: "middle",
            fill: "currentColor",
            fontSize: "9",
            fontWeight: "bold",
            fontFamily: "system-ui, -apple-system, sans-serif",
            children: "OLL"
          }
        )
      ]
    }
  );
}

// lib/llm/tool-formatting-utils.ts
function parseOpenAIToolCalls(response) {
  const toolCalls = [];
  try {
    let toolCallsArray = response?.tool_calls;
    if (!toolCallsArray && response?.choices?.[0]?.message?.tool_calls) {
      toolCallsArray = response.choices[0].message.tool_calls;
    }
    if (toolCallsArray && Array.isArray(toolCallsArray) && toolCallsArray.length > 0) {
      for (const toolCall of toolCallsArray) {
        if (toolCall.type === "function" && toolCall.function) {
          logger.debug("Parsed OpenAI tool call", {
            context: "tool-parsing",
            toolName: toolCall.function.name
          });
          toolCalls.push({
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || "{}")
          });
        }
      }
    }
  } catch (error) {
    logger.error("Error parsing OpenAI tool calls", { context: "tool-parsing" }, error instanceof Error ? error : void 0);
  }
  return toolCalls;
}

// plugins/dist/qtap-plugin-ollama/index.ts
var metadata = {
  providerName: "OLLAMA",
  displayName: "Ollama",
  description: "Local Ollama LLM models for offline AI inference",
  colors: {
    bg: "bg-gray-100",
    text: "text-gray-800",
    icon: "text-gray-600"
  },
  abbreviation: "OLL"
};
var config = {
  requiresApiKey: false,
  requiresBaseUrl: true,
  baseUrlLabel: "Ollama Base URL",
  baseUrlDefault: "http://localhost:11434"
};
var capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: true,
  webSearch: false
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "File attachments not yet supported (requires multimodal model detection)",
  notes: "Multimodal models like llava can process images, but require model-specific implementation"
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create an Ollama LLM provider instance
   * Requires baseUrl parameter for Ollama server connection
   */
  createProvider: (baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    logger.debug("Creating Ollama provider instance", { context: "plugin.createProvider", baseUrl: url });
    return new OllamaProvider(url);
  },
  /**
   * Ollama does not support image generation
   */
  createImageProvider: (baseUrl) => {
    logger.debug("Image provider requested but not supported for Ollama", { context: "plugin.createImageProvider" });
    throw new Error("Ollama does not support image generation");
  },
  /**
   * Get list of available models from Ollama server
   * No API key required, uses baseUrl to connect to local/remote Ollama instance
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    logger.debug("Fetching available Ollama models", { context: "plugin.getAvailableModels", baseUrl: url });
    try {
      const provider = new OllamaProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched Ollama models", { context: "plugin.getAvailableModels", count: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Ollama models", { context: "plugin.getAvailableModels", baseUrl: url }, error instanceof Error ? error : void 0);
      return [];
    }
  },
  /**
   * Validate Ollama server connection
   * Ollama doesn't use API keys, just verifies server is reachable
   */
  validateApiKey: async (apiKey, baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    logger.debug("Validating Ollama server", { context: "plugin.validateApiKey", baseUrl: url });
    try {
      const provider = new OllamaProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("Ollama server validation result", { context: "plugin.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Error validating Ollama server", { context: "plugin.validateApiKey", baseUrl: url }, error instanceof Error ? error : void 0);
      return false;
    }
  },
  /**
   * Get static model information
   * Returns cached information about common Ollama models
   */
  getModelInfo: () => {
    return [
      {
        id: "llama2",
        name: "Llama 2",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false
      },
      {
        id: "neural-chat",
        name: "Neural Chat",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false
      },
      {
        id: "mistral",
        name: "Mistral",
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false
      },
      {
        id: "llava",
        name: "LLaVA (Vision)",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: true,
        supportsTools: false
      },
      {
        id: "dolphin-mixtral",
        name: "Dolphin Mixtral",
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: false
      }
    ];
  },
  /**
   * Get embedding models supported by Ollama
   * Returns static information about available embedding models
   */
  getEmbeddingModels: () => {
    logger.debug("Getting Ollama embedding models", { context: "plugin.getEmbeddingModels" });
    return [
      {
        id: "nomic-embed-text",
        name: "Nomic Embed Text",
        dimensions: 768,
        description: "High-quality open embedding model. Good balance of speed and accuracy."
      },
      {
        id: "mxbai-embed-large",
        name: "MixedBread Embed Large",
        dimensions: 1024,
        description: "Large embedding model with excellent performance."
      },
      {
        id: "all-minilm",
        name: "All MiniLM",
        dimensions: 384,
        description: "Fast and lightweight. Good for quick semantic search."
      },
      {
        id: "snowflake-arctic-embed",
        name: "Snowflake Arctic Embed",
        dimensions: 1024,
        description: "State-of-the-art retrieval embedding model."
      }
    ];
  },
  /**
   * Render the Ollama icon
   */
  renderIcon: (props) => {
    logger.debug("Rendering Ollama icon", { context: "plugin.renderIcon", className: props.className });
    return OllamaIcon(props);
  },
  /**
   * Format tools from OpenAI format to OpenAI format
   * Ollama uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for Ollama provider", {
      context: "plugin.formatTools",
      toolCount: tools.length
    });
    try {
      const formattedTools = [];
      for (const tool of tools) {
        if (!("function" in tool)) {
          logger.warn("Skipping tool with invalid format", {
            context: "plugin.formatTools"
          });
          continue;
        }
        formattedTools.push(tool);
      }
      logger.debug("Successfully formatted tools", {
        context: "plugin.formatTools",
        count: formattedTools.length
      });
      return formattedTools;
    } catch (error) {
      logger.error(
        "Error formatting tools for Ollama",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from Ollama response format
   * Extracts tool calls from Ollama API responses (OpenAI format)
   *
   * @param response Ollama API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    logger.debug("Parsing tool calls from Ollama response", {
      context: "plugin.parseToolCalls"
    });
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      logger.debug("Successfully parsed tool calls", {
        context: "plugin.parseToolCalls",
        count: toolCalls.length
      });
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from Ollama response",
        { context: "plugin.parseToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  }
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
