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

// plugins/dist/qtap-plugin-google/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// plugins/dist/qtap-plugin-google/provider.ts
var import_generative_ai = require("@google/generative-ai");

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

// plugins/dist/qtap-plugin-google/provider.ts
var GOOGLE_SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
];
var GoogleProvider = class {
  constructor() {
    this.supportsFileAttachments = true;
    this.supportedMimeTypes = GOOGLE_SUPPORTED_MIME_TYPES;
    this.supportsImageGeneration = true;
    this.supportsWebSearch = true;
  }
  async formatMessagesWithAttachments(messages) {
    logger.debug("Formatting messages with attachments", { context: "GoogleProvider.formatMessagesWithAttachments", messageCount: messages.length });
    const sent = [];
    const failed = [];
    const formattedMessages = [];
    for (const msg of messages) {
      const formattedMessage = {
        role: msg.role === "assistant" ? "model" : "user",
        parts: []
      };
      if (msg.content) {
        formattedMessage.parts.push({ text: msg.content });
      }
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            logger.warn("Unsupported attachment type", {
              context: "GoogleProvider.formatMessagesWithAttachments",
              mimeType: attachment.mimeType
            });
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Google supports: ${this.supportedMimeTypes.join(", ")}`
            });
            continue;
          }
          if (!attachment.data) {
            logger.warn("Attachment data not loaded", {
              context: "GoogleProvider.formatMessagesWithAttachments",
              attachmentId: attachment.id
            });
            failed.push({
              id: attachment.id,
              error: "File data not loaded"
            });
            continue;
          }
          formattedMessage.parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data
            }
          });
          sent.push(attachment.id);
        }
      }
      formattedMessages.push(formattedMessage);
    }
    logger.debug("Messages formatted with attachments", {
      context: "GoogleProvider.formatMessagesWithAttachments",
      sentCount: sent.length,
      failedCount: failed.length
    });
    return { messages: formattedMessages, attachmentResults: { sent, failed } };
  }
  async sendMessage(params, apiKey) {
    logger.debug("Google sendMessage called", { context: "GoogleProvider.sendMessage", model: params.model });
    const client = new import_generative_ai.GoogleGenerativeAI(apiKey);
    const modelConfig = {
      model: params.model,
      safetySettings: [
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        }
      ]
    };
    const tools = [];
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to request", { context: "GoogleProvider.sendMessage", toolCount: params.tools.length });
      tools.push({
        functionDeclarations: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "OBJECT",
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || []
          }
        }))
      });
    }
    if (params.webSearchEnabled) {
      logger.debug("Web search enabled", { context: "GoogleProvider.sendMessage" });
      tools.push({ googleSearch: {} });
    }
    if (tools.length > 0) {
      modelConfig.tools = tools;
    }
    const model = client.getGenerativeModel(modelConfig);
    const { messages, attachmentResults } = await this.formatMessagesWithAttachments(params.messages);
    const response = await model.generateContent({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1e3,
        topP: params.topP ?? 1,
        stopSequences: params.stop
      }
    });
    const text = response.text?.() ?? "";
    const finishReason = response.candidates?.[0]?.finishReason ?? "STOP";
    const usage = response.usageMetadata;
    logger.debug("Received Google response", {
      context: "GoogleProvider.sendMessage",
      finishReason,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount
    });
    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0
      },
      raw: response,
      attachmentResults
    };
  }
  async *streamMessage(params, apiKey) {
    logger.debug("Google streamMessage called", { context: "GoogleProvider.streamMessage", model: params.model });
    const client = new import_generative_ai.GoogleGenerativeAI(apiKey);
    const modelConfig = {
      model: params.model,
      safetySettings: [
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        }
      ]
    };
    const tools = [];
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to stream request", { context: "GoogleProvider.streamMessage", toolCount: params.tools.length });
      tools.push({
        functionDeclarations: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "OBJECT",
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || []
          }
        }))
      });
    }
    if (params.webSearchEnabled) {
      logger.debug("Web search enabled for stream", { context: "GoogleProvider.streamMessage" });
      tools.push({ googleSearch: {} });
    }
    if (tools.length > 0) {
      modelConfig.tools = tools;
    }
    const model = client.getGenerativeModel(modelConfig);
    const { messages, attachmentResults } = await this.formatMessagesWithAttachments(params.messages);
    const stream = await model.generateContentStream({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1e3,
        topP: params.topP ?? 1,
        stopSequences: params.stop
      }
    });
    let chunkCount = 0;
    for await (const chunk of stream.stream) {
      chunkCount++;
      const text = chunk.text?.() ?? "";
      if (text) {
        logger.debug("Received stream chunk", { context: "GoogleProvider.streamMessage", chunkNumber: chunkCount, contentLength: text.length });
        yield {
          content: text,
          done: false
        };
      }
    }
    const response = await stream.response;
    const usage = response.usageMetadata;
    logger.debug("Stream completed", {
      context: "GoogleProvider.streamMessage",
      totalChunks: chunkCount,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount
    });
    yield {
      content: "",
      done: true,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0
      },
      attachmentResults,
      rawResponse: response
    };
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating Google API key", { context: "GoogleProvider.validateApiKey" });
      const client = new import_generative_ai.GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
      await model.generateContent("test");
      logger.debug("Google API key validation successful", { context: "GoogleProvider.validateApiKey" });
      return true;
    } catch (error) {
      logger.error("Google API key validation failed", { context: "GoogleProvider.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    try {
      logger.debug("Fetching Google models", { context: "GoogleProvider.getAvailableModels" });
      const models = [
        "gemini-2.5-flash-image",
        "gemini-3-pro-image-preview",
        "imagen-4",
        "imagen-4-fast",
        "gemini-2.5-flash",
        "gemini-pro-vision"
      ];
      logger.debug("Retrieved Google models", { context: "GoogleProvider.getAvailableModels", modelCount: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Google models", { context: "GoogleProvider.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  }
  async generateImage(params, apiKey) {
    logger.debug("Generating image with Google", {
      context: "GoogleProvider.generateImage",
      model: params.model,
      promptLength: params.prompt.length
    });
    const client = new import_generative_ai.GoogleGenerativeAI(apiKey);
    const modelName = params.model ?? "gemini-2.5-flash-image";
    const model = client.getGenerativeModel({
      model: modelName,
      safetySettings: [
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: import_generative_ai.HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: import_generative_ai.HarmBlockThreshold.BLOCK_NONE
        }
      ]
    });
    const config2 = {
      temperature: 0.7
    };
    if (params.aspectRatio) {
      config2.aspectRatio = params.aspectRatio;
    }
    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: params.prompt }]
        }
      ],
      generationConfig: config2
    });
    const images = [];
    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if ("inlineData" in part && part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png"
          });
        }
      }
    }
    if (images.length === 0) {
      logger.error("No images generated in response", { context: "GoogleProvider.generateImage" });
      throw new Error("No images generated in response");
    }
    logger.debug("Image generation completed", { context: "GoogleProvider.generateImage", imageCount: images.length });
    return {
      images,
      raw: response
    };
  }
};

// plugins/dist/qtap-plugin-google/image-provider.ts
var GoogleImagenProvider = class {
  constructor() {
    this.provider = "GOOGLE";
    this.supportedModels = [
      "imagen-4",
      "imagen-4-fast",
      "gemini-2.5-flash-image",
      "gemini-3-pro-image-preview"
    ];
  }
  async generateImage(params, apiKey) {
    logger.debug("Google Imagen generation started", {
      context: "GoogleImagenProvider.generateImage",
      model: params.model,
      promptLength: params.prompt.length
    });
    const model = params.model ?? "imagen-4";
    const baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = `${baseUrl}/models/${model}:predict`;
    const requestBody = {
      instances: [
        {
          prompt: params.prompt
        }
      ],
      parameters: {
        sampleCount: params.n ?? 1
      }
    };
    if (params.aspectRatio) {
      requestBody.parameters.aspectRatio = params.aspectRatio;
    }
    const extendedParams = params;
    if (extendedParams.seed !== void 0) {
      requestBody.parameters.seed = extendedParams.seed;
    }
    logger.debug("Sending request to Google Imagen API", {
      context: "GoogleImagenProvider.generateImage",
      endpoint,
      sampleCount: requestBody.parameters.sampleCount
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const error = await response.json();
      logger.error("Google Imagen API error", {
        context: "GoogleImagenProvider.generateImage",
        status: response.status,
        errorMessage: error.error?.message
      });
      throw new Error(error.error?.message || `Google Imagen API error: ${response.status}`);
    }
    const data = await response.json();
    logger.debug("Image generation completed", {
      context: "GoogleImagenProvider.generateImage",
      imageCount: data.predictions?.length ?? 0
    });
    return {
      images: (data.predictions ?? []).map((pred) => ({
        data: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || "image/png"
      })),
      raw: data
    };
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating Google API key for image generation", { context: "GoogleImagenProvider.validateApiKey" });
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey
        }
      });
      const isValid = response.ok;
      logger.debug("Google API key validation result", { context: "GoogleImagenProvider.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Google API key validation failed for image generation", {
        context: "GoogleImagenProvider.validateApiKey"
      }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels() {
    logger.debug("Getting available Google image models", { context: "GoogleImagenProvider.getAvailableModels" });
    return this.supportedModels;
  }
};

// plugins/dist/qtap-plugin-google/icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function GoogleIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-blue-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "google-icon",
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
            children: "GGL"
          }
        )
      ]
    }
  );
}

// lib/llm/tool-formatting-utils.ts
function convertOpenAIToGoogleFormat(tool) {
  logger.debug("Converting tool to Google format", {
    context: "tool-formatting",
    toolName: tool.function.name
  });
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: {
      type: "object",
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required
    }
  };
}
function parseGoogleToolCalls(response) {
  const toolCalls = [];
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts)) {
      return toolCalls;
    }
    for (const part of parts) {
      if (part.functionCall) {
        logger.debug("Parsed Google tool call", {
          context: "tool-parsing",
          toolName: part.functionCall.name
        });
        toolCalls.push({
          name: part.functionCall.name,
          arguments: part.functionCall.args || {}
        });
      }
    }
  } catch (error) {
    logger.error("Error parsing Google tool calls", { context: "tool-parsing" }, error instanceof Error ? error : void 0);
  }
  return toolCalls;
}

// plugins/dist/qtap-plugin-google/index.ts
var metadata = {
  providerName: "GOOGLE",
  displayName: "Google Gemini",
  description: "Google Gemini models including text and image generation via Generative AI API",
  colors: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    icon: "text-blue-600"
  },
  abbreviation: "GGL"
};
var config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: "Google Generative AI API Key"
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
  notes: "Images are supported in Gemini models for vision analysis"
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create a Google LLM provider instance
   */
  createProvider: (baseUrl) => {
    logger.debug("Creating Google provider instance", { context: "plugin.createProvider", baseUrl });
    return new GoogleProvider();
  },
  /**
   * Factory method to create a Google Imagen image generation provider instance
   */
  createImageProvider: (baseUrl) => {
    logger.debug("Creating Google Imagen provider instance", { context: "plugin.createImageProvider", baseUrl });
    return new GoogleImagenProvider();
  },
  /**
   * Get list of available models from Google API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available Google models", { context: "plugin.getAvailableModels" });
    try {
      const provider = new GoogleProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched Google models", { context: "plugin.getAvailableModels", count: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Google models", { context: "plugin.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  },
  /**
   * Validate a Google API key
   */
  validateApiKey: async (apiKey, baseUrl) => {
    logger.debug("Validating Google API key", { context: "plugin.validateApiKey" });
    try {
      const provider = new GoogleProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("Google API key validation result", { context: "plugin.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Error validating Google API key", { context: "plugin.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  },
  /**
   * Get static model information
   * Returns cached information about Google models without needing API calls
   */
  getModelInfo: () => {
    logger.debug("Getting Google model information", { context: "plugin.getModelInfo" });
    return [
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-3-pro-image-preview",
        name: "Gemini 3 Pro Image Preview",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-pro-vision",
        name: "Gemini Pro Vision",
        contextWindow: 32e3,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "imagen-4",
        name: "Imagen 4",
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false
      },
      {
        id: "imagen-4-fast",
        name: "Imagen 4 Fast",
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false
      }
    ];
  },
  /**
   * Render the Google icon
   */
  renderIcon: (props) => {
    logger.debug("Rendering Google icon", { context: "plugin.renderIcon", className: props.className });
    return GoogleIcon(props);
  },
  /**
   * Format tools from OpenAI format to Google format
   * Converts tool definitions to Google's function calling format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in Google format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for Google provider", {
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
        const googleTool = convertOpenAIToGoogleFormat(openaiTool);
        formattedTools.push(googleTool);
      }
      logger.debug("Successfully formatted tools", {
        context: "plugin.formatTools",
        count: formattedTools.length
      });
      return formattedTools;
    } catch (error) {
      logger.error(
        "Error formatting tools for Google",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from Google response format
   * Extracts tool calls from Google Gemini API responses
   *
   * @param response Google API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    logger.debug("Parsing tool calls from Google response", {
      context: "plugin.parseToolCalls"
    });
    try {
      const toolCalls = parseGoogleToolCalls(response);
      logger.debug("Successfully parsed tool calls", {
        context: "plugin.parseToolCalls",
        count: toolCalls.length
      });
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from Google response",
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
