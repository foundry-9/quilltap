"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/dist/qtap-plugin-openai-compatible/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// plugins/dist/qtap-plugin-openai-compatible/provider.ts
var import_openai = __toESM(require("openai"));

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

// plugins/dist/qtap-plugin-openai-compatible/provider.ts
var OpenAICompatibleProvider = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.supportsFileAttachments = false;
    // Varies by implementation, conservative default
    this.supportedMimeTypes = [];
    this.supportsImageGeneration = false;
    this.supportsWebSearch = false;
    logger.debug("OpenAI-compatible provider instantiated", { context: "OpenAICompatibleProvider.constructor", baseUrl });
  }
  // Helper to collect attachment failures
  collectAttachmentFailures(params) {
    const failed = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: "OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)"
          });
        }
      }
    }
    return { sent: [], failed };
  }
  async sendMessage(params, apiKey) {
    logger.debug("OpenAI-compatible sendMessage called", {
      context: "OpenAICompatibleProvider.sendMessage",
      model: params.model,
      baseUrl: this.baseUrl
    });
    const attachmentResults = this.collectAttachmentFailures(params);
    const client = new import_openai.default({
      apiKey: apiKey || "not-needed",
      // Some compatible APIs don't require keys
      baseURL: this.baseUrl
    });
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    try {
      const response = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1e3,
        top_p: params.topP ?? 1,
        stop: params.stop
      });
      const choice = response.choices[0];
      logger.debug("Received OpenAI-compatible response", {
        context: "OpenAICompatibleProvider.sendMessage",
        finishReason: choice.finish_reason,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens
      });
      return {
        content: choice.message.content ?? "",
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0
        },
        raw: response,
        attachmentResults
      };
    } catch (error) {
      logger.error(
        "OpenAI-compatible API error in sendMessage",
        { context: "OpenAICompatibleProvider.sendMessage", baseUrl: this.baseUrl },
        error instanceof Error ? error : void 0
      );
      throw error;
    }
  }
  async *streamMessage(params, apiKey) {
    logger.debug("OpenAI-compatible streamMessage called", {
      context: "OpenAICompatibleProvider.streamMessage",
      model: params.model,
      baseUrl: this.baseUrl
    });
    const attachmentResults = this.collectAttachmentFailures(params);
    const client = new import_openai.default({
      apiKey: apiKey || "not-needed",
      baseURL: this.baseUrl
    });
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    try {
      const stream = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1e3,
        top_p: params.topP ?? 1,
        stream: true,
        stream_options: { include_usage: true }
      });
      let chunkCount = 0;
      for await (const chunk of stream) {
        chunkCount++;
        const content = chunk.choices[0]?.delta?.content;
        const finishReason = chunk.choices[0]?.finish_reason;
        const hasUsage = chunk.usage;
        if (content && !(finishReason && hasUsage)) {
          yield {
            content,
            done: false
          };
        }
        if (finishReason && hasUsage) {
          logger.debug("Stream completed", {
            context: "OpenAICompatibleProvider.streamMessage",
            finishReason,
            chunks: chunkCount,
            promptTokens: chunk.usage?.prompt_tokens,
            completionTokens: chunk.usage?.completion_tokens
          });
          yield {
            content: "",
            done: true,
            usage: {
              promptTokens: chunk.usage?.prompt_tokens ?? 0,
              completionTokens: chunk.usage?.completion_tokens ?? 0,
              totalTokens: chunk.usage?.total_tokens ?? 0
            },
            attachmentResults
          };
        }
      }
    } catch (error) {
      logger.error(
        "OpenAI-compatible API error in streamMessage",
        { context: "OpenAICompatibleProvider.streamMessage", baseUrl: this.baseUrl },
        error instanceof Error ? error : void 0
      );
      throw error;
    }
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating OpenAI-compatible API connection", {
        context: "OpenAICompatibleProvider.validateApiKey",
        baseUrl: this.baseUrl
      });
      const client = new import_openai.default({
        apiKey: apiKey || "not-needed",
        baseURL: this.baseUrl
      });
      await client.models.list();
      logger.debug("OpenAI-compatible API validation successful", {
        context: "OpenAICompatibleProvider.validateApiKey"
      });
      return true;
    } catch (error) {
      logger.error(
        "OpenAI-compatible API validation failed",
        { context: "OpenAICompatibleProvider.validateApiKey", baseUrl: this.baseUrl },
        error instanceof Error ? error : void 0
      );
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    try {
      logger.debug("Fetching OpenAI-compatible models", {
        context: "OpenAICompatibleProvider.getAvailableModels",
        baseUrl: this.baseUrl
      });
      const client = new import_openai.default({
        apiKey: apiKey || "not-needed",
        baseURL: this.baseUrl
      });
      const models = await client.models.list();
      const modelList = models.data.map((m) => m.id).sort();
      logger.debug("Retrieved OpenAI-compatible models", {
        context: "OpenAICompatibleProvider.getAvailableModels",
        modelCount: modelList.length
      });
      return modelList;
    } catch (error) {
      logger.error(
        "Failed to fetch OpenAI-compatible models",
        { context: "OpenAICompatibleProvider.getAvailableModels", baseUrl: this.baseUrl },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  }
  async generateImage(params, apiKey) {
    throw new Error("OpenAI-compatible image generation support varies by implementation (not yet implemented)");
  }
};

// plugins/dist/qtap-plugin-openai-compatible/icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function OpenAICompatibleIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-slate-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "openai-compatible-icon",
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
            children: "OAC"
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

// plugins/dist/qtap-plugin-openai-compatible/index.ts
var metadata = {
  providerName: "OPENAI_COMPATIBLE",
  displayName: "OpenAI-Compatible",
  description: "OpenAI-compatible API provider for local and remote LLM services",
  colors: {
    bg: "bg-slate-100",
    text: "text-slate-800",
    icon: "text-slate-600"
  },
  abbreviation: "OAC"
};
var config = {
  requiresApiKey: false,
  requiresBaseUrl: true,
  apiKeyLabel: "API Key (optional)",
  baseUrlLabel: "Base URL",
  baseUrlPlaceholder: "http://localhost:8080/v1",
  baseUrlDefault: "http://localhost:8080/v1"
};
var capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: false,
  webSearch: false
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "File attachments are not supported. Attachment support varies by implementation.",
  notes: "Some compatible implementations may support attachments; this is a conservative default."
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create an OpenAI-compatible LLM provider instance
   * IMPORTANT: baseUrl is REQUIRED for this provider
   */
  createProvider: (baseUrl) => {
    if (!baseUrl) {
      const defaultUrl = "http://localhost:8080/v1";
      logger.warn("No baseUrl provided for OpenAI-compatible provider, using default", {
        context: "plugin.createProvider",
        defaultUrl
      });
    }
    const url = baseUrl || "http://localhost:8080/v1";
    logger.debug("Creating OpenAI-compatible provider instance", {
      context: "plugin.createProvider",
      baseUrl: url
    });
    return new OpenAICompatibleProvider(url);
  },
  /**
   * Get list of available models from the compatible API
   * Requires a valid base URL and optional API key
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available OpenAI-compatible models", {
      context: "plugin.getAvailableModels",
      baseUrl
    });
    try {
      const url = baseUrl || "http://localhost:8080/v1";
      const provider = new OpenAICompatibleProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched OpenAI-compatible models", {
        context: "plugin.getAvailableModels",
        count: models.length
      });
      return models;
    } catch (error) {
      logger.error(
        "Failed to fetch OpenAI-compatible models",
        { context: "plugin.getAvailableModels", baseUrl },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Validate an OpenAI-compatible API connection
   */
  validateApiKey: async (apiKey, baseUrl) => {
    logger.debug("Validating OpenAI-compatible API connection", {
      context: "plugin.validateApiKey",
      baseUrl
    });
    try {
      const url = baseUrl || "http://localhost:8080/v1";
      const provider = new OpenAICompatibleProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("OpenAI-compatible API validation result", {
        context: "plugin.validateApiKey",
        isValid
      });
      return isValid;
    } catch (error) {
      logger.error(
        "Error validating OpenAI-compatible API connection",
        { context: "plugin.validateApiKey", baseUrl },
        error instanceof Error ? error : void 0
      );
      return false;
    }
  },
  /**
   * Get static model information
   * Returns generic information applicable to most compatible implementations
   */
  getModelInfo: () => {
    return [
      {
        id: "default",
        name: "Default Model",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false
      }
    ];
  },
  /**
   * Render the OpenAI-compatible icon
   */
  renderIcon: (props) => {
    logger.debug("Rendering OpenAI-compatible icon", {
      context: "plugin.renderIcon",
      className: props.className
    });
    return OpenAICompatibleIcon(props);
  },
  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenAI-compatible providers use OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for OpenAI-compatible provider", {
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
        "Error formatting tools for OpenAI-compatible",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from OpenAI-compatible response format
   * Extracts tool calls from OpenAI-compatible API responses (OpenAI format)
   *
   * @param response OpenAI-compatible API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    logger.debug("Parsing tool calls from OpenAI-compatible response", {
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
        "Error parsing tool calls from OpenAI-compatible response",
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
