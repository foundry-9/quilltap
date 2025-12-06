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

// plugins/dist/qtap-plugin-openai/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// plugins/dist/qtap-plugin-openai/provider.ts
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
  // Database (legacy - no longer used, MongoDB is required)
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
  // NOTE: 'json' option is deprecated and will be removed in a future version.
  // Use the migration plugin (qtap-plugin-upgrade) to migrate JSON data to MongoDB.
  DATA_BACKEND: import_zod.z.enum(["json", "mongodb"]).optional().default("mongodb"),
  // MongoDB Configuration (required - MongoDB is the default data backend)
  MONGODB_URI: import_zod.z.string().min(1, "MONGODB_URI is required for MongoDB backend"),
  MONGODB_DATABASE: import_zod.z.string().optional().default("quilltap"),
  MONGODB_MODE: import_zod.z.enum(["external", "embedded"]).optional().default("external"),
  MONGODB_DATA_DIR: import_zod.z.string().optional().default("/data/mongodb"),
  MONGODB_CONNECTION_TIMEOUT_MS: import_zod.z.string().regex(/^\d+$/).optional(),
  MONGODB_MAX_POOL_SIZE: import_zod.z.string().regex(/^\d+$/).optional(),
  // S3 Configuration (required - S3 is the only supported file storage backend)
  // NOTE: 'disabled' option is deprecated and will be removed in a future version.
  // Use the migration plugin (qtap-plugin-upgrade) to migrate local files to S3.
  S3_MODE: import_zod.z.enum(["embedded", "external", "disabled"]).optional().default("embedded"),
  S3_ENDPOINT: import_zod.z.string().url().optional(),
  S3_REGION: import_zod.z.string().optional().default("us-east-1"),
  S3_ACCESS_KEY: import_zod.z.string().optional(),
  S3_SECRET_KEY: import_zod.z.string().optional(),
  S3_BUCKET: import_zod.z.string().optional().default("quilltap-files"),
  S3_PATH_PREFIX: import_zod.z.string().optional(),
  S3_PUBLIC_URL: import_zod.z.string().url().optional(),
  S3_FORCE_PATH_STYLE: import_zod.z.enum(["true", "false"]).optional()
}).refine(
  (data) => {
    if (data.DATA_BACKEND === "mongodb" && !data.MONGODB_URI) {
      return false;
    }
    return true;
  },
  {
    message: "MONGODB_URI is required when DATA_BACKEND is mongodb",
    path: ["MONGODB_URI"]
  }
).refine(
  (data) => {
    if (data.S3_MODE === "external") {
      if (!data.S3_ENDPOINT || !data.S3_ACCESS_KEY || !data.S3_SECRET_KEY) {
        return false;
      }
    }
    return true;
  },
  {
    message: "S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY are required when S3_MODE is external",
    path: ["S3_MODE"]
  }
);
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

// plugins/dist/qtap-plugin-openai/provider.ts
var OPENAI_SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
];
var OpenAIProvider = class {
  constructor() {
    this.supportsFileAttachments = true;
    this.supportedMimeTypes = OPENAI_SUPPORTED_MIME_TYPES;
    this.supportsImageGeneration = true;
    this.supportsWebSearch = true;
  }
  formatMessagesWithAttachments(messages) {
    const sent = [];
    const failed = [];
    const formattedMessages = messages.map((msg) => {
      if (!msg.attachments || msg.attachments.length === 0) {
        return {
          role: msg.role,
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
            error: `Unsupported file type: ${attachment.mimeType}. OpenAI supports: ${this.supportedMimeTypes.join(", ")}`
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
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
            detail: "auto"
          }
        });
        sent.push(attachment.id);
      }
      return {
        role: msg.role,
        content: content.length > 0 ? content : msg.content
      };
    });
    return { messages: formattedMessages, attachmentResults: { sent, failed } };
  }
  async sendMessage(params, apiKey) {
    logger.debug("OpenAI sendMessage called", { context: "OpenAIProvider.sendMessage", model: params.model });
    const client = new import_openai.default({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === "test"
    });
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);
    const requestParams = {
      model: params.model,
      messages,
      max_completion_tokens: params.maxTokens ?? 1e3,
      top_p: params.topP ?? 1,
      stop: params.stop
    };
    if (params.temperature !== void 0) {
      requestParams.temperature = params.temperature;
    }
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to request", { context: "OpenAIProvider.sendMessage", toolCount: params.tools.length });
      requestParams.tools = params.tools;
      requestParams.tool_choice = "auto";
    }
    if (params.webSearchEnabled) {
      logger.debug("Web search enabled", { context: "OpenAIProvider.sendMessage" });
      requestParams.web_search_options = {};
    }
    const response = await client.chat.completions.create(requestParams);
    const choice = response.choices[0];
    logger.debug("Received OpenAI response", {
      context: "OpenAIProvider.sendMessage",
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
  }
  async *streamMessage(params, apiKey) {
    logger.debug("OpenAI streamMessage called", { context: "OpenAIProvider.streamMessage", model: params.model });
    const client = new import_openai.default({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === "test"
    });
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);
    const requestParams = {
      model: params.model,
      messages,
      max_completion_tokens: params.maxTokens ?? 1e3,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true }
    };
    if (params.temperature !== void 0) {
      requestParams.temperature = params.temperature;
    }
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to stream request", { context: "OpenAIProvider.streamMessage", toolCount: params.tools.length });
      requestParams.tools = params.tools;
      requestParams.tool_choice = "auto";
    }
    if (params.webSearchEnabled) {
      logger.debug("Web search enabled for stream", { context: "OpenAIProvider.streamMessage" });
      requestParams.web_search_options = {};
    }
    const stream = await client.chat.completions.create(requestParams);
    let fullMessage = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: []
          },
          finish_reason: null
        }
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
    let chunkCount = 0;
    let finishReasonSeen = false;
    let usageSeen = false;
    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices?.[0]?.delta;
      const content = delta?.content;
      const finishReason = chunk.choices[0]?.finish_reason;
      const hasUsage = chunk.usage;
      if (content) {
        fullMessage.choices[0].message.content += content;
      }
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index ?? 0;
          if (!fullMessage.choices[0].message.tool_calls[index]) {
            fullMessage.choices[0].message.tool_calls[index] = {
              id: "",
              type: "function",
              function: { name: "", arguments: "" }
            };
          }
          if (toolCall.id) fullMessage.choices[0].message.tool_calls[index].id = toolCall.id;
          if (toolCall.function?.name) fullMessage.choices[0].message.tool_calls[index].function.name = toolCall.function.name;
          if (toolCall.function?.arguments) fullMessage.choices[0].message.tool_calls[index].function.arguments += toolCall.function.arguments;
        }
      }
      if (finishReason) {
        fullMessage.choices[0].finish_reason = finishReason;
        finishReasonSeen = true;
      }
      if (hasUsage) {
        fullMessage.usage = chunk.usage;
        usageSeen = true;
      }
      const isFinalChunk = finishReasonSeen && usageSeen;
      const isToolCallsChunk = finishReasonSeen && finishReason === "tool_calls";
      if (content && !isFinalChunk && !isToolCallsChunk) {
        yield {
          content,
          done: false
        };
      }
      if (finishReasonSeen && finishReason === "tool_calls" && !usageSeen) {
        logger.debug("Tool calls detected in stream", { context: "OpenAIProvider.streamMessage", toolCallCount: fullMessage.choices[0].message.tool_calls.length });
        yield {
          content: "",
          done: true,
          usage: {
            promptTokens: fullMessage.usage?.prompt_tokens ?? 0,
            completionTokens: fullMessage.usage?.completion_tokens ?? 0,
            totalTokens: fullMessage.usage?.total_tokens ?? 0
          },
          attachmentResults,
          rawResponse: fullMessage
        };
      } else if (finishReasonSeen && usageSeen) {
        logger.debug("Stream completed", {
          context: "OpenAIProvider.streamMessage",
          finishReason,
          chunks: chunkCount,
          promptTokens: fullMessage.usage?.prompt_tokens,
          completionTokens: fullMessage.usage?.completion_tokens
        });
        yield {
          content: "",
          done: true,
          usage: {
            promptTokens: fullMessage.usage?.prompt_tokens ?? 0,
            completionTokens: fullMessage.usage?.completion_tokens ?? 0,
            totalTokens: fullMessage.usage?.total_tokens ?? 0
          },
          attachmentResults,
          rawResponse: fullMessage
        };
      }
    }
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating OpenAI API key", { context: "OpenAIProvider.validateApiKey" });
      const client = new import_openai.default({ apiKey });
      await client.models.list();
      logger.debug("OpenAI API key validation successful", { context: "OpenAIProvider.validateApiKey" });
      return true;
    } catch (error) {
      logger.error("OpenAI API key validation failed", { context: "OpenAIProvider.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    try {
      logger.debug("Fetching OpenAI models", { context: "OpenAIProvider.getAvailableModels" });
      const client = new import_openai.default({ apiKey });
      const models = await client.models.list();
      const gptModels = models.data.filter((m) => m.id.includes("gpt")).map((m) => m.id).sort();
      logger.debug("Retrieved OpenAI models", { context: "OpenAIProvider.getAvailableModels", modelCount: gptModels.length });
      return gptModels;
    } catch (error) {
      logger.error("Failed to fetch OpenAI models", { context: "OpenAIProvider.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  }
  async generateImage(params, apiKey) {
    logger.debug("Generating image with OpenAI", { context: "OpenAIProvider.generateImage", model: params.model, prompt: params.prompt.substring(0, 100) });
    const client = new import_openai.default({ apiKey });
    const response = await client.images.generate({
      model: params.model ?? "dall-e-3",
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? "1024x1024",
      quality: params.quality ?? "standard",
      style: params.style ?? "vivid",
      response_format: "b64_json"
    });
    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error("No base64 image data in response");
        }
        return {
          data: image.b64_json,
          mimeType: "image/png",
          revisedPrompt: image.revised_prompt
        };
      })
    );
    logger.debug("Image generation completed", { context: "OpenAIProvider.generateImage", imageCount: images.length });
    return {
      images,
      raw: response
    };
  }
};

// plugins/dist/qtap-plugin-openai/image-provider.ts
var import_openai2 = __toESM(require("openai"));
var OpenAIImageProvider = class {
  constructor() {
    this.provider = "OPENAI";
    this.supportedModels = ["gpt-image-1", "dall-e-3", "dall-e-2"];
  }
  /**
   * Validate and normalize size for OpenAI API
   * gpt-image-1: 1024x1024, 1024x1536, 1536x1024, auto
   * dall-e-3: 1024x1024, 1024x1792, 1792x1024
   * dall-e-2: 256x256, 512x512, 1024x1024
   */
  validateAndNormalizeSize(size, model) {
    if (!size) {
      return "1024x1024";
    }
    const isGptImage = model === "gpt-image-1";
    if (isGptImage) {
      const gptImageSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
      if (gptImageSizes.includes(size)) {
        return size;
      }
      logger.debug("Normalizing size for gpt-image-1", { context: "OpenAIImageProvider.validateAndNormalizeSize", originalSize: size, normalizedSize: "1024x1024" });
      return "1024x1024";
    }
    if (model === "dall-e-3") {
      const dalleThreeSizes = ["1024x1024", "1024x1792", "1792x1024"];
      if (dalleThreeSizes.includes(size)) {
        return size;
      }
      logger.debug("Normalizing size for dall-e-3", { context: "OpenAIImageProvider.validateAndNormalizeSize", originalSize: size, normalizedSize: "1024x1024" });
      return "1024x1024";
    }
    const dalleTwoSizes = ["256x256", "512x512", "1024x1024"];
    if (dalleTwoSizes.includes(size)) {
      return size;
    }
    logger.debug("Normalizing size for dall-e-2", { context: "OpenAIImageProvider.validateAndNormalizeSize", originalSize: size, normalizedSize: "1024x1024" });
    return "1024x1024";
  }
  async generateImage(params, apiKey) {
    logger.debug("OpenAI image generation started", {
      context: "OpenAIImageProvider.generateImage",
      model: params.model,
      promptLength: params.prompt.length,
      n: params.n ?? 1
    });
    const client = new import_openai2.default({ apiKey });
    const isGptImage = params.model === "gpt-image-1";
    const requestParams = {
      model: params.model,
      prompt: params.prompt,
      n: params.n ?? 1
    };
    if (!isGptImage) {
      requestParams.response_format = "b64_json";
    }
    const modelName = params.model ?? "dall-e-3";
    requestParams.size = this.validateAndNormalizeSize(params.size, modelName);
    if (!isGptImage) {
      requestParams.quality = params.quality ?? "standard";
      requestParams.style = params.style ?? "vivid";
      logger.debug("Applied DALL-E specific parameters", {
        context: "OpenAIImageProvider.generateImage",
        quality: requestParams.quality,
        style: requestParams.style
      });
    }
    const response = await client.images.generate(requestParams);
    if (!response.data || !Array.isArray(response.data)) {
      logger.error("Invalid response from OpenAI Images API", { context: "OpenAIImageProvider.generateImage" });
      throw new Error("Invalid response from OpenAI Images API");
    }
    logger.debug("Image generation completed", {
      context: "OpenAIImageProvider.generateImage",
      imageCount: response.data.length
    });
    return {
      images: response.data.map((img) => ({
        // gpt-image-1 returns urls, DALL-E models return b64_json
        data: img.b64_json || img.url || "",
        mimeType: "image/png",
        revisedPrompt: img.revised_prompt
      })),
      raw: response
    };
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating OpenAI API key for image generation", { context: "OpenAIImageProvider.validateApiKey" });
      const client = new import_openai2.default({ apiKey });
      await client.models.list();
      logger.debug("OpenAI API key validation successful", { context: "OpenAIImageProvider.validateApiKey" });
      return true;
    } catch (error) {
      logger.error("OpenAI API key validation failed for image generation", { context: "OpenAIImageProvider.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels() {
    logger.debug("Getting available OpenAI image models", { context: "OpenAIImageProvider.getAvailableModels" });
    return this.supportedModels;
  }
};

// plugins/dist/qtap-plugin-openai/icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function OpenAIIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-green-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "openai-icon",
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
            children: "OAI"
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

// plugins/dist/qtap-plugin-openai/index.ts
var metadata = {
  providerName: "OPENAI",
  displayName: "OpenAI",
  description: "OpenAI GPT models including GPT-4o and DALL-E image generation",
  colors: {
    bg: "bg-green-100",
    text: "text-green-800",
    icon: "text-green-600"
  },
  abbreviation: "OAI"
};
var config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: "OpenAI API Key"
};
var capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: false,
  webSearch: true
};
var attachmentSupport = {
  supportsAttachments: true,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  description: "Images only (JPEG, PNG, GIF, WebP)",
  notes: "Images are supported in vision-capable models like GPT-4V and GPT-4o"
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create an OpenAI LLM provider instance
   */
  createProvider: (baseUrl) => {
    logger.debug("Creating OpenAI provider instance", { context: "plugin.createProvider", baseUrl });
    return new OpenAIProvider();
  },
  /**
   * Factory method to create an OpenAI image generation provider instance
   */
  createImageProvider: (baseUrl) => {
    logger.debug("Creating OpenAI image provider instance", { context: "plugin.createImageProvider", baseUrl });
    return new OpenAIImageProvider();
  },
  /**
   * Get list of available models from OpenAI API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available OpenAI models", { context: "plugin.getAvailableModels" });
    try {
      const provider = new OpenAIProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched OpenAI models", { context: "plugin.getAvailableModels", count: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch OpenAI models", { context: "plugin.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  },
  /**
   * Validate an OpenAI API key
   */
  validateApiKey: async (apiKey, baseUrl) => {
    logger.debug("Validating OpenAI API key", { context: "plugin.validateApiKey" });
    try {
      const provider = new OpenAIProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("OpenAI API key validation result", { context: "plugin.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Error validating OpenAI API key", { context: "plugin.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  },
  /**
   * Get static model information
   * Returns cached information about OpenAI models without needing API calls
   */
  getModelInfo: () => {
    return [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        contextWindow: 128e3,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        contextWindow: 128e3,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gpt-4",
        name: "GPT-4",
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: true
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: true
      }
    ];
  },
  /**
   * Get embedding models supported by OpenAI
   * Returns cached information about available embedding models
   */
  getEmbeddingModels: () => {
    logger.debug("Getting OpenAI embedding models", { context: "plugin.getEmbeddingModels" });
    return [
      {
        id: "text-embedding-3-small",
        name: "Text Embedding 3 Small",
        dimensions: 1536,
        description: "Smaller, faster, and cheaper. Good for most use cases."
      },
      {
        id: "text-embedding-3-large",
        name: "Text Embedding 3 Large",
        dimensions: 3072,
        description: "Larger model with higher accuracy for complex tasks."
      },
      {
        id: "text-embedding-ada-002",
        name: "Text Embedding Ada 002",
        dimensions: 1536,
        description: "Legacy model. Consider using text-embedding-3-small instead."
      }
    ];
  },
  /**
   * Render the OpenAI icon
   */
  renderIcon: (props) => {
    logger.debug("Rendering OpenAI icon", { context: "plugin.renderIcon", className: props.className });
    return OpenAIIcon(props);
  },
  /**
   * Format tools from OpenAI format to OpenAI format
   * Tools pass through as-is since OpenAI is the universal format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for OpenAI provider", {
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
        "Error formatting tools for OpenAI",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from OpenAI response format
   * Extracts tool calls from OpenAI API responses
   *
   * @param response OpenAI API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    logger.debug("Parsing tool calls from OpenAI response", {
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
        "Error parsing tool calls from OpenAI response",
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
