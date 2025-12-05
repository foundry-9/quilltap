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

// plugins/dist/qtap-plugin-anthropic/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// plugins/dist/qtap-plugin-anthropic/provider.ts
var import_sdk = __toESM(require("@anthropic-ai/sdk"));

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

// plugins/dist/qtap-plugin-anthropic/provider.ts
var ANTHROPIC_SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf"
];
var AnthropicProvider = class {
  constructor() {
    this.supportsFileAttachments = true;
    this.supportedMimeTypes = ANTHROPIC_SUPPORTED_MIME_TYPES;
    this.supportsImageGeneration = false;
    this.supportsWebSearch = false;
  }
  formatMessagesWithAttachments(messages) {
    const sent = [];
    const failed = [];
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    const formattedMessages = nonSystemMessages.map((msg) => {
      const role = msg.role === "user" ? "user" : "assistant";
      if (!msg.attachments || msg.attachments.length === 0) {
        return {
          role,
          content: msg.content
        };
      }
      const content = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Anthropic supports: ${this.supportedMimeTypes.join(", ")}`
          });
          continue;
        }
        if (!attachment.data) {
          failed.push({
            id: attachment.id,
            error: "File data not loaded"
          });
          continue;
        }
        if (attachment.mimeType === "application/pdf") {
          content.push({
            type: "document",
            source: {
              type: "base64",
              media_type: attachment.mimeType,
              data: attachment.data
            }
          });
        } else {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: attachment.mimeType,
              data: attachment.data
            }
          });
        }
        sent.push(attachment.id);
      }
      return {
        role,
        content: content.length > 0 ? content : msg.content
      };
    });
    return { messages: formattedMessages, attachmentResults: { sent, failed } };
  }
  async sendMessage(params, apiKey) {
    logger.debug("Anthropic sendMessage called", { context: "AnthropicProvider.sendMessage", model: params.model });
    const client = new import_sdk.default({ apiKey });
    const systemMessage = params.messages.find((m) => m.role === "system");
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);
    const requestParams = {
      model: params.model,
      system: systemMessage?.content,
      messages,
      max_tokens: params.maxTokens ?? 1e3
    };
    if (params.temperature !== void 0) {
      requestParams.temperature = params.temperature;
    } else if (params.topP !== void 0) {
      requestParams.top_p = params.topP;
    } else {
      requestParams.temperature = 1;
    }
    const tools = params.tools ? [...params.tools] : [];
    if (tools.length > 0) {
      logger.debug("Adding tools to request", { context: "AnthropicProvider.sendMessage", toolCount: tools.length });
      requestParams.tools = tools;
    }
    const response = await client.messages.create(requestParams);
    logger.debug("Received Anthropic response", {
      context: "AnthropicProvider.sendMessage",
      finishReason: response.stop_reason,
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens
    });
    const content = response.content[0];
    return {
      content: content.type === "text" ? content.text : "",
      finishReason: response.stop_reason ?? "stop",
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      },
      raw: response,
      attachmentResults
    };
  }
  async *streamMessage(params, apiKey) {
    logger.debug("Anthropic streamMessage called", { context: "AnthropicProvider.streamMessage", model: params.model });
    const client = new import_sdk.default({ apiKey });
    const systemMessage = params.messages.find((m) => m.role === "system");
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);
    const requestParams = {
      model: params.model,
      system: systemMessage?.content,
      messages,
      max_tokens: params.maxTokens ?? 1e3,
      stream: true
    };
    if (params.temperature !== void 0) {
      requestParams.temperature = params.temperature;
    } else if (params.topP !== void 0) {
      requestParams.top_p = params.topP;
    } else {
      requestParams.temperature = 1;
    }
    const tools = params.tools ? [...params.tools] : [];
    if (tools.length > 0) {
      logger.debug("Adding tools to stream request", { context: "AnthropicProvider.streamMessage", toolCount: tools.length });
      requestParams.tools = tools;
    }
    const stream = await client.messages.create(requestParams);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fullContent = "";
    let stopReason = null;
    let messageId = null;
    let model = null;
    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && event.delta?.text) {
          logger.debug("Stream text delta", { context: "AnthropicProvider.streamMessage", textLength: event.delta.text.length });
          fullContent += event.delta.text;
          yield {
            content: event.delta.text,
            done: false
          };
        }
      }
      if (event.type === "message_start") {
        totalInputTokens = event.message.usage.input_tokens;
        messageId = event.message.id;
        model = event.message.model;
      }
      if (event.type === "message_delta") {
        totalOutputTokens = event.usage.output_tokens;
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
      }
      if (event.type === "message_stop") {
        logger.debug("Stream completed", {
          context: "AnthropicProvider.streamMessage",
          promptTokens: totalInputTokens,
          completionTokens: totalOutputTokens
        });
        const fullMessage = {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: fullContent }],
          model,
          stop_reason: stopReason,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens
          }
        };
        yield {
          content: "",
          done: true,
          usage: {
            promptTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens
          },
          attachmentResults,
          rawResponse: fullMessage
        };
      }
    }
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating Anthropic API key", { context: "AnthropicProvider.validateApiKey" });
      const client = new import_sdk.default({ apiKey });
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }]
      });
      logger.debug("Anthropic API key validation successful", { context: "AnthropicProvider.validateApiKey" });
      return true;
    } catch (error) {
      logger.error("Anthropic API key validation failed", { context: "AnthropicProvider.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    logger.debug("Fetching Anthropic models", { context: "AnthropicProvider.getAvailableModels" });
    const models = [
      // Claude 4.5 models (latest)
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      // Claude 4 models
      "claude-opus-4-1-20250805",
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      // Claude 3 models (legacy, will be retired)
      "claude-3-opus-20240229",
      // Retiring Jan 5, 2026
      "claude-3-haiku-20240307"
    ];
    logger.debug("Retrieved Anthropic models", { context: "AnthropicProvider.getAvailableModels", modelCount: models.length });
    return models;
  }
  async generateImage(params, apiKey) {
    logger.error("Image generation not supported by Anthropic", { context: "AnthropicProvider.generateImage" });
    throw new Error("Anthropic does not support image generation. Claude can analyze images but cannot generate them.");
  }
};

// plugins/dist/qtap-plugin-anthropic/icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function AnthropicIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-purple-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "anthropic-icon",
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
            fontSize: "10",
            fontWeight: "bold",
            fontFamily: "system-ui, -apple-system, sans-serif",
            children: "ANT"
          }
        )
      ]
    }
  );
}

// lib/llm/tool-formatting-utils.ts
function convertOpenAIToAnthropicFormat(tool) {
  logger.debug("Converting tool to Anthropic format", {
    context: "tool-formatting",
    toolName: tool.function.name
  });
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: "object",
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required
    }
  };
}
function parseAnthropicToolCalls(response) {
  const toolCalls = [];
  try {
    if (!response?.content || !Array.isArray(response.content)) {
      return toolCalls;
    }
    for (const block of response.content) {
      if (block.type === "tool_use") {
        logger.debug("Parsed Anthropic tool call", {
          context: "tool-parsing",
          toolName: block.name
        });
        toolCalls.push({
          name: block.name,
          arguments: block.input || {}
        });
      }
    }
  } catch (error) {
    logger.error("Error parsing Anthropic tool calls", { context: "tool-parsing" }, error instanceof Error ? error : void 0);
  }
  return toolCalls;
}

// plugins/dist/qtap-plugin-anthropic/index.ts
var metadata = {
  providerName: "ANTHROPIC",
  displayName: "Anthropic",
  description: "Anthropic Claude models with support for image and PDF analysis",
  colors: {
    bg: "bg-purple-100",
    text: "text-purple-800",
    icon: "text-purple-600"
  },
  abbreviation: "ANT"
};
var config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: "Anthropic API Key"
};
var capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: false,
  webSearch: false
};
var attachmentSupport = {
  supportsAttachments: true,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
  description: "Images (JPEG, PNG, GIF, WebP) and PDFs",
  notes: "Images and PDFs are supported in Claude models for analysis and understanding"
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create an Anthropic LLM provider instance
   */
  createProvider: (baseUrl) => {
    logger.debug("Creating Anthropic provider instance", { context: "plugin.createProvider", baseUrl });
    return new AnthropicProvider();
  },
  /**
   * Get list of available models from Anthropic
   * Anthropic doesn't provide a models endpoint, so we return known models
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available Anthropic models", { context: "plugin.getAvailableModels" });
    try {
      const provider = new AnthropicProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched Anthropic models", { context: "plugin.getAvailableModels", count: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Anthropic models", { context: "plugin.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  },
  /**
   * Validate an Anthropic API key
   */
  validateApiKey: async (apiKey, baseUrl) => {
    logger.debug("Validating Anthropic API key", { context: "plugin.validateApiKey" });
    try {
      const provider = new AnthropicProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("Anthropic API key validation result", { context: "plugin.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Error validating Anthropic API key", { context: "plugin.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  },
  /**
   * Get static model information
   * Returns cached information about Claude models without needing API calls
   */
  getModelInfo: () => {
    logger.debug("Getting Claude model info", { context: "plugin.getModelInfo" });
    return [
      {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        contextWindow: 2e5,
        maxOutputTokens: 16e3,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        contextWindow: 2e5,
        maxOutputTokens: 16e3,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "claude-opus-4-1-20250805",
        name: "Claude Opus 4.1",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "claude-3-haiku-20240307",
        name: "Claude 3 Haiku",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      }
    ];
  },
  /**
   * Render the Anthropic icon
   */
  renderIcon: (props) => {
    logger.debug("Rendering Anthropic icon", { context: "plugin.renderIcon", className: props.className });
    return AnthropicIcon(props);
  },
  /**
   * Format tools from OpenAI format to Anthropic format
   * Converts tool definitions to Anthropic's tool_use format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in Anthropic format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for Anthropic provider", {
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
        const openaiTool = tool;
        const anthropicTool = convertOpenAIToAnthropicFormat(openaiTool);
        formattedTools.push(anthropicTool);
      }
      logger.debug("Successfully formatted tools", {
        context: "plugin.formatTools",
        count: formattedTools.length
      });
      return formattedTools;
    } catch (error) {
      logger.error(
        "Error formatting tools for Anthropic",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from Anthropic response format
   * Extracts tool use blocks and converts them to standardized ToolCallRequest format
   *
   * @param response Anthropic API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    logger.debug("Parsing tool calls from Anthropic response", {
      context: "plugin.parseToolCalls"
    });
    try {
      const toolCalls = parseAnthropicToolCalls(response);
      logger.debug("Successfully parsed tool calls", {
        context: "plugin.parseToolCalls",
        count: toolCalls.length
      });
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from Anthropic response",
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
