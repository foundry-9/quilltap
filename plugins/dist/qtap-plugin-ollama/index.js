"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
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

// ../../../node_modules/openai/internal/auth/x509-transport-state.js
var require_x509_transport_state = __commonJS({
  "../../../node_modules/openai/internal/auth/x509-transport-state.js"(exports2, module2) {
    "use strict";
    if (typeof module2 !== "undefined" && module2 !== globalThis.module && typeof exports2 !== "undefined" && module2.exports === exports2) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.findX509Credential = exports2.rememberX509Credential = exports2.findX509OAuthError = exports2.rememberX509OAuthError = exports2.isApprovedX509Client = exports2.markApprovedX509Client = exports2.isRetryableX509IssuerError = exports2.markRetryableX509IssuerError = exports2.isTransientX509ConnectionError = exports2.markTransientX509ConnectionError = exports2.rememberRegisteredX509Transport = exports2.findRegisteredX509Transport = void 0;
      const registeredX509Transports2 = /* @__PURE__ */ new WeakMap();
      const transientX509ConnectionErrors2 = /* @__PURE__ */ new WeakSet();
      const retryableX509IssuerErrors2 = /* @__PURE__ */ new WeakSet();
      const approvedX509Clients2 = /* @__PURE__ */ new WeakSet();
      const approvedX509OAuthErrors2 = /* @__PURE__ */ new WeakMap();
      const approvedX509Credentials2 = /* @__PURE__ */ new WeakMap();
      exports2.findRegisteredX509Transport = WeakMap.prototype.get.bind(registeredX509Transports2);
      exports2.rememberRegisteredX509Transport = WeakMap.prototype.set.bind(registeredX509Transports2);
      exports2.markTransientX509ConnectionError = WeakSet.prototype.add.bind(transientX509ConnectionErrors2);
      exports2.isTransientX509ConnectionError = WeakSet.prototype.has.bind(transientX509ConnectionErrors2);
      exports2.markRetryableX509IssuerError = WeakSet.prototype.add.bind(retryableX509IssuerErrors2);
      exports2.isRetryableX509IssuerError = WeakSet.prototype.has.bind(retryableX509IssuerErrors2);
      exports2.markApprovedX509Client = WeakSet.prototype.add.bind(approvedX509Clients2);
      exports2.isApprovedX509Client = WeakSet.prototype.has.bind(approvedX509Clients2);
      exports2.rememberX509OAuthError = WeakMap.prototype.set.bind(approvedX509OAuthErrors2);
      exports2.findX509OAuthError = WeakMap.prototype.get.bind(approvedX509OAuthErrors2);
      exports2.rememberX509Credential = WeakMap.prototype.set.bind(approvedX509Credentials2);
      exports2.findX509Credential = WeakMap.prototype.get.bind(approvedX509Credentials2);
    }
  }
});

// index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// ../../../node_modules/openai/internal/tslib.mjs
function __classPrivateFieldSet(receiver, state2, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state2.set(receiver, value), value;
}
function __classPrivateFieldGet(receiver, state2, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state2.get(receiver);
}

// ../../../node_modules/openai/internal/utils/uuid.mjs
var uuid4 = function() {
  const { crypto: crypto2 } = globalThis;
  if (crypto2?.randomUUID) {
    uuid4 = crypto2.randomUUID.bind(crypto2);
    return crypto2.randomUUID();
  }
  const u8 = new Uint8Array(1);
  const randomByte = crypto2 ? () => crypto2.getRandomValues(u8)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ randomByte() & 15 >> +c / 4).toString(16));
};

// ../../../node_modules/openai/internal/errors.mjs
function isAbortError(err) {
  return typeof err === "object" && err !== null && // Spec-compliant fetch implementations
  ("name" in err && err.name === "AbortError" || // Expo fetch
  "message" in err && String(err.message).includes("FetchRequestCanceledException"));
}
var castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
        if (err.stack)
          error.stack = err.stack;
        if (err.cause && !error.cause)
          error.cause = err.cause;
        if (err.name)
          error.name = err.name;
        return error;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
    }
  }
  return new Error(err);
};

// ../../../node_modules/openai/core/error.mjs
var OpenAIError = class extends Error {
};
var APIError = class _APIError extends OpenAIError {
  constructor(status, error, message, headers) {
    super(`${_APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("x-request-id");
    this.error = error;
    const data = error;
    this.code = data?.["code"];
    this.param = data?.["param"];
    this.type = data?.["type"];
  }
  static makeMessage(status, error, message) {
    const msg = error?.message ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status || !headers) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse?.["error"];
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new _APIError(status, error, message, headers);
  }
};
var APIUserAbortError = class extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
};
var APIConnectionError = class extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause)
      this.cause = cause;
  }
};
var APIConnectionTimeoutError = class extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
};
var BadRequestError = class extends APIError {
};
var AuthenticationError = class extends APIError {
};
var PermissionDeniedError = class extends APIError {
};
var NotFoundError = class extends APIError {
};
var ConflictError = class extends APIError {
};
var UnprocessableEntityError = class extends APIError {
};
var RateLimitError = class extends APIError {
};
var InternalServerError = class extends APIError {
};
var LengthFinishReasonError = class extends OpenAIError {
  constructor() {
    super(`Could not parse response content as the length limit was reached`);
  }
};
var ContentFilterFinishReasonError = class extends OpenAIError {
  constructor() {
    super(`Could not parse response content as the request was rejected by the content filter`);
  }
};
var InvalidWebhookSignatureError = class extends Error {
  constructor(message) {
    super(message);
  }
};
var OAuthError = class extends APIError {
  constructor(status, error, headers) {
    let finalMessage = "OAuth2 authentication error";
    let error_code = void 0;
    if (error && typeof error === "object") {
      const errorData = error;
      error_code = errorData["error"];
      const description = errorData["error_description"];
      if (description && typeof description === "string") {
        finalMessage = description;
      } else if (error_code) {
        finalMessage = error_code;
      }
    }
    super(status, error, finalMessage, headers);
    this.error_code = error_code;
  }
};
var SubjectTokenProviderError = class extends OpenAIError {
  constructor(message, provider, cause) {
    super(message);
    this.provider = provider;
    this.cause = cause;
  }
};

// ../../../node_modules/openai/internal/utils/values.mjs
var startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
var isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
var isArray = (val) => (isArray = Array.isArray, isArray(val));
var isReadonlyArray = isArray;
function maybeObj(x) {
  if (typeof x !== "object") {
    return {};
  }
  return x ?? {};
}
function isEmptyObj(obj) {
  if (!obj)
    return true;
  for (const _k in obj)
    return false;
  return true;
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function isObj(obj) {
  return obj != null && typeof obj === "object" && !Array.isArray(obj);
}
var validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new OpenAIError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new OpenAIError(`${name} must be a positive integer`);
  }
  return n;
};
var safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return void 0;
  }
};

// ../../../node_modules/openai/internal/utils/sleep.mjs
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ../../../node_modules/openai/internal/shims.mjs
function getDefaultFetch() {
  if (typeof fetch !== "undefined") {
    return fetch;
  }
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function makeReadableStream(...args) {
  const ReadableStream2 = globalThis.ReadableStream;
  if (typeof ReadableStream2 === "undefined") {
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  }
  return new ReadableStream2(...args);
}
function ReadableStreamFrom(iterable) {
  let iter = Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();
  return makeReadableStream({
    start() {
    },
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await iter.return?.();
    }
  });
}
function ReadableStreamToAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator])
    return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done)
          reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
async function CancelReadableStream(stream) {
  if (stream === null || typeof stream !== "object")
    return;
  if (stream[Symbol.asyncIterator]) {
    await stream[Symbol.asyncIterator]().return?.();
    return;
  }
  const reader = stream.getReader();
  const cancelPromise = reader.cancel();
  reader.releaseLock();
  await cancelPromise;
}

// ../../../node_modules/openai/internal/utils/bytes.mjs
var encodeUTF8_;
function encodeUTF8(str) {
  let encoder;
  return (encodeUTF8_ ?? (encoder = new globalThis.TextEncoder(), encodeUTF8_ = encoder.encode.bind(encoder)))(str);
}
var decodeUTF8_;
function decodeUTF8(bytes) {
  let decoder;
  return (decodeUTF8_ ?? (decoder = new globalThis.TextDecoder(), decodeUTF8_ = decoder.decode.bind(decoder)))(bytes);
}

// ../../../node_modules/openai/internal/decoders/line.mjs
var _LineDecoder_instances;
var _LineDecoder_buffer;
var _LineDecoder_start;
var _LineDecoder_end;
var _LineDecoder_searchIndex;
var _LineDecoder_skipLeadingLF;
var _LineDecoder_append;
var MAX_RETAINED_BUFFER_BYTES = 64 * 1024;
var LineDecoder = class {
  /** Creates a decoder with no buffered bytes or pending newline continuation. */
  constructor() {
    _LineDecoder_instances.add(this);
    _LineDecoder_buffer.set(this, void 0);
    _LineDecoder_start.set(this, void 0);
    _LineDecoder_end.set(this, void 0);
    _LineDecoder_searchIndex.set(this, void 0);
    _LineDecoder_skipLeadingLF.set(this, void 0);
    __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array(), "f");
    __classPrivateFieldSet(this, _LineDecoder_start, 0, "f");
    __classPrivateFieldSet(this, _LineDecoder_end, 0, "f");
    __classPrivateFieldSet(this, _LineDecoder_searchIndex, 0, "f");
    __classPrivateFieldSet(this, _LineDecoder_skipLeadingLF, false, "f");
  }
  /**
   * Appends a text or UTF-8 byte chunk and returns every newly completed line.
   *
   * Incomplete lines remain buffered for the next call. A trailing `\r`
   * completes its line immediately, and a following `\n` is consumed as its
   * continuation. `null` and `undefined` are ignored and do not flush buffered
   * content.
   */
  decode(chunk) {
    if (chunk == null) {
      return [];
    }
    let binaryChunk;
    if (chunk instanceof ArrayBuffer) {
      binaryChunk = new Uint8Array(chunk);
    } else if (typeof chunk === "string") {
      binaryChunk = encodeUTF8(chunk);
    } else {
      binaryChunk = chunk;
    }
    if (binaryChunk.length === 0) {
      return [];
    }
    if (__classPrivateFieldGet(this, _LineDecoder_skipLeadingLF, "f")) {
      __classPrivateFieldSet(this, _LineDecoder_skipLeadingLF, false, "f");
      if (binaryChunk[0] === 10) {
        binaryChunk = binaryChunk.subarray(1);
      }
      if (binaryChunk.length === 0) {
        return [];
      }
    }
    __classPrivateFieldGet(this, _LineDecoder_instances, "m", _LineDecoder_append).call(this, binaryChunk);
    const lines = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), __classPrivateFieldGet(this, _LineDecoder_searchIndex, "f"), __classPrivateFieldGet(this, _LineDecoder_end, "f"))) != null) {
      const line = decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_start, "f"), patternIndex.preceding));
      lines.push(line);
      __classPrivateFieldSet(this, _LineDecoder_start, patternIndex.index, "f");
      if (patternIndex.carriage) {
        if (__classPrivateFieldGet(this, _LineDecoder_start, "f") < __classPrivateFieldGet(this, _LineDecoder_end, "f") && __classPrivateFieldGet(this, _LineDecoder_buffer, "f")[__classPrivateFieldGet(this, _LineDecoder_start, "f")] === 10) {
          __classPrivateFieldSet(this, _LineDecoder_start, __classPrivateFieldGet(this, _LineDecoder_start, "f") + 1, "f");
        } else if (__classPrivateFieldGet(this, _LineDecoder_start, "f") === __classPrivateFieldGet(this, _LineDecoder_end, "f")) {
          __classPrivateFieldSet(this, _LineDecoder_skipLeadingLF, true, "f");
        }
      }
      __classPrivateFieldSet(this, _LineDecoder_searchIndex, __classPrivateFieldGet(this, _LineDecoder_start, "f"), "f");
    }
    __classPrivateFieldSet(this, _LineDecoder_searchIndex, __classPrivateFieldGet(this, _LineDecoder_end, "f"), "f");
    if (__classPrivateFieldGet(this, _LineDecoder_start, "f") === __classPrivateFieldGet(this, _LineDecoder_end, "f")) {
      __classPrivateFieldSet(this, _LineDecoder_start, 0, "f");
      __classPrivateFieldSet(this, _LineDecoder_end, 0, "f");
      __classPrivateFieldSet(this, _LineDecoder_searchIndex, 0, "f");
      if (__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length > MAX_RETAINED_BUFFER_BYTES) {
        __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array(), "f");
      }
    } else if (lines.length > 0 && __classPrivateFieldGet(this, _LineDecoder_buffer, "f").length > MAX_RETAINED_BUFFER_BYTES) {
      const length = __classPrivateFieldGet(this, _LineDecoder_end, "f") - __classPrivateFieldGet(this, _LineDecoder_start, "f");
      if (length <= MAX_RETAINED_BUFFER_BYTES || __classPrivateFieldGet(this, _LineDecoder_buffer, "f").length > length * 4) {
        const capacity = length <= MAX_RETAINED_BUFFER_BYTES ? Math.min(Math.max(length * 2, 256), MAX_RETAINED_BUFFER_BYTES) : length * 2;
        const buffer = new Uint8Array(capacity);
        buffer.set(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_start, "f"), __classPrivateFieldGet(this, _LineDecoder_end, "f")));
        __classPrivateFieldSet(this, _LineDecoder_buffer, buffer, "f");
        __classPrivateFieldSet(this, _LineDecoder_start, 0, "f");
        __classPrivateFieldSet(this, _LineDecoder_end, length, "f");
        __classPrivateFieldSet(this, _LineDecoder_searchIndex, length, "f");
      }
    }
    return lines;
  }
  /** Emits the remaining unterminated line, or returns an empty array when idle. */
  flush() {
    __classPrivateFieldSet(this, _LineDecoder_skipLeadingLF, false, "f");
    if (__classPrivateFieldGet(this, _LineDecoder_start, "f") === __classPrivateFieldGet(this, _LineDecoder_end, "f")) {
      return [];
    }
    return this.decode("\n");
  }
};
_LineDecoder_buffer = /* @__PURE__ */ new WeakMap(), _LineDecoder_start = /* @__PURE__ */ new WeakMap(), _LineDecoder_end = /* @__PURE__ */ new WeakMap(), _LineDecoder_searchIndex = /* @__PURE__ */ new WeakMap(), _LineDecoder_skipLeadingLF = /* @__PURE__ */ new WeakMap(), _LineDecoder_instances = /* @__PURE__ */ new WeakSet(), _LineDecoder_append = function _LineDecoder_append2(chunk) {
  if (__classPrivateFieldGet(this, _LineDecoder_end, "f") + chunk.length > __classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
    const length = __classPrivateFieldGet(this, _LineDecoder_end, "f") - __classPrivateFieldGet(this, _LineDecoder_start, "f");
    if (__classPrivateFieldGet(this, _LineDecoder_start, "f") >= __classPrivateFieldGet(this, _LineDecoder_buffer, "f").length / 2 && length + chunk.length <= __classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
      __classPrivateFieldGet(this, _LineDecoder_buffer, "f").copyWithin(0, __classPrivateFieldGet(this, _LineDecoder_start, "f"), __classPrivateFieldGet(this, _LineDecoder_end, "f"));
    } else {
      const capacity = Math.max(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length * 2, length + chunk.length, 256);
      const buffer = new Uint8Array(capacity);
      buffer.set(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_start, "f"), __classPrivateFieldGet(this, _LineDecoder_end, "f")));
      __classPrivateFieldSet(this, _LineDecoder_buffer, buffer, "f");
    }
    __classPrivateFieldSet(this, _LineDecoder_searchIndex, __classPrivateFieldGet(this, _LineDecoder_searchIndex, "f") - __classPrivateFieldGet(this, _LineDecoder_start, "f"), "f");
    __classPrivateFieldSet(this, _LineDecoder_end, length, "f");
    __classPrivateFieldSet(this, _LineDecoder_start, 0, "f");
  }
  __classPrivateFieldGet(this, _LineDecoder_buffer, "f").set(chunk, __classPrivateFieldGet(this, _LineDecoder_end, "f"));
  __classPrivateFieldSet(this, _LineDecoder_end, __classPrivateFieldGet(this, _LineDecoder_end, "f") + chunk.length, "f");
};
LineDecoder.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function findNewlineIndex(buffer, start, end) {
  const newline = 10;
  const carriage = 13;
  for (let i = start; i < end; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }
    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }
  return null;
}
function findDoubleNewlineIndex(buffer) {
  for (let i = 0; i < buffer.length - 1; i++) {
    const firstEndingLength = lineEndingLength(buffer, i);
    if (firstEndingLength > 0) {
      const secondEndingIndex = i + firstEndingLength;
      const secondEndingLength = lineEndingLength(buffer, secondEndingIndex);
      if (secondEndingLength > 0) {
        return secondEndingIndex + secondEndingLength;
      }
    }
  }
  return -1;
}
function lineEndingLength(buffer, index) {
  const newline = 10;
  const carriage = 13;
  if (buffer[index] === newline) {
    return 1;
  }
  if (buffer[index] === carriage) {
    return buffer[index + 1] === newline ? 2 : 1;
  }
  return 0;
}

// ../../../node_modules/openai/internal/utils/log.mjs
var levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
};
var parseLogLevel = (maybeLevel, sourceName, client) => {
  if (!maybeLevel) {
    return void 0;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
  return void 0;
};
function noop() {
}
function makeLogFn(fnLevel, logger4, logLevel) {
  if (!logger4 || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger4[fnLevel].bind(logger4);
  }
}
var noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};
var cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger4 = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger4) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger4);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger4, logLevel),
    warn: makeLogFn("warn", logger4, logLevel),
    info: makeLogFn("info", logger4, logLevel),
    debug: makeLogFn("debug", logger4, logLevel)
  };
  cachedLoggers.set(logger4, [logLevel, levelLogger]);
  return levelLogger;
}
var sensitiveQueryNames = /* @__PURE__ */ new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "sessionid",
  "idtoken",
  "authtoken",
  "authorization",
  "token",
  "password",
  "clientsecret",
  "xamzsecuritytoken",
  "xamzsignature",
  "xamzcredential"
]);
function isSensitiveQueryParameter(name) {
  const normalized = name.toLowerCase().replace(/[-_]/gu, "");
  return sensitiveQueryNames.has(normalized) || sensitiveQueryNames.has(normalized.replace(/^x/u, ""));
}
var sensitiveHeaderNames = /* @__PURE__ */ new Set([
  "authorization",
  "proxy-authorization",
  "api-key",
  "x-api-key",
  "x-amz-security-token",
  "cookie",
  "set-cookie",
  "x-session-token",
  "x-session-id",
  "x-auth-token",
  "x-id-token"
]);
function isSensitiveHeader(name) {
  return sensitiveHeaderNames.has(name.toLowerCase().replace(/_/gu, "-")) || isSensitiveQueryParameter(name);
}
function redactURL(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const name of url.searchParams.keys()) {
    if (isSensitiveQueryParameter(name)) {
      url.searchParams.set(name, "***");
    }
  }
  return url.href;
}
var formatRequestDetails = (details) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options["headers"];
    if (details.options.path) {
      const path2 = details.options.path;
      const redacted = new URL(redactURL(new URL(path2, "https://redacted.invalid").href));
      details.options.path = redacted.origin === "https://redacted.invalid" ? `${path2.startsWith("/") ? "/" : ""}${redacted.pathname.slice(1)}${redacted.search}` : redacted.href;
    }
    if (details.options.query) {
      details.options.query = Object.fromEntries(Object.entries(details.options.query).map(([name, value]) => [
        name,
        isSensitiveQueryParameter(name) ? "***" : value
      ]));
    }
  }
  if (details.url) {
    details.url = redactURL(details.url);
  }
  if (details.headers) {
    details.headers = Object.fromEntries((details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(([name, value]) => [name, isSensitiveHeader(name) ? "***" : value]));
  }
  if ("retryOfRequestLogID" in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};

// ../../../node_modules/openai/core/streaming.mjs
var _Stream_client;
function createStreamTeeQueue() {
  let entries = [];
  let head = 0;
  return {
    get length() {
      return entries.length - head;
    },
    enqueue(value) {
      entries.push(value);
    },
    dequeue() {
      if (head === entries.length) {
        return void 0;
      }
      const value = entries[head];
      entries[head] = void 0;
      head += 1;
      if (head === entries.length) {
        entries = [];
        head = 0;
      } else if (head >= 1024 && head * 2 >= entries.length) {
        entries = entries.slice(head);
        head = 0;
      }
      return value;
    }
  };
}
var Stream = class _Stream {
  /** Wraps an asynchronous event iterator and the controller that owns its request. */
  constructor(iterator, controller, client) {
    _Stream_client.set(this, void 0);
    this.iterator = iterator;
    this.controller = controller;
    __classPrivateFieldSet(this, _Stream_client, client, "f");
  }
  /**
   * Decodes an SSE response into parsed JSON events.
   *
   * The resulting stream can be consumed only once, ignores events after `[DONE]`, and
   * surfaces API error payloads as `APIError` instances. When
   * `synthesizeEventData` is enabled, each item also includes its SSE event name.
   */
  static fromSSEResponse(response, controller, client, synthesizeEventData) {
    let consumed = false;
    const logger4 = client ? loggerFor(client) : console;
    async function* iterator() {
      if (consumed) {
        throw new OpenAIError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      let receivedCompletionSentinel = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (sse.data === "[DONE]") {
            receivedCompletionSentinel = true;
            break;
          }
          if (sse.event === null || !sse.event.startsWith("thread.")) {
            let data;
            try {
              data = JSON.parse(sse.data);
            } catch {
              logger4.error(`Could not parse message into JSON:`);
              logger4.error(`From chunk:`);
              throw new SyntaxError("Error reading response: malformed server-sent event JSON.");
            }
            if (sse.event === "error") {
              throw new APIError(void 0, data?.error ?? data, void 0, response.headers);
            }
            if (data && data.error) {
              throw new APIError(void 0, data.error, void 0, response.headers);
            }
            yield synthesizeEventData ? { event: sse.event, data } : data;
          } else {
            let data;
            try {
              data = JSON.parse(sse.data);
            } catch {
              logger4.error(`Could not parse message into JSON:`);
              logger4.error(`From chunk:`);
              throw new SyntaxError("Error reading response: malformed server-sent event JSON.");
            }
            yield { event: sse.event, data };
          }
        }
        done = true;
      } catch (e) {
        if (receivedCompletionSentinel || isAbortError(e) || controller.signal.aborted && e === controller.signal.reason) {
          return;
        }
        throw e;
      } finally {
        if (!done) {
          controller.abort();
        }
      }
    }
    return new _Stream(iterator, controller, client);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(readableStream, controller, client) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder();
      const reader = readableStream.getReader();
      let closed = false;
      let cancelPromise;
      const cancel = () => {
        cancelPromise ?? (cancelPromise = reader.cancel());
        cancelPromise.catch(() => void 0);
      };
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        if (controller.signal.aborted) {
          cancel();
          return;
        }
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) {
            closed = true;
            break;
          }
          if (controller.signal.aborted) {
            return;
          }
          for (const line of lineDecoder.decode(chunk)) {
            if (controller.signal.aborted) {
              return;
            }
            yield line;
          }
        }
        if (controller.signal.aborted) {
          return;
        }
        for (const line of lineDecoder.flush()) {
          if (controller.signal.aborted) {
            return;
          }
          yield line;
        }
      } finally {
        controller.signal.removeEventListener("abort", cancel);
        if (!closed) {
          cancel();
        }
        reader.releaseLock();
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new OpenAIError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done) {
            continue;
          }
          if (line) {
            let data;
            try {
              data = JSON.parse(line);
            } catch (error) {
              if (error instanceof SyntaxError) {
                throw new SyntaxError("Error reading response: malformed newline-delimited JSON.");
              }
              throw error;
            }
            yield data;
          }
        }
        done = true;
      } catch (e) {
        if (controller.signal.aborted || isAbortError(e)) {
          return;
        }
        throw e;
      } finally {
        if (!done) {
          controller.abort();
        }
      }
    }
    return new _Stream(iterator, controller, client);
  }
  /** Starts consuming this stream; attempting to consume it again throws. */
  [(_Stream_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const left = createStreamTeeQueue();
    const right = createStreamTeeQueue();
    const iterator = this.iterator();
    const teeIterator = (queue) => ({
      next: () => {
        if (queue.length === 0) {
          const result = iterator.next();
          left.enqueue(result);
          right.enqueue(result);
        }
        return queue.dequeue();
      }
    });
    return [
      new _Stream(() => teeIterator(left), this.controller, __classPrivateFieldGet(this, _Stream_client, "f")),
      new _Stream(() => teeIterator(right), this.controller, __classPrivateFieldGet(this, _Stream_client, "f"))
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    let iter;
    return makeReadableStream({
      start: async () => {
        iter = this[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done) {
            return ctrl.close();
          }
          const bytes = encodeUTF8(JSON.stringify(value) + "\n");
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      }
    });
  }
};
function createAbortableSSESource(body, signal) {
  const reader = typeof body.getReader === "function" ? body.getReader() : void 0;
  const source = reader ? {
    next: () => reader.read(),
    return: () => reader.cancel()
  } : ReadableStreamToAsyncIterable(body)[Symbol.asyncIterator]();
  const ended = { value: void 0, done: true };
  let closed = false;
  let canceled = false;
  let cancellation;
  let interrupt;
  const waitForAbort = () => (
    // oxlint-disable-next-line promise/avoid-new -- AbortSignal callbacks need a portable Promise bridge.
    new Promise((resolve) => {
      interrupt = resolve;
    })
  );
  const cancel = () => {
    if (canceled || closed) {
      return cancellation;
    }
    canceled = true;
    try {
      cancellation = Promise.resolve(source.return?.());
    } catch (error) {
      cancellation = Promise.reject(error);
    }
    cancellation.catch(() => void 0);
    return cancellation;
  };
  const abort = () => {
    queueMicrotask(() => {
      interrupt?.();
      cancel();
    });
  };
  const iterator = {
    async next() {
      if (signal.aborted) {
        return ended;
      }
      const aborted = waitForAbort().then(() => ended);
      try {
        const result = await Promise.race([source.next(), aborted]);
        if (signal.aborted) {
          return ended;
        }
        if (result.done) {
          closed = true;
          return ended;
        }
        return { value: result.value, done: false };
      } catch (error) {
        if (signal.aborted && (isAbortError(error) || error === signal.reason)) {
          return ended;
        }
        throw error;
      } finally {
        interrupt = void 0;
      }
    },
    async return() {
      const pending = cancel();
      if (pending && !signal.aborted) {
        const aborted = waitForAbort();
        try {
          if (!signal.aborted) {
            await Promise.race([pending, aborted]);
          }
        } finally {
          interrupt = void 0;
        }
      }
      return ended;
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
  return {
    iterator,
    start() {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    },
    async cleanup(failed) {
      let cleanupError;
      try {
        signal.removeEventListener("abort", abort);
      } catch (error) {
        cleanupError = error;
      }
      if (!closed) {
        const pending = cancel();
        if (pending && !failed && !signal.aborted) {
          try {
            await pending;
          } catch (error) {
            cleanupError ?? (cleanupError = error);
          }
        }
      }
      if (reader) {
        try {
          reader.releaseLock();
        } catch (error) {
          cleanupError ?? (cleanupError = error);
        }
      }
      if (cleanupError !== void 0 && !failed && !signal.aborted) {
        throw cleanupError;
      }
    }
  };
}
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    if (globalThis.navigator !== void 0 && globalThis.navigator.product === "ReactNative") {
      throw new OpenAIError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
    }
    throw new OpenAIError(`Attempted to iterate over a response with no body`);
  }
  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const { signal } = controller;
  const source = createAbortableSSESource(response.body, signal);
  let failed = false;
  try {
    source.start();
    for await (const sseChunk of iterSSEChunks(source.iterator)) {
      if (signal.aborted) {
        return;
      }
      for (const line of lineDecoder.decode(sseChunk)) {
        if (signal.aborted) {
          return;
        }
        const sse = sseDecoder.decode(line);
        if (sse) {
          yield sse;
        }
      }
    }
    if (signal.aborted) {
      return;
    }
    for (const line of lineDecoder.flush()) {
      if (signal.aborted) {
        return;
      }
      const sse = sseDecoder.decode(line);
      if (sse) {
        yield sse;
      }
    }
  } catch (error) {
    failed = true;
    if (!signal.aborted || !isAbortError(error) && error !== signal.reason) {
      throw error;
    }
  } finally {
    await source.cleanup(failed);
  }
}
var DOUBLE_NEWLINE_DELIMITER_MAX_OVERLAP_BYTES = 3;
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array();
  let dataStart = 0;
  let dataEnd = 0;
  let searchStartIndex = 0;
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    let binaryChunk;
    if (chunk instanceof ArrayBuffer) {
      binaryChunk = new Uint8Array(chunk);
    } else if (typeof chunk === "string") {
      binaryChunk = encodeUTF8(chunk);
    } else {
      binaryChunk = chunk;
    }
    if (dataEnd + binaryChunk.length > data.length) {
      const bufferedLength = dataEnd - dataStart;
      if (dataStart >= data.length / 2 && bufferedLength + binaryChunk.length <= data.length) {
        data.copyWithin(0, dataStart, dataEnd);
      } else {
        const newData = new Uint8Array(Math.max(data.length * 2, bufferedLength + binaryChunk.length));
        newData.set(data.subarray(dataStart, dataEnd));
        data = newData;
      }
      searchStartIndex -= dataStart;
      dataStart = 0;
      dataEnd = bufferedLength;
    }
    data.set(binaryChunk, dataEnd);
    dataEnd += binaryChunk.length;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data.subarray(searchStartIndex, dataEnd))) !== -1) {
      patternIndex += searchStartIndex;
      yield data.slice(dataStart, patternIndex);
      dataStart = patternIndex;
      searchStartIndex = dataStart;
    }
    searchStartIndex = Math.max(dataStart, dataEnd - DOUBLE_NEWLINE_DELIMITER_MAX_OVERLAP_BYTES);
  }
  if (dataEnd > dataStart) {
    yield data.slice(dataStart, dataEnd);
  }
}
var SSEDecoder = class {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    if (!line) {
      if (!this.event && !this.data.length) {
        return null;
      }
      const sse = {
        event: this.event,
        data: this.data.join("\n"),
        raw: this.chunks
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    const [fieldname, , initialValue] = partition(line, ":");
    let value = initialValue;
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
};
function partition(str, delimiter) {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.slice(0, index), delimiter, str.slice(index + delimiter.length)];
  }
  return [str, "", ""];
}

// ../../../node_modules/openai/internal/parse.mjs
async function defaultParseResponse(client, props) {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
    if (props.options.stream) {
      loggerFor(client).debug("response", response.status, response.url, response.headers, response.body);
      if (props.options.__streamClass) {
        return props.options.__streamClass.fromSSEResponse(response, props.controller, client, props.options.__synthesizeEventData);
      }
      return Stream.fromSSEResponse(response, props.controller, client, props.options.__synthesizeEventData);
    }
    if (response.status === 204) {
      return null;
    }
    if (props.options.__binaryResponse) {
      return response;
    }
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";")[0]?.trim();
    const isJSON = mediaType?.includes("application/json") || mediaType?.endsWith("+json");
    if (isJSON) {
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        return void 0;
      }
      const bodyText = await response.text();
      if (!bodyText) {
        return void 0;
      }
      const json = JSON.parse(bodyText);
      return addRequestID(json, response);
    }
    const text = await response.text();
    return text;
  })().catch((error) => {
    throw asAbortError(error, props.controller.signal);
  });
  loggerFor(client).debug(`[${requestLogID}] response parsed`, formatRequestDetails({
    retryOfRequestLogID,
    url: response.url,
    status: response.status,
    body,
    durationMs: Date.now() - startTime
  }));
  return body;
}
function asAbortError(error, signal) {
  if (!signal.aborted || error !== signal.reason || isAbortError(error)) {
    return error;
  }
  const message = "This operation was aborted";
  const DOMExceptionConstructor = globalThis.DOMException;
  return typeof DOMExceptionConstructor === "function" ? new DOMExceptionConstructor(message, "AbortError") : Object.assign(new Error(message), { name: "AbortError" });
}
function addRequestID(value, response) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.defineProperty(value, "_request_id", {
    value: response.headers.get("x-request-id"),
    enumerable: false
  });
}

// ../../../node_modules/openai/version.mjs
var VERSION = "7.10.0";

// ../../../node_modules/openai/internal/detect-platform.mjs
var isRunningInBrowser = () => {
  return (
    // @ts-ignore
    typeof window !== "undefined" && // @ts-ignore
    typeof window.document !== "undefined" && // @ts-ignore
    typeof navigator !== "undefined"
  );
};
function getDetectedPlatform() {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return "deno";
  }
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (Object.prototype.toString.call(typeof globalThis.process !== "undefined" ? globalThis.process : 0) === "[object process]") {
    return "node";
  }
  return "unknown";
}
var getPlatformProperties = () => {
  const detectedPlatform = getDetectedPlatform();
  if (detectedPlatform === "deno") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version === "string" ? Deno.version : Deno.version?.deno ?? "unknown"
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version
    };
  }
  if (detectedPlatform === "node") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": normalizeArch(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
var normalizeArch = (arch) => {
  if (arch === "x32")
    return "x32";
  if (arch === "x86_64" || arch === "x64")
    return "x64";
  if (arch === "arm")
    return "arm";
  if (arch === "aarch64" || arch === "arm64")
    return "arm64";
  if (arch)
    return `other:${arch}`;
  return "unknown";
};
var normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios"))
    return "iOS";
  if (platform === "android")
    return "Android";
  if (platform === "darwin")
    return "MacOS";
  if (platform === "win32")
    return "Windows";
  if (platform === "freebsd")
    return "FreeBSD";
  if (platform === "openbsd")
    return "OpenBSD";
  if (platform === "linux")
    return "Linux";
  if (platform)
    return `Other:${platform}`;
  return "Unknown";
};
var _platformHeaders;
var getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};

// ../../../node_modules/openai/internal/request-options.mjs
var jsonRequestBodyObservers = /* @__PURE__ */ new WeakMap();
function observeJSONRequestBody(body, observer) {
  let observers = jsonRequestBodyObservers.get(body);
  if (!observers) {
    observers = /* @__PURE__ */ new Set();
    jsonRequestBodyObservers.set(body, observers);
  }
  observers.add(observer);
  return () => {
    const active = jsonRequestBodyObservers.get(body);
    if (!active) {
      return;
    }
    active.delete(observer);
    if (active.size === 0) {
      jsonRequestBodyObservers.delete(body);
    }
  };
}
var FallbackEncoder = ({ headers, body }) => {
  const observers = typeof body === "object" && body !== null ? jsonRequestBodyObservers.get(body) : void 0;
  let encoded;
  if (!observers || observers.size === 0) {
    encoded = JSON.stringify(body);
  } else {
    const active = [...observers];
    encoded = JSON.stringify(body, function(key, value) {
      let observed = value;
      for (const observer of active) {
        const replacement = observer.value(this, key, observed);
        if (replacement !== void 0) {
          observed = replacement;
        }
      }
      return observed;
    });
    for (const observer of active) {
      observer.complete();
    }
  }
  return {
    bodyHeaders: {
      "content-type": "application/json"
    },
    body: encoded
  };
};

// ../../../node_modules/openai/internal/qs/formats.mjs
var default_format = "RFC3986";
var default_formatter = String;
var formatters = {
  RFC1738: (v) => String(v).replace(/%20/g, "+"),
  RFC3986: default_formatter
};
var RFC1738 = "RFC1738";

// ../../../node_modules/openai/internal/qs/utils.mjs
var cachedHas;
var has = (obj, key) => {
  const resolvedHas = cachedHas ?? Object.hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  cachedHas = resolvedHas;
  return resolvedHas(obj, key);
};
var hex_table = /* @__PURE__ */ (() => {
  const array = [];
  for (let i = 0; i < 256; ++i) {
    array.push("%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase());
  }
  return array;
})();
var limit = 1024;
var encode = (str, _defaultEncoder, charset, _kind, format) => {
  if (str.length === 0) {
    return str;
  }
  let string = str;
  if (typeof str === "symbol") {
    string = Symbol.prototype.toString.call(str);
  } else if (typeof str !== "string") {
    string = String(str);
  }
  if (charset === "iso-8859-1") {
    return escape(string).replace(/%u[0-9a-f]{4}/gi, ($0) => "%26%23" + Number.parseInt($0.slice(2), 16) + "%3B");
  }
  let out = "";
  for (let j = 0; j < string.length; ) {
    let segmentEnd = Math.min((Math.floor(j / limit) + 1) * limit, string.length);
    if (segmentEnd < string.length && string.codePointAt(segmentEnd - 1) > 65535) {
      segmentEnd += 1;
    }
    const segment = string.length >= limit ? string.slice(j, segmentEnd) : string;
    const arr = [];
    for (let i = 0; i < segment.length; ++i) {
      let c = segment.charCodeAt(i);
      if (c === 45 || // -
      c === 46 || // .
      c === 95 || // _
      c === 126 || // ~
      c >= 48 && c <= 57 || // 0-9
      c >= 65 && c <= 90 || // a-z
      c >= 97 && c <= 122 || // A-Z
      format === RFC1738 && (c === 40 || c === 41)) {
        arr[arr.length] = segment.charAt(i);
        continue;
      }
      if (c < 128) {
        arr[arr.length] = hex_table[c];
        continue;
      }
      if (c < 2048) {
        arr[arr.length] = hex_table[192 | c >> 6] + hex_table[128 | c & 63];
        continue;
      }
      if (c < 55296 || c >= 57344) {
        arr[arr.length] = hex_table[224 | c >> 12] + hex_table[128 | c >> 6 & 63] + hex_table[128 | c & 63];
        continue;
      }
      i += 1;
      c = 65536 + ((c & 1023) << 10 | segment.charCodeAt(i) & 1023);
      arr[arr.length] = hex_table[240 | c >> 18] + hex_table[128 | c >> 12 & 63] + hex_table[128 | c >> 6 & 63] + hex_table[128 | c & 63];
    }
    out += arr.join("");
    j = segmentEnd;
  }
  return out;
};
function is_buffer(obj) {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
}
function maybe_map(val, fn) {
  if (isArray(val)) {
    const mapped = [];
    for (const item of val) {
      mapped.push(fn(item));
    }
    return mapped;
  }
  return fn(val);
}

// ../../../node_modules/openai/internal/qs/stringify.mjs
var array_prefix_generators = {
  brackets(prefix) {
    return String(prefix) + "[]";
  },
  comma: "comma",
  indices(prefix, key) {
    return String(prefix) + "[" + key + "]";
  },
  repeat(prefix) {
    return String(prefix);
  }
};
var push_to_array = function push_to_array2(arr, value_or_array) {
  Array.prototype.push.apply(arr, isArray(value_or_array) ? value_or_array : [value_or_array]);
};
var toISOString;
var defaults = {
  addQueryPrefix: false,
  allowDots: false,
  allowEmptyArrays: false,
  arrayFormat: "indices",
  charset: "utf-8",
  charsetSentinel: false,
  delimiter: "&",
  encode: true,
  encodeDotInKeys: false,
  encoder: encode,
  encodeValuesOnly: false,
  format: default_format,
  formatter: default_formatter,
  /** @deprecated */
  indices: false,
  serializeDate(date) {
    return (toISOString ?? (toISOString = Function.prototype.call.bind(Date.prototype.toISOString)))(date);
  },
  skipNulls: false,
  strictNullHandling: false
};
function is_non_nullish_primitive(v) {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "symbol" || typeof v === "bigint";
}
var sentinel = {};
function inner_stringify(object, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
  let obj = object;
  let tmp_sc = sideChannel;
  let step = 0;
  let find_flag = false;
  while ((tmp_sc = tmp_sc.get(sentinel)) !== void 0 && !find_flag) {
    const pos = tmp_sc.get(object);
    step += 1;
    if (pos !== void 0) {
      if (pos === step) {
        throw new RangeError("Cyclic object value");
      } else {
        find_flag = true;
      }
    }
    if (tmp_sc.get(sentinel) === void 0) {
      step = 0;
    }
  }
  if (typeof filter === "function") {
    obj = filter(prefix, obj);
  } else if (obj instanceof Date) {
    obj = serializeDate?.(obj);
  } else if (generateArrayPrefix === "comma" && isArray(obj)) {
    obj = maybe_map(obj, (value) => {
      if (value instanceof Date) {
        return serializeDate?.(value);
      }
      return value;
    });
  }
  if (obj === null) {
    if (strictNullHandling) {
      return encoder && !encodeValuesOnly ? (
        // @ts-expect-error
        encoder(prefix, defaults.encoder, charset, "key", format)
      ) : prefix;
    }
    obj = "";
  }
  if (is_non_nullish_primitive(obj) || is_buffer(obj)) {
    if (encoder) {
      const key_value = encodeValuesOnly ? prefix : (
        // @ts-expect-error
        encoder(prefix, defaults.encoder, charset, "key", format)
      );
      return [
        formatter?.(key_value) + "=" + // @ts-expect-error
        formatter?.(encoder(obj, defaults.encoder, charset, "value", format))
      ];
    }
    return [formatter?.(prefix) + "=" + formatter?.(String(obj))];
  }
  const values = [];
  if (obj === void 0) {
    return values;
  }
  let obj_keys;
  if (generateArrayPrefix === "comma" && isArray(obj)) {
    if (encodeValuesOnly && encoder) {
      obj = maybe_map(obj, encoder);
    }
    obj_keys = [{ value: obj.length > 0 ? obj.join(",") || null : void 0 }];
  } else if (isArray(filter)) {
    obj_keys = filter;
  } else {
    const keys = Object.keys(obj);
    if (sort) {
      keys.sort(sort);
    }
    obj_keys = keys;
  }
  const encoded_prefix = encodeDotInKeys ? String(prefix).replace(/\./g, "%2E") : String(prefix);
  const adjusted_prefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encoded_prefix + "[]" : encoded_prefix;
  if (allowEmptyArrays && isArray(obj) && obj.length === 0) {
    return adjusted_prefix + "[]";
  }
  for (const key of obj_keys) {
    const value = (
      // @ts-ignore
      typeof key === "object" && key.value !== void 0 ? key.value : obj[key]
    );
    if (skipNulls && value === null) {
      continue;
    }
    const encoded_key = allowDots && encodeDotInKeys ? key.replace(/\./g, "%2E") : key;
    let key_prefix;
    if (isArray(obj)) {
      key_prefix = typeof generateArrayPrefix === "function" ? generateArrayPrefix(adjusted_prefix, encoded_key) : adjusted_prefix;
    } else {
      key_prefix = adjusted_prefix + (allowDots ? "." + encoded_key : "[" + encoded_key + "]");
    }
    sideChannel.set(object, step);
    const valueSideChannel = new WeakMap([[sentinel, sideChannel]]);
    push_to_array(values, inner_stringify(
      value,
      key_prefix,
      generateArrayPrefix,
      commaRoundTrip,
      allowEmptyArrays,
      strictNullHandling,
      skipNulls,
      encodeDotInKeys,
      // @ts-ignore
      generateArrayPrefix === "comma" && encodeValuesOnly && isArray(obj) ? null : encoder,
      filter,
      sort,
      allowDots,
      serializeDate,
      format,
      formatter,
      encodeValuesOnly,
      charset,
      valueSideChannel
    ));
  }
  return values;
}
function normalize_stringify_options(opts = defaults) {
  if (opts.allowEmptyArrays !== void 0 && typeof opts.allowEmptyArrays !== "boolean") {
    throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
  }
  if (opts.encodeDotInKeys !== void 0 && typeof opts.encodeDotInKeys !== "boolean") {
    throw new TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");
  }
  if (opts.encoder !== null && opts.encoder !== void 0 && typeof opts.encoder !== "function") {
    throw new TypeError("Encoder has to be a function.");
  }
  const charset = opts.charset || defaults.charset;
  if (opts.charset !== void 0 && opts.charset !== "utf-8" && opts.charset !== "iso-8859-1") {
    throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
  }
  let format = default_format;
  if (opts.format !== void 0) {
    if (!has(formatters, opts.format)) {
      throw new TypeError("Unknown format option provided.");
    }
    format = opts.format;
  }
  const formatter = formatters[format];
  let filter = defaults.filter;
  if (typeof opts.filter === "function" || isArray(opts.filter)) {
    filter = opts.filter;
  }
  let arrayFormat;
  if (opts.arrayFormat && opts.arrayFormat in array_prefix_generators) {
    arrayFormat = opts.arrayFormat;
  } else if ("indices" in opts) {
    arrayFormat = opts.indices ? "indices" : "repeat";
  } else {
    arrayFormat = defaults.arrayFormat;
  }
  if ("commaRoundTrip" in opts && typeof opts.commaRoundTrip !== "boolean") {
    throw new TypeError("`commaRoundTrip` must be a boolean, or absent");
  }
  let allowDots;
  if (opts.allowDots === void 0) {
    allowDots = !!opts.encodeDotInKeys === true ? true : defaults.allowDots;
  } else {
    allowDots = !!opts.allowDots;
  }
  return {
    addQueryPrefix: typeof opts.addQueryPrefix === "boolean" ? opts.addQueryPrefix : defaults.addQueryPrefix,
    // @ts-ignore
    allowDots,
    allowEmptyArrays: typeof opts.allowEmptyArrays === "boolean" ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
    arrayFormat,
    charset,
    charsetSentinel: typeof opts.charsetSentinel === "boolean" ? opts.charsetSentinel : defaults.charsetSentinel,
    commaRoundTrip: !!opts.commaRoundTrip,
    delimiter: opts.delimiter === void 0 ? defaults.delimiter : opts.delimiter,
    encode: typeof opts.encode === "boolean" ? opts.encode : defaults.encode,
    encodeDotInKeys: typeof opts.encodeDotInKeys === "boolean" ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
    encoder: typeof opts.encoder === "function" ? opts.encoder : defaults.encoder,
    encodeValuesOnly: typeof opts.encodeValuesOnly === "boolean" ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
    filter,
    format,
    formatter,
    serializeDate: typeof opts.serializeDate === "function" ? opts.serializeDate : defaults.serializeDate,
    skipNulls: typeof opts.skipNulls === "boolean" ? opts.skipNulls : defaults.skipNulls,
    // @ts-ignore
    sort: typeof opts.sort === "function" ? opts.sort : null,
    strictNullHandling: typeof opts.strictNullHandling === "boolean" ? opts.strictNullHandling : defaults.strictNullHandling
  };
}
function stringify(object, opts = {}) {
  let obj = object;
  const options = normalize_stringify_options(opts);
  let obj_keys;
  let filter;
  if (typeof options.filter === "function") {
    filter = options.filter;
    obj = filter("", obj);
  } else if (isArray(options.filter)) {
    filter = options.filter;
    obj_keys = filter;
  }
  const keys = [];
  if (typeof obj !== "object" || obj === null) {
    return "";
  }
  const generateArrayPrefix = array_prefix_generators[options.arrayFormat];
  const commaRoundTrip = generateArrayPrefix === "comma" && options.commaRoundTrip;
  if (!obj_keys) {
    obj_keys = Object.keys(obj);
  }
  if (options.sort) {
    obj_keys.sort(options.sort);
  }
  const sideChannel = /* @__PURE__ */ new WeakMap();
  for (const key of obj_keys) {
    if (options.skipNulls && obj[key] === null) {
      continue;
    }
    push_to_array(keys, inner_stringify(
      obj[key],
      key,
      // @ts-expect-error
      generateArrayPrefix,
      commaRoundTrip,
      options.allowEmptyArrays,
      options.strictNullHandling,
      options.skipNulls,
      options.encodeDotInKeys,
      options.encode ? options.encoder : null,
      options.filter,
      options.sort,
      options.allowDots,
      options.serializeDate,
      options.format,
      options.formatter,
      options.encodeValuesOnly,
      options.charset,
      sideChannel
    ));
  }
  const joined = keys.join(options.delimiter);
  let prefix = options.addQueryPrefix === true ? "?" : "";
  if (options.charsetSentinel) {
    prefix += options.charset === "iso-8859-1" ? (
      // encodeURIComponent('&#10003;'), the "numeric entity" representation of a checkmark
      "utf8=%26%2310003%3B&"
    ) : (
      // encodeURIComponent('✓')
      "utf8=%E2%9C%93&"
    );
  }
  return joined.length > 0 ? prefix + joined : "";
}

// ../../../node_modules/openai/internal/utils/query.mjs
function stringifyQuery(query) {
  return stringify(query, { arrayFormat: "brackets" });
}

// ../../../node_modules/openai/internal/data-residency.mjs
var endpoints = /* @__PURE__ */ new Map([
  ["global", "https://api.openai.com/v1"],
  ["us", "https://us.api.openai.com/v1"],
  ["eu", "https://eu.api.openai.com/v1"],
  ["ae", "https://ae.api.openai.com/v1"]
]);
function resolveDataResidency(options) {
  if (options.dataResidency === null || options.dataResidency === void 0) {
    return void 0;
  }
  if (hasOwn(options, "baseURL")) {
    throw new OpenAIError("The `dataResidency` and `baseURL` options are mutually exclusive.");
  }
  const endpoint = endpoints.get(options.dataResidency);
  if (endpoint === void 0) {
    throw new OpenAIError("Invalid `dataResidency`; expected one of: global, us, eu, ae.");
  }
  return endpoint;
}

// ../../../node_modules/openai/core/api-promise.mjs
var _APIPromise_client;
var APIPromise = class _APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse2 = defaultParseResponse) {
    super((resolve) => {
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse2;
    _APIPromise_client.set(this, void 0);
    __classPrivateFieldSet(this, _APIPromise_client, client, "f");
  }
  _thenUnwrap(transform) {
    return new _APIPromise(__classPrivateFieldGet(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => addRequestID(transform(await this.parseResponse(client, props), props), props.response));
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data, the raw `Response` instance and the ID of the request,
   * returned via the X-Request-ID header which is useful for debugging requests and reporting
   * issues to OpenAI.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response, request_id: response.headers.get("x-request-id") };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(__classPrivateFieldGet(this, _APIPromise_client, "f"), data));
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
};
_APIPromise_client = /* @__PURE__ */ new WeakMap();

// ../../../node_modules/openai/core/pagination.mjs
var _AbstractPage_client;
var AbstractPage = class {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, void 0);
    __classPrivateFieldSet(this, _AbstractPage_client, client, "f");
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length)
      return false;
    return this.nextPageRequestOptions() != null;
  }
  async getNextPage() {
    const nextOptions = this.nextPageRequestOptions();
    if (!nextOptions) {
      throw new OpenAIError("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
    }
    return await __classPrivateFieldGet(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
  }
  async *iterPages() {
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async *[(_AbstractPage_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
};
var PagePromise = class extends APIPromise {
  constructor(client, request, Page2) {
    super(client, request, async (client2, props) => new Page2(client2, props.response, await defaultParseResponse(client2, props), props.options));
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
};
var Page = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.object = body.object;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    return null;
  }
};
var CursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const data = this.getPaginatedItems();
    const id = data[data.length - 1]?.id;
    if (!id) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: id
      }
    };
  }
};
var ConversationCursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.last_id = body.last_id || "";
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const cursor = this.last_id;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: cursor
      }
    };
  }
};
var NextCursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.next = body.next || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const cursor = this.next;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: cursor
      }
    };
  }
};

// ../../../node_modules/openai/auth/workload-identity-auth.mjs
var SUBJECT_TOKEN_TYPES = {
  jwt: "urn:ietf:params:oauth:token-type:jwt",
  id: "urn:ietf:params:oauth:token-type:id_token"
};
var TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
var MAX_REFRESH_BUFFER_FRACTION = 0.5;
function calculateRefreshAt(expiresAt, now, refreshBufferSeconds) {
  const configuredBufferMs = (refreshBufferSeconds ?? 1200) * 1e3;
  const effectiveBufferMs = Math.min(configuredBufferMs, (expiresAt - now) * MAX_REFRESH_BUFFER_FRACTION);
  return expiresAt - effectiveBufferMs;
}
var NATIVE_RESPONSE_PROTOTYPE = Response.prototype;
var READ_NATIVE_RESPONSE_BODY = NATIVE_RESPONSE_PROTOTYPE.arrayBuffer;
function isResponsePrototype(response, prototype) {
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (prototype === response || typeof constructor !== "function" || Object.getOwnPropertyDescriptor(constructor, "name")?.value !== "Response" || Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype) {
    return false;
  }
  const tag = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
  return (tag?.value === "Response" || typeof tag?.get === "function") && typeof Object.getOwnPropertyDescriptor(prototype, "headers")?.get === "function" && typeof Object.getOwnPropertyDescriptor(prototype, "ok")?.get === "function" && typeof Object.getOwnPropertyDescriptor(prototype, "status")?.get === "function";
}
function isResponseBodyPrototype(prototype, responsePrototype) {
  if (prototype === responsePrototype) {
    return true;
  }
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return responsePrototype !== null && Object.getPrototypeOf(responsePrototype) === prototype && typeof constructor === "function" && Object.getOwnPropertyDescriptor(constructor, "name")?.value === "Body" && Object.getOwnPropertyDescriptor(constructor, "prototype")?.value === prototype;
}
function decodeNativeResponseBody(body) {
  const scope = globalThis;
  return new TextDecoder("utf-8", { ignoreBOM: typeof scope.Bun?.version === "string" }).decode(body);
}
async function parseOAuthTokenResponse(response) {
  let readText;
  let responsePrototype = null;
  for (let depth = 0, prototype = response; prototype !== null && depth < 16; prototype = Object.getPrototypeOf(prototype), depth += 1) {
    if (prototype === NATIVE_RESPONSE_PROTOTYPE) {
      break;
    }
    if (isResponsePrototype(response, prototype)) {
      responsePrototype = prototype;
    }
    const parser = Object.getOwnPropertyDescriptor(prototype, "json");
    if (!parser) {
      continue;
    }
    if (typeof parser.value !== "function") {
      break;
    }
    const bodyReader = Object.getOwnPropertyDescriptor(prototype, "text")?.value;
    if (typeof bodyReader === "function" && isResponseBodyPrototype(prototype, responsePrototype)) {
      readText = bodyReader;
      break;
    }
    return parser.value.call(response);
  }
  const body = readText === void 0 ? decodeNativeResponseBody(await READ_NATIVE_RESPONSE_BODY.call(response)) : await readText.call(response);
  try {
    return JSON.parse(body);
  } catch {
    throw new SyntaxError("Token exchange response contains invalid JSON");
  }
}
function isUnsafeAccessToken(accessToken) {
  const scope = globalThis;
  if (typeof scope.Bun?.version === "string") {
    return /[^\t\u0020-\u007E]|^[\t ]|[\t ]$/u.test(accessToken);
  }
  return /[^\t\u0020-\u007E\u0080-\u00FF]|^[\t ]|[\t ]$/u.test(accessToken);
}
var WorkloadIdentityAuth = class _WorkloadIdentityAuth {
  /**
   * Creates a workload-identity token cache and OAuth token-exchange client.
   *
   * @param config External identity provider, OpenAI service account, and refresh settings.
   * @param fetch Optional fetch implementation for calls to the OpenAI token endpoint.
   */
  constructor(config2, fetch2) {
    this.cachedToken = null;
    this.refreshPromise = null;
    this.tokenGeneration = 0;
    this.tokenExchangeUrl = "https://auth.openai.com/oauth/token";
    const { identityProviderId, serviceAccountId, clientId, refreshBufferSeconds, provider } = config2;
    this.config = {
      identityProviderId,
      serviceAccountId,
      ...clientId === void 0 ? {} : { clientId },
      ...refreshBufferSeconds === void 0 ? {} : { refreshBufferSeconds },
      provider: {
        tokenType: provider.tokenType,
        getToken: provider.getToken.bind(provider)
      }
    };
    this.fetch = fetch2 ?? getDefaultFetch();
  }
  /**
   * Returns a valid OpenAI access token, exchanging or refreshing credentials as needed.
   *
   * Cached tokens nearing expiration are returned immediately while a background
   * refresh runs. Concurrent callers share the same in-flight token exchange.
   *
   * @throws {OAuthError} When the token endpoint rejects the subject token or identity.
   * @throws {APIError} When another unsuccessful HTTP response prevents token exchange.
   * @throws {OpenAIError} When a successful exchange has an invalid access token or expiration.
   */
  async getToken() {
    if (!this.cachedToken || _WorkloadIdentityAuth.isTokenExpired(this.cachedToken)) {
      if (this.refreshPromise) {
        return await this.refreshPromise;
      }
      const refreshPromise = this.refreshToken(this.tokenGeneration);
      this.refreshPromise = refreshPromise;
      try {
        return await refreshPromise;
      } finally {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      }
    }
    if (_WorkloadIdentityAuth.needsRefresh(this.cachedToken) && !this.refreshPromise) {
      const refreshPromise = this.refreshToken(this.tokenGeneration).finally(() => {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      });
      this.refreshPromise = refreshPromise;
      void refreshPromise.catch(() => null);
    }
    return this.cachedToken.token;
  }
  async refreshToken(generation) {
    const subjectToken = await this.config.provider.getToken();
    const body = {
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: subjectToken,
      subject_token_type: SUBJECT_TOKEN_TYPES[this.config.provider.tokenType],
      identity_provider_id: this.config.identityProviderId,
      service_account_id: this.config.serviceAccountId
    };
    if (this.config.clientId) {
      body["client_id"] = this.config.clientId;
    }
    const response = await this.fetch(this.tokenExchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      redirect: "manual"
    });
    if (!response.ok) {
      const errorText = await response.text();
      let body2 = void 0;
      try {
        body2 = JSON.parse(errorText);
      } catch {
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new OAuthError(response.status, body2, response.headers);
      }
      throw APIError.generate(response.status, body2, `Token exchange failed with status ${response.status}`, response.headers);
    }
    const tokenResponse = await parseOAuthTokenResponse(response);
    const accessToken = typeof tokenResponse === "object" && tokenResponse !== null && "access_token" in tokenResponse ? tokenResponse.access_token : void 0;
    if (typeof accessToken !== "string" || accessToken.trim().length === 0 || isUnsafeAccessToken(accessToken)) {
      throw new OpenAIError("Token exchange response missing 'access_token' field");
    }
    const expiresIn = tokenResponse.expires_in ?? 3600;
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }
    const now = Date.now();
    const expiresAt = now + expiresIn * 1e3;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }
    if (this.tokenGeneration === generation) {
      this.cachedToken = {
        token: accessToken,
        expiresAt,
        refreshAt: calculateRefreshAt(expiresAt, now, this.config.refreshBufferSeconds)
      };
    }
    return accessToken;
  }
  static isTokenExpired(cachedToken) {
    return Date.now() >= cachedToken.expiresAt;
  }
  static needsRefresh(cachedToken) {
    return Date.now() >= cachedToken.refreshAt;
  }
  /** Discards the cached access token so the next request performs a fresh exchange. */
  invalidateToken() {
    this.tokenGeneration += 1;
    this.cachedToken = null;
    this.refreshPromise = null;
  }
};

// ../../../node_modules/openai/internal/auth/x509-api-origin.mjs
var X509_API_BASE_URL = "https://mtls.api.openai.com/v1";
function assertX509APIOrigin(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new OpenAIError("X.509 workload identity requires the approved global mTLS API origin.");
  }
  if (target.origin !== "https://mtls.api.openai.com" || target.username || target.password) {
    throw new OpenAIError("X.509 workload identity requires the approved global mTLS API origin.");
  }
  for (const name of target.searchParams.keys()) {
    if (isSensitiveQueryParameter(name)) {
      throw new OpenAIError("X.509 workload identity cannot send conflicting query authentication credentials.");
    }
  }
  return target;
}

// ../../../node_modules/openai/internal/headers.mjs
var brand_privateNullableHeaders = /* @__PURE__ */ Symbol("brand.privateNullableHeaders");
var httpTokenHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function* iterateHeaders(headers) {
  if (!headers)
    return;
  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }
  let shouldClear = false;
  let iter;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== "string")
      throw new TypeError("expected header name to be a string");
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === void 0)
        continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}
var buildHeaders = (newHeaders) => {
  const targetHeaders = new Headers();
  const nullHeaders = /* @__PURE__ */ new Set();
  for (const headers of newHeaders) {
    const seenHeaders = /* @__PURE__ */ new Set();
    for (const [name, value] of iterateHeaders(headers)) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(lowerName);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(lowerName);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(lowerName, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

// ../../../node_modules/openai/internal/auth/x509-transport-state-browser.mjs
var x509_transport_state_browser_exports = {};
__export(x509_transport_state_browser_exports, {
  findRegisteredX509Transport: () => findRegisteredX509Transport,
  findX509Credential: () => findX509Credential,
  findX509OAuthError: () => findX509OAuthError,
  isApprovedX509Client: () => isApprovedX509Client,
  isRetryableX509IssuerError: () => isRetryableX509IssuerError,
  isTransientX509ConnectionError: () => isTransientX509ConnectionError,
  markApprovedX509Client: () => markApprovedX509Client,
  markRetryableX509IssuerError: () => markRetryableX509IssuerError,
  markTransientX509ConnectionError: () => markTransientX509ConnectionError,
  rememberRegisteredX509Transport: () => rememberRegisteredX509Transport,
  rememberX509Credential: () => rememberX509Credential,
  rememberX509OAuthError: () => rememberX509OAuthError
});
var registeredX509Transports = /* @__PURE__ */ new WeakMap();
var transientX509ConnectionErrors = /* @__PURE__ */ new WeakSet();
var retryableX509IssuerErrors = /* @__PURE__ */ new WeakSet();
var approvedX509Clients = /* @__PURE__ */ new WeakSet();
var approvedX509OAuthErrors = /* @__PURE__ */ new WeakMap();
var approvedX509Credentials = /* @__PURE__ */ new WeakMap();
var findRegisteredX509Transport = WeakMap.prototype.get.bind(registeredX509Transports);
var rememberRegisteredX509Transport = WeakMap.prototype.set.bind(registeredX509Transports);
var markTransientX509ConnectionError = WeakSet.prototype.add.bind(transientX509ConnectionErrors);
var isTransientX509ConnectionError = WeakSet.prototype.has.bind(transientX509ConnectionErrors);
var markRetryableX509IssuerError = WeakSet.prototype.add.bind(retryableX509IssuerErrors);
var isRetryableX509IssuerError = WeakSet.prototype.has.bind(retryableX509IssuerErrors);
var markApprovedX509Client = WeakSet.prototype.add.bind(approvedX509Clients);
var isApprovedX509Client = WeakSet.prototype.has.bind(approvedX509Clients);
var rememberX509OAuthError = WeakMap.prototype.set.bind(approvedX509OAuthErrors);
var findX509OAuthError = WeakMap.prototype.get.bind(approvedX509OAuthErrors);
var rememberX509Credential = WeakMap.prototype.set.bind(approvedX509Credentials);
var findX509Credential = WeakMap.prototype.get.bind(approvedX509Credentials);

// ../../../node_modules/openai/internal/auth/x509-transport-state.mjs
var nodeState = __toESM(require_x509_transport_state(), 1);
var state = typeof nodeState.findRegisteredX509Transport === "function" ? nodeState : x509_transport_state_browser_exports;
var {
  findRegisteredX509Transport: findRegisteredX509Transport3,
  rememberRegisteredX509Transport: rememberRegisteredX509Transport2,
  markTransientX509ConnectionError: markTransientX509ConnectionError2,
  isTransientX509ConnectionError: isTransientX509ConnectionError2,
  markRetryableX509IssuerError: markRetryableX509IssuerError2,
  isRetryableX509IssuerError: isRetryableX509IssuerError2,
  markApprovedX509Client: markApprovedX509Client2,
  isApprovedX509Client: isApprovedX509Client2,
  rememberX509OAuthError: rememberX509OAuthError2,
  findX509OAuthError: findX509OAuthError2,
  rememberX509Credential: rememberX509Credential2,
  findX509Credential: findX509Credential2
} = state;

// ../../../node_modules/openai/internal/auth/x509-transport-registry.mjs
function resolveX509Transport(value) {
  if (!value || typeof value !== "object") {
    throw new OpenAIError("X.509 workload identity requires an approved X.509 transport capability.");
  }
  const registered = findRegisteredX509Transport3(value);
  if (!registered) {
    throw new OpenAIError("X.509 workload identity requires an approved X.509 transport capability.");
  }
  return registered;
}

// ../../../node_modules/openai/internal/auth/x509-workload-identity-auth.mjs
var _X509WorkloadIdentityAuth_instances;
var _a;
var _X509WorkloadIdentityAuth_identityProviderId;
var _X509WorkloadIdentityAuth_serviceAccountId;
var _X509WorkloadIdentityAuth_configuredRefreshBufferMs;
var _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds;
var _X509WorkloadIdentityAuth_organization;
var _X509WorkloadIdentityAuth_project;
var _X509WorkloadIdentityAuth_transport;
var _X509WorkloadIdentityAuth_refreshBufferMs;
var _X509WorkloadIdentityAuth_cachedToken;
var _X509WorkloadIdentityAuth_refresh;
var _X509WorkloadIdentityAuth_tokenGeneration;
var _X509WorkloadIdentityAuth_cancelRequestBody;
var _X509WorkloadIdentityAuth_assignToken;
var _X509WorkloadIdentityAuth_recoverRefreshFailure;
var _X509WorkloadIdentityAuth_fallbackToken;
var _X509WorkloadIdentityAuth_retireRefresh;
var _X509WorkloadIdentityAuth_beginRefresh;
var _X509WorkloadIdentityAuth_refreshToken;
var _X509WorkloadIdentityAuth_preflight;
var _X509WorkloadIdentityAuth_scope;
var _X509WorkloadIdentityAuth_assertTenantHeaders;
var FORBIDDEN_TRANSPORT_OPTIONS = ["dispatcher", "agent", "client", "tls", "proxy"];
var headerValue = (headers, name) => Headers.prototype.get.call(headers, name);
var DEFAULT_REFRESH_BUFFER_MS = 20 * 60 * 1e3;
var FAILED_REFRESH_COOLDOWN_MS = 1e3;
var userAbortError = (signal) => {
  const error = new APIUserAbortError();
  Object.defineProperty(error, "cause", { value: signal.reason, writable: true, configurable: true });
  return error;
};
function assertSafeHeaders(headers) {
  for (const name of Headers.prototype.keys.call(headers)) {
    const canonical = name.toLowerCase().split("_").join("-");
    if (canonical !== "authorization" && isSensitiveHeader(canonical) || canonical === "host") {
      throw new OpenAIError("X.509 workload identity cannot send conflicting authentication credentials.");
    }
  }
}
function exchangeDeadline(timeout, callerSignal) {
  const deadline = new AbortController();
  const timer = timeout === void 0 ? void 0 : setTimeout(() => deadline.abort(new APIConnectionTimeoutError()), timeout);
  const timerHandle = timer;
  if (typeof timerHandle === "object" && timerHandle !== null && "unref" in timerHandle && typeof timerHandle.unref === "function") {
    timerHandle.unref();
  }
  const cancel = () => deadline.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", cancel, { once: true });
  if (callerSignal?.aborted) {
    cancel();
  }
  return {
    signal: deadline.signal,
    dispose: () => {
      callerSignal?.removeEventListener("abort", cancel);
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
function waitForRefresh(attempt, signal) {
  let abort;
  const canceled = new Promise((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  });
  return {
    result: Promise.race([attempt.promise, canceled]),
    dispose: () => {
      if (abort) {
        signal.removeEventListener("abort", abort);
      }
    }
  };
}
function isX509WorkloadIdentity(identity) {
  if (!identity || typeof identity !== "object") {
    return false;
  }
  let providerOwner = identity;
  while (providerOwner !== null && providerOwner !== Object.prototype) {
    const provider = Object.getOwnPropertyDescriptor(providerOwner, "provider");
    if (provider) {
      if (!("value" in provider) || provider.value !== void 0) {
        return false;
      }
      break;
    }
    providerOwner = Object.getPrototypeOf(providerOwner);
  }
  let current = identity;
  while (current !== null && current !== Object.prototype) {
    const discriminator = Object.getOwnPropertyDescriptor(current, "type");
    if (discriminator) {
      if (!("value" in discriminator)) {
        throw new OpenAIError("X.509 workload identity type must be a plain data property.");
      }
      return discriminator.value === "x509";
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}
function assertX509FetchOptions(options) {
  if (!options) {
    return;
  }
  for (const name of FORBIDDEN_TRANSPORT_OPTIONS) {
    if (hasOwn(options, name)) {
      throw new OpenAIError("X.509 workload identity cannot override its approved transport capability.");
    }
  }
  const redirect = Object.getOwnPropertyDescriptor(options, "redirect")?.value;
  if (redirect !== void 0 && redirect !== "manual") {
    throw new OpenAIError("X.509 workload identity requests require manual redirects.");
  }
}
function assertX509RequestOptions(options) {
  assertX509FetchOptions(options);
  if (options && ["body", "headers", "method", "signal"].some((name) => hasOwn(options, name))) {
    throw new OpenAIError("X.509 workload identity cannot override its request body, headers, method, or signal through fetch options.");
  }
}
function snapshotX509RequestOptions(options) {
  assertX509RequestOptions(options);
  const snapshot = { ...options };
  assertX509RequestOptions(snapshot);
  return snapshot;
}
var X509WorkloadIdentityAuth = class {
  /** Captures one registered, immutable certificate identity and its enrolled selectors. */
  constructor(identity, transport, organization, project) {
    _X509WorkloadIdentityAuth_instances.add(this);
    _X509WorkloadIdentityAuth_identityProviderId.set(this, void 0);
    _X509WorkloadIdentityAuth_serviceAccountId.set(this, void 0);
    _X509WorkloadIdentityAuth_configuredRefreshBufferMs.set(this, void 0);
    _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds.set(this, void 0);
    _X509WorkloadIdentityAuth_organization.set(this, void 0);
    _X509WorkloadIdentityAuth_project.set(this, void 0);
    _X509WorkloadIdentityAuth_transport.set(this, void 0);
    _X509WorkloadIdentityAuth_refreshBufferMs.set(this, void 0);
    _X509WorkloadIdentityAuth_cachedToken.set(this, void 0);
    _X509WorkloadIdentityAuth_refresh.set(this, void 0);
    _X509WorkloadIdentityAuth_tokenGeneration.set(this, 0);
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_transport, resolveX509Transport(transport), "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_identityProviderId, identity.identityProviderId, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_serviceAccountId, identity.serviceAccountId, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, identity.refreshBufferMs, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, identity.refreshBufferSeconds, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_organization, organization, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_project, project, "f");
    if (__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f") !== void 0 && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") !== void 0) {
      throw new OpenAIError("X.509 workload identity cannot combine refreshBufferSeconds and refreshBufferMs.");
    }
    if (__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f") !== void 0 && (!Number.isSafeInteger(__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f")) || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f") < 0)) {
      throw new OpenAIError("X.509 workload identity requires a nonnegative integer refreshBufferMs.");
    }
    if (__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") !== void 0 && (!Number.isSafeInteger(__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f")) || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") < 0 || !Number.isSafeInteger(__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") * 1e3))) {
      throw new OpenAIError("X.509 workload identity requires a nonnegative integer refreshBufferSeconds.");
    }
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_refreshBufferMs, __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") === void 0 ? __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f") ?? DEFAULT_REFRESH_BUFFER_MS : __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") * 1e3, "f");
  }
  /** Reconstructs the immutable selectors captured before caller-owned identity mutation. */
  identitySnapshot() {
    return {
      type: "x509",
      identityProviderId: __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_identityProviderId, "f"),
      serviceAccountId: __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_serviceAccountId, "f"),
      ...__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f") === void 0 ? {} : { refreshBufferMs: __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferMs, "f") },
      ...__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") === void 0 ? {} : { refreshBufferSeconds: __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds, "f") }
    };
  }
  /** Preserves explicitly headerless requests without presenting a certificate to the issuer. */
  static shouldAuthenticate(options, defaultHeaders, requestHeaders = options.headers) {
    return !buildHeaders([defaultHeaders, requestHeaders]).nulls.has("authorization");
  }
  /** Snapshots each caller-owned header layer once while preserving nulls and precedence. */
  snapshotHeaders(defaultHeaders, requestHeaders) {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    scope.defaultHeaders ?? (scope.defaultHeaders = buildHeaders([defaultHeaders]));
    scope.requestHeaders ?? (scope.requestHeaders = buildHeaders([requestHeaders]));
    return this.headerSnapshots();
  }
  /** Returns the already rendered caller headers without touching mutable inputs again. */
  headerSnapshots() {
    const { defaultHeaders, requestHeaders } = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (!defaultHeaders || !requestHeaders) {
      throw new OpenAIError("X.509 workload identity requires snapshotted request headers.");
    }
    return { defaultHeaders, requestHeaders };
  }
  /** Captures enrolled public tenant selectors once before certificate presentation. */
  snapshotTenant(organization, project) {
    if (organization !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_organization, "f") || project !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_project, "f")) {
      throw new OpenAIError("X.509 workload identity cannot override its enrolled organization or project.");
    }
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    scope.tenant = { organization, project };
    return scope.tenant;
  }
  /** Returns the tenant selectors already approved for this logical request. */
  tenantSnapshot() {
    const { tenant } = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (!tenant) {
      throw new OpenAIError("X.509 workload identity requires snapshotted tenant selectors.");
    }
    return tenant;
  }
  /** Validates and retains the exact destination that authenticated dispatch will use. */
  snapshotAPIURL(value) {
    assertX509APIOrigin(value);
    __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this).apiURL = value;
  }
  /** Reads the already-approved destination without rerendering caller-owned request options. */
  requestAPIURL() {
    const { apiURL } = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (apiURL === void 0) {
      throw new OpenAIError("X.509 workload identity requires a snapshotted API destination.");
    }
    return apiURL;
  }
  /** Captures the exact caller settings approved for authenticated dispatch. */
  snapshotRequest(signal, timeout, fetchOptions) {
    var _b;
    (_b = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this)).request ?? (_b.request = { signal, timeout, fetchOptions });
  }
  /** Returns immutable request settings without invoking caller-owned accessors again. */
  requestSnapshot() {
    const { request } = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (!request) {
      throw new OpenAIError("X.509 workload identity requires snapshotted request settings.");
    }
    return request;
  }
  /** Suspends an already-running network budget during retry-local asynchronous preparation. */
  beginRequestPreparation() {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (scope.deadlineArmed && scope.preparationStartedAt === void 0) {
      scope.preparationStartedAt = performance.now();
      scope.preparationWallStartedAt = Date.now();
    }
  }
  /** Begins local request construction without charging protected hook latency to the network. */
  beginRequestPlanning() {
    __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this).phase = "planning";
  }
  /** Arms one absolute network deadline only after all local request preparation completes. */
  beginRequestNetwork() {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (!scope.deadlineArmed) {
      scope.wallStartedAt = Date.now();
      scope.monotonicStartedAt = performance.now();
      scope.deadlineArmed = true;
    } else if (scope.preparationStartedAt !== void 0) {
      scope.monotonicStartedAt += performance.now() - scope.preparationStartedAt;
      scope.wallStartedAt += Date.now() - (scope.preparationWallStartedAt ?? Date.now());
      delete scope.preparationStartedAt;
      delete scope.preparationWallStartedAt;
    }
  }
  /** Keeps certificate authentication outside overridable request construction. */
  isPlanningRequest() {
    return __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this).phase === "planning";
  }
  /** Approves the final overridden destination and transport before minting a bearer. */
  authorizePlannedRequest(url, request, timeout, allowHookSignal = false) {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    const headers = Object.getOwnPropertyDescriptor(request, "headers");
    const body = Object.getOwnPropertyDescriptor(request, "body");
    const signal = Object.getOwnPropertyDescriptor(request, "signal");
    const redirect = Object.getOwnPropertyDescriptor(request, "redirect");
    if (scope.phase !== "planning" || !headers || !(headers.value instanceof Headers) || !body && "body" in request || [body, signal, redirect].some((descriptor) => descriptor && !("value" in descriptor))) {
      throw new OpenAIError("X.509 workload identity requires an approved final request.");
    }
    this.snapshotAPIURL(url);
    assertX509FetchOptions(request);
    try {
      assertSafeHeaders(headers.value);
    } catch {
      throw new OpenAIError("X.509 workload identity cannot use caller-supplied authentication credentials.");
    }
    if (headerValue(headers.value, "Authorization") !== null) {
      throw new OpenAIError("X.509 workload identity cannot use caller-supplied authorization credentials.");
    }
    __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_assertTenantHeaders).call(this, headers.value);
    if (!allowHookSignal && (signal?.value ?? void 0) !== (this.requestSnapshot().signal ?? void 0)) {
      throw new OpenAIError("X.509 workload identity must preserve its approved request signal.");
    }
    const approved = this.requestSnapshot();
    scope.request = { ...approved, timeout: Math.min(approved.timeout, timeout) };
    scope.phase = "authorizing";
  }
  /** Owns only SDK-created iterator adapters until authenticated dispatch takes responsibility. */
  ownRequestBody(body, source) {
    if (body instanceof ReadableStream && body !== source) {
      __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this).materializedBody = body;
    }
  }
  /** Recognizes every one-shot upload before issuer authentication or request replay. */
  static isStreamingRequestBody(body) {
    return globalThis.ReadableStream !== void 0 && body instanceof globalThis.ReadableStream || typeof body === "object" && body !== null && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function");
  }
  /** Retires abandoned upload adapters without masking or blocking their authentication failure. */
  retireRequestBody() {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    const body = scope.materializedBody;
    delete scope.materializedBody;
    if (body) {
      void __classPrivateFieldGet(_a, _a, "m", _X509WorkloadIdentityAuth_cancelRequestBody).call(_a, body);
    }
  }
  /** Transfers the dispatched upload while retiring any SDK-owned body replaced by a hook. */
  releaseRequestBody(body) {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    if (scope.materializedBody === body) {
      delete scope.materializedBody;
    } else {
      this.retireRequestBody();
    }
  }
  /** Retains caller-only cancellation separately from SDK-created deadline controllers. */
  setEffectiveSignal(signal) {
    if (signal) {
      __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this).effectiveSignal = signal;
    } else {
      delete __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this).effectiveSignal;
    }
  }
  /** Uses protected-hook cancellation when an authenticated attempt enters retry backoff. */
  effectiveSignal() {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    return scope.effectiveSignal ?? scope.request?.signal;
  }
  /** Establishes an independent scope even when concurrent requests share caller options. */
  runRequest(operation, requestOwner) {
    return __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").run(async () => {
      const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current();
      if (!scope) {
        throw new OpenAIError("X.509 workload identity requires an active certificate request scope.");
      }
      scope.owner = this;
      scope.requestOwner = requestOwner;
      try {
        return await operation();
      } finally {
        this.retireRequestBody();
        this.releaseRequestCredentials();
        delete scope.requestOwner;
        delete scope.owner;
      }
    });
  }
  /** Reports whether a public request-building call already belongs to an active logical operation. */
  inRequest(requestOwner) {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current();
    return scope?.owner === this && scope.requestOwner === requestOwner && scope.phase !== "authorizing";
  }
  /** Shares a cache only when the complete, privately snapshotted credential identity matches. */
  matches(other) {
    return __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f") === __classPrivateFieldGet(other, _X509WorkloadIdentityAuth_transport, "f") && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_identityProviderId, "f") === __classPrivateFieldGet(other, _X509WorkloadIdentityAuth_identityProviderId, "f") && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_serviceAccountId, "f") === __classPrivateFieldGet(other, _X509WorkloadIdentityAuth_serviceAccountId, "f") && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_organization, "f") === __classPrivateFieldGet(other, _X509WorkloadIdentityAuth_organization, "f") && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_project, "f") === __classPrivateFieldGet(other, _X509WorkloadIdentityAuth_project, "f") && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refreshBufferMs, "f") === __classPrivateFieldGet(other, _X509WorkloadIdentityAuth_refreshBufferMs, "f");
  }
  /** Binds deferred response parsing to the original logical request and its unchanged deadline. */
  continuation() {
    const { wallStartedAt, monotonicStartedAt, deadlineArmed, request, requestOwner, effectiveSignal } = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    const scope = {
      wallStartedAt,
      monotonicStartedAt,
      owner: this,
      ...deadlineArmed ? { deadlineArmed } : {},
      ...request ? { request } : {},
      ...effectiveSignal ? { effectiveSignal } : {},
      ...requestOwner ? { requestOwner } : {}
    };
    return (operation) => __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").resume(scope, async () => {
      try {
        return await operation();
      } finally {
        this.releaseRequestCredentials();
        delete scope.requestOwner;
        delete scope.owner;
      }
    });
  }
  /** Removes dispatched bearer material before settled request promises can retain their scope. */
  releaseRequestCredentials() {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    delete scope.request;
    delete scope.phase;
    delete scope.deadlineArmed;
    delete scope.preparationStartedAt;
    delete scope.preparationWallStartedAt;
    delete scope.effectiveSignal;
    delete scope.materializedBody;
    delete scope.apiURL;
    delete scope.tenant;
    delete scope.token;
    delete scope.defaultHeaders;
    delete scope.requestHeaders;
    delete scope.tokenGeneration;
    delete scope.headers;
    delete scope.authorization;
  }
  /** Returns the original authentication start so response consumption shares its request deadline. */
  requestStartedAt(_options) {
    return __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current()?.wallStartedAt;
  }
  /** Distinguishes issued workload credentials from independent admin or headerless requests. */
  usedWorkloadToken(_options) {
    return __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current()?.token !== void 0;
  }
  /** Returns the budget left after certificate authentication without starting another timeout. */
  remainingTimeout(_options, timeout) {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current();
    if (scope === void 0) {
      return timeout;
    }
    const remaining = timeout - (performance.now() - scope.monotonicStartedAt);
    if (remaining <= 0) {
      throw new APIConnectionTimeoutError();
    }
    return remaining;
  }
  /** Cancels active retry timers promptly without changing public caller-abort semantics. */
  async waitForRetry(duration, signal) {
    try {
      await __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").sleep(duration, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw userAbortError(signal);
      }
      throw error;
    }
  }
  /** Trusts only issuer or connection failures privately branded by the approved transport. */
  static isRetryableFailure(error) {
    return typeof error === "object" && error !== null && (isTransientX509ConnectionError2(error) || isRetryableX509IssuerError2(error));
  }
  /** Reads safe retry hints only from a privately branded, sanitized issuer response. */
  static retryHeaders(error) {
    if (!error || typeof error !== "object" || !isRetryableX509IssuerError2(error)) {
      return void 0;
    }
    const headers = Object.getOwnPropertyDescriptor(error, "headers")?.value;
    return headers instanceof Headers ? headers : void 0;
  }
  /** Exchanges the exact certificate capability selected for the matching API dispatch. */
  async getToken(options, context) {
    const callerSignal = context ? context.signal : options?.signal;
    if (callerSignal?.aborted) {
      throw userAbortError(callerSignal);
    }
    if (options) {
      assertX509RequestOptions(context ? context.fetchOptions : options.fetchOptions);
    }
    __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_preflight).call(this, context);
    const scope = options ? __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this) : void 0;
    const cached = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_cachedToken, "f");
    if (cached && performance.now() < cached.refreshAt && Date.now() < cached.wallRefreshAt) {
      return __classPrivateFieldGet(_a, _a, "m", _X509WorkloadIdentityAuth_assignToken).call(_a, scope, cached);
    }
    const remaining = context && options ? this.remainingTimeout(options, context.timeout) : context?.timeout;
    const { signal, dispose } = exchangeDeadline(remaining, callerSignal);
    if (callerSignal?.aborted) {
      dispose();
      throw userAbortError(callerSignal);
    }
    const attempt = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refresh, "f") ?? __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_beginRefresh).call(this);
    attempt.waiters += 1;
    const waiter = waitForRefresh(attempt, signal);
    try {
      const exchanged = await waiter.result;
      const refreshed = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_cachedToken, "f");
      if (!refreshed || refreshed.accessToken !== exchanged.accessToken) {
        throw new APIUserAbortError();
      }
      return __classPrivateFieldGet(_a, _a, "m", _X509WorkloadIdentityAuth_assignToken).call(_a, scope, refreshed);
    } catch (error) {
      return await __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_recoverRefreshFailure).call(this, error, attempt, cached, scope, options, context);
    } finally {
      waiter.dispose();
      dispose();
      attempt.waiters -= 1;
      __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_retireRefresh).call(this, attempt);
    }
  }
  /** Invalidates only the workload-token generation actually rejected by the current request. */
  invalidateToken() {
    const rejected = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current();
    if (!rejected?.token || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_cachedToken, "f")?.accessToken !== rejected.token || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_cachedToken, "f").generation !== rejected.tokenGeneration) {
      return;
    }
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_tokenGeneration, __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f") + 1, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_cachedToken, void 0, "f");
    const refresh = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refresh, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_refresh, void 0, "f");
    refresh?.controller.abort(new APIUserAbortError());
  }
  /** Binds the minted credential to the original headers before protected request hooks run. */
  bindRequest(options, request, adminAPIKey) {
    if (!(request.headers instanceof Headers)) {
      throw new OpenAIError("X.509 workload identity requires the original workload authorization headers.");
    }
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    const { token } = scope;
    const security = options.__security ?? { bearerAuth: true };
    let approvedAuthorization = token ? `Bearer ${token}` : null;
    if (!token && security.adminAPIKeyAuth && adminAPIKey !== null && headerValue(request.headers, "Authorization") !== null) {
      approvedAuthorization = new Headers({ Authorization: `Bearer ${adminAPIKey}` }).get("Authorization");
    }
    scope.headers = request.headers;
    scope.authorization = approvedAuthorization;
    this.assertRequest(request);
  }
  /** Rebinds an equivalent protected-hook container without relaxing final dispatch identity checks. */
  adoptRequestHeaders(request) {
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_scope).call(this);
    const original = scope.headers;
    if (!(original instanceof Headers) || !(request.headers instanceof Headers)) {
      throw new OpenAIError("X.509 workload identity must preserve its issued workload authorization.");
    }
    scope.headers = request.headers;
    try {
      this.assertRequest(request);
    } catch (error) {
      scope.headers = original;
      throw error;
    }
  }
  /** Rejects request hooks that replace the selected bearer or its approved header identity. */
  assertRequest(request) {
    const { headers } = request;
    if (!(headers instanceof Headers)) {
      throw new OpenAIError("X.509 workload identity must preserve its issued workload authorization.");
    }
    const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current();
    if (!scope || scope.headers !== headers || scope.authorization === void 0 || headerValue(headers, "Authorization") !== scope.authorization) {
      throw new OpenAIError("X.509 workload identity must preserve its issued workload authorization.");
    }
    __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_assertTenantHeaders).call(this, headers);
    assertSafeHeaders(headers);
  }
  /** Returns a guarded final dispatcher while preserving all existing request hook object identities. */
  fetch() {
    return async (input, init = {}) => {
      const target = assertX509APIOrigin(typeof input === "string" || input instanceof URL ? input : input.url);
      assertX509FetchOptions(init);
      this.assertRequest(init);
      const approved = init.headers;
      if (!(approved instanceof Headers)) {
        throw new OpenAIError("X.509 workload identity must preserve its issued workload authorization.");
      }
      const headers = new Headers([...Headers.prototype.entries.call(approved)]);
      assertSafeHeaders(headers);
      init.headers = headers;
      init.redirect = "manual";
      return await __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").dispatch(target, init);
    };
  }
};
_a = X509WorkloadIdentityAuth, _X509WorkloadIdentityAuth_identityProviderId = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_serviceAccountId = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_configuredRefreshBufferMs = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_configuredRefreshBufferSeconds = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_organization = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_project = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_transport = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_refreshBufferMs = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_cachedToken = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_refresh = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_tokenGeneration = /* @__PURE__ */ new WeakMap(), _X509WorkloadIdentityAuth_instances = /* @__PURE__ */ new WeakSet(), _X509WorkloadIdentityAuth_cancelRequestBody = async function _X509WorkloadIdentityAuth_cancelRequestBody2(body) {
  try {
    await CancelReadableStream(body);
  } catch {
  }
}, _X509WorkloadIdentityAuth_assignToken = function _X509WorkloadIdentityAuth_assignToken2(scope, token) {
  if (scope) {
    scope.token = token.accessToken;
    scope.tokenGeneration = token.generation;
  }
  return token.accessToken;
}, _X509WorkloadIdentityAuth_recoverRefreshFailure = async function _X509WorkloadIdentityAuth_recoverRefreshFailure2(error, attempt, cached, scope, options, context) {
  const callerSignal = context ? context.signal : options?.signal;
  if (callerSignal?.aborted) {
    throw userAbortError(callerSignal);
  }
  if (attempt.controller.signal.aborted && attempt.generation !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f")) {
    return await this.getToken(options, context);
  }
  const fallback = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_fallbackToken).call(this, error, cached, scope);
  if (fallback !== void 0) {
    return fallback;
  }
  if (error && typeof error === "object" && !(error instanceof OAuthError)) {
    const oauth = findX509OAuthError2(error);
    if (oauth) {
      throw new OAuthError(oauth.status, oauth.error, oauth.headers);
    }
  }
  throw error;
}, _X509WorkloadIdentityAuth_fallbackToken = function _X509WorkloadIdentityAuth_fallbackToken2(error, cached, scope) {
  if (!cached || cached !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_cachedToken, "f") || performance.now() >= cached.expiresAt || Date.now() >= cached.wallExpiresAt || !_a.isRetryableFailure(error)) {
    return void 0;
  }
  const headers = _a.retryHeaders(error);
  const milliseconds = headers?.get("retry-after-ms");
  let requested = milliseconds ? Number(milliseconds) : void 0;
  const retryAfter = headers?.get("retry-after");
  if (retryAfter && (requested === void 0 || Number.isNaN(requested))) {
    const seconds = Number(retryAfter);
    requested = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1e3;
  }
  const cooldown = requested !== void 0 && Number.isFinite(requested) && requested >= 0 && requested <= 6e4 ? Math.max(FAILED_REFRESH_COOLDOWN_MS, requested) : FAILED_REFRESH_COOLDOWN_MS;
  cached.refreshAt = Math.min(cached.expiresAt, performance.now() + cooldown);
  cached.wallRefreshAt = Math.min(cached.wallExpiresAt, Date.now() + cooldown);
  return __classPrivateFieldGet(_a, _a, "m", _X509WorkloadIdentityAuth_assignToken).call(_a, scope, cached);
}, _X509WorkloadIdentityAuth_retireRefresh = function _X509WorkloadIdentityAuth_retireRefresh2(attempt) {
  if (attempt.waiters !== 0 || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refresh, "f") !== attempt) {
    return;
  }
  queueMicrotask(() => {
    if (attempt.waiters === 0 && __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refresh, "f") === attempt) {
      __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_refresh, void 0, "f");
      __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_tokenGeneration, __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f") + 1, "f");
      attempt.controller.abort(new APIUserAbortError());
    }
  });
}, _X509WorkloadIdentityAuth_beginRefresh = function _X509WorkloadIdentityAuth_beginRefresh2() {
  const controller = new AbortController();
  const generation = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f");
  const attempt = {
    controller,
    generation,
    waiters: 0,
    promise: __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_instances, "m", _X509WorkloadIdentityAuth_refreshToken).call(this, controller, generation)
  };
  __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_refresh, attempt, "f");
  return attempt;
}, _X509WorkloadIdentityAuth_refreshToken = async function _X509WorkloadIdentityAuth_refreshToken2(controller, generation) {
  const startedAt = performance.now();
  const wallStartedAt = Date.now();
  try {
    const token = await __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").exchange(__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_identityProviderId, "f"), __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_serviceAccountId, "f"), controller.signal);
    const lifetime = token.expiresIn * 1e3;
    const expiresAt = startedAt + lifetime;
    const wallExpiresAt = wallStartedAt + lifetime;
    if (performance.now() >= expiresAt || Date.now() >= wallExpiresAt) {
      throw new OpenAIError("X.509 workload identity token expired before its exchange completed.");
    }
    if (__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f") !== generation || controller.signal.aborted || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refresh, "f")?.controller !== controller) {
      throw new APIUserAbortError();
    }
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_tokenGeneration, __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f") + 1, "f");
    __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_cachedToken, {
      accessToken: token.accessToken,
      generation: __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_tokenGeneration, "f"),
      expiresAt,
      refreshAt: expiresAt - Math.min(__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refreshBufferMs, "f"), lifetime / 2),
      wallExpiresAt,
      wallRefreshAt: wallExpiresAt - Math.min(__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refreshBufferMs, "f"), lifetime / 2)
    }, "f");
    return token;
  } finally {
    if (__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_refresh, "f")?.controller === controller) {
      __classPrivateFieldSet(this, _X509WorkloadIdentityAuth_refresh, void 0, "f");
    }
  }
}, _X509WorkloadIdentityAuth_preflight = function _X509WorkloadIdentityAuth_preflight2(context) {
  if (!context) {
    return;
  }
  if (context.organization !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_organization, "f") || context.project !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_project, "f")) {
    throw new OpenAIError("X.509 workload identity cannot override its enrolled organization or project.");
  }
  assertX509APIOrigin(context.apiURL);
  const supplied = buildHeaders([context.defaultHeaders, context.requestHeaders]);
  if (__classPrivateFieldGet(this, _X509WorkloadIdentityAuth_organization, "f") !== null && supplied.nulls.has("openai-organization") || __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_project, "f") !== null && supplied.nulls.has("openai-project")) {
    throw new OpenAIError("X.509 workload identity cannot omit its enrolled organization or project.");
  }
  for (const name of supplied.values.keys()) {
    const canonical = name.toLowerCase().split("_").join("-");
    if ((canonical === "openai-organization" || canonical === "openai-project") && (name !== canonical || headerValue(supplied.values, name) !== (canonical === "openai-organization" ? context.organization : context.project))) {
      throw new OpenAIError("X.509 workload identity cannot override its enrolled organization or project.");
    }
    if (isSensitiveHeader(canonical) || canonical === "host") {
      throw new OpenAIError("X.509 workload identity cannot use caller-supplied authentication credentials.");
    }
  }
}, _X509WorkloadIdentityAuth_scope = function _X509WorkloadIdentityAuth_scope2() {
  const scope = __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_transport, "f").current();
  if (!scope || scope.owner !== this) {
    throw new OpenAIError("X.509 workload identity requires an active certificate request scope.");
  }
  return scope;
}, _X509WorkloadIdentityAuth_assertTenantHeaders = function _X509WorkloadIdentityAuth_assertTenantHeaders2(headers) {
  if (headerValue(headers, "OpenAI-Organization") !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_organization, "f") || headerValue(headers, "OpenAI-Project") !== __classPrivateFieldGet(this, _X509WorkloadIdentityAuth_project, "f")) {
    throw new OpenAIError("X.509 workload identity cannot override its enrolled organization or project.");
  }
  for (const name of Headers.prototype.keys.call(headers)) {
    const canonical = name.toLowerCase().split("_").join("-");
    if ((canonical === "openai-organization" || canonical === "openai-project") && name !== canonical) {
      throw new OpenAIError("X.509 workload identity cannot override its enrolled organization or project.");
    }
  }
};

// ../../../node_modules/openai/internal/auth/x509-credential-options.mjs
function normalizeX509CredentialOptions(options) {
  const { credential } = options;
  if (credential === void 0) {
    return { credential, options };
  }
  const registered = findX509Credential2(credential);
  if (!registered) {
    throw new OpenAIError("An X.509 credential must be created by the SDK authentication helper.");
  }
  const conflicting = ["apiKey", "adminAPIKey", "workloadIdentity", "x509Transport"].filter((name) => {
    const value = options[name];
    return value !== null && value !== void 0;
  });
  if (conflicting.length > 0) {
    throw new OpenAIError(`The \`credential\` option cannot be combined with ${conflicting.map((name) => `\`${name}\``).join(", ")}.`);
  }
  return {
    credential,
    options: {
      ...options,
      apiKey: null,
      adminAPIKey: null,
      baseURL: options.baseURL ?? null,
      organization: options.organization ?? null,
      project: options.project ?? null,
      workloadIdentity: registered.identity,
      x509Transport: registered.transport
    }
  };
}
function overridesOrdinaryAuthentication({ apiKey, adminAPIKey }) {
  return apiKey !== null && apiKey !== void 0 || adminAPIKey !== null && adminAPIKey !== void 0;
}
function prepareProviderClone(inherited, overrides) {
  const inheritedProvider = inherited.provider;
  const replacingProvider = overrides.credential ?? overrides.workloadIdentity;
  const provider = overrides.provider ?? (replacingProvider ? void 0 : inheritedProvider);
  if (provider !== inheritedProvider) {
    delete inherited.baseURL;
    delete inherited.organization;
    delete inherited.project;
    delete inherited.defaultHeaders;
    delete inherited.defaultQuery;
    delete inherited.fetchOptions;
    delete inherited.fetch;
  }
  if (provider) {
    delete inherited.apiKey;
    delete inherited.adminAPIKey;
    delete inherited.credential;
    delete inherited.workloadIdentity;
    delete inherited.x509Transport;
    delete inherited.baseURL;
  }
  return provider;
}
function prepareX509ClientClone(inherited, overrides, credential, currentlyX509) {
  const nextIdentity = hasOwn(overrides, "workloadIdentity") ? overrides.workloadIdentity : inherited.workloadIdentity;
  const dropping = credential !== void 0 && (overridesOrdinaryAuthentication(overrides) && overrides.workloadIdentity === void 0 || overrides.provider !== void 0);
  if (credential !== void 0 && hasOwn(overrides, "workloadIdentity")) {
    delete inherited.x509Transport;
  }
  const inheritedCredential = credential !== void 0 && !dropping && overrides.credential === void 0 && !hasOwn(overrides, "workloadIdentity") && !hasOwn(overrides, "x509Transport") ? credential : void 0;
  const nextCredential = overrides.credential === void 0 ? inheritedCredential : overrides.credential;
  const nextX509 = nextCredential !== void 0 || !dropping && isX509WorkloadIdentity(nextIdentity);
  if (currentlyX509 !== nextX509) {
    delete inherited.fetch;
    delete inherited.baseURL;
    delete inherited.organization;
    delete inherited.project;
    delete inherited.defaultHeaders;
    delete inherited.defaultQuery;
    delete inherited.fetchOptions;
    if (nextX509) {
      inherited.apiKey = null;
    } else {
      delete inherited.x509Transport;
      if (dropping) {
        delete inherited.workloadIdentity;
      }
    }
  }
  if (nextCredential !== void 0) {
    delete inherited.apiKey;
    delete inherited.adminAPIKey;
    delete inherited.workloadIdentity;
    delete inherited.x509Transport;
    inherited.credential = nextCredential;
    if (overrides.credential !== void 0) {
      delete inherited.organization;
      delete inherited.project;
      delete inherited.defaultHeaders;
      delete inherited.defaultQuery;
      delete inherited.fetchOptions;
    }
  }
  return { credential: nextCredential, provider: prepareProviderClone(inherited, overrides) };
}

// ../../../node_modules/openai/internal/uploads.mjs
var brand_privateStreamingFile = /* @__PURE__ */ Symbol("brand.privateStreamingFile");
function toStreamingFile(data, name, options) {
  if (typeof name !== "string" || !name) {
    throw new TypeError("toStreamingFile requires a non-empty file name");
  }
  const type = options?.type;
  if (type) {
    validateStreamingFileType(type);
  }
  return {
    [brand_privateStreamingFile]: true,
    data,
    name,
    ...type ? { type } : {}
  };
}
var checkFileSupport = () => {
  if (typeof File === "undefined") {
    const { process: process2 } = globalThis;
    const isOldNode = typeof process2?.versions?.node === "string" && Number.parseInt(process2.versions.node.split("."), 10) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (isOldNode ? " Update to a supported Node.js LTS release, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function makeFile(fileBits, fileName, options) {
  checkFileSupport();
  return new File(fileBits, fileName ?? "unknown_file", options);
}
function getName(value, options) {
  if (typeof value !== "object" || value === null) {
    return void 0;
  }
  const name = "name" in value ? value.name : void 0;
  const explicitName = name && String(name) || "filename" in value && value.filename && String(value.filename);
  if (explicitName) {
    return options?.stripFilename === false ? normalizeFilenamePath(explicitName) : basename(explicitName);
  }
  const url = "url" in value && value.url && String(value.url);
  if (url) {
    try {
      return basename(new URL(url).pathname);
    } catch {
      return basename(url);
    }
  }
  const path2 = "path" in value && value.path && String(value.path);
  return path2 ? basename(path2) : void 0;
}
function basename(value) {
  return value.split(/[\\/]/).pop() || void 0;
}
function normalizeFilenamePath(value) {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new TypeError("Upload file name must be a safe relative path without parent directory segments");
  }
  return normalized;
}
var isAsyncIterable = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
var maybeMultipartFormRequestOptions = async (opts, fetch2, formOptions) => {
  if (!hasUploadableValue(opts.body)) {
    return opts;
  }
  if (hasStreamingUploadableValue(opts.body)) {
    return createStreamingFormRequestOptions(opts, formOptions);
  }
  return { ...opts, body: await createForm(opts.body, fetch2, formOptions) };
};
var multipartFormRequestOptions = async (opts, fetch2, formOptions) => {
  if (hasStreamingUploadableValue(opts.body)) {
    return createStreamingFormRequestOptions(opts, formOptions);
  }
  return { ...opts, body: await createForm(opts.body, fetch2, formOptions) };
};
var supportsFormDataMap = /* @__PURE__ */ new WeakMap();
function supportsFormData(fetchObject) {
  const fetch2 = typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    try {
      let FetchResponse;
      if ("Response" in fetch2) {
        FetchResponse = fetch2.Response;
      } else {
        const response = await fetch2("data:,");
        await response.arrayBuffer();
        FetchResponse = response.constructor;
      }
      const data = new FormData();
      if (data.toString() === await new FetchResponse(data).text()) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  })();
  supportsFormDataMap.set(fetch2, promise);
  return promise;
}
var createForm = async (body, fetch2, options = {}) => {
  if (!await supportsFormData(fetch2)) {
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  }
  const form = new FormData();
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value, options)));
  return form;
};
var isBlob = (value) => value instanceof Blob;
var isReadableStream = (value) => typeof value === "object" && value !== null && "getReader" in value && typeof value.getReader === "function";
var isStreamingFile = (value) => typeof value === "object" && value !== null && brand_privateStreamingFile in value;
var isUploadable = (value) => typeof value === "object" && value !== null && (value instanceof Response || isAsyncIterable(value) || isReadableStream(value) || isStreamingFile(value) || isBlob(value));
var hasStreamingUploadableValue = (value) => {
  if (isStreamingFile(value) || isAsyncIterable(value) || isReadableStream(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasStreamingUploadableValue);
  }
  if (value && typeof value === "object" && !isBlob(value) && !(value instanceof Response)) {
    for (const k of Object.keys(value)) {
      if (hasStreamingUploadableValue(value[k])) {
        return true;
      }
    }
  }
  return false;
};
var hasUploadableValue = (value) => {
  if (isUploadable(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasUploadableValue);
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (hasUploadableValue(value[k])) {
        return true;
      }
    }
  }
  return false;
};
var snapshotPreservedUploadEntries = (entries, filenames) => {
  const snapshot = [];
  for (const entry of entries) {
    if (isUploadable(entry.value) && !filenames.has(entry.value)) {
      filenames.set(entry.value, getStreamingFileName(entry.value, { stripFilenames: false }));
    }
    snapshot.push(entry);
  }
  return snapshot;
};
var createStreamingFormRequestOptions = (opts, options = {}) => {
  const entries = iterateFormEntries(opts.body);
  const preservedFilenames = options.stripFilenames === false ? /* @__PURE__ */ new WeakMap() : void 0;
  const multipartEntries = preservedFilenames ? snapshotPreservedUploadEntries(entries, preservedFilenames) : entries;
  const boundary = `openai-${Math.random().toString(36).slice(2)}`;
  const body = ReadableStreamFrom(iterateMultipartBody(multipartEntries, boundary, options, preservedFilenames));
  return {
    ...opts,
    body,
    headers: buildHeaders([{ "content-type": `multipart/form-data; boundary=${boundary}` }, opts.headers])
  };
};
async function* iterateMultipartBody(entries, boundary, options, preservedFilenames) {
  for await (const { key, value } of entries) {
    if (isUploadable(value)) {
      const filename = preservedFilenames?.get(value) ?? getStreamingFileName(value, options);
      const type = getStreamingFileType(value);
      yield encodeUTF8(`--${boundary}\r
`);
      yield encodeUTF8(`Content-Disposition: form-data; name="${escapeHeaderValue(key)}"; filename="${escapeHeaderValue(filename)}"\r
Content-Type: ${type}\r
\r
`);
      yield* iterateBytes(getStreamingFileData(value));
    } else {
      yield encodeUTF8(`--${boundary}\r
`);
      yield encodeUTF8(`Content-Disposition: form-data; name="${escapeHeaderValue(key)}"\r
\r
${String(value)}`);
    }
    yield encodeUTF8("\r\n");
  }
  yield encodeUTF8(`--${boundary}--\r
`);
}
function* iterateFormEntries(body) {
  if (!body || typeof body !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(body)) {
    yield* iterateFormValue(key, value);
  }
}
function* iterateFormValue(key, value) {
  if (value === void 0) {
    return;
  }
  if (value == null) {
    throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || isUploadable(value)) {
    yield { key, value };
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      yield* iterateFormValue(key + "[]", entry);
    }
  } else if (typeof value === "object") {
    for (const [name, prop] of Object.entries(value)) {
      yield* iterateFormValue(`${key}[${name}]`, prop);
    }
  } else {
    throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
  }
}
function getStreamingFileName(value, options) {
  if (isStreamingFile(value)) {
    const { name } = value;
    if (typeof name !== "string" || !name) {
      throw new TypeError("Streaming upload file name must be a non-empty string");
    }
    return options.stripFilenames === false ? normalizeFilenamePath(name) : basename(name) ?? "unknown_file";
  }
  return getName(value, { stripFilename: options.stripFilenames }) ?? "unknown_file";
}
function getStreamingFileType(value) {
  let type;
  if (isStreamingFile(value) || isBlob(value)) {
    ({ type } = value);
  } else if (value instanceof Response) {
    type = value.headers.get("content-type") ?? void 0;
  }
  return validateStreamingFileType(type || "application/octet-stream");
}
function validateStreamingFileType(type) {
  if (typeof type !== "string") {
    throw new TypeError("Streaming upload content type must be a string");
  }
  for (let index = 0; index < type.length; index += 1) {
    const character = type.codePointAt(index) ?? 0;
    if (character <= 31 || character === 127) {
      throw new TypeError("Streaming upload content type must not contain control characters");
    }
  }
  return type;
}
function getStreamingFileData(value) {
  if (isStreamingFile(value)) {
    return value.data;
  }
  return value;
}
async function* iterateBytes(value) {
  if (typeof value === "string") {
    yield encodeUTF8(value);
  } else if (ArrayBuffer.isView(value)) {
    yield new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    yield new Uint8Array(value);
  } else if (value instanceof Response) {
    yield* iterateBytes(value.body || await value.blob());
  } else if (value instanceof Blob) {
    if (typeof value.stream === "function") {
      yield* iterateBytes(value.stream());
    } else {
      yield new Uint8Array(await value.arrayBuffer());
    }
  } else if (isReadableStream(value)) {
    for await (const chunk of ReadableStreamToAsyncIterable(value)) {
      yield* iterateBytes(chunk);
    }
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      yield* iterateBytes(chunk);
    }
  } else {
    throw new TypeError(`Invalid streaming file chunk: ${String(value)}`);
  }
}
function escapeHeaderValue(value) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 || character === '"' || character === "\\" ? encodeURIComponent(character) : character;
  }).join("");
}
var addFormValue = async (form, key, value, options) => {
  if (value === void 0) {
    return;
  }
  if (value == null) {
    throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    const blob = await value.blob();
    form.append(key, makeFile([blob], getName(value, { stripFilename: options.stripFilenames }), { type: blob.type }));
  } else if (isAsyncIterable(value)) {
    form.append(key, makeFile([await new Response(ReadableStreamFrom(value)).blob()], getName(value, { stripFilename: options.stripFilenames })));
  } else if (isBlob(value)) {
    const filename = getName(value, { stripFilename: options.stripFilenames });
    if (filename === void 0) {
      form.append(key, value);
    } else {
      form.append(key, value, filename);
    }
  } else if (Array.isArray(value)) {
    const entries = await Promise.all(value.map(async (entry) => {
      const entryForm = new FormData();
      await addFormValue(entryForm, key + "[]", entry, options);
      return entryForm;
    }));
    for (const entryForm of entries) {
      if (!entryForm) {
        continue;
      }
      for (const [entryKey, entryValue] of entryForm.entries()) {
        form.append(entryKey, entryValue);
      }
    }
  } else if (typeof value === "object") {
    await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop, options)));
  } else {
    throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
  }
};

// ../../../node_modules/openai/internal/to-file.mjs
var isBlobLike = (value) => value != null && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string" && typeof value.text === "function" && typeof value.slice === "function" && typeof value.arrayBuffer === "function";
var isFileLike = (value) => value != null && typeof value === "object" && typeof value.name === "string" && typeof value.lastModified === "number" && isBlobLike(value);
var isResponseLike = (value) => value != null && typeof value === "object" && typeof value.url === "string" && typeof value.blob === "function";
var hasFilePropertyOverrides = (value, options) => options?.type != null && options.type !== value.type || options?.lastModified != null && options.lastModified !== value.lastModified || options?.endings != null;
var canReuseNativeFile = (value, name, options) => (name == null || name === value.name) && !hasFilePropertyOverrides(value, options);
async function toFile(value, name, options) {
  checkFileSupport();
  value = await value;
  if (isFileLike(value)) {
    const fileOptions = {
      ...options,
      type: options?.type ?? value.type,
      lastModified: options?.lastModified ?? value.lastModified
    };
    if (value instanceof File) {
      if (canReuseNativeFile(value, name, options)) {
        return value;
      }
      return makeFile([value], name ?? value.name, fileOptions);
    }
    return makeFile([await value.arrayBuffer()], name ?? value.name, fileOptions);
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = getName(value));
    const responseOptions = options?.type === void 0 && blob.type ? { ...options, type: blob.type } : options;
    return makeFile(await getBytes(blob), name, responseOptions);
  }
  const parts = await getBytes(value);
  name || (name = getName(value));
  if (options?.type === void 0) {
    const typedPart = parts.find((part) => typeof part === "object" && "type" in part && !!part.type);
    if (typedPart) {
      options = { ...options, type: typedPart.type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  const parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
  value instanceof ArrayBuffer) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : new Blob([await value.arrayBuffer()], { type: value.type }));
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      parts.push(...await getBytes(chunk));
    }
  } else {
    const constructor = value?.constructor?.name;
    throw new Error(`Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ""}${propsForError(value)}`);
  }
  return parts;
}
function propsForError(value) {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(", ")}]`;
}

// ../../../node_modules/openai/core/resource.mjs
var APIResource = class {
  constructor(client) {
    this._client = client;
  }
};

// ../../../node_modules/openai/internal/utils/path.mjs
function encodeURIPath(str) {
  return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));
var createPathTagFunction = (pathEncoder = encodeURIPath) => function path2(statics, ...params) {
  if (statics.length === 1) {
    return statics[0];
  }
  let postPath = false;
  const invalidSegments = [];
  let path3 = "";
  for (let index = 0; index < statics.length; index += 1) {
    if (index in statics) {
      const currentValue = statics[index];
      if (/[?#]/.test(currentValue)) {
        postPath = true;
      }
      const value = params[index];
      let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
      if (index !== params.length && (value == null || typeof value === "object" && // handle values from other realms
      value.toString === Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)?.toString)) {
        encoded = value + "";
        invalidSegments.push({
          start: path3.length + currentValue.length,
          length: encoded.length,
          error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`
        });
      }
      path3 += currentValue + (index === params.length ? "" : encoded);
    }
  }
  const pathOnly = path3.split(/[?#]/, 1)[0];
  const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
  let match;
  while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
    invalidSegments.push({
      start: match.index,
      length: match[0].length,
      error: `Value "${match[0]}" can't be safely passed as a path parameter`
    });
  }
  invalidSegments.sort((a, b) => a.start - b.start);
  if (invalidSegments.length > 0) {
    let lastEnd = 0;
    let underline = "";
    for (const segment of invalidSegments) {
      const spaces = " ".repeat(segment.start - lastEnd);
      const arrows = "^".repeat(segment.length);
      lastEnd = segment.start + segment.length;
      underline += spaces + arrows;
    }
    throw new OpenAIError(`Path parameters result in path with invalid segments:
${invalidSegments.map((e) => e.error).join("\n")}
${path3}
${underline}`);
  }
  return path3;
};
var path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);

// ../../../node_modules/openai/resources/chat/completions/messages.mjs
var Messages = class extends APIResource {
  /**
   * Get the messages in a stored chat completion. Only Chat Completions that have
   * been created with the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletionStoreMessage of client.chat.completions.messages.list(
   *   'completion_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(completionID, query = {}, options) {
    return this._client.getAPIList(path`/chat/completions/${completionID}/messages`, CursorPage, { query, ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/lib/parser.mjs
function isChatCompletionFunctionTool(tool) {
  return tool !== void 0 && "function" in tool && tool.function !== void 0;
}
function isAutoParsableResponseFormat(response_format) {
  return response_format?.["$brand"] === "auto-parseable-response-format";
}
function isParseableResponseFormat(format) {
  return isAutoParsableResponseFormat(format) || format?.type === "json_schema";
}
function parseResponseFormatContent(format, content) {
  if (!isParseableResponseFormat(format)) {
    return null;
  }
  if (typeof format === "object" && format !== null && "$parseRaw" in format && typeof format.$parseRaw === "function") {
    return format.$parseRaw(content);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError("Error reading response: invalid structured output JSON.");
    }
    throw error;
  }
}
function isAutoParsableTool(tool) {
  return tool?.["$brand"] === "auto-parseable-tool";
}
function maybeParseChatCompletion(completion, params) {
  if (!params || !hasAutoParseableInput(params)) {
    return {
      ...completion,
      choices: completion.choices.map((choice) => ({
        ...choice,
        message: {
          ...choice.message,
          parsed: null,
          ...choice.message.tool_calls ? {
            tool_calls: choice.message.tool_calls
          } : void 0
        }
      }))
    };
  }
  return parseChatCompletion(completion, params);
}
function parseChatCompletion(completion, params) {
  const choices = completion.choices.map((choice) => {
    if (choice.finish_reason === "length") {
      throw new LengthFinishReasonError();
    }
    if (choice.finish_reason === "content_filter") {
      throw new ContentFilterFinishReasonError();
    }
    return {
      ...choice,
      message: {
        ...choice.message,
        ...choice.message.tool_calls ? {
          tool_calls: choice.message.tool_calls?.map((toolCall) => parseToolCall(params, toolCall)) ?? void 0
        } : void 0,
        parsed: choice.message.content !== null && choice.message.content !== void 0 && !choice.message.refusal && (choice.message.content !== "" || !choice.message.tool_calls?.length && !choice.message.function_call) ? parseResponseFormat(params, choice.message.content) : null
      }
    };
  });
  return { ...completion, choices };
}
function parseResponseFormat(params, content) {
  return parseResponseFormatContent(params.response_format, content);
}
function parseToolCall(params, toolCall) {
  if (toolCall.type === "custom") {
    return toolCall;
  }
  if (toolCall.type !== "function") {
    const unsupportedType = toolCall.type;
    throw new OpenAIError(`Currently only \`function\` and \`custom\` tool calls are supported; Received \`${unsupportedType}\``);
  }
  const inputTool = params.tools?.find((inputTool2) => isChatCompletionFunctionTool(inputTool2) && inputTool2.function?.name === toolCall.function.name);
  let parsedArguments = null;
  if (isAutoParsableTool(inputTool)) {
    parsedArguments = inputTool.$parseRaw(toolCall.function.arguments);
  } else if (inputTool?.function.strict) {
    parsedArguments = parseResponseFormatContent({ type: "json_schema", $parseRaw: void 0 }, toolCall.function.arguments);
  }
  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      parsed_arguments: parsedArguments
    }
  };
}
function shouldParseToolCall(params, toolCall) {
  if (!params || !("tools" in params) || !params.tools || toolCall.type !== "function") {
    return false;
  }
  const inputTool = params.tools?.find((inputTool2) => isChatCompletionFunctionTool(inputTool2) && inputTool2.function?.name === toolCall.function?.name);
  return isChatCompletionFunctionTool(inputTool) && (isAutoParsableTool(inputTool) || inputTool?.function.strict || false);
}
function hasAutoParseableInput(params) {
  if (isParseableResponseFormat(params.response_format)) {
    return true;
  }
  return params.tools?.some((t) => isAutoParsableTool(t) || t.type === "function" && t.function.strict === true) ?? false;
}
function validateInputTools(tools) {
  for (const tool of tools ?? []) {
    if (tool.type === "custom") {
      continue;
    }
    if (tool.type !== "function") {
      const unsupportedType = tool.type;
      throw new OpenAIError(`Currently only \`function\` and \`custom\` tool types are supported; Received \`${unsupportedType}\``);
    }
    if (tool.function.strict !== true) {
      throw new OpenAIError(`The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
    }
  }
}

// ../../../node_modules/openai/lib/chatCompletionUtils.mjs
var isAssistantMessage = (message) => message?.role === "assistant";
var isToolMessage = (message) => message?.role === "tool";

// ../../../node_modules/openai/lib/EventStream.mjs
var _EventStream_instances;
var _EventStream_connectedPromise;
var _EventStream_resolveConnectedPromise;
var _EventStream_rejectConnectedPromise;
var _EventStream_endPromise;
var _EventStream_resolveEndPromise;
var _EventStream_rejectEndPromise;
var _EventStream_listeners;
var _EventStream_abortListeners;
var _EventStream_emittedListenerRegistrations;
var _EventStream_pendingListenerCleanup;
var _EventStream_pendingBufferedEventChecks;
var _EventStream_listenerDispatchDepth;
var _EventStream_ended;
var _EventStream_errored;
var _EventStream_aborted;
var _EventStream_catchingPromiseCreated;
var _EventStream_removeAbortListeners;
var _EventStream_onceForEmitted;
var _EventStream_removeEmittedListener;
var _EventStream_cleanupEmittedListeners;
var _EventStream_handleError;
var MAX_BUFFERED_ITERATOR_EVENTS = 4096;
var MAX_BUFFERED_ITERATOR_BYTES = 8 * 1024 * 1024;
var MAX_INSPECTABLE_TYPED_ARRAY_ELEMENTS = 4096;
var MAX_BUFFERED_EVENT_DEPTH = 256;
var bufferedJSONStringify = JSON.stringify;
var bufferedJSONParse = JSON.parse;
var sdkOwnedBufferedEventArguments = /* @__PURE__ */ new WeakSet();
var typedArrayBufferGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "buffer")?.get;
var typedArrayLengthGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")?.get;
var dataViewBufferGetter = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer")?.get;
var symbolDescriptionGetter = Object.getOwnPropertyDescriptor(Symbol.prototype, "description")?.get;
var dateTimestampGetter = Date.prototype.getTime;
var arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
var sharedArrayBufferByteLengthGetter = typeof SharedArrayBuffer === "function" ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")?.get : void 0;
var errorStackDescriptor = Object.getOwnPropertyDescriptor(new Error("native stack descriptor"), "stack");
var functionToString = Function.prototype.toString;
var objectToString = Object.prototype.toString;
var errorBrandDescriptor = Object.getOwnPropertyDescriptor(Error, "isError");
var nativeErrorBrand = errorBrandDescriptor && "value" in errorBrandDescriptor && typeof errorBrandDescriptor.value === "function" ? errorBrandDescriptor.value : void 0;
var nativeErrorConstructorSource = functionToString.call(Error);
var nativeDateConstructorSource = functionToString.call(Date);
var nativeFunctionConstructorSource = functionToString.call(Function);
var trustedIntrinsicPrototypes = /* @__PURE__ */ new Set([
  APIConnectionError.prototype,
  APIConnectionTimeoutError.prototype,
  APIError.prototype,
  OpenAIError.prototype,
  APIUserAbortError.prototype,
  AuthenticationError.prototype,
  BadRequestError.prototype,
  ConflictError.prototype,
  ContentFilterFinishReasonError.prototype,
  InternalServerError.prototype,
  InvalidWebhookSignatureError.prototype,
  LengthFinishReasonError.prototype,
  NotFoundError.prototype,
  OAuthError.prototype,
  PermissionDeniedError.prototype,
  RateLimitError.prototype,
  SubjectTokenProviderError.prototype,
  UnprocessableEntityError.prototype
]);
var trustedNativeConstructorSources = /* @__PURE__ */ new Set();
var canonicalIntrinsicDescriptors = /* @__PURE__ */ new Map();
var foreignErrorStackDescriptors = /* @__PURE__ */ new WeakMap();
function captureNativeProxyDetector() {
  if (typeof process === "undefined") {
    return void 0;
  }
  try {
    const loader = Object.getOwnPropertyDescriptor(process, "getBuiltinModule");
    if (!loader || !("value" in loader) || typeof loader.value !== "function") {
      return void 0;
    }
    const util = Reflect.apply(loader.value, process, ["node:util"]);
    if (typeof util !== "object" || util === null) {
      return void 0;
    }
    const types = Object.getOwnPropertyDescriptor(util, "types");
    if (!types || !("value" in types) || typeof types.value !== "object" || types.value === null) {
      return void 0;
    }
    const detector = Object.getOwnPropertyDescriptor(types.value, "isProxy");
    if (!detector || !("value" in detector) || typeof detector.value !== "function") {
      return void 0;
    }
    return detector.value;
  } catch {
    return void 0;
  }
}
var nativeProxyDetector = captureNativeProxyDetector();
function rememberTrustedIntrinsic(constructor) {
  if (typeof constructor !== "function") {
    return;
  }
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(constructor, "prototype");
  if (!prototypeDescriptor || !("value" in prototypeDescriptor) || typeof prototypeDescriptor.value !== "object" && typeof prototypeDescriptor.value !== "function") {
    return;
  }
  trustedIntrinsicPrototypes.add(prototypeDescriptor.value);
  const source = functionToString.call(constructor);
  if (/^function [A-Za-z_$][\w$]*\(\) \{ \[native code\] \}$/u.test(source) && prototypeDescriptor.configurable === false && prototypeDescriptor.writable === false) {
    trustedNativeConstructorSources.add(source);
    const descriptors = /* @__PURE__ */ new Map();
    for (const key of Reflect.ownKeys(prototypeDescriptor.value)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototypeDescriptor.value, key);
      if (descriptor) {
        descriptors.set(key, descriptor);
      }
    }
    canonicalIntrinsicDescriptors.set(source, descriptors);
  }
}
for (const constructor of [
  Object,
  Function,
  Array,
  Date,
  Map,
  Set,
  ArrayBuffer,
  DataView,
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array
]) {
  rememberTrustedIntrinsic(constructor);
}
for (const name of [
  "SharedArrayBuffer",
  "AggregateError",
  "Float16Array",
  "BigInt64Array",
  "BigUint64Array",
  "Blob",
  "File",
  "Headers"
]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor && "value" in descriptor) {
    rememberTrustedIntrinsic(descriptor.value);
  }
}
var typedArrayConstructorDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "constructor");
if (typedArrayConstructorDescriptor && "value" in typedArrayConstructorDescriptor) {
  rememberTrustedIntrinsic(typedArrayConstructorDescriptor.value);
}
if (typeof Buffer === "function") {
  rememberTrustedIntrinsic(Buffer);
}
var blobInternalHandlePrototype = (() => {
  if (typeof Blob !== "function") {
    return void 0;
  }
  try {
    const blob = new Blob([]);
    for (const key of Object.getOwnPropertySymbols(blob)) {
      const descriptor = Object.getOwnPropertyDescriptor(blob, key);
      if (descriptor && "value" in descriptor && typeof descriptor.value === "object" && descriptor.value) {
        return Object.getPrototypeOf(descriptor.value);
      }
    }
  } catch {
    return void 0;
  }
  return void 0;
})();
var mapEntries = Map.prototype.entries;
var setValues = Set.prototype.values;
var headersEntriesDescriptor = typeof Headers === "function" ? Object.getOwnPropertyDescriptor(Headers.prototype, "entries") : void 0;
var headersEntries = headersEntriesDescriptor && "value" in headersEntriesDescriptor && typeof headersEntriesDescriptor.value === "function" ? headersEntriesDescriptor.value : void 0;
var retainedStorageBrands = /* @__PURE__ */ new Set([
  "ArrayBuffer",
  "SharedArrayBuffer",
  "Blob",
  "File",
  "Map",
  "Date",
  "Set",
  "Headers"
]);
function getTrustedForeignIntrinsic(prototype) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    return void 0;
  }
  const constructor = descriptor.value;
  const source = functionToString.call(constructor);
  const descriptors = canonicalIntrinsicDescriptors.get(source);
  if (!trustedNativeConstructorSources.has(source) || !descriptors) {
    return void 0;
  }
  const constructorPrototype = Object.getOwnPropertyDescriptor(constructor, "prototype");
  if (!constructorPrototype || !("value" in constructorPrototype) || constructorPrototype.value !== prototype || constructorPrototype.configurable !== false || constructorPrototype.writable !== false) {
    return void 0;
  }
  return { constructor, descriptors, functionPrototype: Object.getPrototypeOf(constructor) };
}
function isTrustedIntrinsicPrototype(prototype) {
  return trustedIntrinsicPrototypes.has(prototype) || getTrustedForeignIntrinsic(prototype) !== void 0;
}
function isCanonicalIntrinsicFunction(value, canonical, functionPrototype) {
  if (canonical === void 0) {
    return value === void 0;
  }
  if (typeof value !== "function" || typeof canonical !== "function") {
    return false;
  }
  const source = functionToString.call(canonical);
  if (functionToString.call(value) !== source) {
    return false;
  }
  const actualFunctionPrototype = Object.getPrototypeOf(value);
  if (actualFunctionPrototype === functionPrototype) {
    return true;
  }
  if (!/^function [A-Za-z_$][\w$]*\(\) \{ \[native code\] \}$/u.test(source)) {
    return false;
  }
  const intrinsic = getTrustedForeignIntrinsic(actualFunctionPrototype);
  return intrinsic !== void 0 && functionToString.call(intrinsic.constructor) === nativeFunctionConstructorSource;
}
function isCanonicalIntrinsicDescriptor(descriptor, canonical, functionPrototype) {
  if (!canonical || descriptor.configurable !== canonical.configurable || descriptor.enumerable !== canonical.enumerable || "value" in descriptor !== "value" in canonical) {
    return false;
  }
  if ("value" in descriptor && "value" in canonical) {
    if (descriptor.writable !== canonical.writable) {
      return false;
    }
    if (typeof canonical.value === "function") {
      return isCanonicalIntrinsicFunction(descriptor.value, canonical.value, functionPrototype);
    }
    if (canonical.value !== null && typeof canonical.value === "object") {
      return false;
    }
    return Object.is(descriptor.value, canonical.value);
  }
  return isCanonicalIntrinsicFunction(descriptor.get, canonical.get, functionPrototype) && isCanonicalIntrinsicFunction(descriptor.set, canonical.set, functionPrototype);
}
function hasNativeErrorBrand(current) {
  if (nativeErrorBrand) {
    return nativeErrorBrand.call(Error, current);
  }
  let prototype = current;
  for (let depth = 0; prototype !== null && depth < MAX_BUFFERED_EVENT_DEPTH; depth += 1) {
    if (Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)) {
      return false;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return prototype === null && objectToString.call(current) === "[object Error]";
}
function getVerifiedForeignErrorConstructor(current, stackDescriptor) {
  if (typeof stackDescriptor.get !== "function" || typeof stackDescriptor.set !== "function") {
    return void 0;
  }
  let prototype = Object.getPrototypeOf(current);
  for (let depth = 0; prototype !== null && depth < MAX_BUFFERED_EVENT_DEPTH; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
      const constructor = descriptor.value;
      if (functionToString.call(constructor) === nativeErrorConstructorSource && isTrustedIntrinsicPrototype(prototype)) {
        const functionPrototype = Object.getPrototypeOf(constructor);
        if (Object.getPrototypeOf(stackDescriptor.get) === functionPrototype && Object.getPrototypeOf(stackDescriptor.set) === functionPrototype) {
          return { constructor, prototype };
        }
        return void 0;
      }
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return void 0;
}
function isTrustedNativeErrorStack(current, descriptor) {
  if (!hasNativeErrorBrand(current)) {
    return false;
  }
  if (errorStackDescriptor && !("value" in errorStackDescriptor) && typeof errorStackDescriptor.get === "function" && Object.prototype.isPrototypeOf.call(Error.prototype, current) && descriptor.get === errorStackDescriptor.get && descriptor.set === errorStackDescriptor.set) {
    return true;
  }
  const verified = getVerifiedForeignErrorConstructor(current, descriptor);
  if (!verified) {
    return false;
  }
  let canonicalDescriptor = foreignErrorStackDescriptors.get(verified.prototype);
  if (!canonicalDescriptor) {
    const canonical = Reflect.construct(verified.constructor, []);
    if (typeof canonical !== "object" || canonical === null || !hasNativeErrorBrand(canonical) || Object.getPrototypeOf(canonical) !== verified.prototype) {
      return false;
    }
    canonicalDescriptor = Object.getOwnPropertyDescriptor(canonical, "stack");
    if (!canonicalDescriptor || "value" in canonicalDescriptor || typeof canonicalDescriptor.get !== "function" || typeof canonicalDescriptor.set !== "function") {
      return false;
    }
    foreignErrorStackDescriptors.set(verified.prototype, canonicalDescriptor);
  }
  return descriptor.get === canonicalDescriptor.get && descriptor.set === canonicalDescriptor.set;
}
function createEventQueue() {
  let entries = [];
  let head = 0;
  return {
    get length() {
      return entries.length - head;
    },
    enqueue(value) {
      entries.push(value);
    },
    dequeue() {
      if (head === entries.length) {
        return void 0;
      }
      const value = entries[head];
      entries[head] = void 0;
      head += 1;
      if (head === entries.length) {
        entries = [];
        head = 0;
      } else if (head >= 1024 && head * 2 >= entries.length) {
        entries = entries.slice(head);
        head = 0;
      }
      return value;
    },
    clear() {
      entries = [];
      head = 0;
    }
  };
}
function getRetainedStorageBrand(current) {
  let prototype = Object.getPrototypeOf(current);
  for (let depth = 0; prototype !== null && depth < MAX_BUFFERED_EVENT_DEPTH; depth += 1) {
    if (prototype === Date.prototype) {
      return "Date";
    }
    if (!trustedIntrinsicPrototypes.has(prototype)) {
      const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (constructor && "value" in constructor && typeof constructor.value === "function" && functionToString.call(constructor.value) === nativeDateConstructorSource && getTrustedForeignIntrinsic(prototype)) {
        return "Date";
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string" && retainedStorageBrands.has(descriptor.value)) {
      return descriptor.value;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return void 0;
}
function estimateRetainedBufferBytes(current, visit, depth) {
  if (ArrayBuffer.isView(current)) {
    let buffer;
    let kind2 = "typed-array";
    try {
      buffer = typedArrayBufferGetter?.call(current);
    } catch {
      kind2 = "data-view";
      buffer = dataViewBufferGetter?.call(current);
    }
    if (typeof buffer !== "object" || buffer === null) {
      return { bytes: Number.POSITIVE_INFINITY, kind: kind2 };
    }
    visit(buffer, depth + 1);
    return { bytes: 0, kind: kind2 };
  }
  const brand = getRetainedStorageBrand(current);
  if (!brand) {
    return void 0;
  }
  let getter;
  const kind = "buffer";
  switch (brand) {
    case "ArrayBuffer": {
      getter = arrayBufferByteLengthGetter;
      break;
    }
    case "SharedArrayBuffer": {
      getter = sharedArrayBufferByteLengthGetter;
      break;
    }
    case "Blob":
    case "File": {
      return { bytes: Number.POSITIVE_INFINITY, kind: "blob" };
    }
    case "Map": {
      return { bytes: 0, kind: "map" };
    }
    case "Date": {
      Reflect.apply(dateTimestampGetter, current, []);
      return { bytes: 8, kind: "date" };
    }
    case "Set": {
      return { bytes: 0, kind: "set" };
    }
    case "Headers": {
      return { bytes: 0, kind: "headers" };
    }
    default: {
      return void 0;
    }
  }
  const bytes = getter?.call(current);
  return {
    bytes: typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : Number.POSITIVE_INFINITY,
    kind
  };
}
function visitHiddenEventValues(current, kind, visit) {
  if (kind === "map") {
    for (const [key, entry] of mapEntries.call(current)) {
      if (!visit(key, 8) || !visit(entry, 8)) {
        return false;
      }
    }
  }
  if (kind === "set") {
    for (const entry of setValues.call(current)) {
      if (!visit(entry, 8)) {
        return false;
      }
    }
  }
  if (kind === "headers") {
    if (!headersEntries) {
      return false;
    }
    for (const [name, value] of headersEntries.call(current)) {
      if (!visit(name, 8) || !visit(value, 8)) {
        return false;
      }
    }
  }
  return true;
}
function getInspectableEventKeys(current, kind, availableBytes) {
  if (Array.isArray(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "length");
    const length2 = descriptor && "value" in descriptor ? descriptor.value : void 0;
    if (typeof length2 !== "number" || !Number.isSafeInteger(length2) || length2 < 0 || length2 > Math.floor(availableBytes / 16)) {
      return void 0;
    }
  }
  if (kind !== "typed-array") {
    return Reflect.ownKeys(current);
  }
  const length = typedArrayLengthGetter?.call(current);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > MAX_INSPECTABLE_TYPED_ARRAY_ELEMENTS) {
    return void 0;
  }
  return Reflect.ownKeys(current).filter((key) => {
    if (typeof key !== "string") {
      return true;
    }
    const index = Number(key);
    return !Number.isInteger(index) || index < 0 || index >= length || String(index) !== key;
  });
}
function visitInspectableEventProperties(current, kind, depth, availableBytes, charge, visit) {
  const keys = getInspectableEventKeys(current, kind, availableBytes());
  if (keys === void 0) {
    return false;
  }
  for (const key of keys) {
    if (!charge(typeof key === "string" ? key.length * 2 + 8 : 8)) {
      return false;
    }
    if (typeof key === "symbol") {
      visit(key, depth + 1);
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor) {
      return false;
    }
    if (!("value" in descriptor)) {
      if (key === "stack" && isTrustedNativeErrorStack(current, descriptor)) {
        continue;
      }
      return false;
    }
    visit(descriptor.value, depth + 1, kind === "blob");
  }
  return true;
}
function visitRetainedEventPrototypes(current, depth, isBlobInternalHandle, visited, availableBytes, charge, visit, retainPrototype) {
  let prototype = Object.getPrototypeOf(current);
  for (let prototypeDepth = depth + 1; prototype !== null; prototypeDepth += 1) {
    if (prototypeDepth >= MAX_BUFFERED_EVENT_DEPTH) {
      return false;
    }
    if (trustedIntrinsicPrototypes.has(prototype) || isBlobInternalHandle && prototype === blobInternalHandlePrototype) {
      return true;
    }
    if (visited.has(prototype)) {
      visit(prototype, prototypeDepth);
      return availableBytes() >= 0;
    }
    visited.add(prototype);
    const retainedPrototype = prototype;
    const retained = retainPrototype(retainedPrototype, () => {
      if (!charge(16)) {
        return false;
      }
      const intrinsic = getTrustedForeignIntrinsic(retainedPrototype);
      if (!intrinsic) {
        return visitInspectableEventProperties(retainedPrototype, void 0, prototypeDepth, availableBytes, charge, visit);
      }
      for (const key of Reflect.ownKeys(retainedPrototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(retainedPrototype, key);
        if (!descriptor) {
          return false;
        }
        if (isCanonicalIntrinsicDescriptor(descriptor, intrinsic.descriptors.get(key), intrinsic.functionPrototype)) {
          continue;
        }
        if (!charge(typeof key === "string" ? key.length * 2 + 8 : 8) || !("value" in descriptor)) {
          return false;
        }
        if (typeof key === "symbol") {
          visit(key, prototypeDepth + 1);
        }
        visit(descriptor.value, prototypeDepth + 1);
      }
      return availableBytes() >= 0;
    });
    if (!retained) {
      return false;
    }
    prototype = Object.getPrototypeOf(retainedPrototype);
  }
  return true;
}
var BUFFERED_LEDGER_ENTRY_BYTES = 32;
var BUFFERED_LEDGER_NODE_BYTES = 32;
var BUFFERED_LEDGER_EDGE_BYTES = 8;
var BUFFERED_LEDGER_OWNER_BYTES = 16;
var MAX_BUFFERED_LEDGER_RECONCILIATION_WORK = 128 * 1024;
function inspectBufferedEventGraph(value, remainingBytes) {
  let bytes = 0;
  let scalarBytes = 0;
  const visited = /* @__PURE__ */ new WeakSet();
  const visitedSymbols = /* @__PURE__ */ new Set();
  const roots = /* @__PURE__ */ new Set();
  const nodes = /* @__PURE__ */ new Map();
  let activeNode;
  const availableBytes = () => remainingBytes - bytes;
  const charge = (amount) => {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      bytes = remainingBytes + 1;
      return false;
    }
    bytes += amount;
    if (activeNode) {
      activeNode.bytes += amount;
    } else {
      scalarBytes += amount;
    }
    return bytes <= remainingBytes;
  };
  const addIdentity = (identity) => {
    if (activeNode) {
      activeNode.edges.add(identity);
    } else {
      roots.add(identity);
    }
  };
  const retainIdentity = (identity, inspect) => {
    addIdentity(identity);
    const node = { bytes: 0, edges: /* @__PURE__ */ new Set() };
    nodes.set(identity, node);
    const previous = activeNode;
    activeNode = node;
    try {
      return inspect();
    } finally {
      activeNode = previous;
    }
  };
  const visitSymbol = (current) => {
    if (visitedSymbols.has(current)) {
      addIdentity(current);
      charge(8);
      return;
    }
    visitedSymbols.add(current);
    if (!retainIdentity(current, () => {
      if (!symbolDescriptionGetter) {
        return false;
      }
      const description = Reflect.apply(symbolDescriptionGetter, current, []);
      return charge(8 + (description?.length ?? 0) * 2);
    })) {
      bytes = remainingBytes + 1;
    }
  };
  const visit = (current, depth, isBlobInternalHandle = false) => {
    if (bytes > remainingBytes) {
      return;
    }
    if (typeof current === "string") {
      charge(current.length * 2);
      return;
    }
    if (typeof current === "symbol") {
      visitSymbol(current);
      return;
    }
    if (typeof current === "function") {
      bytes = remainingBytes + 1;
      return;
    }
    if (current === null || typeof current !== "object") {
      charge(8);
      return;
    }
    if (nativeProxyDetector?.(current)) {
      bytes = remainingBytes + 1;
      return;
    }
    if (depth >= MAX_BUFFERED_EVENT_DEPTH) {
      bytes = remainingBytes + 1;
      return;
    }
    if (visited.has(current)) {
      addIdentity(current);
      charge(8);
      return;
    }
    visited.add(current);
    if (!retainIdentity(current, () => {
      if (!charge(16)) {
        return false;
      }
      const retainedStorage = estimateRetainedBufferBytes(current, visit, depth);
      if (!visitRetainedEventPrototypes(current, depth, isBlobInternalHandle, visited, availableBytes, charge, visit, retainIdentity)) {
        return false;
      }
      if (retainedStorage !== void 0 && !charge(retainedStorage.bytes)) {
        return false;
      }
      if (!visitHiddenEventValues(current, retainedStorage?.kind, (hiddenValue, overhead) => {
        if (!charge(overhead)) {
          return false;
        }
        visit(hiddenValue, depth + 1);
        return bytes <= remainingBytes;
      })) {
        return false;
      }
      return visitInspectableEventProperties(current, retainedStorage?.kind, depth, availableBytes, charge, visit);
    })) {
      bytes = remainingBytes + 1;
    }
  };
  try {
    visit(value, 0);
  } catch {
    return void 0;
  }
  return bytes <= remainingBytes ? { scalarBytes, roots, nodes } : void 0;
}
function areBufferedRetainedEdgesEqual(first, second) {
  if (first.size !== second.size) {
    return false;
  }
  for (const identity of first) {
    if (!second.has(identity)) {
      return false;
    }
  }
  return true;
}
function getBufferedLedgerNodeBytes(node, owners) {
  return node.bytes + BUFFERED_LEDGER_NODE_BYTES + node.edges.size * BUFFERED_LEDGER_EDGE_BYTES + owners * BUFFERED_LEDGER_OWNER_BYTES;
}
function getBufferedLedgerEntryBytes(entry) {
  return BUFFERED_LEDGER_ENTRY_BYTES + entry.scalarBytes + entry.roots.size * BUFFERED_LEDGER_EDGE_BYTES;
}
function collectBufferedLedgerIdentities(roots, candidate, records, work) {
  const identities = /* @__PURE__ */ new Set();
  const pending = [...roots];
  while (pending.length) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return void 0;
    }
    const identity = pending.pop();
    if (identities.has(identity)) {
      continue;
    }
    const node = candidate.get(identity) ?? records.get(identity);
    if (!node) {
      return void 0;
    }
    identities.add(identity);
    for (const edge of node.edges) {
      pending.push(edge);
    }
  }
  return identities;
}
function getBufferedLedgerChange(identity, graph, records, changes, node) {
  const existing = changes.get(identity);
  if (existing) {
    if (node) {
      existing.node = node;
    }
    return existing;
  }
  const current = node ?? graph.nodes.get(identity) ?? records.get(identity);
  if (!current) {
    return void 0;
  }
  const update = { node: current, ownerDelta: 0 };
  changes.set(identity, update);
  return update;
}
function findBufferedLedgerAffectedOwners(entry, graph, records, changes, work) {
  const affected = /* @__PURE__ */ new Set([entry]);
  for (const [identity, node] of graph.nodes) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return void 0;
    }
    const previous = records.get(identity);
    if (!previous) {
      continue;
    }
    const changedEdges = !areBufferedRetainedEdgesEqual(previous.edges, node.edges);
    if (previous.bytes !== node.bytes || changedEdges) {
      getBufferedLedgerChange(identity, graph, records, changes, node);
    }
    if (!changedEdges) {
      continue;
    }
    for (const owner of previous.owners) {
      work.remaining -= 1;
      if (work.remaining < 0) {
        return void 0;
      }
      affected.add(owner);
    }
  }
  return affected;
}
function updateBufferedLedgerMembershipChanges(owner, next, graph, records, changes, work) {
  for (const identity of owner.identities) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return false;
    }
    if (!next.has(identity)) {
      const update = getBufferedLedgerChange(identity, graph, records, changes);
      if (!update) {
        return false;
      }
      update.ownerDelta -= 1;
    }
  }
  for (const identity of next) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return false;
    }
    if (!owner.identities.has(identity)) {
      const update = getBufferedLedgerChange(identity, graph, records, changes);
      if (!update) {
        return false;
      }
      update.ownerDelta += 1;
    }
  }
  return true;
}
function collectBufferedLedgerMemberships(entry, graph, affected, records, changes, work) {
  const memberships = /* @__PURE__ */ new Map();
  for (const owner of affected) {
    const roots = owner === entry ? graph.roots : owner.roots;
    const next = collectBufferedLedgerIdentities(roots, graph.nodes, records, work);
    if (!next || !updateBufferedLedgerMembershipChanges(owner, next, graph, records, changes, work)) {
      return void 0;
    }
    memberships.set(owner, next);
  }
  return memberships;
}
function projectBufferedLedgerBytes(currentBytes, entry, graph, isNew, changes, records) {
  let projected = currentBytes - (isNew ? 0 : getBufferedLedgerEntryBytes(entry)) + getBufferedLedgerEntryBytes(graph);
  for (const [identity, update] of changes) {
    const previous = records.get(identity);
    const owners = (previous?.owners.size ?? 0) + update.ownerDelta;
    if (owners < 0) {
      return void 0;
    }
    if (previous) {
      projected -= getBufferedLedgerNodeBytes(previous, previous.owners.size);
    }
    if (owners) {
      projected += getBufferedLedgerNodeBytes(update.node, owners);
    }
  }
  return Number.isSafeInteger(projected) && projected >= 0 && projected <= MAX_BUFFERED_ITERATOR_BYTES ? projected : void 0;
}
function applyBufferedLedgerChanges(records, changes, memberships) {
  for (const [identity, update] of changes) {
    const previous = records.get(identity);
    const owners = (previous?.owners.size ?? 0) + update.ownerDelta;
    if (!owners) {
      continue;
    }
    if (previous) {
      previous.bytes = update.node.bytes;
      previous.edges = update.node.edges;
    } else {
      records.set(identity, {
        bytes: update.node.bytes,
        edges: update.node.edges,
        owners: /* @__PURE__ */ new Set()
      });
    }
  }
  for (const [owner, next] of memberships) {
    for (const identity of owner.identities) {
      if (!next.has(identity)) {
        records.get(identity)?.owners.delete(owner);
      }
    }
    for (const identity of next) {
      if (!owner.identities.has(identity)) {
        records.get(identity).owners.add(owner);
      }
    }
    owner.identities = next;
  }
  for (const identity of changes.keys()) {
    if (records.get(identity)?.owners.size === 0) {
      records.delete(identity);
    }
  }
}
function createBufferedEventLedger() {
  const records = /* @__PURE__ */ new Map();
  let bytes = 0;
  const reconcile = (entry, graph, isNew) => {
    const work = { remaining: MAX_BUFFERED_LEDGER_RECONCILIATION_WORK };
    const changes = /* @__PURE__ */ new Map();
    const affected = findBufferedLedgerAffectedOwners(entry, graph, records, changes, work);
    if (!affected) {
      return false;
    }
    const memberships = collectBufferedLedgerMemberships(entry, graph, affected, records, changes, work);
    if (!memberships) {
      return false;
    }
    const projectedBytes = projectBufferedLedgerBytes(bytes, entry, graph, isNew, changes, records);
    if (projectedBytes === void 0) {
      return false;
    }
    applyBufferedLedgerChanges(records, changes, memberships);
    entry.scalarBytes = graph.scalarBytes;
    entry.roots = graph.roots;
    bytes = projectedBytes;
    return true;
  };
  const release = (entry) => {
    bytes -= getBufferedLedgerEntryBytes(entry);
    for (const identity of entry.identities) {
      const record = records.get(identity);
      if (!record?.owners.delete(entry)) {
        continue;
      }
      bytes -= BUFFERED_LEDGER_OWNER_BYTES;
      if (record.owners.size === 0) {
        bytes -= getBufferedLedgerNodeBytes(record, 0);
        records.delete(identity);
      }
    }
    entry.identities.clear();
  };
  return {
    retain(graph) {
      const entry = { scalarBytes: 0, roots: /* @__PURE__ */ new Set(), identities: /* @__PURE__ */ new Set() };
      return reconcile(entry, graph, true) ? entry : void 0;
    },
    refresh(entry, graph) {
      return reconcile(entry, graph, false);
    },
    release,
    clear() {
      records.clear();
      bytes = 0;
    }
  };
}
var EventStream = class {
  /** Creates an unstarted stream with independent connection and completion lifecycle promises. */
  constructor() {
    _EventStream_instances.add(this);
    this.controller = new AbortController();
    _EventStream_connectedPromise.set(this, void 0);
    _EventStream_resolveConnectedPromise.set(this, () => void 0);
    _EventStream_rejectConnectedPromise.set(this, () => void 0);
    _EventStream_endPromise.set(this, void 0);
    _EventStream_resolveEndPromise.set(this, () => void 0);
    _EventStream_rejectEndPromise.set(this, () => void 0);
    _EventStream_listeners.set(this, /* @__PURE__ */ Object.create(null));
    _EventStream_abortListeners.set(this, []);
    _EventStream_emittedListenerRegistrations.set(this, /* @__PURE__ */ new WeakMap());
    _EventStream_pendingListenerCleanup.set(this, /* @__PURE__ */ new Set());
    _EventStream_pendingBufferedEventChecks.set(this, /* @__PURE__ */ new Set());
    _EventStream_listenerDispatchDepth.set(this, 0);
    _EventStream_ended.set(this, false);
    _EventStream_errored.set(this, false);
    _EventStream_aborted.set(this, false);
    _EventStream_catchingPromiseCreated.set(this, false);
    __classPrivateFieldSet(this, _EventStream_connectedPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _EventStream_resolveConnectedPromise, resolve, "f");
      __classPrivateFieldSet(this, _EventStream_rejectConnectedPromise, reject, "f");
    }), "f");
    __classPrivateFieldSet(this, _EventStream_endPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _EventStream_resolveEndPromise, resolve, "f");
      __classPrivateFieldSet(this, _EventStream_rejectEndPromise, reject, "f");
    }), "f");
    __classPrivateFieldGet(this, _EventStream_connectedPromise, "f").catch(() => void 0);
    __classPrivateFieldGet(this, _EventStream_endPromise, "f").catch(() => void 0);
  }
  _run(executor) {
    setTimeout(() => {
      let failed = false;
      Promise.resolve().then(executor).catch((error) => {
        failed = true;
        __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_handleError).call(this, error);
      }).then(() => {
        if (failed) {
          return;
        }
        try {
          this._emitFinal();
        } catch (error) {
          __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_handleError).call(this, error);
          return;
        }
        this._emit("end");
      });
    }, 0);
  }
  _connected() {
    if (this.ended) {
      return;
    }
    __classPrivateFieldGet(this, _EventStream_resolveConnectedPromise, "f").call(this);
    this._emit("connect");
  }
  /** Whether the stream has finished successfully, failed, or been aborted. */
  get ended() {
    return __classPrivateFieldGet(this, _EventStream_ended, "f");
  }
  /** Whether an error or user cancellation has been observed. */
  get errored() {
    return __classPrivateFieldGet(this, _EventStream_errored, "f");
  }
  /** Whether the stream ended because its request was cancelled. */
  get aborted() {
    return __classPrivateFieldGet(this, _EventStream_aborted, "f");
  }
  /**
   * Cancels the underlying request; {@link done} and {@link events} observe cancellation.
   * Promises returned by {@link emitted} for other events may remain pending.
   */
  abort() {
    this.controller.abort();
  }
  _listenForAbort(signal) {
    if (!signal || this.ended) {
      return;
    }
    if (signal.aborted) {
      this.controller.abort();
      return;
    }
    const listener = () => this.controller.abort();
    signal.addEventListener("abort", listener, { once: true });
    __classPrivateFieldGet(this, _EventStream_abortListeners, "f").push({ signal, listener });
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns This stream, so that listener registration calls can be chained.
   */
  on(event, listener) {
    var _a5;
    const listeners = (_a5 = __classPrivateFieldGet(this, _EventStream_listeners, "f"))[event] || (_a5[event] = []);
    listeners.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns This stream, so that listener registration calls can be chained.
   */
  off(event, listener) {
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
    if (!listeners) {
      return this;
    }
    const emittedRegistration = __classPrivateFieldGet(this, _EventStream_emittedListenerRegistrations, "f").get(listener);
    if (emittedRegistration?.event === event && !emittedRegistration.registration.removed && !emittedRegistration.registration.detached) {
      __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_removeEmittedListener).call(this, event, emittedRegistration.registration);
      return this;
    }
    const index = listeners.findIndex((l) => !l.removed && l.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns This stream, so that listener registration calls can be chained.
   */
  once(event, listener) {
    var _a5;
    const listeners = (_a5 = __classPrivateFieldGet(this, _EventStream_listeners, "f"))[event] || (_a5[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * Events without arguments resolve to `undefined`, single-argument events resolve
   * to that argument, and events with multiple arguments resolve to an argument tuple.
   *
   * @returns A promise for the next event, or a rejection if an error occurs first.
   * Requesting the `error` event resolves with the emitted error instead.
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _EventStream_catchingPromiseCreated, true, "f");
      const onError = (error) => {
        this.off(event, onEvent);
        reject(error);
      };
      const onEvent = (...values) => {
        if (event !== "error") {
          this.off("error", onError);
        }
        resolve(values.length > 1 ? values : values[0]);
      };
      if (event !== "error") {
        __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_onceForEmitted).call(this, "error", onError);
      }
      __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_onceForEmitted).call(this, event, onEvent);
    });
  }
  /**
   * Returns an async iterator that yields every time the event is triggered.
   * The iterator ends when the stream ends and rejects if the stream errors
   * or is aborted. If you request the 'error' or 'abort' event, the iterator
   * yields that event instead of rejecting.
   *
   * Example:
   *
   *   for await (const [message] of stream.events('message')) {
   *     await processMessage(message);
   *   }
   */
  events(event) {
    return this._createIterator((push) => {
      const onEvent = (...args) => {
        sdkOwnedBufferedEventArguments.add(args);
        try {
          push(args);
        } finally {
          sdkOwnedBufferedEventArguments.delete(args);
        }
      };
      this.on(event, onEvent);
      return () => this.off(event, onEvent);
    }, {
      // When iterating the 'error' or 'abort' event itself, yield it as a
      // value instead of rejecting the iterator.
      rejectOnError: event !== "error",
      rejectOnAbort: event !== "abort"
    });
  }
  /**
   * Shared buffered async-iterator adapter over this stream's events.
   *
   * `attach` registers the producer listener(s) with the given `push` and
   * returns a cleanup function that removes them. Termination is handled
   * here: the iterator ends when the stream ends, listeners are removed on
   * end/return, and a terminal error is retained until buffered values have
   * drained so it is surfaced even when no reader was waiting when it fired.
   * Detached consumers have bounded event and byte queues; exceeding either
   * limit fails the stream and aborts its underlying request. Detached queues
   * also reject accessor-backed payloads because getter closures cannot be
   * safely sized without executing untrusted code.
   */
  _createIterator(attach, { rejectOnError = true, rejectOnAbort = true, onReturn } = {}) {
    const pushQueue = createEventQueue();
    const bufferedEventSizes = createEventQueue();
    const readQueue = createEventQueue();
    const bufferedLedger = createBufferedEventLedger();
    let ended = this.ended;
    let failure;
    let failureDelivered = false;
    let detach = () => void 0;
    const doneResult = () => ({ value: void 0, done: true });
    const finishReaders = () => {
      while (readQueue.length) {
        readQueue.dequeue().resolve(doneResult());
      }
    };
    const rejectReader = () => {
      if (!failure || failureDelivered || !readQueue.length) {
        return;
      }
      failureDelivered = true;
      readQueue.dequeue().reject(failure);
    };
    const cleanup = () => {
      detach();
      this.off("end", onEnd);
      if (rejectOnError) {
        this.off("error", onFailure);
      }
      if (rejectOnAbort) {
        this.off("abort", onFailure);
      }
    };
    const deactivateBufferedEvent = (entry) => {
      entry.active = false;
      if (entry.check) {
        __classPrivateFieldGet(this, _EventStream_pendingBufferedEventChecks, "f").delete(entry.check);
        entry.check = void 0;
      }
    };
    const failBufferedEvents = (discardRetained = false) => {
      if (discardRetained) {
        while (bufferedEventSizes.length) {
          deactivateBufferedEvent(bufferedEventSizes.dequeue());
        }
        pushQueue.clear();
        bufferedLedger.clear();
      }
      const error = new OpenAIError(`Event stream iterator buffer limit exceeded (${MAX_BUFFERED_ITERATOR_EVENTS} events or ${MAX_BUFFERED_ITERATOR_BYTES} bytes); consume events as they arrive.`);
      try {
        __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_handleError).call(this, error);
      } finally {
        this.controller.abort();
      }
      return error;
    };
    const revalidateBufferedEvent = (value, entry) => {
      if (!entry.active || __classPrivateFieldGet(this, _EventStream_ended, "f")) {
        return;
      }
      const graph = inspectBufferedEventGraph(value, MAX_BUFFERED_ITERATOR_BYTES);
      if (!graph || !bufferedLedger.refresh(entry.retention, graph)) {
        failBufferedEvents(true);
      }
    };
    const push = (value) => {
      if (ended) {
        return;
      }
      const reader = readQueue.dequeue();
      if (reader) {
        reader.resolve({ value, done: false });
      } else {
        if (pushQueue.length >= MAX_BUFFERED_ITERATOR_EVENTS) {
          failBufferedEvents();
          return;
        }
        const graph = inspectBufferedEventGraph(value, MAX_BUFFERED_ITERATOR_BYTES);
        const retention = graph && bufferedLedger.retain(graph);
        if (!retention) {
          failBufferedEvents();
          return;
        }
        if (typeof value === "object" && value !== null && sdkOwnedBufferedEventArguments.has(value)) {
          const argumentsTuple = value;
          for (let index = 0; index < argumentsTuple.length; index += 1) {
            const argument = argumentsTuple[index];
            if (typeof argument === "string") {
              argumentsTuple[index] = bufferedJSONParse(bufferedJSONStringify(argument));
            }
          }
        }
        const entry = { retention, active: true, check: void 0 };
        pushQueue.enqueue(value);
        bufferedEventSizes.enqueue(entry);
        const check = () => {
          entry.check = void 0;
          revalidateBufferedEvent(value, entry);
        };
        entry.check = check;
        __classPrivateFieldGet(this, _EventStream_pendingBufferedEventChecks, "f").add(check);
      }
    };
    const onFailure = (error) => {
      failure = error;
      if (!pushQueue.length) {
        rejectReader();
      }
    };
    const onEnd = () => {
      ended = true;
      cleanup();
      if (!pushQueue.length) {
        rejectReader();
        finishReaders();
      }
    };
    if (!ended) {
      detach = attach(push);
      this.on("end", onEnd);
      if (rejectOnError) {
        this.on("error", onFailure);
      }
      if (rejectOnAbort) {
        this.on("abort", onFailure);
      }
    }
    return {
      next: () => {
        if (pushQueue.length) {
          const value = pushQueue.dequeue();
          const entry = bufferedEventSizes.dequeue();
          deactivateBufferedEvent(entry);
          const graph = inspectBufferedEventGraph(value, MAX_BUFFERED_ITERATOR_BYTES);
          if (!graph || !bufferedLedger.refresh(entry.retention, graph)) {
            const error = failBufferedEvents(true);
            failureDelivered = true;
            return Promise.reject(error);
          }
          bufferedLedger.release(entry.retention);
          return Promise.resolve({ value, done: false });
        }
        if (failure && !failureDelivered) {
          failureDelivered = true;
          return Promise.reject(failure);
        }
        if (ended) {
          return Promise.resolve(doneResult());
        }
        return new Promise((resolve, reject) => {
          readQueue.enqueue({ resolve, reject });
        });
      },
      return: () => {
        ended = true;
        while (bufferedEventSizes.length) {
          deactivateBufferedEvent(bufferedEventSizes.dequeue());
        }
        pushQueue.clear();
        bufferedLedger.clear();
        cleanup();
        finishReaders();
        if (onReturn) {
          void this.done().catch(() => void 0);
          onReturn();
        }
        return Promise.resolve(doneResult());
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }
  /** Resolves when the stream ends successfully or rejects when it fails or is aborted. */
  async done() {
    __classPrivateFieldSet(this, _EventStream_catchingPromiseCreated, true, "f");
    await __classPrivateFieldGet(this, _EventStream_endPromise, "f");
  }
  /** Returns whether an event currently has one or more registered listeners. */
  _hasListeners(event) {
    return Boolean(__classPrivateFieldGet(this, _EventStream_listeners, "f")[event]?.some((listener) => !listener.removed));
  }
  /** Dispatches a stream event and performs the associated lifecycle transitions. */
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _EventStream_ended, "f")) {
      return;
    }
    if (event === "end") {
      __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_removeAbortListeners).call(this);
      __classPrivateFieldSet(this, _EventStream_ended, true, "f");
      __classPrivateFieldGet(this, _EventStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = listeners.filter((listener) => {
        if (listener.once) {
          listener.detached = true;
        }
        return !listener.once && !listener.removed;
      });
      __classPrivateFieldSet(this, _EventStream_listenerDispatchDepth, __classPrivateFieldGet(this, _EventStream_listenerDispatchDepth, "f") + 1, "f");
      try {
        for (const registration of listeners) {
          if (!registration.removed) {
            registration.listener(...args);
          }
        }
      } finally {
        __classPrivateFieldSet(this, _EventStream_listenerDispatchDepth, __classPrivateFieldGet(this, _EventStream_listenerDispatchDepth, "f") - 1, "f");
        if (__classPrivateFieldGet(this, _EventStream_listenerDispatchDepth, "f") === 0) {
          __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_cleanupEmittedListeners).call(this);
          for (const check of __classPrivateFieldGet(this, _EventStream_pendingBufferedEventChecks, "f")) {
            __classPrivateFieldGet(this, _EventStream_pendingBufferedEventChecks, "f").delete(check);
            if (!__classPrivateFieldGet(this, _EventStream_ended, "f")) {
              check();
            }
          }
        }
      }
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _EventStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _EventStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  // oxlint-disable-next-line class-methods-use-this -- Subclasses override this instance hook.
  _emitFinal() {
  }
};
_EventStream_connectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_endPromise = /* @__PURE__ */ new WeakMap(), _EventStream_resolveEndPromise = /* @__PURE__ */ new WeakMap(), _EventStream_rejectEndPromise = /* @__PURE__ */ new WeakMap(), _EventStream_listeners = /* @__PURE__ */ new WeakMap(), _EventStream_abortListeners = /* @__PURE__ */ new WeakMap(), _EventStream_emittedListenerRegistrations = /* @__PURE__ */ new WeakMap(), _EventStream_pendingListenerCleanup = /* @__PURE__ */ new WeakMap(), _EventStream_pendingBufferedEventChecks = /* @__PURE__ */ new WeakMap(), _EventStream_listenerDispatchDepth = /* @__PURE__ */ new WeakMap(), _EventStream_ended = /* @__PURE__ */ new WeakMap(), _EventStream_errored = /* @__PURE__ */ new WeakMap(), _EventStream_aborted = /* @__PURE__ */ new WeakMap(), _EventStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap(), _EventStream_instances = /* @__PURE__ */ new WeakSet(), _EventStream_removeAbortListeners = function _EventStream_removeAbortListeners2() {
  for (const { signal, listener } of __classPrivateFieldGet(this, _EventStream_abortListeners, "f").splice(0)) {
    signal.removeEventListener("abort", listener);
  }
}, _EventStream_onceForEmitted = function _EventStream_onceForEmitted2(event, listener) {
  const previousListeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
  const previousLength = previousListeners?.length ?? 0;
  this.once(event, listener);
  const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
  const [registration] = listeners?.slice(-1) ?? [];
  if ((previousListeners === void 0 || listeners === previousListeners) && listeners?.length === previousLength + 1 && registration?.listener === listener && registration.once) {
    __classPrivateFieldGet(this, _EventStream_emittedListenerRegistrations, "f").set(listener, { event, registration });
  }
}, _EventStream_removeEmittedListener = function _EventStream_removeEmittedListener2(event, registration) {
  if (registration.removed) {
    return;
  }
  registration.removed = true;
  __classPrivateFieldGet(this, _EventStream_emittedListenerRegistrations, "f").delete(registration.listener);
  __classPrivateFieldGet(this, _EventStream_pendingListenerCleanup, "f").add(event);
  if (__classPrivateFieldGet(this, _EventStream_listenerDispatchDepth, "f") === 0) {
    __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_cleanupEmittedListeners).call(this);
  }
}, _EventStream_cleanupEmittedListeners = function _EventStream_cleanupEmittedListeners2() {
  for (const event of __classPrivateFieldGet(this, _EventStream_pendingListenerCleanup, "f")) {
    const eventType = event;
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[eventType];
    if (listeners) {
      __classPrivateFieldGet(this, _EventStream_listeners, "f")[eventType] = listeners.filter((listener) => !listener.removed);
    }
  }
  __classPrivateFieldGet(this, _EventStream_pendingListenerCleanup, "f").clear();
}, _EventStream_handleError = function _EventStream_handleError2(error) {
  __classPrivateFieldSet(this, _EventStream_errored, true, "f");
  if (error instanceof Error && error.name === "AbortError") {
    error = new APIUserAbortError();
  }
  if (error instanceof APIUserAbortError) {
    __classPrivateFieldSet(this, _EventStream_aborted, true, "f");
    return this._emit("abort", error);
  }
  if (error instanceof OpenAIError) {
    return this._emit("error", error);
  }
  if (error instanceof Error) {
    const openAIError = new OpenAIError(error.message);
    openAIError.cause = error;
    return this._emit("error", openAIError);
  }
  return this._emit("error", new OpenAIError(String(error)));
};

// ../../../node_modules/openai/lib/RunnableFunction.mjs
function isRunnableFunctionWithParse(fn) {
  return typeof fn.parse === "function";
}

// ../../../node_modules/openai/lib/AbstractChatCompletionRunner.mjs
var _AbstractChatCompletionRunner_instances;
var _a2;
var _AbstractChatCompletionRunner_completionArrivedBeforeAbort;
var _AbstractChatCompletionRunner_getFinalContent;
var _AbstractChatCompletionRunner_getFinalMessage;
var _AbstractChatCompletionRunner_getFinalFunctionToolCall;
var _AbstractChatCompletionRunner_getFinalFunctionToolCallResult;
var _AbstractChatCompletionRunner_calculateTotalUsage;
var _AbstractChatCompletionRunner_validateParams;
var _AbstractChatCompletionRunner_stringifyFunctionCallResult;
var DEFAULT_MAX_CHAT_COMPLETIONS = 10;
function normalizeToolCallIds(chatCompletion) {
  for (const choice of chatCompletion.choices) {
    for (const toolCall of choice.message.tool_calls ?? []) {
      if (!toolCall.id) {
        toolCall.id = `call_${uuid4()}`;
      }
    }
  }
}
function toRequestMessage(message) {
  if (!isAssistantMessage(message)) {
    return message;
  }
  const requestMessage = { role: "assistant" };
  if (message.audio != null) {
    requestMessage.audio = { id: message.audio.id };
  }
  if (message.content !== void 0) {
    requestMessage.content = message.content;
  }
  if (message.function_call != null) {
    requestMessage.function_call = message.function_call;
  }
  if (message.name !== void 0) {
    requestMessage.name = message.name;
  }
  if (message.refusal != null) {
    requestMessage.refusal = message.refusal;
  }
  if (message.tool_calls !== void 0) {
    requestMessage.tool_calls = message.tool_calls.map((toolCall) => {
      if (toolCall.type === "custom") {
        return {
          id: toolCall.id,
          type: toolCall.type,
          custom: {
            input: toolCall.custom.input,
            name: toolCall.custom.name
          }
        };
      }
      return {
        id: toolCall.id,
        type: toolCall.type,
        function: {
          arguments: toolCall.function.arguments,
          name: toolCall.function.name
        }
      };
    });
  }
  return requestMessage;
}
var AbstractChatCompletionRunner = class extends EventStream {
  constructor() {
    super(...arguments);
    _AbstractChatCompletionRunner_instances.add(this);
    this._chatCompletions = [];
    _AbstractChatCompletionRunner_completionArrivedBeforeAbort.set(this, false);
    this.messages = [];
  }
  _addChatCompletion(chatCompletion) {
    __classPrivateFieldSet(this, _AbstractChatCompletionRunner_completionArrivedBeforeAbort, !this.controller.signal.aborted, "f");
    normalizeToolCallIds(chatCompletion);
    this._chatCompletions.push(chatCompletion);
    this._emit("chatCompletion", chatCompletion);
    const message = chatCompletion.choices[0]?.message;
    if (message) {
      this._addMessage(message);
    }
    return chatCompletion;
  }
  _addMessage(message, emit = true) {
    if (!("content" in message)) {
      message.content = null;
    }
    this.messages.push(message);
    if (emit) {
      this._emit("message", message);
      if (isToolMessage(message) && message.content) {
        this._emit("functionToolCallResult", message.content);
      } else if (isAssistantMessage(message) && message.tool_calls) {
        for (const tool_call of message.tool_calls) {
          if (tool_call.type === "function") {
            this._emit("functionToolCall", tool_call.function);
          }
        }
      }
    }
  }
  /**
   * @returns a promise that resolves with the final ChatCompletion, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
   */
  async finalChatCompletion() {
    await this.done();
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (!completion) {
      throw new OpenAIError("stream ended without producing a ChatCompletion");
    }
    return completion;
  }
  /**
   * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalContent() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
  }
  /**
   * @returns a promise that resolves with the final assistant ChatCompletionMessage response,
   * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
  }
  /**
   * Waits for completion and returns the last function-tool call, or `undefined`
   * when no assistant message contains a function-tool call.
   */
  async finalFunctionToolCall() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
  }
  /** Waits for completion and returns the last matching function-tool result, if any. */
  async finalFunctionToolCallResult() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
  }
  /** Waits for completion and sums token usage across every chat completion in the run. */
  async totalUsage() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this);
  }
  /** Returns a copy of the chat completions received so far, in request order. */
  allChatCompletions() {
    return [...this._chatCompletions];
  }
  _emitFinal() {
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (completion) {
      this._emit("finalChatCompletion", completion);
    }
    const finalMessage = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
    if (finalMessage) {
      this._emit("finalMessage", finalMessage);
    }
    const finalContent = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
    if (finalContent) {
      this._emit("finalContent", finalContent);
    }
    const finalFunctionCall = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
    if (finalFunctionCall) {
      this._emit("finalFunctionToolCall", finalFunctionCall);
    }
    const finalFunctionCallResult = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
    if (finalFunctionCallResult != null) {
      this._emit("finalFunctionToolCallResult", finalFunctionCallResult);
    }
    if (this._chatCompletions.some((c) => c.usage)) {
      this._emit("totalUsage", __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this));
    }
  }
  async _createChatCompletion(client, params, options) {
    this._listenForAbort(options?.signal);
    __classPrivateFieldGet(_a2, _a2, "m", _AbstractChatCompletionRunner_validateParams).call(_a2, params);
    const chatCompletion = await client.chat.completions.create({ ...params, stream: false }, { ...options, signal: this.controller.signal });
    this._connected();
    return this._addChatCompletion(parseChatCompletion(chatCompletion, params));
  }
  async _runChatCompletion(client, params, options) {
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    return await this._createChatCompletion(client, params, options);
  }
  async _runTools(client, params, runner, options) {
    const role = "tool";
    const { tool_choice = "auto", stream, toolContext: inputToolContext, ...restParams } = params;
    const toolContext = inputToolContext;
    const singleFunctionToCall = typeof tool_choice !== "string" && tool_choice.type === "function" && tool_choice?.function?.name;
    const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS, afterCompletion } = options || {};
    const inputTools = params.tools.map((tool) => {
      if (isAutoParsableTool(tool)) {
        if (!tool.$callback) {
          throw new OpenAIError("Tool given to `.runTools()` that does not have an associated function");
        }
        return {
          type: "function",
          function: {
            function: tool.$callback,
            name: tool.function.name,
            description: tool.function.description || "",
            parameters: tool.function.parameters,
            parse: tool.$parseRaw,
            strict: true
          }
        };
      }
      return tool;
    });
    const functionsByName = /* @__PURE__ */ Object.create(null);
    for (const f of inputTools) {
      if (f.type === "function") {
        functionsByName[f.function.name || f.function.function.name] = f.function;
      }
    }
    const tools = "tools" in params ? inputTools.map((t) => t.type === "function" ? {
      type: "function",
      function: {
        name: t.function.name || t.function.function.name,
        parameters: t.function.parameters,
        description: t.function.description,
        strict: t.function.strict
      }
    } : t) : void 0;
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    let allowBufferedToolCall = false;
    const runToolCall = async (toolCall) => {
      const bufferedToolCall = allowBufferedToolCall;
      allowBufferedToolCall = false;
      if (toolCall.type !== "function") {
        return { message: void 0, functionCalled: false };
      }
      const tool_call_id = toolCall.id;
      const { name, arguments: args } = toolCall.function;
      const fn = functionsByName[name];
      if (!fn) {
        const content2 = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(functionsByName).map((name2) => JSON.stringify(name2)).join(", ")}. Please try again`;
        return { message: { role, tool_call_id, content: content2 }, functionCalled: false };
      }
      if (singleFunctionToCall && singleFunctionToCall !== name) {
        const content2 = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
        return { message: { role, tool_call_id, content: content2 }, functionCalled: false };
      }
      let rawContent;
      if (isRunnableFunctionWithParse(fn)) {
        let parsed;
        try {
          parsed = await fn.parse(args);
        } catch (error) {
          if (this.controller.signal.aborted) {
            throw new APIUserAbortError();
          }
          const content2 = error instanceof Error ? error.message : String(error);
          return { message: { role, tool_call_id, content: content2 }, functionCalled: false };
        }
        if (this.controller.signal.aborted) {
          throw new APIUserAbortError();
        }
        rawContent = await fn.function(parsed, runner, toolContext);
      } else {
        if (this.controller.signal.aborted && !bufferedToolCall) {
          throw new APIUserAbortError();
        }
        rawContent = await fn.function(args, runner, toolContext);
      }
      const content = __classPrivateFieldGet(_a2, _a2, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(_a2, rawContent);
      return { message: { role, tool_call_id, content }, functionCalled: true };
    };
    for (let i = 0; i < maxChatCompletions; ++i) {
      const chatCompletion = await this._createChatCompletion(client, {
        ...restParams,
        tool_choice,
        tools,
        messages: this.messages.map(toRequestMessage)
      }, options);
      allowBufferedToolCall = this.controller.signal.aborted && __classPrivateFieldGet(this, _AbstractChatCompletionRunner_completionArrivedBeforeAbort, "f");
      const message = chatCompletion.choices[0]?.message;
      if (!message) {
        throw new OpenAIError(`missing message in ChatCompletion response`);
      }
      if (!message.tool_calls?.length) {
        await afterCompletion?.(chatCompletion, runner);
        return;
      }
      if (singleFunctionToCall || params.parallel_tool_calls === false) {
        for (const toolCall of message.tool_calls) {
          const result = await runToolCall(toolCall);
          if (result.message) {
            this._addMessage(result.message);
          }
          if (this.controller.signal.aborted) {
            throw new APIUserAbortError();
          }
          if (singleFunctionToCall && result.functionCalled) {
            await afterCompletion?.(chatCompletion, runner);
            return;
          }
        }
      } else {
        const results = await Promise.allSettled(message.tool_calls.map(runToolCall));
        if (!this.controller.signal.aborted) {
          for (const result of results) {
            if (result.status === "rejected") {
              throw result.reason;
            }
          }
        }
        for (const result of results) {
          if (result.status === "fulfilled" && result.value.message) {
            this._addMessage(result.value.message);
          }
        }
        if (this.controller.signal.aborted) {
          throw new APIUserAbortError();
        }
      }
      await afterCompletion?.(chatCompletion, runner);
    }
  }
};
_a2 = AbstractChatCompletionRunner, _AbstractChatCompletionRunner_completionArrivedBeforeAbort = /* @__PURE__ */ new WeakMap(), _AbstractChatCompletionRunner_instances = /* @__PURE__ */ new WeakSet(), _AbstractChatCompletionRunner_getFinalContent = function _AbstractChatCompletionRunner_getFinalContent2() {
  return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this).content ?? null;
}, _AbstractChatCompletionRunner_getFinalMessage = function _AbstractChatCompletionRunner_getFinalMessage2() {
  let i = this.messages.length;
  while (i-- > 0) {
    const message = this.messages[i];
    if (isAssistantMessage(message)) {
      const ret = {
        ...message,
        content: message.content ?? null,
        refusal: message.refusal ?? null
      };
      return ret;
    }
  }
  throw new OpenAIError("stream ended without producing a ChatCompletionMessage with role=assistant");
}, _AbstractChatCompletionRunner_getFinalFunctionToolCall = function _AbstractChatCompletionRunner_getFinalFunctionToolCall2() {
  for (let i = this.messages.length - 1; i >= 0; i--) {
    const message = this.messages[i];
    if (isAssistantMessage(message) && message?.tool_calls?.length) {
      for (let j = message.tool_calls.length - 1; j >= 0; j--) {
        const toolCall = message.tool_calls[j];
        if (toolCall?.type === "function") {
          return toolCall.function;
        }
      }
    }
  }
  return void 0;
}, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult = function _AbstractChatCompletionRunner_getFinalFunctionToolCallResult2() {
  for (let i = this.messages.length - 1; i >= 0; i--) {
    const message = this.messages[i];
    if (isToolMessage(message) && message.content != null && typeof message.content === "string" && this.messages.some((x) => x.role === "assistant" && x.tool_calls?.some((y) => y.type === "function" && y.id === message.tool_call_id))) {
      return message.content;
    }
  }
  return void 0;
}, _AbstractChatCompletionRunner_calculateTotalUsage = function _AbstractChatCompletionRunner_calculateTotalUsage2() {
  const total = {
    completion_tokens: 0,
    prompt_tokens: 0,
    total_tokens: 0
  };
  for (const { usage } of this._chatCompletions) {
    if (usage) {
      total.completion_tokens += usage.completion_tokens;
      total.prompt_tokens += usage.prompt_tokens;
      total.total_tokens += usage.total_tokens;
    }
  }
  return total;
}, _AbstractChatCompletionRunner_validateParams = function _AbstractChatCompletionRunner_validateParams2(params) {
  if (params.n != null && params.n > 1) {
    throw new OpenAIError("ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.");
  }
}, _AbstractChatCompletionRunner_stringifyFunctionCallResult = function _AbstractChatCompletionRunner_stringifyFunctionCallResult2(rawContent) {
  if (typeof rawContent === "string") {
    return rawContent;
  }
  if (rawContent === void 0) {
    return "undefined";
  }
  return JSON.stringify(rawContent);
};

// ../../../node_modules/openai/lib/ChatCompletionRunner.mjs
var ChatCompletionRunner = class _ChatCompletionRunner extends AbstractChatCompletionRunner {
  /** Starts a non-streaming tool loop and returns its event-driven conversation runner. */
  static runTools(client, params, options) {
    const runner = new _ChatCompletionRunner();
    const opts = {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "runTools" }
    };
    runner._run(() => runner._runTools(client, params, runner, opts));
    return runner;
  }
  /** Appends a conversation message and emits text content for assistant replies. */
  _addMessage(message, emit = true) {
    super._addMessage(message, emit);
    if (isAssistantMessage(message) && message.content) {
      this._emit("content", message.content);
    }
  }
};

// ../../../node_modules/openai/_vendor/partial-json-parser/parser.mjs
var STR = 1;
var NUM = 2;
var ARR = 4;
var OBJ = 8;
var NULL = 16;
var BOOL = 32;
var NAN = 64;
var INFINITY = 128;
var MINUS_INFINITY = 256;
var INF = INFINITY | MINUS_INFINITY;
var SPECIAL = NULL | BOOL | INF | NAN;
var ATOM = STR | NUM | SPECIAL;
var COLLECTION = ARR | OBJ;
var ALL = ATOM | COLLECTION;
var Allow = {
  STR,
  NUM,
  ARR,
  OBJ,
  NULL,
  BOOL,
  NAN,
  INFINITY,
  MINUS_INFINITY,
  INF,
  SPECIAL,
  ATOM,
  COLLECTION,
  ALL
};
var PartialJSON = class extends Error {
};
var MalformedJSON = class extends Error {
};
function parseJSON(jsonString, allowPartial = Allow.ALL) {
  if (typeof jsonString !== "string") {
    throw new TypeError(`expecting str, got ${typeof jsonString}`);
  }
  if (!jsonString.trim()) {
    throw new Error(`${jsonString} is empty`);
  }
  return _parseJSON(jsonString.trim(), allowPartial);
}
var _parseJSON = (jsonString, allow) => {
  const length = jsonString.length;
  let index = 0;
  const markPartialJSON = (msg) => {
    throw new PartialJSON(`${msg} at position ${index}`);
  };
  const throwMalformedError = (msg) => {
    throw new MalformedJSON(`${msg} at position ${index}`);
  };
  const parseAny = () => {
    skipBlank();
    if (index >= length) {
      markPartialJSON("Unexpected end of input");
    }
    if (jsonString[index] === '"') {
      return parseStr();
    }
    if (jsonString[index] === "{") {
      return parseObj();
    }
    if (jsonString[index] === "[") {
      return parseArr();
    }
    if (jsonString.substring(index, index + 4) === "null" || Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index))) {
      index += 4;
      return null;
    }
    if (jsonString.substring(index, index + 4) === "true" || Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index))) {
      index += 4;
      return true;
    }
    if (jsonString.substring(index, index + 5) === "false" || Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index))) {
      index += 5;
      return false;
    }
    if (jsonString.substring(index, index + 8) === "Infinity" || Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index))) {
      index += 8;
      return Infinity;
    }
    if (jsonString.substring(index, index + 9) === "-Infinity" || Allow.MINUS_INFINITY & allow && length - index > 1 && length - index < 9 && "-Infinity".startsWith(jsonString.substring(index))) {
      index += 9;
      return -Infinity;
    }
    if (jsonString.substring(index, index + 3) === "NaN" || Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index))) {
      index += 3;
      return Number.NaN;
    }
    return parseNum();
  };
  const parseStr = () => {
    const start = index;
    let escape2 = false;
    index++;
    while (index < length && (jsonString[index] !== '"' || escape2 && jsonString[index - 1] === "\\")) {
      escape2 = jsonString[index] === "\\" ? !escape2 : false;
      index++;
    }
    if (jsonString.charAt(index) === '"') {
      try {
        return JSON.parse(jsonString.substring(start, ++index - Number(escape2)));
      } catch (e) {
        throwMalformedError(String(e));
      }
    } else if (Allow.STR & allow) {
      try {
        return JSON.parse(jsonString.substring(start, index - Number(escape2)) + '"');
      } catch {
        return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("\\")) + '"');
      }
    }
    markPartialJSON("Unterminated string literal");
  };
  const parseObj = () => {
    index++;
    skipBlank();
    const obj = {};
    try {
      while (jsonString[index] !== "}") {
        skipBlank();
        if (index >= length && Allow.OBJ & allow) {
          return obj;
        }
        const key = parseStr();
        skipBlank();
        index++;
        try {
          const value = parseAny();
          Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
        } catch (e) {
          if (Allow.OBJ & allow) {
            return obj;
          }
          throw e;
        }
        skipBlank();
        if (jsonString[index] === ",") {
          index++;
        }
      }
    } catch {
      if (Allow.OBJ & allow) {
        return obj;
      }
      markPartialJSON("Expected '}' at end of object");
    }
    index++;
    return obj;
  };
  const parseArr = () => {
    index++;
    const arr = [];
    try {
      while (jsonString[index] !== "]") {
        arr.push(parseAny());
        skipBlank();
        if (jsonString[index] === ",") {
          index++;
        }
      }
    } catch {
      if (Allow.ARR & allow) {
        return arr;
      }
      markPartialJSON("Expected ']' at end of array");
    }
    index++;
    return arr;
  };
  const parseNum = () => {
    if (index === 0) {
      if (jsonString === "-" && Allow.NUM & allow) {
        markPartialJSON("Not sure what '-' is");
      }
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        if (Allow.NUM & allow) {
          try {
            if (jsonString[jsonString.length - 1] === ".") {
              return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf(".")));
            }
            return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e")));
          } catch {
          }
        }
        throwMalformedError(String(e));
      }
    }
    const start = index;
    if (jsonString[index] === "-") {
      index++;
    }
    while (jsonString[index] && !",]}".includes(jsonString[index])) {
      index++;
    }
    if (index === length && !(Allow.NUM & allow)) {
      markPartialJSON("Unterminated number literal");
    }
    try {
      return JSON.parse(jsonString.substring(start, index));
    } catch {
      if (jsonString.substring(start, index) === "-" && Allow.NUM & allow) {
        markPartialJSON("Not sure what '-' is");
      }
      try {
        return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e")));
      } catch (e) {
        throwMalformedError(String(e));
      }
    }
  };
  const skipBlank = () => {
    while (index < length && " \n\r	".includes(jsonString[index])) {
      index++;
    }
  };
  return parseAny();
};
var partialParse = (input) => parseJSON(input, Allow.ALL ^ Allow.NUM);

// ../../../node_modules/openai/lib/ChatCompletionStream.mjs
var _ChatCompletionStream_instances;
var _ChatCompletionStream_params;
var _ChatCompletionStream_audioDoneChoiceIndexes;
var _ChatCompletionStream_choiceEventStates;
var _ChatCompletionStream_currentChatCompletionSnapshot;
var _ChatCompletionStream_hasAutoParseableTool;
var _ChatCompletionStream_partialJSONParseBudget;
var _ChatCompletionStream_beginRequest;
var _ChatCompletionStream_getChoiceEventState;
var _ChatCompletionStream_addChunk;
var _ChatCompletionStream_emitToolCallDoneEvent;
var _ChatCompletionStream_emitContentDoneEvents;
var _ChatCompletionStream_validateStructuredSnapshots;
var _ChatCompletionStream_endRequest;
var _ChatCompletionStream_accumulateChatCompletion;
function parseStructuredStreamingJSON(content) {
  try {
    return partialParse(content);
  } catch (error) {
    if (error instanceof MalformedJSON || error instanceof SyntaxError) {
      return parseResponseFormatContent({ type: "json_schema", $parseRaw: void 0 }, content);
    }
    throw error;
  }
}
var CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX = "chat.completion.chunk.message:";
function makeChatCompletionReadableStreamMessageChunk(chunk, message, toolCallIds) {
  const payload = {
    type: "message",
    message,
    ...toolCallIds ? { tool_call_ids: toolCallIds } : {}
  };
  return {
    id: chunk.id,
    choices: [],
    created: chunk.created,
    model: chunk.model,
    object: `${CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX}${JSON.stringify(payload)}`
  };
}
function isChatCompletionReadableStreamMessage(item) {
  return "type" in item && item.type === "message" && "message" in item || "object" in item && typeof item.object === "string" && item.object.startsWith(CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX);
}
function getChatCompletionReadableStreamMessage(item) {
  if ("type" in item) {
    return item;
  }
  return JSON.parse(item.object.slice(CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX.length));
}
var MAX_STREAM_CHOICES = 128;
var MAX_STREAM_TOOL_CALLS = 128;
var MAX_PARTIAL_JSON_BYTES = 16 * 1024 * 1024;
var MAX_PARTIAL_JSON_FRAGMENTS = 65536;
var MAX_PARTIAL_JSON_DEPTH = 128;
var MAX_PARTIAL_JSON_PARSE_WORK = 64 * 1024 * 1024;
var EAGER_PARTIAL_JSON_BYTES = 1024;
function createPartialJSONParseState() {
  return {
    bytes: 0,
    depth: 0,
    fragments: 0,
    work: 0,
    escaped: false,
    has_non_whitespace: false,
    in_string: false,
    last_parsed_bytes: 0,
    pending_high_surrogate: false
  };
}
function recordPartialJSONFragment(state2, budget, fragment, validationWorkBudget) {
  if (budget.fragments >= MAX_PARTIAL_JSON_FRAGMENTS) {
    throw new OpenAIError("Chat completion stream exceeded its structured JSON fragment limit");
  }
  let bytes = 0;
  let { depth, escaped, has_non_whitespace: hasNonWhitespace, in_string: inString } = state2;
  let completed = false;
  let firstCharacter = true;
  for (const character of fragment) {
    const previousBytes = bytes;
    const codePoint = character.codePointAt(0);
    if (firstCharacter && state2.pending_high_surrogate && codePoint >= 56320 && codePoint <= 57343) {
      bytes += 1;
    } else if (codePoint <= 127) {
      bytes += 1;
    } else if (codePoint <= 2047) {
      bytes += 2;
    } else if (codePoint <= 65535) {
      bytes += 3;
    } else {
      bytes += 4;
    }
    firstCharacter = false;
    if (budget.bytes + bytes > MAX_PARTIAL_JSON_BYTES) {
      throw new OpenAIError("Chat completion stream exceeded its structured JSON byte limit");
    }
    if (validationWorkBudget && validationWorkBudget.work + bytes > MAX_PARTIAL_JSON_PARSE_WORK) {
      validationWorkBudget.work += previousBytes;
      throw new OpenAIError("Chat completion stream exceeded its structured JSON parse-work limit");
    }
    if (character !== " " && character !== "\n" && character !== "\r" && character !== "	") {
      hasNonWhitespace = true;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        completed || (completed = depth === 0);
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_PARTIAL_JSON_DEPTH) {
        throw new OpenAIError("Chat completion stream exceeded its structured JSON nesting depth limit");
      }
    } else if ((character === "}" || character === "]") && depth > 0) {
      depth -= 1;
      completed || (completed = depth === 0);
    }
  }
  state2.bytes += bytes;
  state2.fragments += 1;
  state2.depth = depth;
  state2.escaped = escaped;
  state2.has_non_whitespace = hasNonWhitespace;
  state2.in_string = inString;
  if (fragment.length > 0) {
    const finalCodeUnit = fragment.codePointAt(fragment.length - 1) ?? 0;
    state2.pending_high_surrogate = finalCodeUnit >= 55296 && finalCodeUnit <= 56319;
  }
  budget.bytes += bytes;
  budget.fragments += 1;
  if (validationWorkBudget) {
    validationWorkBudget.work += bytes;
  }
  if (!hasNonWhitespace || bytes === 0) {
    return false;
  }
  const minimumGrowth = Math.max(EAGER_PARTIAL_JSON_BYTES, Math.floor(state2.last_parsed_bytes / 2));
  if (state2.bytes > EAGER_PARTIAL_JSON_BYTES && !completed && state2.bytes - state2.last_parsed_bytes < minimumGrowth) {
    return false;
  }
  return true;
}
function reservePartialJSONParse(state2, budget) {
  if (budget.work + state2.bytes > MAX_PARTIAL_JSON_PARSE_WORK) {
    return false;
  }
  budget.work += state2.bytes;
  state2.work += state2.bytes;
  state2.last_parsed_bytes = state2.bytes;
  return true;
}
function captureStructuredJSONSnapshot(snapshot, property) {
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, property);
  if (!descriptor) {
    let prototype = Object.getPrototypeOf(snapshot);
    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_PARTIAL_JSON_DEPTH || Object.getOwnPropertyDescriptor(prototype, property)) {
        throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return void 0;
  }
  if (!("value" in descriptor) || typeof descriptor.value !== "string" && descriptor.value !== null && descriptor.value !== void 0) {
    throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
  }
  return descriptor.value;
}
function captureStructuredMessageSnapshot(choice) {
  const descriptor = Object.getOwnPropertyDescriptor(choice, "message");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "object" || descriptor.value === null) {
    throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
  }
  return descriptor.value;
}
function captureSnapshotArray(snapshot, property, maximum, kind) {
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, property);
  if (!descriptor) {
    let prototype = Object.getPrototypeOf(snapshot);
    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_PARTIAL_JSON_DEPTH || Object.getOwnPropertyDescriptor(prototype, property)) {
        throw new OpenAIError(`Chat completion stream contains an unsafe snapshot ${kind} collection`);
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return void 0;
  }
  if (!("value" in descriptor) || !Array.isArray(descriptor.value)) {
    throw new OpenAIError(`Chat completion stream contains an unsafe snapshot ${kind} collection`);
  }
  const length = Object.getOwnPropertyDescriptor(descriptor.value, "length");
  if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value > maximum) {
    throw new OpenAIError(`Chat completion stream exceeded its snapshot ${kind} limit`);
  }
  return descriptor.value;
}
function captureSnapshotArrayItem(array, index) {
  const descriptor = Object.getOwnPropertyDescriptor(array, index);
  if (!descriptor) {
    return void 0;
  }
  if (!("value" in descriptor)) {
    throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
  }
  return descriptor.value;
}
function mapCapturedSnapshotArray(array, maximum, kind, map) {
  const descriptor = Object.getOwnPropertyDescriptor(array, "length");
  const length = descriptor && "value" in descriptor ? descriptor.value : void 0;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximum) {
    throw new OpenAIError(`Chat completion stream exceeded its snapshot ${kind} limit`);
  }
  const mapped = [];
  mapped.length = length;
  for (let index = 0; index < length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(array, index);
    if (!item) {
      continue;
    }
    if (!("value" in item)) {
      throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
    }
    mapped[index] = map(item.value, index);
  }
  return mapped;
}
function validateStructuredJSONSnapshot(value, budget, validationWorkBudget) {
  const state2 = createPartialJSONParseState();
  const parseBudget = budget ?? { bytes: 0, fragments: 0, work: 0 };
  recordPartialJSONFragment(state2, parseBudget, value, validationWorkBudget);
  if (!reservePartialJSONParse(state2, parseBudget)) {
    throw new OpenAIError("Chat completion stream exceeded its structured JSON parse-work limit");
  }
  return value;
}
function ownFunctionToolIdentity(toolCall) {
  const type = Object.getOwnPropertyDescriptor(toolCall, "type");
  const fn = Object.getOwnPropertyDescriptor(toolCall, "function");
  if (!type || !("value" in type) || type.value !== "function" || !fn || !("value" in fn)) {
    return void 0;
  }
  if (typeof fn.value !== "object" || fn.value === null) {
    return void 0;
  }
  const name = Object.getOwnPropertyDescriptor(fn.value, "name");
  if (!name || !("value" in name) || typeof name.value !== "string" || name.value.length === 0) {
    return void 0;
  }
  return { type: "function", name: name.value };
}
function assertBoundToolCallIdentity(toolCall, identity) {
  const current = ownFunctionToolIdentity(toolCall);
  if (!current || current.name !== identity.name || current.type !== identity.type) {
    throw new OpenAIError("Chat completion stream contains a changed tool call identity");
  }
}
function assignOwnProperties(target, source) {
  if (Object.prototype.propertyIsEnumerable.call(source, "__proto__") && !hasOwn(target, "__proto__")) {
    Object.defineProperty(target, "__proto__", {
      value: void 0,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  return Object.assign(target, source);
}
function cloneParserConfigObject(value, stableFields = []) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of stableFields) {
    const descriptor = descriptors[field];
    if (!descriptor && !(field in value)) {
      continue;
    }
    descriptors[field] = {
      value: descriptor && "value" in descriptor ? descriptor.value : Reflect.get(value, field, value),
      enumerable: descriptor?.enumerable ?? false,
      configurable: descriptor?.configurable ?? true,
      writable: descriptor && "writable" in descriptor ? descriptor.writable : false
    };
  }
  return Object.create(Object.getPrototypeOf(value), descriptors);
}
function snapshotChatCompletionParserParams(params) {
  const snapshot = cloneParserConfigObject(params);
  if (params.tools) {
    const stableTools = [];
    const lengthDescriptor = Object.getOwnPropertyDescriptor(params.tools, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : void 0;
    const toolCount = typeof length === "number" && Number.isSafeInteger(length) && length >= 0 ? Math.min(length, MAX_STREAM_TOOL_CALLS) : 0;
    for (let index = 0; index < toolCount; index += 1) {
      const item = Object.getOwnPropertyDescriptor(params.tools, String(index));
      if (!item || !("value" in item)) {
        stableTools.length = index + 1;
        continue;
      }
      const tool = item.value;
      const stableTool = cloneParserConfigObject(tool, [
        "type",
        "$brand",
        "$parseRaw",
        "$callback",
        "function"
      ]);
      const descriptors = Object.getOwnPropertyDescriptors(stableTool);
      if (isChatCompletionFunctionTool(stableTool)) {
        const descriptor = descriptors.function;
        descriptors.function = {
          ...descriptor && "value" in descriptor ? descriptor : { configurable: true, enumerable: true, writable: true },
          value: cloneParserConfigObject(stableTool.function, ["name", "strict"])
        };
      }
      stableTools[index] = Object.create(Object.getPrototypeOf(tool), descriptors);
    }
    snapshot.tools = stableTools;
  }
  if (params.response_format) {
    snapshot.response_format = cloneParserConfigObject(params.response_format, [
      "type",
      "$brand",
      "$parseRaw"
    ]);
  }
  return snapshot;
}
var MAX_SERIALIZED_PARSER_SCHEMA_NODES = 4096;
var stringifyParserSchemaValue = JSON.stringify;
var MAX_SERIALIZED_PARSER_SCHEMA_BYTES = 1024 * 1024;
var MAX_SERIALIZED_PARSER_SCHEMA_DEPTH = 64;
var OMITTED_SERIALIZED_PARSER_VALUE = /* @__PURE__ */ Symbol("omitted serialized parser value");
var UNSAFE_SERIALIZED_PARSER_VALUE = /* @__PURE__ */ Symbol("unsafe serialized parser value");
function canonicalSerializedParserSchema(value, budget) {
  const ancestors = /* @__PURE__ */ new WeakSet();
  const charge = (bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || budget.bytes + bytes > MAX_SERIALIZED_PARSER_SCHEMA_BYTES) {
      return false;
    }
    budget.bytes += bytes;
    return true;
  };
  const visit = (current, depth) => {
    if (depth > MAX_SERIALIZED_PARSER_SCHEMA_DEPTH || budget.nodes >= MAX_SERIALIZED_PARSER_SCHEMA_NODES) {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    budget.nodes += 1;
    if (current === void 0 || typeof current === "function" || typeof current === "symbol") {
      return OMITTED_SERIALIZED_PARSER_VALUE;
    }
    if (typeof current === "bigint") {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    if (current === null || typeof current === "boolean" || typeof current === "number") {
      const serialized = stringifyParserSchemaValue(current);
      return typeof serialized === "string" && charge(serialized.length) ? serialized : UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    if (typeof current === "string") {
      if (!charge(current.length * 6 + 2)) {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }
      return stringifyParserSchemaValue(current);
    }
    if (typeof current !== "object" || ancestors.has(current)) {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (array && prototype !== Array.prototype || !array && prototype !== null && prototype !== Object.prototype) {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    for (let owner = current; owner !== null; owner = Object.getPrototypeOf(owner)) {
      const serializer = Object.getOwnPropertyDescriptor(owner, "toJSON");
      if (!serializer) {
        continue;
      }
      if (!("value" in serializer) || typeof serializer.value === "function") {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }
      break;
    }
    ancestors.add(current);
    try {
      if (!charge(2)) {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }
      if (array) {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
        const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : void 0;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > MAX_SERIALIZED_PARSER_SCHEMA_NODES - budget.nodes) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        const items = [];
        for (let index = 0; index < length; index += 1) {
          const key = String(index);
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor) {
            if (Object.getOwnPropertyDescriptor(Array.prototype, key) || Object.getOwnPropertyDescriptor(Object.prototype, key)) {
              return UNSAFE_SERIALIZED_PARSER_VALUE;
            }
            budget.nodes += 1;
            if (!charge(4)) {
              return UNSAFE_SERIALIZED_PARSER_VALUE;
            }
            items.push("null");
            continue;
          }
          if (!("value" in descriptor)) {
            return UNSAFE_SERIALIZED_PARSER_VALUE;
          }
          const item = visit(descriptor.value, depth + 1);
          if (item === UNSAFE_SERIALIZED_PARSER_VALUE) {
            return item;
          }
          items.push(item === OMITTED_SERIALIZED_PARSER_VALUE ? "null" : item);
        }
        return `[${items.join(",")}]`;
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length > MAX_SERIALIZED_PARSER_SCHEMA_NODES - budget.nodes) {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }
      const entries = [];
      for (const key of keys) {
        if (typeof key !== "string") {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        if (!descriptor.enumerable) {
          continue;
        }
        if (!("value" in descriptor)) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        entries.push([key, descriptor.value]);
      }
      entries.sort(([left], [right]) => {
        if (left === right) {
          return 0;
        }
        return left < right ? -1 : 1;
      });
      const fields = [];
      for (const [key, entry] of entries) {
        const normalized = visit(entry, depth + 1);
        if (normalized === UNSAFE_SERIALIZED_PARSER_VALUE) {
          return normalized;
        }
        if (normalized === OMITTED_SERIALIZED_PARSER_VALUE) {
          continue;
        }
        if (!charge(key.length * 6 + 3)) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        fields.push(`${stringifyParserSchemaValue(key)}:${normalized}`);
      }
      return `{${fields.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };
  try {
    const normalized = visit(value, 0);
    return typeof normalized === "string" ? normalized : void 0;
  } catch {
    return void 0;
  }
}
function rememberSerializedParserSchema(signatures, source, holder, key) {
  const parser = Object.getOwnPropertyDescriptor(source, "$parseRaw");
  const schema = Object.getOwnPropertyDescriptor(holder, key);
  if (!parser || !("value" in parser) || typeof parser.value !== "function" || !schema || !("value" in schema)) {
    return;
  }
  const normalized = canonicalSerializedParserSchema(schema.value, { nodes: 0, bytes: 0 });
  if (normalized !== void 0) {
    signatures.set(source, normalized);
  }
}
function hasMatchingSerializedParserSchema(signatures, source, holder, key, value) {
  const expected = source && signatures.get(source);
  const descriptor = Object.getOwnPropertyDescriptor(holder, key);
  return expected !== void 0 && descriptor !== void 0 && "value" in descriptor && canonicalSerializedParserSchema(value, { nodes: 0, bytes: 0 }) === expected;
}
function serializedParserDescriptor(descriptor, value) {
  return descriptor && "value" in descriptor ? { ...descriptor, value } : { configurable: true, enumerable: true, writable: true, value };
}
function shadowSerializedParserMetadata(descriptors, source, fields) {
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor && !(field in source)) {
      continue;
    }
    descriptors[field] = descriptor && "value" in descriptor ? { ...descriptor, value: void 0 } : {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      writable: false,
      value: void 0
    };
  }
}
function snapshotSerializedParserTool(serialized) {
  const source = serialized.source ?? {
    type: serialized.type,
    ...serialized.type === "function" ? { function: {} } : {}
  };
  const descriptors = Object.getOwnPropertyDescriptors(source);
  descriptors.type = serializedParserDescriptor(descriptors.type, serialized.type);
  if (serialized.type !== "function" || !serialized.function) {
    if (descriptors.function) {
      descriptors.function = serializedParserDescriptor(descriptors.function, void 0);
    }
    shadowSerializedParserMetadata(descriptors, source, ["$brand", "$parseRaw", "$callback"]);
    return Object.create(Object.getPrototypeOf(source), descriptors);
  }
  const descriptor = descriptors.function;
  const original = descriptor && "value" in descriptor && typeof descriptor.value === "object" && descriptor.value !== null ? descriptor.value : {};
  const functionDescriptors = Object.getOwnPropertyDescriptors(original);
  functionDescriptors["name"] = serializedParserDescriptor(functionDescriptors["name"], serialized.function.name);
  functionDescriptors["strict"] = serializedParserDescriptor(functionDescriptors["strict"], serialized.function.strict);
  descriptors.function = serializedParserDescriptor(descriptor, Object.create(Object.getPrototypeOf(original), functionDescriptors));
  if (!serialized.function.schemaMatches) {
    shadowSerializedParserMetadata(descriptors, source, ["$brand", "$parseRaw", "$callback"]);
  }
  return Object.create(Object.getPrototypeOf(source), descriptors);
}
function snapshotSerializedResponseFormat(serialized) {
  const source = serialized.source ?? { type: serialized.type };
  const descriptors = Object.getOwnPropertyDescriptors(source);
  descriptors.type = serializedParserDescriptor(descriptors.type, serialized.type);
  if (serialized.type !== "json_schema" || !serialized.source || !serialized.schemaMatches) {
    shadowSerializedParserMetadata(descriptors, source, ["$brand", "$parseRaw"]);
  }
  return Object.create(Object.getPrototypeOf(source), descriptors);
}
function ownSerializedParserObject(holder, key) {
  const descriptor = Object.getOwnPropertyDescriptor(holder, key);
  if (!descriptor || !("value" in descriptor)) {
    return void 0;
  }
  const { value } = descriptor;
  return typeof value === "object" && value !== null ? value : void 0;
}
function observeSerializedChatCompletionParserParams(body, initial, update) {
  const originalToolOwners = /* @__PURE__ */ new WeakMap();
  const originalSchemaSignatures = /* @__PURE__ */ new WeakMap();
  if (body.tools) {
    for (let index = 0; index < body.tools.length && index < MAX_STREAM_TOOL_CALLS; index += 1) {
      const owner = ownSerializedParserObject(body.tools, String(index));
      const source = initial.tools?.[index];
      if (owner && source) {
        originalToolOwners.set(owner, source);
        const originalFunction = ownSerializedParserObject(source, "function");
        if (originalFunction) {
          rememberSerializedParserSchema(originalSchemaSignatures, source, originalFunction, "parameters");
        }
      }
    }
  }
  if (initial.response_format) {
    rememberSerializedParserSchema(originalSchemaSignatures, initial.response_format, initial.response_format, "json_schema");
  }
  let root;
  let tools;
  let responseFormat;
  let responseFrame;
  let frames = [];
  let toolFrames = /* @__PURE__ */ new WeakMap();
  let actualToolOwners = /* @__PURE__ */ new Map();
  let functionFrames = /* @__PURE__ */ new WeakMap();
  return observeJSONRequestBody(body, {
    value(holder, key, value) {
      if (!root && key === "" && typeof value === "object" && value !== null) {
        root = value;
        tools = void 0;
        responseFormat = void 0;
        responseFrame = void 0;
        frames = [];
        toolFrames = /* @__PURE__ */ new WeakMap();
        actualToolOwners = /* @__PURE__ */ new Map();
        functionFrames = /* @__PURE__ */ new WeakMap();
        return;
      }
      if (holder === root && key === "response_format") {
        if (typeof value === "object" && value !== null) {
          responseFormat = value;
          const owner = ownSerializedParserObject(holder, key);
          responseFrame = {
            source: owner === body.response_format ? initial.response_format : void 0,
            schemaMatches: false
          };
        }
        return;
      }
      if (holder === root && key === "tools") {
        if (Array.isArray(value)) {
          tools = new Proxy(value, {
            get(target, property) {
              const actual = Reflect.get(target, property, target);
              if (typeof property === "string") {
                const index = Number(property);
                if (Number.isSafeInteger(index) && index >= 0 && index < MAX_STREAM_TOOL_CALLS && String(index) === property) {
                  actualToolOwners.set(index, typeof actual === "object" && actual !== null ? actual : void 0);
                }
              }
              return actual;
            }
          });
          return tools;
        }
        return;
      }
      if (holder === tools) {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_STREAM_TOOL_CALLS || typeof value !== "object" || value === null) {
          return;
        }
        const owner = actualToolOwners.get(index);
        const source = owner ? originalToolOwners.get(owner) : void 0;
        const frame = { source };
        frames[index] = frame;
        toolFrames.set(value, frame);
        return;
      }
      const tool = toolFrames.get(holder);
      if (tool) {
        if (key === "type" && typeof value === "string") {
          tool.type = value;
        } else if (key === "function" && typeof value === "object" && value !== null) {
          const fn2 = { source: tool.source, schemaMatches: false };
          tool.function = fn2;
          functionFrames.set(value, fn2);
        }
        return;
      }
      if (holder === responseFormat && responseFrame) {
        if (key === "type" && typeof value === "string") {
          responseFrame.type = value;
        } else if (key === "json_schema") {
          responseFrame.schemaMatches = hasMatchingSerializedParserSchema(originalSchemaSignatures, responseFrame.source, holder, key, value);
        }
        return;
      }
      const fn = functionFrames.get(holder);
      if (fn) {
        if (key === "name" && typeof value === "string") {
          fn.name = value;
        } else if (key === "strict" && typeof value === "boolean") {
          fn.strict = value;
        } else if (key === "parameters") {
          fn.schemaMatches = hasMatchingSerializedParserSchema(originalSchemaSignatures, fn.source, holder, key, value);
        }
      }
      return void 0;
    },
    complete() {
      if (!root) {
        return;
      }
      const snapshot = cloneParserConfigObject(initial);
      if (tools) {
        const serializedTools = [];
        for (let index = 0; index < frames.length; index += 1) {
          const frame = frames[index];
          if (frame) {
            serializedTools[index] = snapshotSerializedParserTool(frame);
          }
        }
        snapshot.tools = serializedTools;
      } else {
        delete snapshot.tools;
      }
      if (responseFrame) {
        snapshot.response_format = snapshotSerializedResponseFormat(responseFrame);
      } else {
        delete snapshot.response_format;
      }
      update(snapshot);
      root = void 0;
      tools = void 0;
      responseFormat = void 0;
      responseFrame = void 0;
      frames = [];
      toolFrames = /* @__PURE__ */ new WeakMap();
      actualToolOwners = /* @__PURE__ */ new Map();
      functionFrames = /* @__PURE__ */ new WeakMap();
    }
  });
}
var ChatCompletionStream = class _ChatCompletionStream extends AbstractChatCompletionRunner {
  /** Creates an unstarted stream, retaining request parameters for structured-output parsing. */
  constructor(params) {
    super();
    _ChatCompletionStream_instances.add(this);
    _ChatCompletionStream_params.set(this, void 0);
    _ChatCompletionStream_audioDoneChoiceIndexes.set(this, void 0);
    _ChatCompletionStream_choiceEventStates.set(this, void 0);
    _ChatCompletionStream_currentChatCompletionSnapshot.set(this, void 0);
    _ChatCompletionStream_hasAutoParseableTool.set(this, void 0);
    _ChatCompletionStream_partialJSONParseBudget.set(this, void 0);
    __classPrivateFieldSet(this, _ChatCompletionStream_params, params, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_audioDoneChoiceIndexes, /* @__PURE__ */ new Set(), "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_choiceEventStates, [], "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_hasAutoParseableTool, false, "f");
    const tools = params?.tools;
    const lengthDescriptor = tools && Object.getOwnPropertyDescriptor(tools, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : void 0;
    if (tools && typeof length === "number" && Number.isSafeInteger(length) && length >= 0) {
      for (let index = 0; index < Math.min(length, MAX_STREAM_TOOL_CALLS); index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(tools, String(index));
        if (!descriptor || !("value" in descriptor)) {
          continue;
        }
        const tool = descriptor.value;
        if (isChatCompletionFunctionTool(tool) && (isAutoParsableTool(tool) || tool.function.strict === true)) {
          __classPrivateFieldSet(this, _ChatCompletionStream_hasAutoParseableTool, true, "f");
          break;
        }
      }
    }
    __classPrivateFieldSet(this, _ChatCompletionStream_partialJSONParseBudget, { bytes: 0, fragments: 0, work: 0 }, "f");
  }
  /** The latest accumulated completion, or `undefined` before a chunk arrives or after finalization. */
  get currentChatCompletionSnapshot() {
    return __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Original input messages are not included in the serialized stream. Tool-result
   * messages explicitly serialized by a streaming tool runner are replayed.
   */
  static fromReadableStream(stream) {
    const runner = new _ChatCompletionStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  /** Starts a streaming chat completion request and returns its event-driven helper. */
  static createChatCompletion(client, params, options) {
    const runner = new _ChatCompletionStream(params);
    runner._run(() => runner._runChatCompletion(client, { ...params, stream: true }, { ...options, __metadata: { ...options?.__metadata, helperMethod: "stream" } }));
    return runner;
  }
  async _createChatCompletion(client, params, options) {
    this._listenForAbort(options?.signal);
    const requestParams = { ...params, stream: true };
    __classPrivateFieldSet(this, _ChatCompletionStream_params, requestParams, "f");
    __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
    const parserParams = snapshotChatCompletionParserParams(requestParams);
    __classPrivateFieldSet(this, _ChatCompletionStream_params, parserParams, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_hasAutoParseableTool, parserParams.tools?.some((tool) => isChatCompletionFunctionTool(tool) && (isAutoParsableTool(tool) || tool.function.strict === true)) ?? false, "f");
    const stopObserving = requestParams.tools || requestParams.response_format ? observeSerializedChatCompletionParserParams(requestParams, parserParams, (serialized) => {
      __classPrivateFieldSet(this, _ChatCompletionStream_params, serialized, "f");
      __classPrivateFieldSet(this, _ChatCompletionStream_hasAutoParseableTool, serialized.tools?.some((tool) => isChatCompletionFunctionTool(tool) && (isAutoParsableTool(tool) || tool.function.strict === true)) ?? false, "f");
    }) : void 0;
    const stream = await client.chat.completions.create(requestParams, {
      ...options,
      signal: this.controller.signal
    }).finally(stopObserving);
    this._connected();
    for await (const chunk of stream) {
      __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
  }
  async _fromReadableStream(readableStream, options) {
    this._listenForAbort(options?.signal);
    __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    let chatId;
    for await (const item of stream) {
      if (isChatCompletionReadableStreamMessage(item)) {
        const message = getChatCompletionReadableStreamMessage(item);
        if (__classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f")) {
          const toolCalls = __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f").choices[0]?.message.tool_calls;
          for (const [index, id] of message.tool_call_ids?.entries() ?? []) {
            const toolCall = toolCalls?.[index];
            if (toolCall && id) {
              toolCall.id = id;
            }
          }
          this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
          chatId = void 0;
        }
        this._addMessage(message.message);
        continue;
      }
      const chunk = item;
      if (chatId && chunk.id && chatId !== chunk.id) {
        this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
      }
      __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
      if (chunk.id) {
        chatId = chunk.id;
      }
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    if (__classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f")) {
      return this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
    }
    const lastChatCompletion = this._chatCompletions[this._chatCompletions.length - 1];
    if (lastChatCompletion) {
      return lastChatCompletion;
    }
    throw new OpenAIError(`request ended without sending any chunks`);
  }
  /** Iterates over raw API chunks; stopping iteration early aborts the underlying request. */
  [(_ChatCompletionStream_params = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_audioDoneChoiceIndexes = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_choiceEventStates = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_currentChatCompletionSnapshot = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_hasAutoParseableTool = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_partialJSONParseBudget = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_instances = /* @__PURE__ */ new WeakSet(), _ChatCompletionStream_beginRequest = function _ChatCompletionStream_beginRequest2() {
    if (this.ended) {
      return;
    }
    __classPrivateFieldSet(this, _ChatCompletionStream_audioDoneChoiceIndexes, /* @__PURE__ */ new Set(), "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, void 0, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_partialJSONParseBudget, { bytes: 0, fragments: 0, work: 0 }, "f");
  }, _ChatCompletionStream_getChoiceEventState = function _ChatCompletionStream_getChoiceEventState2(choice) {
    let state2 = __classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index];
    if (state2) {
      return state2;
    }
    state2 = {
      content_done: false,
      content_parse_state: void 0,
      refusal_done: false,
      logprobs_content_done: false,
      logprobs_refusal_done: false,
      done_tool_calls: /* @__PURE__ */ new Set(),
      current_tool_call_index: null,
      tool_call_parse_states: /* @__PURE__ */ new Map(),
      tool_call_identities: /* @__PURE__ */ new Map()
    };
    __classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index] = state2;
    return state2;
  }, _ChatCompletionStream_addChunk = function _ChatCompletionStream_addChunk2(chunk) {
    if (this.ended) {
      return;
    }
    const capturedChoiceFrames = /* @__PURE__ */ new WeakMap();
    const completion = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_accumulateChatCompletion).call(this, chunk, capturedChoiceFrames);
    this._emit("chunk", chunk, completion);
    for (const choice of chunk.choices) {
      const capturedChoice = capturedChoiceFrames.get(choice);
      const choiceSnapshot = completion.choices[capturedChoice?.index ?? choice.index];
      const capturedToolCalls = capturedChoice?.tool_calls ?? [];
      const { delta } = choice;
      const structuredResponse = isParseableResponseFormat(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format);
      const boundedSnapshot = structuredResponse || __classPrivateFieldGet(this, _ChatCompletionStream_hasAutoParseableTool, "f");
      const messageSnapshot = boundedSnapshot ? captureStructuredMessageSnapshot(choiceSnapshot) : choiceSnapshot.message;
      const refusal = boundedSnapshot ? captureStructuredJSONSnapshot(messageSnapshot, "refusal") : messageSnapshot.refusal;
      const parseableContent = !refusal && structuredResponse;
      const messageContent = parseableContent ? captureStructuredJSONSnapshot(messageSnapshot, "content") : messageSnapshot.content;
      if (delta?.content != null && messageSnapshot.role === "assistant" && messageContent) {
        this._emit("content", delta.content, messageContent);
        this._emit("content.delta", {
          delta: delta.content,
          snapshot: messageContent,
          parsed: messageSnapshot.parsed
        });
      }
      if (delta?.refusal != null && messageSnapshot.role === "assistant" && refusal) {
        this._emit("refusal.delta", {
          delta: delta.refusal,
          snapshot: refusal
        });
      }
      if (choice.logprobs?.content != null && messageSnapshot.role === "assistant") {
        this._emit("logprobs.content.delta", {
          content: choice.logprobs?.content,
          snapshot: choiceSnapshot.logprobs?.content ?? []
        });
      }
      if (choice.logprobs?.refusal != null && messageSnapshot.role === "assistant") {
        this._emit("logprobs.refusal.delta", {
          refusal: choice.logprobs?.refusal,
          snapshot: choiceSnapshot.logprobs?.refusal ?? []
        });
      }
      const state2 = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
      if (choiceSnapshot.finish_reason) {
        __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
        if (state2.current_tool_call_index != null) {
          __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state2.current_tool_call_index);
        }
      }
      for (const toolCall of capturedToolCalls) {
        if (state2.current_tool_call_index !== toolCall.index) {
          __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
          if (state2.current_tool_call_index != null) {
            __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state2.current_tool_call_index);
          }
        }
        state2.current_tool_call_index = toolCall.index;
      }
      for (const toolCallDelta of capturedToolCalls) {
        const toolCallSnapshot = messageSnapshot.tool_calls?.[toolCallDelta.index];
        if (!toolCallSnapshot?.type) {
          continue;
        }
        if (toolCallSnapshot.type === "function") {
          const boundIdentity = state2.tool_call_identities.get(toolCallDelta.index);
          let argumentsSnapshot;
          if (boundIdentity?.parseable) {
            const capturedArguments = captureStructuredJSONSnapshot(toolCallSnapshot.function, "arguments");
            if (typeof capturedArguments !== "string") {
              throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
            }
            argumentsSnapshot = capturedArguments;
          } else {
            argumentsSnapshot = toolCallSnapshot.function.arguments;
          }
          this._emit("tool_calls.function.arguments.delta", {
            name: toolCallSnapshot.function.name,
            index: toolCallDelta.index,
            arguments: argumentsSnapshot,
            parsed_arguments: toolCallSnapshot.function.parsed_arguments,
            arguments_delta: toolCallDelta.arguments_delta
          });
        } else if (toolCallSnapshot.type !== "custom") {
          assertNever(toolCallSnapshot);
        }
      }
    }
  }, _ChatCompletionStream_emitToolCallDoneEvent = function _ChatCompletionStream_emitToolCallDoneEvent2(choiceSnapshot, toolCallIndex) {
    const state2 = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
    if (state2.done_tool_calls.has(toolCallIndex)) {
      return;
    }
    const messageSnapshot = __classPrivateFieldGet(this, _ChatCompletionStream_hasAutoParseableTool, "f") ? captureStructuredMessageSnapshot(choiceSnapshot) : choiceSnapshot.message;
    const toolCallSnapshot = messageSnapshot.tool_calls?.[toolCallIndex];
    if (!toolCallSnapshot) {
      throw new Error("no tool call snapshot");
    }
    const boundIdentity = state2.tool_call_identities.get(toolCallIndex);
    if (boundIdentity) {
      assertBoundToolCallIdentity(toolCallSnapshot, boundIdentity);
    }
    if (!toolCallSnapshot.type) {
      throw new Error("tool call snapshot missing `type`");
    }
    if (toolCallSnapshot.type === "function") {
      const inputTool = __classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.tools?.find((tool) => isChatCompletionFunctionTool(tool) && tool.function.name === toolCallSnapshot.function.name);
      let parsedArguments = null;
      const parseable = isAutoParsableTool(inputTool) || inputTool?.function.strict === true;
      let argumentsSnapshot;
      if (parseable) {
        if (__classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f")) {
          __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_validateStructuredSnapshots).call(this, __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f"));
        }
        const capturedArguments = captureStructuredJSONSnapshot(toolCallSnapshot.function, "arguments");
        if (typeof capturedArguments !== "string") {
          throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
        }
        argumentsSnapshot = capturedArguments;
      } else {
        argumentsSnapshot = toolCallSnapshot.function.arguments;
      }
      if (isAutoParsableTool(inputTool)) {
        parsedArguments = inputTool.$parseRaw(validateStructuredJSONSnapshot(argumentsSnapshot));
      } else if (inputTool?.function.strict) {
        parsedArguments = parseResponseFormatContent({ type: "json_schema", $parseRaw: void 0 }, validateStructuredJSONSnapshot(argumentsSnapshot));
      }
      this._emit("tool_calls.function.arguments.done", {
        name: toolCallSnapshot.function.name,
        index: toolCallIndex,
        arguments: argumentsSnapshot,
        parsed_arguments: parsedArguments
      });
    } else if (toolCallSnapshot.type !== "custom") {
      assertNever(toolCallSnapshot);
    }
  }, _ChatCompletionStream_emitContentDoneEvents = function _ChatCompletionStream_emitContentDoneEvents2(choiceSnapshot) {
    const state2 = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
    const structuredResponse = isParseableResponseFormat(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format);
    const boundedSnapshot = structuredResponse || __classPrivateFieldGet(this, _ChatCompletionStream_hasAutoParseableTool, "f");
    const messageSnapshot = boundedSnapshot ? captureStructuredMessageSnapshot(choiceSnapshot) : choiceSnapshot.message;
    const refusal = boundedSnapshot ? captureStructuredJSONSnapshot(messageSnapshot, "refusal") : messageSnapshot.refusal;
    const parseableContent = !refusal && structuredResponse;
    const content = parseableContent ? captureStructuredJSONSnapshot(messageSnapshot, "content") : messageSnapshot.content;
    if (content != null && (content !== "" || !refusal && !messageSnapshot.tool_calls?.length && !messageSnapshot.function_call) && !state2.content_done) {
      if (parseableContent && __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f")) {
        __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_validateStructuredSnapshots).call(this, __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f"));
      }
      state2.content_done = true;
      this._emit("content.done", {
        content,
        parsed: refusal ? null : parseResponseFormatContent(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format, parseableContent ? validateStructuredJSONSnapshot(content) : content)
      });
    }
    if (refusal && !state2.refusal_done) {
      state2.refusal_done = true;
      this._emit("refusal.done", { refusal });
    }
    if (choiceSnapshot.logprobs?.content && !state2.logprobs_content_done) {
      state2.logprobs_content_done = true;
      this._emit("logprobs.content.done", { content: choiceSnapshot.logprobs.content });
    }
    if (choiceSnapshot.logprobs?.refusal && !state2.logprobs_refusal_done) {
      state2.logprobs_refusal_done = true;
      this._emit("logprobs.refusal.done", { refusal: choiceSnapshot.logprobs.refusal });
    }
  }, _ChatCompletionStream_validateStructuredSnapshots = function _ChatCompletionStream_validateStructuredSnapshots2(snapshot) {
    const finalJSONBudget = { bytes: 0, fragments: 0, work: 0 };
    const parseableContent = isParseableResponseFormat(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format);
    const validatedMessages = /* @__PURE__ */ new WeakMap();
    const choices = captureSnapshotArray(snapshot, "choices", MAX_STREAM_CHOICES, "choice");
    if (!choices) {
      throw new OpenAIError("Chat completion stream contains an unsafe snapshot choice collection");
    }
    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
      const choice = captureSnapshotArrayItem(choices, choiceIndex);
      if (!choice) {
        continue;
      }
      const message = captureStructuredMessageSnapshot(choice);
      const refusal = captureStructuredJSONSnapshot(message, "refusal");
      const content = captureStructuredJSONSnapshot(message, "content");
      const validatedTools = /* @__PURE__ */ new Map();
      const toolCalls = captureSnapshotArray(message, "tool_calls", MAX_STREAM_TOOL_CALLS, "tool-call");
      validatedMessages.set(choice, Object.freeze({
        message,
        content,
        refusal,
        toolCallCollection: toolCalls,
        toolCalls: validatedTools
      }));
      const state2 = __classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index];
      if (parseableContent && !refusal && typeof content === "string") {
        validateStructuredJSONSnapshot(content, finalJSONBudget, __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f"));
      }
      for (const [index, identity] of state2?.tool_call_identities ?? []) {
        const toolCall = toolCalls && captureSnapshotArrayItem(toolCalls, index);
        if (!toolCall) {
          throw new OpenAIError("Chat completion stream contains a changed tool call identity");
        }
        assertBoundToolCallIdentity(toolCall, identity);
      }
      if (!__classPrivateFieldGet(this, _ChatCompletionStream_hasAutoParseableTool, "f")) {
        continue;
      }
      for (let toolCallIndex = 0; toolCallIndex < (toolCalls?.length ?? 0); toolCallIndex += 1) {
        const toolCall = captureSnapshotArrayItem(toolCalls, toolCallIndex);
        if (!toolCall) {
          continue;
        }
        const identity = ownFunctionToolIdentity(toolCall);
        if (!identity) {
          const type = Object.getOwnPropertyDescriptor(toolCall, "type");
          if (type && !("value" in type)) {
            throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
          }
          if (type?.value !== "function") {
            continue;
          }
          const fn2 = Object.getOwnPropertyDescriptor(toolCall, "function");
          if (fn2 && !("value" in fn2)) {
            throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
          }
          if (fn2 && typeof fn2.value === "object" && fn2.value !== null) {
            const name = Object.getOwnPropertyDescriptor(fn2.value, "name");
            if (name && !("value" in name)) {
              throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
            }
          }
          continue;
        }
        if (!shouldParseToolCall(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"), {
          type: identity.type,
          function: { name: identity.name }
        })) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(toolCall, "function");
        if (!descriptor || !("value" in descriptor)) {
          throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
        }
        const fn = descriptor.value;
        const argumentsSnapshot = captureStructuredJSONSnapshot(fn, "arguments");
        if (typeof argumentsSnapshot !== "string") {
          throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
        }
        validateStructuredJSONSnapshot(argumentsSnapshot, finalJSONBudget, __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f"));
        validatedTools.set(toolCallIndex, Object.freeze({
          tool: toolCall,
          function: fn,
          type: identity.type,
          name: identity.name,
          arguments: argumentsSnapshot
        }));
      }
    }
    return validatedMessages;
  }, _ChatCompletionStream_endRequest = function _ChatCompletionStream_endRequest2() {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any chunks`);
    }
    const validatedMessages = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_validateStructuredSnapshots).call(this, snapshot);
    const audioDoneChoiceIndexes = __classPrivateFieldGet(this, _ChatCompletionStream_audioDoneChoiceIndexes, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_audioDoneChoiceIndexes, /* @__PURE__ */ new Set(), "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, void 0, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_choiceEventStates, [], "f");
    return finalizeChatCompletion(snapshot, __classPrivateFieldGet(this, _ChatCompletionStream_params, "f"), audioDoneChoiceIndexes, validatedMessages);
  }, _ChatCompletionStream_accumulateChatCompletion = function _ChatCompletionStream_accumulateChatCompletion2(chunk, capturedChoiceFrames) {
    var _a5, _b, _c, _d, _e;
    let snapshot = __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    const { choices, obfuscation: _obfuscation, ...rest } = chunk;
    if (!snapshot) {
      const newSnapshot = {
        ...rest,
        choices: []
      };
      __classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, newSnapshot, "f");
      snapshot = newSnapshot;
    } else if (chunk.id) {
      assignOwnProperties(snapshot, rest);
    }
    const requestedChoiceCount = __classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.n;
    const maxChoices = typeof requestedChoiceCount === "number" && Number.isSafeInteger(requestedChoiceCount) && requestedChoiceCount > 0 ? Math.min(requestedChoiceCount, MAX_STREAM_CHOICES) : MAX_STREAM_CHOICES;
    for (const chunkChoice of chunk.choices) {
      const { delta, finish_reason, index, logprobs = null, ...other } = chunkChoice;
      const capturedToolCalls = [];
      capturedChoiceFrames.set(chunkChoice, Object.freeze({ index, tool_calls: capturedToolCalls }));
      if (!Number.isSafeInteger(index) || index < 0 || index >= maxChoices) {
        throw new OpenAIError(`Chat completion stream contains an invalid choice index: ${index}`);
      }
      let choice = snapshot.choices[index];
      if (!choice) {
        const newChoice = { finish_reason, index, message: {}, logprobs: null, ...other };
        snapshot.choices[index] = newChoice;
        choice = newChoice;
      }
      if (isParseableResponseFormat(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format) || __classPrivateFieldGet(this, _ChatCompletionStream_hasAutoParseableTool, "f")) {
        captureStructuredJSONSnapshot(captureStructuredMessageSnapshot(choice), "refusal");
      }
      if (logprobs) {
        if (choice.logprobs) {
          const { content: content2, refusal: refusal2, ...rest3 } = logprobs;
          assertIsEmpty(rest3);
          assignOwnProperties(choice.logprobs, rest3);
          if (content2) {
            (_a5 = choice.logprobs).content ?? (_a5.content = []);
            choice.logprobs.content.push(...content2);
          }
          if (refusal2) {
            (_b = choice.logprobs).refusal ?? (_b.refusal = []);
            choice.logprobs.refusal.push(...refusal2);
          }
        } else {
          choice.logprobs = { ...logprobs };
          if (logprobs.content) {
            choice.logprobs.content = [...logprobs.content];
          }
          if (logprobs.refusal) {
            choice.logprobs.refusal = [...logprobs.refusal];
          }
        }
      }
      if (finish_reason) {
        choice.finish_reason = finish_reason;
        if (__classPrivateFieldGet(this, _ChatCompletionStream_params, "f") && hasAutoParseableInput(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"))) {
          if (finish_reason === "length") {
            throw new LengthFinishReasonError();
          }
          if (finish_reason === "content_filter") {
            throw new ContentFilterFinishReasonError();
          }
        }
      }
      assignOwnProperties(choice, other);
      if (!delta) {
        Object.freeze(capturedToolCalls);
        continue;
      }
      __classPrivateFieldGet(this, _ChatCompletionStream_audioDoneChoiceIndexes, "f").delete(index);
      const { audio, content, refusal, function_call, role, ...capturedDeltaFields } = delta;
      const { tool_calls: capturedToolCallDelta, ...rest2 } = capturedDeltaFields;
      const tool_calls = hasOwn(capturedDeltaFields, "tool_calls") ? capturedToolCallDelta : delta.tool_calls;
      assertIsEmpty(rest2);
      assignOwnProperties(choice.message, rest2);
      if (audio?.expires_at != null && audio.id == null && audio.data == null && audio.transcript == null && content == null && refusal == null && function_call == null && role == null && tool_calls == null && Object.keys(rest2).length === 0) {
        __classPrivateFieldGet(this, _ChatCompletionStream_audioDoneChoiceIndexes, "f").add(index);
      }
      if (refusal) {
        choice.message.refusal = (choice.message.refusal || "") + refusal;
      }
      if (role) {
        choice.message.role = role;
      }
      if (audio) {
        const audioSnapshot = (_c = choice.message).audio ?? (_c.audio = {});
        if (audio.id != null) {
          audioSnapshot.id = audio.id;
        }
        if (audio.data != null) {
          audioSnapshot.data = (audioSnapshot.data ?? "") + audio.data;
        }
        if (audio.transcript != null) {
          audioSnapshot.transcript = (audioSnapshot.transcript ?? "") + audio.transcript;
        }
        if (audio.expires_at != null) {
          audioSnapshot.expires_at = audio.expires_at;
        }
      }
      if (function_call) {
        if (choice.message.function_call) {
          if (function_call.name) {
            choice.message.function_call.name = function_call.name;
          }
          if (function_call.arguments) {
            (_d = choice.message.function_call).arguments ?? (_d.arguments = "");
            choice.message.function_call.arguments += function_call.arguments;
          }
        } else {
          choice.message.function_call = function_call;
        }
      }
      if (content != null) {
        if (!choice.message.refusal && isParseableResponseFormat(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format)) {
          const eventState = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choice);
          const parseState = eventState.content_parse_state ?? (eventState.content_parse_state = createPartialJSONParseState());
          const shouldParse = recordPartialJSONFragment(parseState, __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f"), content);
          choice.message.content = (captureStructuredJSONSnapshot(choice.message, "content") || "") + content;
          if (!parseState.has_non_whitespace) {
            choice.message.parsed = null;
          } else if (shouldParse && reservePartialJSONParse(parseState, __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f"))) {
            __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_validateStructuredSnapshots).call(this, snapshot);
            choice.message.parsed = parseStructuredStreamingJSON(validateStructuredJSONSnapshot(choice.message.content));
          } else if (content.length > 0) {
            choice.message.parsed = null;
          }
        } else {
          choice.message.content = (choice.message.content || "") + content;
        }
      }
      if (tool_calls) {
        const toolCallSnapshots = (_e = choice.message).tool_calls ?? (_e.tool_calls = []);
        for (const toolCallDelta of tool_calls) {
          const { index: index2, id, type, function: fn, custom, ...rest3 } = toolCallDelta;
          if (!Number.isSafeInteger(index2) || index2 < 0 || index2 >= MAX_STREAM_TOOL_CALLS) {
            throw new OpenAIError(`Chat completion stream contains an invalid tool call index: ${index2}`);
          }
          let argumentsDelta = "";
          const tool_call = toolCallSnapshots[index2] ?? (toolCallSnapshots[index2] = {});
          const functionName = fn?.name;
          const eventState = __classPrivateFieldGet(this, _ChatCompletionStream_hasAutoParseableTool, "f") ? __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choice) : void 0;
          let boundIdentity = eventState?.tool_call_identities.get(index2);
          if (boundIdentity) {
            assertBoundToolCallIdentity(tool_call, boundIdentity);
            if (type !== void 0 && type !== boundIdentity.type || functionName !== void 0 && functionName !== boundIdentity.name) {
              throw new OpenAIError("Chat completion stream contains a changed tool call identity");
            }
          }
          assignOwnProperties(tool_call, rest3);
          if (id) {
            tool_call.id = id;
          }
          if (type) {
            tool_call.type = type;
          }
          if (custom) {
            const customSnapshot = tool_call.custom ?? (tool_call.custom = { name: custom.name ?? "", input: "" });
            if (custom.name) {
              customSnapshot.name = custom.name;
            }
            if (custom.input) {
              customSnapshot.input += custom.input;
            }
          }
          if (fn) {
            const functionSnapshot = tool_call.function ?? (tool_call.function = { name: functionName ?? "", arguments: "" });
            if (functionName) {
              functionSnapshot.name = functionName;
            }
            if (eventState && !boundIdentity) {
              const identity = ownFunctionToolIdentity(tool_call);
              const configuredTool = identity && __classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.tools?.find((tool) => isChatCompletionFunctionTool(tool) && tool.function.name === identity.name);
              if (identity) {
                boundIdentity = {
                  ...identity,
                  parseable: configuredTool !== void 0 && shouldParseToolCall(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"), {
                    type: identity.type,
                    function: { name: identity.name }
                  })
                };
                eventState.tool_call_identities.set(index2, boundIdentity);
                if (!boundIdentity.parseable) {
                  const provisionalState = eventState.tool_call_parse_states.get(index2);
                  if (provisionalState) {
                    __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f").bytes -= provisionalState.bytes;
                    __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f").fragments -= provisionalState.fragments;
                    __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f").work -= provisionalState.work;
                    eventState.tool_call_parse_states.delete(index2);
                  }
                }
              }
            }
            const argumentFragment = fn.arguments;
            if (argumentFragment != null) {
              argumentsDelta = argumentFragment;
              if (eventState && boundIdentity?.parseable !== false) {
                let parseState = eventState.tool_call_parse_states.get(index2);
                if (!parseState) {
                  parseState = createPartialJSONParseState();
                  eventState.tool_call_parse_states.set(index2, parseState);
                }
                const shouldParse = recordPartialJSONFragment(parseState, __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f"), argumentFragment);
                const previousArguments = captureStructuredJSONSnapshot(functionSnapshot, "arguments");
                if (typeof previousArguments !== "string") {
                  throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
                }
                functionSnapshot.arguments = previousArguments + argumentFragment;
                if (shouldParse && boundIdentity?.parseable === true && reservePartialJSONParse(parseState, __classPrivateFieldGet(this, _ChatCompletionStream_partialJSONParseBudget, "f"))) {
                  __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_validateStructuredSnapshots).call(this, snapshot);
                  functionSnapshot.parsed_arguments = parseStructuredStreamingJSON(validateStructuredJSONSnapshot(functionSnapshot.arguments));
                } else if (argumentFragment.length > 0 && hasOwn(functionSnapshot, "parsed_arguments")) {
                  functionSnapshot.parsed_arguments = void 0;
                }
              } else {
                functionSnapshot.arguments += argumentFragment;
              }
            }
          }
          capturedToolCalls.push(Object.freeze({ index: index2, arguments_delta: argumentsDelta }));
        }
      }
      Object.freeze(capturedToolCalls);
    }
    return snapshot;
  }, Symbol.asyncIterator)]() {
    return this._createIterator((push) => {
      const onChunk = (chunk) => push(chunk);
      this.on("chunk", onChunk);
      return () => this.off("chunk", onChunk);
    }, { onReturn: () => this.abort() });
  }
  /** Serializes raw completion chunks into a readable stream for transfer to another runtime. */
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
};
function finalizeChatCompletion(snapshot, params, audioDoneChoiceIndexes, validatedMessages) {
  const { id, choices, created, model, system_fingerprint, ...rest } = snapshot;
  const completion = {
    ...rest,
    id,
    choices: mapCapturedSnapshotArray(choices, MAX_STREAM_CHOICES, "choice", (choice) => {
      const validated = validatedMessages.get(choice);
      if (!validated) {
        throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
      }
      const stableChoice = new Proxy(choice, {
        get(target, property, receiver) {
          return property === "message" ? validated.message : Reflect.get(target, property, receiver);
        }
      });
      const { message: sourceMessage, finish_reason, index, logprobs, ...choiceRest } = stableChoice;
      const message = new Proxy(sourceMessage, {
        get(target, property, receiver) {
          if (property === "content") {
            return validated.content;
          }
          if (property === "refusal") {
            return validated.refusal;
          }
          if (property === "tool_calls") {
            return validated.toolCallCollection;
          }
          return Reflect.get(target, property, receiver);
        }
      });
      const { content = null, function_call, tool_calls, audio, ...messageRest } = message;
      const finishReason = finish_reason ?? (audioDoneChoiceIndexes.has(index) && isCompleteAudio(audio) ? "stop" : null);
      if (!finishReason) {
        throw new OpenAIError(`missing finish_reason for choice ${index}`);
      }
      const audioResponse = audio ? { audio } : {};
      const role = message.role;
      if (!role) {
        throw new OpenAIError(`missing role for choice ${index}`);
      }
      if (function_call) {
        const { arguments: args, name } = function_call;
        if (args == null) {
          throw new OpenAIError(`missing function_call.arguments for choice ${index}`);
        }
        if (!name) {
          throw new OpenAIError(`missing function_call.name for choice ${index}`);
        }
        return {
          ...choiceRest,
          message: {
            ...audioResponse,
            content,
            function_call: { arguments: args, name },
            role,
            refusal: message.refusal ?? null
          },
          finish_reason: finishReason,
          index,
          logprobs
        };
      }
      if (tool_calls) {
        return {
          ...choiceRest,
          index,
          finish_reason: finishReason,
          logprobs,
          message: {
            ...messageRest,
            ...audioResponse,
            role,
            content,
            refusal: message.refusal ?? null,
            tool_calls: mapCapturedSnapshotArray(tool_calls, MAX_STREAM_TOOL_CALLS, "tool-call", (tool_call, i) => {
              const captured = validated.toolCalls.get(i);
              if (!captured) {
                const identity = ownFunctionToolIdentity(tool_call);
                if (identity && shouldParseToolCall(params, {
                  type: identity.type,
                  function: { name: identity.name }
                })) {
                  throw new OpenAIError("Chat completion stream contains an unsafe structured JSON snapshot");
                }
              }
              if (captured && captured.tool !== tool_call) {
                throw new OpenAIError("Chat completion stream contains a changed tool call identity");
              }
              const stableFunction = captured && new Proxy(captured.function, {
                get(target, property, receiver) {
                  if (property === "arguments") {
                    return captured.arguments;
                  }
                  if (property === "name") {
                    return captured.name;
                  }
                  return Reflect.get(target, property, receiver);
                }
              });
              const stableTool = captured && stableFunction ? new Proxy(tool_call, {
                get(target, property, receiver) {
                  if (property === "type") {
                    return captured.type;
                  }
                  if (property === "function") {
                    return stableFunction;
                  }
                  return Reflect.get(target, property, receiver);
                }
              }) : tool_call;
              if (stableTool.type == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].type`);
              }
              if (stableTool.type === "custom") {
                const { custom, type: type2, id: id3, ...toolRest2 } = stableTool;
                const { input = "", name: name2, ...customRest } = custom || {};
                if (name2 == null) {
                  throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].custom.name`);
                }
                return {
                  ...toolRest2,
                  id: id3 || `call_${uuid4()}`,
                  type: type2,
                  custom: { ...customRest, name: name2, input }
                };
              }
              const { function: fn, type, id: id2, ...toolRest } = stableTool;
              const { arguments: args, name, ...fnRest } = fn || {};
              if (name == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.name`);
              }
              if (args == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.arguments`);
              }
              return {
                ...toolRest,
                id: id2 || `call_${uuid4()}`,
                type,
                function: { ...fnRest, name, arguments: args }
              };
            })
          }
        };
      }
      return {
        ...choiceRest,
        message: { ...messageRest, ...audioResponse, content, role, refusal: message.refusal ?? null },
        finish_reason: finishReason,
        index,
        logprobs
      };
    }),
    created,
    model,
    object: "chat.completion",
    ...system_fingerprint ? { system_fingerprint } : {}
  };
  return maybeParseChatCompletion(completion, params);
}
function isCompleteAudio(audio) {
  return audio?.id != null && audio.data != null && audio.transcript != null && audio.expires_at != null;
}
function assertIsEmpty(obj) {
  void obj;
}
function assertNever(_x) {
  return _x;
}

// ../../../node_modules/openai/lib/ChatCompletionStreamingRunner.mjs
var ChatCompletionStreamingRunner = class _ChatCompletionStreamingRunner extends ChatCompletionStream {
  /** Restores a serialized tool run, including intermediate completions and tool-result messages. */
  static fromReadableStream(stream) {
    const runner = new _ChatCompletionStreamingRunner(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  /** Serializes completion chunks and tool-result messages for replay in another runtime. */
  toReadableStream() {
    let lastChunk;
    let toolCallIds;
    const iterator = this._createIterator((push) => {
      const onChunk = (chunk) => {
        lastChunk = chunk;
        push(chunk);
      };
      const onMessage = (message) => {
        if (isAssistantMessage(message)) {
          toolCallIds = message.tool_calls?.map((toolCall) => toolCall.id);
          return;
        }
        if (isToolMessage(message)) {
          if (!lastChunk) {
            throw new OpenAIError("cannot serialize a tool message before receiving any chunks");
          }
          push(makeChatCompletionReadableStreamMessageChunk(lastChunk, message, toolCallIds));
        }
      };
      this.on("chunk", onChunk);
      this.on("message", onMessage);
      return () => {
        this.off("chunk", onChunk);
        this.off("message", onMessage);
      };
    }, { onReturn: () => this.abort() });
    const stream = new Stream(() => iterator, this.controller);
    return stream.toReadableStream();
  }
  /** Starts a streaming tool loop and returns its event-driven conversation runner. */
  static runTools(client, params, options) {
    const runner = new _ChatCompletionStreamingRunner(
      // @ts-expect-error TODO these types are incompatible
      params
    );
    const opts = {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "runTools" }
    };
    runner._run(() => runner._runTools(client, params, runner, opts));
    return runner;
  }
};

// ../../../node_modules/openai/resources/chat/completions/completions.mjs
var Completions = class extends APIResource {
  constructor() {
    super(...arguments);
    this.messages = new Messages(this._client);
  }
  create(body, options) {
    return this._client.post("/chat/completions", {
      body,
      ...options,
      stream: body.stream ?? false,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Get a stored chat completion. Only Chat Completions that have been created with
   * the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * const chatCompletion =
   *   await client.chat.completions.retrieve('completion_id');
   * ```
   */
  retrieve(completionID, options) {
    return this._client.get(path`/chat/completions/${completionID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Modify a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be modified. Currently, the only
   * supported modification is to update the `metadata` field.
   *
   * @example
   * ```ts
   * const chatCompletion = await client.chat.completions.update(
   *   'completion_id',
   *   { metadata: { foo: 'string' } },
   * );
   * ```
   */
  update(completionID, body, options) {
    return this._client.post(path`/chat/completions/${completionID}`, {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List stored Chat Completions. Only Chat Completions that have been stored with
   * the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletion of client.chat.completions.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/chat/completions", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be deleted.
   *
   * @example
   * ```ts
   * const chatCompletionDeleted =
   *   await client.chat.completions.delete('completion_id');
   * ```
   */
  delete(completionID, options) {
    return this._client.delete(path`/chat/completions/${completionID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  parse(body, options) {
    validateInputTools(body.tools);
    return this._client.chat.completions.create(body, {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "chat.completions.parse" }
    })._thenUnwrap((completion) => parseChatCompletion(completion, body));
  }
  runTools(body, options) {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runTools(this._client, body, options);
    }
    return ChatCompletionRunner.runTools(this._client, body, options);
  }
  /**
   * Creates a chat completion stream
   */
  stream(body, options) {
    return ChatCompletionStream.createChatCompletion(this._client, body, options);
  }
};
Completions.Messages = Messages;

// ../../../node_modules/openai/resources/chat/chat.mjs
var Chat = class extends APIResource {
  constructor() {
    super(...arguments);
    this.completions = new Completions(this._client);
  }
};
Chat.Completions = Completions;

// ../../../node_modules/openai/resources/admin/organization/admin-api-keys.mjs
var AdminAPIKeys = class extends APIResource {
  /**
   * Create an organization admin API key
   *
   * @example
   * ```ts
   * const adminAPIKey =
   *   await client.admin.organization.adminAPIKeys.create({
   *     name: 'New Admin Key',
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/admin_api_keys", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieve a single organization API key
   *
   * @example
   * ```ts
   * const adminAPIKey =
   *   await client.admin.organization.adminAPIKeys.retrieve(
   *     'key_id',
   *   );
   * ```
   */
  retrieve(keyID, options) {
    return this._client.get(path`/organization/admin_api_keys/${keyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * List organization API keys
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const adminAPIKey of client.admin.organization.adminAPIKeys.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/admin_api_keys", CursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Delete an organization admin API key
   *
   * @example
   * ```ts
   * const adminAPIKey =
   *   await client.admin.organization.adminAPIKeys.delete(
   *     'key_id',
   *   );
   * ```
   */
  delete(keyID, options) {
    return this._client.delete(path`/organization/admin_api_keys/${keyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/audit-logs.mjs
var AuditLogs = class extends APIResource {
  /**
   * List user actions and configuration changes within this organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const auditLogListResponse of client.admin.organization.auditLogs.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/audit_logs", ConversationCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/certificates.mjs
var Certificates = class extends APIResource {
  /**
   * Upload a certificate to the organization. This does **not** automatically
   * activate the certificate.
   *
   * Organizations can upload up to 50 certificates.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.create({
   *     certificate: 'certificate',
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/certificates", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get a certificate that has been uploaded to the organization.
   *
   * You can get a certificate regardless of whether it is active or not.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.retrieve(
   *     'certificate_id',
   *   );
   * ```
   */
  retrieve(certificateID, query = {}, options) {
    return this._client.get(path`/organization/certificates/${certificateID}`, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Modify a certificate. Note that only the name can be modified.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.update(
   *     'certificate_id',
   *   );
   * ```
   */
  update(certificateID, body, options) {
    return this._client.post(path`/organization/certificates/${certificateID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * List uploaded certificates for this organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateListResponse of client.admin.organization.certificates.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/certificates", ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Delete a certificate from the organization.
   *
   * The certificate must be inactive for the organization and all projects.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.delete(
   *     'certificate_id',
   *   );
   * ```
   */
  delete(certificateID, options) {
    return this._client.delete(path`/organization/certificates/${certificateID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Activate certificates at the organization level.
   *
   * You can atomically and idempotently activate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateActivateResponse of client.admin.organization.certificates.activate(
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  activate(body, options) {
    return this._client.getAPIList("/organization/certificates/activate", Page, {
      body,
      method: "post",
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Deactivate certificates at the organization level.
   *
   * You can atomically and idempotently deactivate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateDeactivateResponse of client.admin.organization.certificates.deactivate(
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  deactivate(body, options) {
    return this._client.getAPIList("/organization/certificates/deactivate", Page, { body, method: "post", ...options, __security: { adminAPIKeyAuth: true } });
  }
};

// ../../../node_modules/openai/resources/admin/organization/data-retention.mjs
var DataRetention = class extends APIResource {
  /**
   * Retrieves organization data retention controls.
   *
   * @example
   * ```ts
   * const organizationDataRetention =
   *   await client.admin.organization.dataRetention.retrieve();
   * ```
   */
  retrieve(options) {
    return this._client.get("/organization/data_retention", {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates organization data retention controls.
   *
   * @example
   * ```ts
   * const organizationDataRetention =
   *   await client.admin.organization.dataRetention.update({
   *     retention_type: 'zero_data_retention',
   *   });
   * ```
   */
  update(body, options) {
    return this._client.post("/organization/data_retention", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/invites.mjs
var Invites = class extends APIResource {
  /**
   * Create an invite for a user to the organization. The invite must be accepted by
   * the user before they have access to the organization.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.admin.organization.invites.create({
   *     email: 'email',
   *     role: 'reader',
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/invites", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves an invite.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.admin.organization.invites.retrieve(
   *     'invite_id',
   *   );
   * ```
   */
  retrieve(inviteID, options) {
    return this._client.get(path`/organization/invites/${inviteID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Returns a list of invites in the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const invite of client.admin.organization.invites.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/invites", ConversationCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Delete an invite. If the invite has already been accepted, it cannot be deleted.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.admin.organization.invites.delete(
   *     'invite_id',
   *   );
   * ```
   */
  delete(inviteID, options) {
    return this._client.delete(path`/organization/invites/${inviteID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/roles.mjs
var Roles = class extends APIResource {
  /**
   * Creates a custom role for the organization.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.create({
   *   permissions: ['string'],
   *   role_name: 'role_name',
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/roles", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves an organization role.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.retrieve(
   *   'role_id',
   * );
   * ```
   */
  retrieve(roleID, options) {
    return this._client.get(path`/organization/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates an existing organization role.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.update(
   *   'role_id',
   * );
   * ```
   */
  update(roleID, body, options) {
    return this._client.post(path`/organization/roles/${roleID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the roles configured for the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const role of client.admin.organization.roles.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/roles", NextCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Deletes a custom role from the organization.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.delete(
   *   'role_id',
   * );
   * ```
   */
  delete(roleID, options) {
    return this._client.delete(path`/organization/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/spend-alerts.mjs
var SpendAlerts = class extends APIResource {
  /**
   * Creates an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlert =
   *   await client.admin.organization.spendAlerts.create({
   *     currency: 'USD',
   *     interval: 'month',
   *     notification_channel: {
   *       recipients: ['string'],
   *       type: 'email',
   *     },
   *     threshold_amount: 0,
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/spend_alerts", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlert =
   *   await client.admin.organization.spendAlerts.retrieve(
   *     'alert_id',
   *   );
   * ```
   */
  retrieve(alertID, options) {
    return this._client.get(path`/organization/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlert =
   *   await client.admin.organization.spendAlerts.update(
   *     'alert_id',
   *     {
   *       currency: 'USD',
   *       interval: 'month',
   *       notification_channel: {
   *         recipients: ['string'],
   *         type: 'email',
   *       },
   *       threshold_amount: 0,
   *     },
   *   );
   * ```
   */
  update(alertID, body, options) {
    return this._client.post(path`/organization/spend_alerts/${alertID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists organization spend alerts.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const organizationSpendAlert of client.admin.organization.spendAlerts.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/spend_alerts", ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Deletes an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlertDeleted =
   *   await client.admin.organization.spendAlerts.delete(
   *     'alert_id',
   *   );
   * ```
   */
  delete(alertID, options) {
    return this._client.delete(path`/organization/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/spend-limit.mjs
var SpendLimit = class extends APIResource {
  /**
   * Get the organization's hard spend limit.
   *
   * @example
   * ```ts
   * const organizationSpendLimit =
   *   await client.admin.organization.spendLimit.retrieve();
   * ```
   */
  retrieve(options) {
    return this._client.get("/organization/spend_limit", {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Create or replace the organization's hard spend limit.
   *
   * @example
   * ```ts
   * const organizationSpendLimit =
   *   await client.admin.organization.spendLimit.update({
   *     currency: 'USD',
   *     interval: 'month',
   *     threshold_amount: 1,
   *   });
   * ```
   */
  update(body, options) {
    return this._client.post("/organization/spend_limit", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Delete the organization's hard spend limit.
   *
   * @example
   * ```ts
   * const organizationSpendLimitDeleted =
   *   await client.admin.organization.spendLimit.delete();
   * ```
   */
  delete(options) {
    return this._client.delete("/organization/spend_limit", {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/usage.mjs
var Usage = class extends APIResource {
  /**
   * Get audio speeches usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.audioSpeeches({
   *     start_time: 0,
   *   });
   * ```
   */
  audioSpeeches(query, options) {
    return this._client.get("/organization/usage/audio_speeches", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get audio transcriptions usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.audioTranscriptions(
   *     { start_time: 0 },
   *   );
   * ```
   */
  audioTranscriptions(query, options) {
    return this._client.get("/organization/usage/audio_transcriptions", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get code interpreter sessions usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.codeInterpreterSessions(
   *     { start_time: 0 },
   *   );
   * ```
   */
  codeInterpreterSessions(query, options) {
    return this._client.get("/organization/usage/code_interpreter_sessions", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get completions usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.completions({
   *     start_time: 0,
   *   });
   * ```
   */
  completions(query, options) {
    return this._client.get("/organization/usage/completions", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get costs details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.costs({
   *     start_time: 0,
   *   });
   * ```
   */
  costs(query, options) {
    return this._client.get("/organization/costs", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get embeddings usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.embeddings({
   *     start_time: 0,
   *   });
   * ```
   */
  embeddings(query, options) {
    return this._client.get("/organization/usage/embeddings", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get file search calls usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.fileSearchCalls({
   *     start_time: 0,
   *   });
   * ```
   */
  fileSearchCalls(query, options) {
    return this._client.get("/organization/usage/file_search_calls", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get images usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.images({
   *     start_time: 0,
   *   });
   * ```
   */
  images(query, options) {
    return this._client.get("/organization/usage/images", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get moderations usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.moderations({
   *     start_time: 0,
   *   });
   * ```
   */
  moderations(query, options) {
    return this._client.get("/organization/usage/moderations", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get vector stores usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.vectorStores({
   *     start_time: 0,
   *   });
   * ```
   */
  vectorStores(query, options) {
    return this._client.get("/organization/usage/vector_stores", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Get web search calls usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.webSearchCalls({
   *     start_time: 0,
   *   });
   * ```
   */
  webSearchCalls(query, options) {
    return this._client.get("/organization/usage/web_search_calls", {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/groups/roles.mjs
var Roles2 = class extends APIResource {
  /**
   * Assigns an organization role to a group within the organization.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.groups.roles.create(
   *     'group_id',
   *     { role_id: 'role_id' },
   *   );
   * ```
   */
  create(groupID, body, options) {
    return this._client.post(path`/organization/groups/${groupID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves an organization role assigned to a group.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.groups.roles.retrieve(
   *     'role_id',
   *     { group_id: 'group_id' },
   *   );
   * ```
   */
  retrieve(roleID, params, options) {
    const { group_id } = params;
    return this._client.get(path`/organization/groups/${group_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the organization roles assigned to a group within the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const roleListResponse of client.admin.organization.groups.roles.list(
   *   'group_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(groupID, query = {}, options) {
    return this._client.getAPIList(path`/organization/groups/${groupID}/roles`, NextCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Unassigns an organization role from a group within the organization.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.groups.roles.delete(
   *     'role_id',
   *     { group_id: 'group_id' },
   *   );
   * ```
   */
  delete(roleID, params, options) {
    const { group_id } = params;
    return this._client.delete(path`/organization/groups/${group_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/groups/users.mjs
var Users = class extends APIResource {
  /**
   * Adds a user to a group.
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.groups.users.create(
   *     'group_id',
   *     { user_id: 'user_id' },
   *   );
   * ```
   */
  create(groupID, body, options) {
    return this._client.post(path`/organization/groups/${groupID}/users`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a user in a group.
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.groups.users.retrieve(
   *     'user_id',
   *     { group_id: 'group_id' },
   *   );
   * ```
   */
  retrieve(userID, params, options) {
    const { group_id } = params;
    return this._client.get(path`/organization/groups/${group_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the users assigned to a group.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const organizationGroupUser of client.admin.organization.groups.users.list(
   *   'group_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(groupID, query = {}, options) {
    return this._client.getAPIList(path`/organization/groups/${groupID}/users`, NextCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Removes a user from a group.
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.groups.users.delete(
   *     'user_id',
   *     { group_id: 'group_id' },
   *   );
   * ```
   */
  delete(userID, params, options) {
    const { group_id } = params;
    return this._client.delete(path`/organization/groups/${group_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/groups/groups.mjs
var Groups = class extends APIResource {
  constructor() {
    super(...arguments);
    this.users = new Users(this._client);
    this.roles = new Roles2(this._client);
  }
  /**
   * Creates a new group in the organization.
   *
   * @example
   * ```ts
   * const group = await client.admin.organization.groups.create(
   *   { name: 'x' },
   * );
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/groups", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a group.
   *
   * @example
   * ```ts
   * const group =
   *   await client.admin.organization.groups.retrieve(
   *     'group_id',
   *   );
   * ```
   */
  retrieve(groupID, options) {
    return this._client.get(path`/organization/groups/${groupID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates a group's information.
   *
   * @example
   * ```ts
   * const group = await client.admin.organization.groups.update(
   *   'group_id',
   *   { name: 'x' },
   * );
   * ```
   */
  update(groupID, body, options) {
    return this._client.post(path`/organization/groups/${groupID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists all groups in the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const group of client.admin.organization.groups.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/groups", NextCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Deletes a group from the organization.
   *
   * @example
   * ```ts
   * const group = await client.admin.organization.groups.delete(
   *   'group_id',
   * );
   * ```
   */
  delete(groupID, options) {
    return this._client.delete(path`/organization/groups/${groupID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};
Groups.Users = Users;
Groups.Roles = Roles2;

// ../../../node_modules/openai/resources/admin/organization/projects/api-keys.mjs
var APIKeys = class extends APIResource {
  /**
   * Retrieves an API key in the project.
   *
   * @example
   * ```ts
   * const projectAPIKey =
   *   await client.admin.organization.projects.apiKeys.retrieve(
   *     'api_key_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(apiKeyID, params, options) {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/api_keys/${apiKeyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Returns a list of API keys in the project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectAPIKey of client.admin.organization.projects.apiKeys.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/api_keys`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Deletes an API key from the project.
   *
   * Returns confirmation of the key deletion, or an error if the key belonged to a
   * service account.
   *
   * @example
   * ```ts
   * const apiKey =
   *   await client.admin.organization.projects.apiKeys.delete(
   *     'api_key_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(apiKeyID, params, options) {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/api_keys/${apiKeyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/certificates.mjs
var Certificates2 = class extends APIResource {
  /**
   * List certificates for this project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateListResponse of client.admin.organization.projects.certificates.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/certificates`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Activate certificates at the project level.
   *
   * You can atomically and idempotently activate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateActivateResponse of client.admin.organization.projects.certificates.activate(
   *   'project_id',
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  activate(projectID, body, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/certificates/activate`, Page, { body, method: "post", ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Deactivate certificates at the project level. You can atomically and
   * idempotently deactivate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateDeactivateResponse of client.admin.organization.projects.certificates.deactivate(
   *   'project_id',
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  deactivate(projectID, body, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/certificates/deactivate`, Page, { body, method: "post", ...options, __security: { adminAPIKeyAuth: true } });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/data-retention.mjs
var DataRetention2 = class extends APIResource {
  /**
   * Retrieves project data retention controls.
   *
   * @example
   * ```ts
   * const projectDataRetention =
   *   await client.admin.organization.projects.dataRetention.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID, options) {
    return this._client.get(path`/organization/projects/${projectID}/data_retention`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates project data retention controls.
   *
   * @example
   * ```ts
   * const projectDataRetention =
   *   await client.admin.organization.projects.dataRetention.update(
   *     'project_id',
   *     { retention_type: 'organization_default' },
   *   );
   * ```
   */
  update(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/data_retention`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/hosted-tool-permissions.mjs
var HostedToolPermissions = class extends APIResource {
  /**
   * Returns hosted tool permissions for a project.
   *
   * @example
   * ```ts
   * const projectHostedToolPermissions =
   *   await client.admin.organization.projects.hostedToolPermissions.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID, options) {
    return this._client.get(path`/organization/projects/${projectID}/hosted_tool_permissions`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates hosted tool permissions for a project.
   *
   * @example
   * ```ts
   * const projectHostedToolPermissions =
   *   await client.admin.organization.projects.hostedToolPermissions.update(
   *     'project_id',
   *   );
   * ```
   */
  update(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/hosted_tool_permissions`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/model-permissions.mjs
var ModelPermissions = class extends APIResource {
  /**
   * Returns model permissions for a project.
   *
   * @example
   * ```ts
   * const projectModelPermissions =
   *   await client.admin.organization.projects.modelPermissions.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID, options) {
    return this._client.get(path`/organization/projects/${projectID}/model_permissions`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates model permissions for a project.
   *
   * @example
   * ```ts
   * const projectModelPermissions =
   *   await client.admin.organization.projects.modelPermissions.update(
   *     'project_id',
   *     { mode: 'allow_list', model_ids: ['string'] },
   *   );
   * ```
   */
  update(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/model_permissions`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Deletes model permissions for a project.
   *
   * @example
   * ```ts
   * const projectModelPermissionsDeleted =
   *   await client.admin.organization.projects.modelPermissions.delete(
   *     'project_id',
   *   );
   * ```
   */
  delete(projectID, options) {
    return this._client.delete(path`/organization/projects/${projectID}/model_permissions`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/rate-limits.mjs
var RateLimits = class extends APIResource {
  /**
   * Returns the rate limits per model for a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectRateLimit of client.admin.organization.projects.rateLimits.listRateLimits(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  listRateLimits(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/rate_limits`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Updates a project rate limit.
   *
   * @example
   * ```ts
   * const projectRateLimit =
   *   await client.admin.organization.projects.rateLimits.updateRateLimit(
   *     'rate_limit_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  updateRateLimit(rateLimitID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/rate_limits/${rateLimitID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/roles.mjs
var Roles3 = class extends APIResource {
  /**
   * Creates a custom role for a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.create(
   *     'project_id',
   *     { permissions: ['string'], role_name: 'role_name' },
   *   );
   * ```
   */
  create(projectID, body, options) {
    return this._client.post(path`/projects/${projectID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a project role.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.retrieve(
   *     'role_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(roleID, params, options) {
    const { project_id } = params;
    return this._client.get(path`/projects/${project_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates an existing project role.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.update(
   *     'role_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  update(roleID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/projects/${project_id}/roles/${roleID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the roles configured for a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const role of client.admin.organization.projects.roles.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/projects/${projectID}/roles`, NextCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Deletes a custom role from a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.delete(
   *     'role_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(roleID, params, options) {
    const { project_id } = params;
    return this._client.delete(path`/projects/${project_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/spend-alerts.mjs
var SpendAlerts2 = class extends APIResource {
  /**
   * Creates a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlert =
   *   await client.admin.organization.projects.spendAlerts.create(
   *     'project_id',
   *     {
   *       currency: 'USD',
   *       interval: 'month',
   *       notification_channel: {
   *         recipients: ['string'],
   *         type: 'email',
   *       },
   *       threshold_amount: 0,
   *     },
   *   );
   * ```
   */
  create(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/spend_alerts`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlert =
   *   await client.admin.organization.projects.spendAlerts.retrieve(
   *     'alert_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(alertID, params, options) {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlert =
   *   await client.admin.organization.projects.spendAlerts.update(
   *     'alert_id',
   *     {
   *       project_id: 'project_id',
   *       currency: 'USD',
   *       interval: 'month',
   *       notification_channel: {
   *         recipients: ['string'],
   *         type: 'email',
   *       },
   *       threshold_amount: 0,
   *     },
   *   );
   * ```
   */
  update(alertID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/spend_alerts/${alertID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists project spend alerts.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectSpendAlert of client.admin.organization.projects.spendAlerts.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/spend_alerts`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Deletes a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlertDeleted =
   *   await client.admin.organization.projects.spendAlerts.delete(
   *     'alert_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(alertID, params, options) {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/spend-limit.mjs
var SpendLimit2 = class extends APIResource {
  /**
   * Get a project's hard spend limit.
   *
   * @example
   * ```ts
   * const projectSpendLimit =
   *   await client.admin.organization.projects.spendLimit.retrieve(
   *     'proj_123',
   *   );
   * ```
   */
  retrieve(projectID, options) {
    return this._client.get(path`/organization/projects/${projectID}/spend_limit`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Create or replace a project's hard spend limit.
   *
   * @example
   * ```ts
   * const projectSpendLimit =
   *   await client.admin.organization.projects.spendLimit.update(
   *     'proj_123',
   *     {
   *       currency: 'USD',
   *       interval: 'month',
   *       threshold_amount: 1,
   *     },
   *   );
   * ```
   */
  update(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/spend_limit`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Delete a project's hard spend limit.
   *
   * @example
   * ```ts
   * const projectSpendLimitDeleted =
   *   await client.admin.organization.projects.spendLimit.delete(
   *     'proj_123',
   *   );
   * ```
   */
  delete(projectID, options) {
    return this._client.delete(path`/organization/projects/${projectID}/spend_limit`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/groups/roles.mjs
var Roles4 = class extends APIResource {
  /**
   * Assigns a project role to a group within a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.groups.roles.create(
   *     'group_id',
   *     { project_id: 'project_id', role_id: 'role_id' },
   *   );
   * ```
   */
  create(groupID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/projects/${project_id}/groups/${groupID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a project role assigned to a group.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.groups.roles.retrieve(
   *     'role_id',
   *     { project_id: 'project_id', group_id: 'group_id' },
   *   );
   * ```
   */
  retrieve(roleID, params, options) {
    const { project_id, group_id } = params;
    return this._client.get(path`/projects/${project_id}/groups/${group_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the project roles assigned to a group within a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const roleListResponse of client.admin.organization.projects.groups.roles.list(
   *   'group_id',
   *   { project_id: 'project_id' },
   * )) {
   *   // ...
   * }
   * ```
   */
  list(groupID, params, options) {
    const { project_id, ...query } = params;
    return this._client.getAPIList(path`/projects/${project_id}/groups/${groupID}/roles`, NextCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Unassigns a project role from a group within a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.groups.roles.delete(
   *     'role_id',
   *     { project_id: 'project_id', group_id: 'group_id' },
   *   );
   * ```
   */
  delete(roleID, params, options) {
    const { project_id, group_id } = params;
    return this._client.delete(path`/projects/${project_id}/groups/${group_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/groups/groups.mjs
var Groups2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.roles = new Roles4(this._client);
  }
  /**
   * Grants a group access to a project.
   *
   * @example
   * ```ts
   * const projectGroup =
   *   await client.admin.organization.projects.groups.create(
   *     'project_id',
   *     { group_id: 'group_id', role: 'role' },
   *   );
   * ```
   */
  create(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/groups`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a project's group.
   *
   * @example
   * ```ts
   * const projectGroup =
   *   await client.admin.organization.projects.groups.retrieve(
   *     'group_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(groupID, params, options) {
    const { project_id, ...query } = params;
    return this._client.get(path`/organization/projects/${project_id}/groups/${groupID}`, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the groups that have access to a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectGroup of client.admin.organization.projects.groups.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/groups`, NextCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Revokes a group's access to a project.
   *
   * @example
   * ```ts
   * const group =
   *   await client.admin.organization.projects.groups.delete(
   *     'group_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(groupID, params, options) {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/groups/${groupID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};
Groups2.Roles = Roles4;

// ../../../node_modules/openai/resources/admin/organization/projects/service-accounts/api-keys.mjs
var APIKeys2 = class extends APIResource {
  /**
   * Creates an API key for a service account in the project.
   *
   * @example
   * ```ts
   * const apiKey =
   *   await client.admin.organization.projects.serviceAccounts.apiKeys.create(
   *     'service_account_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  create(serviceAccountID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/service_accounts/${serviceAccountID}/api_keys`, { body, ...options, __security: { adminAPIKeyAuth: true } });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/service-accounts/service-accounts.mjs
var ServiceAccounts = class extends APIResource {
  constructor() {
    super(...arguments);
    this.apiKeys = new APIKeys2(this._client);
  }
  /**
   * Creates a new service account in the project. By default, this also returns an
   * unredacted API key for the service account.
   *
   * @example
   * ```ts
   * const serviceAccount =
   *   await client.admin.organization.projects.serviceAccounts.create(
   *     'project_id',
   *     { name: 'name' },
   *   );
   * ```
   */
  create(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/service_accounts`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a service account in the project.
   *
   * @example
   * ```ts
   * const projectServiceAccount =
   *   await client.admin.organization.projects.serviceAccounts.retrieve(
   *     'service_account_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(serviceAccountID, params, options) {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/service_accounts/${serviceAccountID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Updates a service account in the project.
   *
   * @example
   * ```ts
   * const projectServiceAccount =
   *   await client.admin.organization.projects.serviceAccounts.update(
   *     'service_account_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  update(serviceAccountID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/service_accounts/${serviceAccountID}`, { body, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Returns a list of service accounts in the project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectServiceAccount of client.admin.organization.projects.serviceAccounts.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/service_accounts`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Deletes a service account from the project.
   *
   * Returns confirmation of service account deletion, or an error if the project is
   * archived (archived projects have no service accounts).
   *
   * @example
   * ```ts
   * const serviceAccount =
   *   await client.admin.organization.projects.serviceAccounts.delete(
   *     'service_account_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(serviceAccountID, params, options) {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/service_accounts/${serviceAccountID}`, { ...options, __security: { adminAPIKeyAuth: true } });
  }
};
ServiceAccounts.APIKeys = APIKeys2;

// ../../../node_modules/openai/resources/admin/organization/projects/users/roles.mjs
var Roles5 = class extends APIResource {
  /**
   * Assigns a project role to a user within a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.users.roles.create(
   *     'user_id',
   *     { project_id: 'project_id', role_id: 'role_id' },
   *   );
   * ```
   */
  create(userID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/projects/${project_id}/users/${userID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a project role assigned to a user.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.users.roles.retrieve(
   *     'role_id',
   *     { project_id: 'project_id', user_id: 'user_id' },
   *   );
   * ```
   */
  retrieve(roleID, params, options) {
    const { project_id, user_id } = params;
    return this._client.get(path`/projects/${project_id}/users/${user_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the project roles assigned to a user within a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const roleListResponse of client.admin.organization.projects.users.roles.list(
   *   'user_id',
   *   { project_id: 'project_id' },
   * )) {
   *   // ...
   * }
   * ```
   */
  list(userID, params, options) {
    const { project_id, ...query } = params;
    return this._client.getAPIList(path`/projects/${project_id}/users/${userID}/roles`, NextCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Unassigns a project role from a user within a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.users.roles.delete(
   *     'role_id',
   *     { project_id: 'project_id', user_id: 'user_id' },
   *   );
   * ```
   */
  delete(roleID, params, options) {
    const { project_id, user_id } = params;
    return this._client.delete(path`/projects/${project_id}/users/${user_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/projects/users/users.mjs
var Users2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.roles = new Roles5(this._client);
  }
  /**
   * Adds a user to the project. Users must already be members of the organization to
   * be added to a project.
   *
   * @example
   * ```ts
   * const projectUser =
   *   await client.admin.organization.projects.users.create(
   *     'project_id',
   *     { role: 'role' },
   *   );
   * ```
   */
  create(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}/users`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a user in the project.
   *
   * @example
   * ```ts
   * const projectUser =
   *   await client.admin.organization.projects.users.retrieve(
   *     'user_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(userID, params, options) {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Modifies a user's role in the project.
   *
   * @example
   * ```ts
   * const projectUser =
   *   await client.admin.organization.projects.users.update(
   *     'user_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  update(userID, params, options) {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/users/${userID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Returns a list of users in the project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectUser of client.admin.organization.projects.users.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(projectID, query = {}, options) {
    return this._client.getAPIList(path`/organization/projects/${projectID}/users`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Deletes a user from the project.
   *
   * Returns confirmation of project user deletion, or an error if the project is
   * archived (archived projects have no users).
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.projects.users.delete(
   *     'user_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(userID, params, options) {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};
Users2.Roles = Roles5;

// ../../../node_modules/openai/resources/admin/organization/projects/projects.mjs
var Projects = class extends APIResource {
  constructor() {
    super(...arguments);
    this.users = new Users2(this._client);
    this.serviceAccounts = new ServiceAccounts(this._client);
    this.apiKeys = new APIKeys(this._client);
    this.rateLimits = new RateLimits(this._client);
    this.modelPermissions = new ModelPermissions(this._client);
    this.hostedToolPermissions = new HostedToolPermissions(this._client);
    this.groups = new Groups2(this._client);
    this.roles = new Roles3(this._client);
    this.dataRetention = new DataRetention2(this._client);
    this.spendLimit = new SpendLimit2(this._client);
    this.spendAlerts = new SpendAlerts2(this._client);
    this.certificates = new Certificates2(this._client);
  }
  /**
   * Create a new project in the organization. Projects can be created and archived,
   * but cannot be deleted.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.create({
   *     name: 'name',
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/organization/projects", {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves a project.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID, options) {
    return this._client.get(path`/organization/projects/${projectID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Modifies a project in the organization.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.update(
   *     'project_id',
   *   );
   * ```
   */
  update(projectID, body, options) {
    return this._client.post(path`/organization/projects/${projectID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Returns a list of projects.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const project of client.admin.organization.projects.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/projects", ConversationCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Archives a project in the organization. Archived projects cannot be used or
   * updated.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.archive(
   *     'project_id',
   *   );
   * ```
   */
  archive(projectID, options) {
    return this._client.post(path`/organization/projects/${projectID}/archive`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};
Projects.Users = Users2;
Projects.ServiceAccounts = ServiceAccounts;
Projects.APIKeys = APIKeys;
Projects.RateLimits = RateLimits;
Projects.ModelPermissions = ModelPermissions;
Projects.HostedToolPermissions = HostedToolPermissions;
Projects.Groups = Groups2;
Projects.Roles = Roles3;
Projects.DataRetention = DataRetention2;
Projects.SpendLimit = SpendLimit2;
Projects.SpendAlerts = SpendAlerts2;
Projects.Certificates = Certificates2;

// ../../../node_modules/openai/resources/admin/organization/users/roles.mjs
var Roles6 = class extends APIResource {
  /**
   * Assigns an organization role to a user within the organization.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.users.roles.create(
   *     'user_id',
   *     { role_id: 'role_id' },
   *   );
   * ```
   */
  create(userID, body, options) {
    return this._client.post(path`/organization/users/${userID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Retrieves an organization role assigned to a user.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.users.roles.retrieve(
   *     'role_id',
   *     { user_id: 'user_id' },
   *   );
   * ```
   */
  retrieve(roleID, params, options) {
    const { user_id } = params;
    return this._client.get(path`/organization/users/${user_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists the organization roles assigned to a user within the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const roleListResponse of client.admin.organization.users.roles.list(
   *   'user_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(userID, query = {}, options) {
    return this._client.getAPIList(path`/organization/users/${userID}/roles`, NextCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * Unassigns an organization role from a user within the organization.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.users.roles.delete(
   *     'role_id',
   *     { user_id: 'user_id' },
   *   );
   * ```
   */
  delete(roleID, params, options) {
    const { user_id } = params;
    return this._client.delete(path`/organization/users/${user_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/admin/organization/users/users.mjs
var Users3 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.roles = new Roles6(this._client);
  }
  /**
   * Retrieves a user by their identifier.
   *
   * @example
   * ```ts
   * const organizationUser =
   *   await client.admin.organization.users.retrieve('user_id');
   * ```
   */
  retrieve(userID, options) {
    return this._client.get(path`/organization/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Modifies a user's role in the organization.
   *
   * @example
   * ```ts
   * const organizationUser =
   *   await client.admin.organization.users.update('user_id');
   * ```
   */
  update(userID, body, options) {
    return this._client.post(path`/organization/users/${userID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Lists all of the users in the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const organizationUser of client.admin.organization.users.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/organization/users", ConversationCursorPage, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * Deletes a user from the organization.
   *
   * @example
   * ```ts
   * const user = await client.admin.organization.users.delete(
   *   'user_id',
   * );
   * ```
   */
  delete(userID, options) {
    return this._client.delete(path`/organization/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
};
Users3.Roles = Roles6;

// ../../../node_modules/openai/resources/admin/organization/organization.mjs
var Organization = class extends APIResource {
  constructor() {
    super(...arguments);
    this.auditLogs = new AuditLogs(this._client);
    this.adminAPIKeys = new AdminAPIKeys(this._client);
    this.usage = new Usage(this._client);
    this.invites = new Invites(this._client);
    this.users = new Users3(this._client);
    this.groups = new Groups(this._client);
    this.roles = new Roles(this._client);
    this.dataRetention = new DataRetention(this._client);
    this.spendLimit = new SpendLimit(this._client);
    this.spendAlerts = new SpendAlerts(this._client);
    this.certificates = new Certificates(this._client);
    this.projects = new Projects(this._client);
  }
};
Organization.AuditLogs = AuditLogs;
Organization.AdminAPIKeys = AdminAPIKeys;
Organization.Usage = Usage;
Organization.Invites = Invites;
Organization.Users = Users3;
Organization.Groups = Groups;
Organization.Roles = Roles;
Organization.DataRetention = DataRetention;
Organization.SpendLimit = SpendLimit;
Organization.SpendAlerts = SpendAlerts;
Organization.Certificates = Certificates;
Organization.Projects = Projects;

// ../../../node_modules/openai/resources/admin/admin.mjs
var Admin = class extends APIResource {
  constructor() {
    super(...arguments);
    this.organization = new Organization(this._client);
  }
};
Admin.Organization = Organization;

// ../../../node_modules/openai/resources/audio/speech.mjs
var Speech = class extends APIResource {
  /**
   * Generates audio from the input text.
   *
   * Returns the audio file content, or a stream of audio events.
   *
   * @example
   * ```ts
   * const speech = await client.audio.speech.create({
   *   input: 'input',
   *   model: 'tts-1',
   *   voice: 'alloy',
   * });
   *
   * const content = await speech.blob();
   * console.log(content);
   * ```
   */
  create(body, options) {
    return this._client.post("/audio/speech", {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "application/octet-stream" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/audio/transcriptions.mjs
var Transcriptions = class extends APIResource {
  create(body, options) {
    return this._client.post("/audio/transcriptions", multipartFormRequestOptions({
      body,
      ...options,
      stream: body.stream ?? false,
      __metadata: { model: body.model },
      __security: { bearerAuth: true }
    }, this._client));
  }
};

// ../../../node_modules/openai/resources/audio/translations.mjs
var Translations = class extends APIResource {
  create(body, options) {
    return this._client.post("/audio/translations", multipartFormRequestOptions({ body, ...options, __metadata: { model: body.model }, __security: { bearerAuth: true } }, this._client));
  }
};

// ../../../node_modules/openai/resources/audio/audio.mjs
var Audio = class extends APIResource {
  constructor() {
    super(...arguments);
    this.transcriptions = new Transcriptions(this._client);
    this.translations = new Translations(this._client);
    this.speech = new Speech(this._client);
  }
};
Audio.Transcriptions = Transcriptions;
Audio.Translations = Translations;
Audio.Speech = Speech;

// ../../../node_modules/openai/resources/batches.mjs
var Batches = class extends APIResource {
  /**
   * Creates and executes a batch from an uploaded file of requests
   */
  create(body, options) {
    return this._client.post("/batches", { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Retrieves a batch.
   */
  retrieve(batchID, options) {
    return this._client.get(path`/batches/${batchID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * List your organization's batches.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/batches", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Cancels an in-progress batch. The batch will be in status `cancelling` for up to
   * 10 minutes, before changing to `cancelled`, where it will have partial results
   * (if any) available in the output file.
   */
  cancel(batchID, options) {
    return this._client.post(path`/batches/${batchID}/cancel`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/assistants.mjs
var Assistants = class extends APIResource {
  /**
   * Create an assistant with a model and instructions.
   *
   * @deprecated
   */
  create(body, options) {
    return this._client.post("/assistants", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieves an assistant.
   *
   * @deprecated
   */
  retrieve(assistantID, options) {
    return this._client.get(path`/assistants/${assistantID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Modifies an assistant.
   *
   * @deprecated
   */
  update(assistantID, body, options) {
    return this._client.post(path`/assistants/${assistantID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Returns a list of assistants.
   *
   * @deprecated
   */
  list(query = {}, options) {
    return this._client.getAPIList("/assistants", CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete an assistant.
   *
   * @deprecated
   */
  delete(assistantID, options) {
    return this._client.delete(path`/assistants/${assistantID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/realtime/sessions.mjs
var Sessions = class extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API. Can be configured with the same session parameters as the
   * `session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   *
   * @example
   * ```ts
   * const session =
   *   await client.beta.realtime.sessions.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/realtime/transcription-sessions.mjs
var TranscriptionSessions = class extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API specifically for realtime transcriptions. Can be configured with
   * the same session parameters as the `transcription_session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   *
   * @example
   * ```ts
   * const transcriptionSession =
   *   await client.beta.realtime.transcriptionSessions.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/transcription_sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/realtime/realtime.mjs
var Realtime = class extends APIResource {
  constructor() {
    super(...arguments);
    this.sessions = new Sessions(this._client);
    this.transcriptionSessions = new TranscriptionSessions(this._client);
  }
};
Realtime.Sessions = Sessions;
Realtime.TranscriptionSessions = TranscriptionSessions;

// ../../../node_modules/openai/resources/beta/chatkit/sessions.mjs
var Sessions2 = class extends APIResource {
  /**
   * Create a ChatKit session.
   *
   * @example
   * ```ts
   * const chatSession =
   *   await client.beta.chatkit.sessions.create({
   *     user: 'x',
   *     workflow: { id: 'id' },
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/chatkit/sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Cancel an active ChatKit session and return its most recent metadata.
   *
   * Cancelling prevents new requests from using the issued client secret.
   *
   * @example
   * ```ts
   * const chatSession =
   *   await client.beta.chatkit.sessions.cancel('cksess_123');
   * ```
   */
  cancel(sessionID, options) {
    return this._client.post(path`/chatkit/sessions/${sessionID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/chatkit/threads.mjs
var Threads = class extends APIResource {
  /**
   * Retrieve a ChatKit thread by its identifier.
   *
   * @example
   * ```ts
   * const chatkitThread =
   *   await client.beta.chatkit.threads.retrieve('cthr_123');
   * ```
   */
  retrieve(threadID, options) {
    return this._client.get(path`/chatkit/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * List ChatKit threads with optional pagination and user filters.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatkitThread of client.beta.chatkit.threads.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/chatkit/threads", ConversationCursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a ChatKit thread along with its items and stored attachments.
   *
   * @example
   * ```ts
   * const thread = await client.beta.chatkit.threads.delete(
   *   'cthr_123',
   * );
   * ```
   */
  delete(threadID, options) {
    return this._client.delete(path`/chatkit/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * List items that belong to a ChatKit thread.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const thread of client.beta.chatkit.threads.listItems(
   *   'cthr_123',
   * )) {
   *   // ...
   * }
   * ```
   */
  listItems(threadID, query = {}, options) {
    return this._client.getAPIList(path`/chatkit/threads/${threadID}/items`, ConversationCursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/chatkit/chatkit.mjs
var ChatKit = class extends APIResource {
  constructor() {
    super(...arguments);
    this.sessions = new Sessions2(this._client);
    this.threads = new Threads(this._client);
  }
};
ChatKit.Sessions = Sessions2;
ChatKit.Threads = Threads;

// ../../../node_modules/openai/resources/beta/responses/input-items.mjs
var InputItems = class extends APIResource {
  /**
   * Returns a list of input items for a given response.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaResponseItem of client.beta.responses.inputItems.list(
   *   'response_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(responseID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/responses/${responseID}/input_items?beta=true`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([
        { ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/responses/input-tokens.mjs
var InputTokens = class extends APIResource {
  /**
   * Returns input token counts of the request.
   *
   * Returns an object with `object` set to `response.input_tokens` and an
   * `input_tokens` count.
   *
   * @example
   * ```ts
   * const response =
   *   await client.beta.responses.inputTokens.count();
   * ```
   */
  count(params = {}, options) {
    const { betas, ...body } = params ?? {};
    return this._client.post("/responses/input_tokens?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/responses/responses.mjs
var Responses = class extends APIResource {
  constructor() {
    super(...arguments);
    this.inputItems = new InputItems(this._client);
    this.inputTokens = new InputTokens(this._client);
  }
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/responses?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      stream: params.stream ?? false,
      __security: { bearerAuth: true }
    });
  }
  retrieve(responseID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.get(path`/responses/${responseID}?beta=true`, {
      query,
      ...options,
      headers: buildHeaders([
        { ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      stream: params?.stream ?? false,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Deletes a model response with the given ID.
   *
   * @example
   * ```ts
   * await client.beta.responses.delete(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  delete(responseID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/responses/${responseID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { Accept: "*/*", ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Cancels a model response with the given ID. Only responses created with the
   * `background` parameter set to `true` can be cancelled.
   * [Learn more](https://platform.openai.com/docs/guides/background).
   *
   * @example
   * ```ts
   * const betaResponse = await client.beta.responses.cancel(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  cancel(responseID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/responses/${responseID}/cancel?beta=true`, {
      ...options,
      headers: buildHeaders([
        { ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Compact a conversation. Returns a compacted response object.
   *
   * Learn when and how to compact long-running conversations in the
   * [conversation state guide](https://platform.openai.com/docs/guides/conversation-state#managing-the-context-window).
   * For ZDR-compatible compaction details, see
   * [Compaction (advanced)](https://platform.openai.com/docs/guides/conversation-state#compaction-advanced).
   *
   * @example
   * ```ts
   * const betaCompactedResponse =
   *   await client.beta.responses.compact({
   *     model: 'gpt-6-astra',
   *   });
   * ```
   */
  compact(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/responses/compact?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { ...betas?.toString() != null ? { "openai-beta": betas?.toString() } : void 0 },
        options?.headers
      ]),
      __security: { bearerAuth: true }
    });
  }
};
Responses.InputItems = InputItems;
Responses.InputTokens = InputTokens;

// ../../../node_modules/openai/resources/beta/threads/messages.mjs
var Messages2 = class extends APIResource {
  /**
   * Create a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  create(threadID, body, options) {
    return this._client.post(path`/threads/${threadID}/messages`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieve a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(messageID, params, options) {
    const { thread_id } = params;
    return this._client.get(path`/threads/${thread_id}/messages/${messageID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Modifies a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(messageID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/messages/${messageID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Returns a list of messages for a given thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(threadID, query = {}, options) {
    return this._client.getAPIList(path`/threads/${threadID}/messages`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Deletes a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  delete(messageID, params, options) {
    const { thread_id } = params;
    return this._client.delete(path`/threads/${thread_id}/messages/${messageID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/beta/threads/runs/steps.mjs
var Steps = class extends APIResource {
  /**
   * Retrieves a run step.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(stepID, params, options) {
    const { thread_id, run_id, ...query } = params;
    return this._client.get(path`/threads/${thread_id}/runs/${run_id}/steps/${stepID}`, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Returns a list of run steps belonging to a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(runID, params, options) {
    const { thread_id, ...query } = params;
    return this._client.getAPIList(path`/threads/${thread_id}/runs/${runID}/steps`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/internal/utils/base64.mjs
var fromBase64 = (str) => {
  if (typeof globalThis.Buffer !== "undefined") {
    const buf = globalThis.Buffer.from(str, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (typeof atob !== "undefined") {
    const bstr = atob(str);
    const buf = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) {
      buf[i] = bstr.charCodeAt(i);
    }
    return buf;
  }
  throw new OpenAIError("Cannot decode base64 string; Expected `Buffer` or `atob` to be defined");
};
var toFloat32Array = (base64Str) => {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64Str, "base64");
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / Float32Array.BYTES_PER_ELEMENT));
  } else {
    const binaryStr = atob(base64Str);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return Array.from(new Float32Array(bytes.buffer));
  }
};

// ../../../node_modules/openai/internal/utils/env.mjs
var readEnv = (env) => {
  try {
    if (typeof globalThis.process !== "undefined") {
      return globalThis.process.env?.[env]?.trim() || void 0;
    }
    if (typeof globalThis.Deno !== "undefined") {
      return globalThis.Deno.env?.get?.(env)?.trim() || void 0;
    }
  } catch {
    return void 0;
  }
  return void 0;
};

// ../../../node_modules/openai/internal/assistant-stream-delta.mjs
var MAX_ASSISTANT_STREAM_ARRAY_GROWTH = 1024;
var MAX_EXTERNALLY_MUTABLE_ASSISTANT_STREAM_ARRAY_LENGTH = 65536;
function getAssistantStreamDiagnosticProperty(property) {
  switch (property) {
    case "value":
    case "arguments":
    case "input":
    case "text":
    case "content":
    case "annotations":
    case "metadata":
    case "name":
    case "role":
    case "status":
    case "tool_calls":
    case "step_details": {
      return property;
    }
    default: {
      return "unknown";
    }
  }
}
var assistantStreamArrayStates = /* @__PURE__ */ new WeakMap();
var externallyMutableAssistantStreamValues = /* @__PURE__ */ new WeakSet();
function createAssistantStreamDeltaProjection(cacheArrays) {
  return { arrays: /* @__PURE__ */ new Map(), cacheArrays, records: /* @__PURE__ */ new WeakMap() };
}
function commitAssistantStreamArrayProjection(projection) {
  for (const [array, projected] of projection.arrays) {
    if (projected.cacheable && !externallyMutableAssistantStreamValues.has(array)) {
      assistantStreamArrayStates.set(array, {
        length: projected.length,
        ownEntryCount: projected.ownEntryCount
      });
    } else {
      assistantStreamArrayStates.delete(array);
    }
  }
}
function isPrimitiveAssistantStreamValue(value) {
  return typeof value === "string" || typeof value === "number";
}
function isPrimitiveAssistantStreamArrayDelta(accumulator, delta) {
  return delta.every(isPrimitiveAssistantStreamValue) && accumulator.every(isPrimitiveAssistantStreamValue);
}
function countOwnAssistantStreamArrayEntries(accumulator) {
  let count = 0;
  for (const key of Object.keys(accumulator)) {
    const index = Number(key);
    if (Number.isSafeInteger(index) && index >= 0 && index < accumulator.length && String(index) === key) {
      count += 1;
    }
  }
  return count;
}
function getAssistantStreamArrayOwnEntryCount(accumulator, enforceSparseHoleBudget, cachedState) {
  if (!enforceSparseHoleBudget) {
    return 0;
  }
  if (cachedState?.length === accumulator.length) {
    return cachedState.ownEntryCount;
  }
  return countOwnAssistantStreamArrayEntries(accumulator);
}
function getAssistantStreamDeltaIndex(deltaEntry, kind, baselineLength) {
  const { index } = deltaEntry;
  if (kind === "array" && (index === null || index === void 0)) {
    throw new Error("Expected array delta entry to have an `index` property");
  }
  if (kind === "array" && typeof index !== "number") {
    throw new TypeError("Expected array delta entry `index` property to be a number but got an invalid value");
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= baselineLength + MAX_ASSISTANT_STREAM_ARRAY_GROWTH || index >= MAX_EXTERNALLY_MUTABLE_ASSISTANT_STREAM_ARRAY_LENGTH) {
    const safeIndex = typeof index === "number" ? index : "unknown";
    throw new OpenAIError(`Assistant stream delta contains an invalid ${kind} index: ${safeIndex}`);
  }
  return index;
}
function assertValidAssistantStreamArrayDelta(accumulator, delta, kind, projection, validateRecord) {
  let projectedArray = projection.arrays.get(accumulator);
  if (!projectedArray) {
    const enforceSparseHoleBudget = projection.cacheArrays && !externallyMutableAssistantStreamValues.has(accumulator);
    const cachedState = enforceSparseHoleBudget ? assistantStreamArrayStates.get(accumulator) : void 0;
    projectedArray = {
      baselineLength: accumulator.length,
      cacheable: enforceSparseHoleBudget,
      enforceSparseHoleBudget,
      entries: /* @__PURE__ */ new Map(),
      length: accumulator.length,
      ownEntryCount: getAssistantStreamArrayOwnEntryCount(accumulator, enforceSparseHoleBudget, cachedState)
    };
    projection.arrays.set(accumulator, projectedArray);
  }
  for (const deltaEntry of delta) {
    if (!isObj(deltaEntry)) {
      throw new Error("Expected array delta entry to be an object but got an invalid value");
    }
    const validatedIndex = getAssistantStreamDeltaIndex(deltaEntry, kind, projectedArray.baselineLength);
    let accumulatedEntry;
    if (projectedArray.entries.has(validatedIndex)) {
      accumulatedEntry = projectedArray.entries.get(validatedIndex);
    } else if (hasOwn(accumulator, validatedIndex)) {
      accumulatedEntry = accumulator[validatedIndex];
      if (accumulatedEntry === null || accumulatedEntry === void 0) {
        projectedArray.entries.set(validatedIndex, deltaEntry);
      }
    } else {
      projectedArray.entries.set(validatedIndex, deltaEntry);
      projectedArray.ownEntryCount += 1;
    }
    const projectedLength = Math.max(projectedArray.length, validatedIndex + 1);
    if (projectedArray.enforceSparseHoleBudget && projectedLength - projectedArray.ownEntryCount > MAX_ASSISTANT_STREAM_ARRAY_GROWTH) {
      throw new OpenAIError(`Assistant stream delta contains an invalid ${kind} index: ${validatedIndex}`);
    }
    if (isObj(accumulatedEntry)) {
      validateRecord(accumulatedEntry, deltaEntry, projection);
    }
    projectedArray.length = projectedLength;
  }
}
function assertValidAssistantStreamDeltaIndices(accumulator, delta, projection) {
  let projectedValues = projection.records.get(accumulator);
  for (const [key, deltaValue] of Object.entries(delta)) {
    if (key === "index" || key === "type") {
      continue;
    }
    let accumulatedValue;
    if (projectedValues?.has(key)) {
      accumulatedValue = projectedValues.get(key);
    } else if (hasOwn(accumulator, key)) {
      accumulatedValue = accumulator[key];
    }
    if (accumulatedValue === null || accumulatedValue === void 0) {
      if (!projectedValues) {
        projectedValues = /* @__PURE__ */ new Map();
        projection.records.set(accumulator, projectedValues);
      }
      projectedValues.set(key, deltaValue);
      continue;
    }
    if (isObj(accumulatedValue) && isObj(deltaValue)) {
      assertValidAssistantStreamDeltaIndices(accumulatedValue, deltaValue, projection);
    } else if (Array.isArray(accumulatedValue) && Array.isArray(deltaValue) && !isPrimitiveAssistantStreamArrayDelta(accumulatedValue, deltaValue)) {
      assertValidAssistantStreamArrayDelta(accumulatedValue, deltaValue, "array", projection, assertValidAssistantStreamDeltaIndices);
    }
  }
}
function isAssistantStreamValueExternallyMutable(value) {
  return (isObj(value) || Array.isArray(value)) && externallyMutableAssistantStreamValues.has(value);
}
function markAssistantStreamValueExternallyMutable(value) {
  if (!isObj(value) && !Array.isArray(value) || externallyMutableAssistantStreamValues.has(value)) {
    return;
  }
  externallyMutableAssistantStreamValues.add(value);
  if (Array.isArray(value)) {
    assistantStreamArrayStates.delete(value);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      markAssistantStreamValueExternallyMutable(descriptor.value);
    }
  }
}
function defineAssistantStreamArrayEntry(accumulator, index, value) {
  if (externallyMutableAssistantStreamValues.has(accumulator)) {
    markAssistantStreamValueExternallyMutable(value);
  }
  Object.defineProperty(accumulator, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}
function getRequiredAssistantStreamArrayIndex(deltaEntry) {
  const { index } = deltaEntry;
  if (index === null || index === void 0) {
    throw new Error("Expected array delta entry to have an `index` property");
  }
  if (typeof index !== "number") {
    throw new TypeError("Expected array delta entry `index` property to be a number but got an invalid value");
  }
  return index;
}
function applyAssistantStreamArrayDelta(accumulator, delta, applyRecord) {
  if (isPrimitiveAssistantStreamArrayDelta(accumulator, delta)) {
    accumulator.push(...delta);
    assistantStreamArrayStates.delete(accumulator);
    return;
  }
  for (const deltaEntry of delta) {
    if (!isObj(deltaEntry)) {
      throw new Error("Expected array delta entry to be an object but got an invalid value");
    }
    const index = getRequiredAssistantStreamArrayIndex(deltaEntry);
    if (hasOwn(accumulator, index)) {
      const accumulatedEntry = accumulator[index];
      if (accumulatedEntry === null || accumulatedEntry === void 0) {
        if (externallyMutableAssistantStreamValues.has(accumulator)) {
          markAssistantStreamValueExternallyMutable(deltaEntry);
        }
        accumulator[index] = deltaEntry;
      } else {
        accumulator[index] = applyRecord(accumulatedEntry, deltaEntry);
      }
    } else {
      defineAssistantStreamArrayEntry(accumulator, index, deltaEntry);
    }
  }
}
function applyAssistantStreamDelta(accumulator, delta) {
  const externallyMutable = externallyMutableAssistantStreamValues.has(accumulator);
  for (const [key, deltaValue] of Object.entries(delta)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new OpenAIError(`Assistant stream delta contains an unsafe property: ${key}`);
    }
    if (!hasOwn(accumulator, key)) {
      if (externallyMutable) {
        markAssistantStreamValueExternallyMutable(deltaValue);
      }
      accumulator[key] = deltaValue;
      continue;
    }
    let accumulatedValue = accumulator[key];
    if (accumulatedValue === null || accumulatedValue === void 0) {
      if (externallyMutable) {
        markAssistantStreamValueExternallyMutable(deltaValue);
      }
      accumulator[key] = deltaValue;
      continue;
    }
    if (key === "index" || key === "type") {
      accumulator[key] = deltaValue;
      continue;
    }
    if (typeof accumulatedValue === "string" && typeof deltaValue === "string") {
      accumulatedValue += deltaValue;
    } else if (typeof accumulatedValue === "number" && typeof deltaValue === "number") {
      accumulatedValue += deltaValue;
    } else if (isObj(accumulatedValue) && isObj(deltaValue)) {
      accumulatedValue = applyAssistantStreamDelta(accumulatedValue, deltaValue);
    } else if (Array.isArray(accumulatedValue) && Array.isArray(deltaValue)) {
      applyAssistantStreamArrayDelta(accumulatedValue, deltaValue, applyAssistantStreamDelta);
      continue;
    } else {
      throw new TypeError(`Unhandled record type: ${getAssistantStreamDiagnosticProperty(key)}`);
    }
    accumulator[key] = accumulatedValue;
  }
  return accumulator;
}
function assertSafeAssistantStreamDelta(value) {
  if (!isObj(value) && !Array.isArray(value)) {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new OpenAIError(`Assistant stream delta contains an unsafe property: ${key}`);
    }
    assertSafeAssistantStreamDelta(nestedValue);
  }
}
function accumulateAssistantStreamDelta(accumulator, delta, cacheArrays = false) {
  assertSafeAssistantStreamDelta(delta);
  const accumulatorRecord = accumulator;
  const deltaRecord = delta;
  const projection = createAssistantStreamDeltaProjection(cacheArrays && !isAssistantStreamValueExternallyMutable(accumulator));
  assertValidAssistantStreamDeltaIndices(accumulatorRecord, deltaRecord, projection);
  applyAssistantStreamDelta(accumulatorRecord, deltaRecord);
  commitAssistantStreamArrayProjection(projection);
  return accumulator;
}
function createAssistantStreamArrayDeltaCommit(accumulator, delta, kind, cacheArrays = true) {
  assertSafeAssistantStreamDelta(delta);
  const projection = createAssistantStreamDeltaProjection(cacheArrays && !isAssistantStreamValueExternallyMutable(accumulator));
  assertValidAssistantStreamArrayDelta(accumulator, delta, kind, projection, assertValidAssistantStreamDeltaIndices);
  return () => commitAssistantStreamArrayProjection(projection);
}

// ../../../node_modules/openai/lib/AssistantStream.mjs
var _AssistantStream_instances;
var _AssistantStream_runStepSnapshots;
var _AssistantStream_runStepIDOwners;
var _AssistantStream_activeRunStepID;
var _AssistantStream_messageSnapshots;
var _AssistantStream_messageIDOwners;
var _AssistantStream_messageSnapshot;
var _AssistantStream_activeMessageID;
var _AssistantStream_finalRun;
var _AssistantStream_currentContentIndex;
var _AssistantStream_currentContent;
var _AssistantStream_currentToolCallIndex;
var _AssistantStream_currentToolCall;
var _AssistantStream_currentEvent;
var _AssistantStream_currentRunSnapshot;
var _AssistantStream_currentRunStepSnapshot;
var _AssistantStream_addEvent;
var _AssistantStream_endRequest;
var _AssistantStream_validateRunStepEvent;
var _AssistantStream_reserveRunStepAlias;
var _AssistantStream_validateMessageEvent;
var _AssistantStream_reserveMessageAlias;
var _AssistantStream_handleMessage;
var _AssistantStream_handleRunStep;
var _AssistantStream_emitExposed;
var _AssistantStream_handleEvent;
var _AssistantStream_accumulateRunStep;
var _AssistantStream_accumulateMessage;
var _AssistantStream_accumulateContent;
var _AssistantStream_handleRun;
function stabilizeAssistantStreamEvent(event) {
  const eventDescriptor = Object.getOwnPropertyDescriptor(event, "event");
  const dataDescriptor = Object.getOwnPropertyDescriptor(event, "data");
  const eventType = Reflect.get(event, "event", event);
  const data = Reflect.get(event, "data", event);
  let stableData = data;
  if (eventType === "thread.message.created" || eventType === "thread.message.in_progress" || eventType === "thread.message.delta" || eventType === "thread.message.completed" || eventType === "thread.message.incomplete" || eventType === "thread.run.step.created" || eventType === "thread.run.step.in_progress" || eventType === "thread.run.step.delta" || eventType === "thread.run.step.completed" || eventType === "thread.run.step.failed" || eventType === "thread.run.step.cancelled" || eventType === "thread.run.step.expired") {
    const messageID = Object.getOwnPropertyDescriptor(data, "id");
    if (messageID && "value" in messageID && Reflect.get(data, "id", data) !== messageID.value) {
      const canonicalID = messageID.value;
      stableData = new Proxy(data, {
        get(target, property) {
          return property === "id" ? canonicalID : Reflect.get(target, property, target);
        }
      });
    }
  }
  const stableEvent = Object.freeze({ event: eventType, data: stableData });
  const ordinaryEvent = eventDescriptor !== void 0 && "value" in eventDescriptor && eventDescriptor.value === eventType && dataDescriptor !== void 0 && "value" in dataDescriptor && dataDescriptor.value === data && stableData === data;
  return {
    event: stableEvent,
    exposedEvent: ordinaryEvent ? event : { event: eventType, data: stableData }
  };
}
var AssistantStream = class _AssistantStream extends EventStream {
  constructor() {
    super(...arguments);
    _AssistantStream_instances.add(this);
    _AssistantStream_runStepSnapshots.set(this, /* @__PURE__ */ Object.create(null));
    _AssistantStream_runStepIDOwners.set(this, /* @__PURE__ */ new Map());
    _AssistantStream_activeRunStepID.set(this, void 0);
    _AssistantStream_messageSnapshots.set(this, /* @__PURE__ */ Object.create(null));
    _AssistantStream_messageIDOwners.set(this, /* @__PURE__ */ new Map());
    _AssistantStream_messageSnapshot.set(this, void 0);
    _AssistantStream_activeMessageID.set(this, void 0);
    _AssistantStream_finalRun.set(this, void 0);
    _AssistantStream_currentContentIndex.set(this, void 0);
    _AssistantStream_currentContent.set(this, void 0);
    _AssistantStream_currentToolCallIndex.set(this, void 0);
    _AssistantStream_currentToolCall.set(this, void 0);
    _AssistantStream_currentEvent.set(this, void 0);
    _AssistantStream_currentRunSnapshot.set(this, void 0);
    _AssistantStream_currentRunStepSnapshot.set(this, void 0);
  }
  /** Iterates over cloned raw assistant events; stopping early aborts the underlying request. */
  [(_AssistantStream_runStepSnapshots = /* @__PURE__ */ new WeakMap(), _AssistantStream_runStepIDOwners = /* @__PURE__ */ new WeakMap(), _AssistantStream_activeRunStepID = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageSnapshots = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageIDOwners = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_activeMessageID = /* @__PURE__ */ new WeakMap(), _AssistantStream_finalRun = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentContentIndex = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentContent = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentToolCallIndex = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentToolCall = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentEvent = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentRunSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentRunStepSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_instances = /* @__PURE__ */ new WeakSet(), Symbol.asyncIterator)]() {
    return this._createIterator((push) => {
      const onEvent = (event) => push(structuredClone(event));
      this.on("event", onEvent);
      return () => this.off("event", onEvent);
    }, { onReturn: () => this.abort() });
  }
  /** Restores an assistant stream from events serialized by `toReadableStream()`. */
  static fromReadableStream(stream) {
    const runner = new _AssistantStream();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  async _fromReadableStream(readableStream, options) {
    this._listenForAbort(options?.signal);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  /** Serializes assistant events into a readable stream for transfer to another runtime. */
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
  /** Submits tool outputs and starts streaming the continuation of an existing assistant run. */
  static createToolAssistantStream(runId, runs, params, options) {
    const runner = new _AssistantStream();
    runner._run(() => runner._runToolAssistantStream(runId, runs, params, {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "stream" }
    }));
    return runner;
  }
  async _createToolAssistantStream(run, runId, params, options) {
    this._listenForAbort(options?.signal);
    const body = { ...params, stream: true };
    const stream = await run.submitToolOutputs(runId, body, {
      ...options,
      signal: this.controller.signal
    });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  /** Creates an assistant thread and starts streaming its newly created run. */
  static createThreadAssistantStream(params, thread, options) {
    const runner = new _AssistantStream();
    runner._run(() => runner._threadAssistantStream(params, thread, {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "stream" }
    }));
    return runner;
  }
  /** Creates a run on an existing assistant thread and starts streaming its events. */
  static createAssistantStream(threadId, runs, params, options) {
    const runner = new _AssistantStream();
    runner._run(() => runner._runAssistantStream(threadId, runs, params, {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "stream" }
    }));
    return runner;
  }
  /** Returns the most recent raw event, or `undefined` before any event arrives. */
  currentEvent() {
    markAssistantStreamValueExternallyMutable(__classPrivateFieldGet(this, _AssistantStream_currentEvent, "f"));
    return __classPrivateFieldGet(this, _AssistantStream_currentEvent, "f");
  }
  /** Returns the latest run snapshot, or `undefined` before a run event arrives. */
  currentRun() {
    markAssistantStreamValueExternallyMutable(__classPrivateFieldGet(this, _AssistantStream_currentRunSnapshot, "f"));
    return __classPrivateFieldGet(this, _AssistantStream_currentRunSnapshot, "f");
  }
  /** Returns the message currently being accumulated, or `undefined` before message creation. */
  currentMessageSnapshot() {
    markAssistantStreamValueExternallyMutable(__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
    return __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f");
  }
  /** Returns the run step currently being accumulated, or `undefined` before a step begins. */
  currentRunStepSnapshot() {
    markAssistantStreamValueExternallyMutable(__classPrivateFieldGet(this, _AssistantStream_currentRunStepSnapshot, "f"));
    return __classPrivateFieldGet(this, _AssistantStream_currentRunStepSnapshot, "f");
  }
  /** Waits for successful completion and returns the final snapshot of every observed run step. */
  async finalRunSteps() {
    await this.done();
    return Object.values(__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f"));
  }
  /** Waits for successful completion and returns the final snapshot of every observed message. */
  async finalMessages() {
    await this.done();
    return Object.values(__classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f"));
  }
  /** Waits for completion and returns the final run, or rejects if no terminal run was received. */
  async finalRun() {
    await this.done();
    if (!__classPrivateFieldGet(this, _AssistantStream_finalRun, "f")) {
      throw new Error("Final run was not received.");
    }
    return __classPrivateFieldGet(this, _AssistantStream_finalRun, "f");
  }
  async _createThreadAssistantStream(thread, params, options) {
    this._listenForAbort(options?.signal);
    const body = { ...params, stream: true };
    const stream = await thread.createAndRun(body, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  async _createAssistantStream(run, threadId, params, options) {
    this._listenForAbort(options?.signal);
    const body = { ...params, stream: true };
    const stream = await run.create(threadId, body, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  /**
   * Applies an assistant delta to its mutable snapshot, concatenating text and
   * merging nested objects and indexed array entries.
   */
  static accumulateDelta(acc, delta) {
    return accumulateAssistantStreamDelta(acc, delta);
  }
  _addRun(run) {
    __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "run", run);
    return run;
  }
  async _threadAssistantStream(params, thread, options) {
    return await this._createThreadAssistantStream(thread, params, options);
  }
  async _runAssistantStream(threadId, runs, params, options) {
    return await this._createAssistantStream(runs, threadId, params, options);
  }
  async _runToolAssistantStream(runId, runs, params, options) {
    return await this._createToolAssistantStream(runs, runId, params, options);
  }
};
_AssistantStream_addEvent = function _AssistantStream_addEvent2(event) {
  if (this.ended) {
    return;
  }
  const { event: stableEvent, exposedEvent } = stabilizeAssistantStreamEvent(event);
  let messageID;
  let messageData;
  let runStepID;
  let runStepData;
  switch (stableEvent.event) {
    case "thread.message.created":
    case "thread.message.in_progress":
    case "thread.message.delta":
    case "thread.message.completed":
    case "thread.message.incomplete": {
      messageID = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_validateMessageEvent).call(this, stableEvent);
      messageData = stableEvent.data;
      break;
    }
    case "thread.run.step.created":
    case "thread.run.step.in_progress":
    case "thread.run.step.delta":
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired": {
      runStepID = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_validateRunStepEvent).call(this, stableEvent);
      runStepData = stableEvent.data;
      break;
    }
  }
  __classPrivateFieldSet(this, _AssistantStream_currentEvent, exposedEvent, "f");
  __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleEvent).call(this, exposedEvent);
  if (messageID !== void 0 && messageData !== void 0) {
    __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveMessageAlias).call(this, messageData, messageID);
  }
  if (runStepID !== void 0 && runStepData !== void 0) {
    __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveRunStepAlias).call(this, runStepData, runStepID);
  }
  if (runStepID === void 0 && __classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f") !== void 0 && __classPrivateFieldGet(this, _AssistantStream_currentRunStepSnapshot, "f")) {
    __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveRunStepAlias).call(this, __classPrivateFieldGet(this, _AssistantStream_currentRunStepSnapshot, "f"), __classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f"));
  }
  switch (stableEvent.event) {
    case "thread.created": {
      break;
    }
    case "thread.run.created":
    case "thread.run.queued":
    case "thread.run.in_progress":
    case "thread.run.requires_action":
    case "thread.run.completed":
    case "thread.run.incomplete":
    case "thread.run.failed":
    case "thread.run.cancelling":
    case "thread.run.cancelled":
    case "thread.run.expired": {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleRun).call(this, stableEvent);
      break;
    }
    case "thread.run.step.created":
    case "thread.run.step.in_progress":
    case "thread.run.step.delta":
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired": {
      if (runStepID === void 0) {
        throw new OpenAIError("Received assistant run-step event without a canonical run-step ID");
      }
      const activeRunStep = __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID];
      if (activeRunStep) {
        __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveRunStepAlias).call(this, activeRunStep, runStepID);
      }
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleRunStep).call(this, stableEvent, runStepID);
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveRunStepAlias).call(this, stableEvent.data, runStepID);
      const retainedRunStep = __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID];
      if (retainedRunStep) {
        __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveRunStepAlias).call(this, retainedRunStep, runStepID);
      }
      break;
    }
    case "thread.message.created":
    case "thread.message.in_progress":
    case "thread.message.delta":
    case "thread.message.completed":
    case "thread.message.incomplete": {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleMessage).call(this, stableEvent);
      if (messageID !== void 0) {
        __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveMessageAlias).call(this, stableEvent.data, messageID);
        const retainedMessage = __classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f")[messageID];
        if (retainedMessage) {
          __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_reserveMessageAlias).call(this, retainedMessage, messageID);
        }
      }
      break;
    }
    case "error": {
      throw new Error("Encountered an error event in event processing - errors should be processed earlier");
    }
    default: {
      assertNever2(stableEvent);
    }
  }
}, _AssistantStream_endRequest = function _AssistantStream_endRequest2() {
  if (this.ended) {
    throw new OpenAIError(`stream has ended, this shouldn't happen`);
  }
  if (!__classPrivateFieldGet(this, _AssistantStream_finalRun, "f")) {
    throw new Error("Final run has not been received");
  }
  return __classPrivateFieldGet(this, _AssistantStream_finalRun, "f");
}, _AssistantStream_validateRunStepEvent = function _AssistantStream_validateRunStepEvent2(event) {
  const descriptor = Object.getOwnPropertyDescriptor(event.data, "id");
  const runStepID = descriptor && "value" in descriptor ? descriptor.value : void 0;
  if (typeof runStepID !== "string" || runStepID.length === 0) {
    throw new OpenAIError("Received assistant run-step event with an invalid run-step ID");
  }
  if (event.event === "thread.run.step.created") {
    if (__classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f") !== void 0) {
      throw new OpenAIError(`Received run-step creation for "${runStepID}" before the active run step "${__classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f")}" reached a terminal state`);
    }
    if (hasOwn(__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f"), runStepID) || __classPrivateFieldGet(this, _AssistantStream_runStepIDOwners, "f").has(runStepID)) {
      throw new OpenAIError(`Received run-step creation for run step "${runStepID}", which has already been created`);
    }
    __classPrivateFieldSet(this, _AssistantStream_activeRunStepID, runStepID, "f");
    __classPrivateFieldGet(this, _AssistantStream_runStepIDOwners, "f").set(runStepID, runStepID);
    return runStepID;
  }
  if (__classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f") !== void 0) {
    if (runStepID !== __classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f")) {
      throw new OpenAIError(`Received ${event.event} for run step "${runStepID}", which does not match the active run step "${__classPrivateFieldGet(this, _AssistantStream_activeRunStepID, "f")}"`);
    }
    return runStepID;
  }
  if (event.event === "thread.run.step.delta") {
    if (!hasOwn(__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f"), runStepID)) {
      throw new OpenAIError("Received a RunStepDelta before creation of a snapshot");
    }
    throw new OpenAIError(`Received run-step delta for "${runStepID}" with no active run step`);
  }
  if (hasOwn(__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f"), runStepID) || __classPrivateFieldGet(this, _AssistantStream_runStepIDOwners, "f").has(runStepID)) {
    throw new OpenAIError(`Received run-step event for run step "${runStepID}", which has already been created`);
  }
  __classPrivateFieldGet(this, _AssistantStream_runStepIDOwners, "f").set(runStepID, runStepID);
  if (event.event === "thread.run.step.in_progress") {
    __classPrivateFieldSet(this, _AssistantStream_activeRunStepID, runStepID, "f");
  }
  return runStepID;
}, _AssistantStream_reserveRunStepAlias = function _AssistantStream_reserveRunStepAlias2(data, canonicalID) {
  const descriptor = Object.getOwnPropertyDescriptor(data, "id");
  const runStepID = descriptor && "value" in descriptor ? descriptor.value : void 0;
  if (typeof runStepID !== "string" || runStepID.length === 0) {
    throw new OpenAIError("Received assistant run-step event with an invalid run-step ID");
  }
  const owner = __classPrivateFieldGet(this, _AssistantStream_runStepIDOwners, "f").get(runStepID);
  if (owner !== void 0 && owner !== canonicalID) {
    throw new OpenAIError(`Received run-step creation for run step "${runStepID}", which has already been created`);
  }
  __classPrivateFieldGet(this, _AssistantStream_runStepIDOwners, "f").set(runStepID, canonicalID);
}, _AssistantStream_validateMessageEvent = function _AssistantStream_validateMessageEvent2(event) {
  const descriptor = Object.getOwnPropertyDescriptor(event.data, "id");
  const messageID = descriptor && "value" in descriptor ? descriptor.value : void 0;
  if (typeof messageID !== "string" || messageID.length === 0) {
    throw new OpenAIError("Received assistant message event with an invalid message ID");
  }
  if (event.event === "thread.message.created") {
    if (__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f")) {
      throw new OpenAIError(`Received message creation for "${messageID}" before the active message "${__classPrivateFieldGet(this, _AssistantStream_activeMessageID, "f")}" reached a terminal state`);
    }
    if (hasOwn(__classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f"), messageID) || __classPrivateFieldGet(this, _AssistantStream_messageIDOwners, "f").has(messageID)) {
      throw new OpenAIError(`Received message creation for message "${messageID}", which has already been created`);
    }
    __classPrivateFieldSet(this, _AssistantStream_activeMessageID, messageID, "f");
    __classPrivateFieldGet(this, _AssistantStream_messageIDOwners, "f").set(messageID, messageID);
    return messageID;
  }
  if (!__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f")) {
    if (event.event === "thread.message.delta") {
      throw new OpenAIError("Received a delta with no existing snapshot (there should be one from message creation)");
    }
    throw new OpenAIError("Received thread message event with no existing snapshot");
  }
  if (messageID !== __classPrivateFieldGet(this, _AssistantStream_activeMessageID, "f")) {
    throw new OpenAIError(`Received ${event.event} for message "${messageID}", which does not match the active message "${__classPrivateFieldGet(this, _AssistantStream_activeMessageID, "f")}"`);
  }
  return messageID;
}, _AssistantStream_reserveMessageAlias = function _AssistantStream_reserveMessageAlias2(data, canonicalID) {
  const descriptor = Object.getOwnPropertyDescriptor(data, "id");
  const messageID = descriptor && "value" in descriptor ? descriptor.value : void 0;
  if (typeof messageID !== "string" || messageID.length === 0) {
    throw new OpenAIError("Received assistant message event with an invalid message ID");
  }
  const owner = __classPrivateFieldGet(this, _AssistantStream_messageIDOwners, "f").get(messageID);
  if (owner !== void 0 && owner !== canonicalID) {
    throw new OpenAIError(`Received message creation for message "${messageID}", which has already been created`);
  }
  __classPrivateFieldGet(this, _AssistantStream_messageIDOwners, "f").set(messageID, canonicalID);
}, _AssistantStream_handleMessage = function _AssistantStream_handleMessage2(event) {
  const [accumulatedMessage, newContent] = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateMessage).call(this, event, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
  __classPrivateFieldSet(this, _AssistantStream_messageSnapshot, accumulatedMessage, "f");
  if (!__classPrivateFieldGet(this, _AssistantStream_activeMessageID, "f")) {
    throw new OpenAIError("Received thread message event with no active message ID");
  }
  __classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f")[__classPrivateFieldGet(this, _AssistantStream_activeMessageID, "f")] = accumulatedMessage;
  for (const content of newContent) {
    const snapshotContent = accumulatedMessage.content[content.index];
    if (snapshotContent?.type === "text") {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "textCreated", snapshotContent.text);
    }
  }
  switch (event.event) {
    case "thread.message.created": {
      __classPrivateFieldSet(this, _AssistantStream_currentContentIndex, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_currentContent, void 0, "f");
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "messageCreated", event.data);
      break;
    }
    case "thread.message.in_progress": {
      break;
    }
    case "thread.message.delta": {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "messageDelta", event.data.delta, accumulatedMessage);
      if (event.data.delta.content) {
        for (const content of event.data.delta.content) {
          if (content.type === "text" && content.text) {
            const textDelta = content.text;
            const snapshot = accumulatedMessage.content[content.index];
            if (snapshot && snapshot.type === "text") {
              __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "textDelta", textDelta, snapshot.text);
            } else {
              throw new Error("The snapshot associated with this text delta is not text or missing");
            }
          }
          if (content.index !== __classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f")) {
            if (__classPrivateFieldGet(this, _AssistantStream_currentContent, "f")) {
              switch (__classPrivateFieldGet(this, _AssistantStream_currentContent, "f").type) {
                case "text": {
                  __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "textDone", __classPrivateFieldGet(this, _AssistantStream_currentContent, "f").text, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                  break;
                }
                case "image_file": {
                  __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "imageFileDone", __classPrivateFieldGet(this, _AssistantStream_currentContent, "f").image_file, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                  break;
                }
              }
            }
            __classPrivateFieldSet(this, _AssistantStream_currentContentIndex, content.index, "f");
          }
          __classPrivateFieldSet(this, _AssistantStream_currentContent, accumulatedMessage.content[content.index], "f");
        }
      }
      break;
    }
    case "thread.message.completed":
    case "thread.message.incomplete": {
      if (__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f") !== void 0) {
        const currentContent = event.data.content[__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f")];
        if (currentContent) {
          switch (currentContent.type) {
            case "image_file": {
              __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "imageFileDone", currentContent.image_file, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
              break;
            }
            case "text": {
              __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "textDone", currentContent.text, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
              break;
            }
          }
        }
      }
      if (__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f")) {
        __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "messageDone", event.data);
      }
      __classPrivateFieldSet(this, _AssistantStream_currentContentIndex, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_currentContent, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_messageSnapshot, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_activeMessageID, void 0, "f");
    }
  }
}, _AssistantStream_handleRunStep = function _AssistantStream_handleRunStep2(event, runStepID) {
  const accumulatedRunStep = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateRunStep).call(this, event, runStepID);
  __classPrivateFieldSet(this, _AssistantStream_currentRunStepSnapshot, accumulatedRunStep, "f");
  switch (event.event) {
    case "thread.run.step.created": {
      __classPrivateFieldSet(this, _AssistantStream_currentToolCallIndex, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_currentToolCall, void 0, "f");
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "runStepCreated", event.data);
      break;
    }
    case "thread.run.step.delta": {
      const delta = event.data.delta;
      if (delta.step_details && delta.step_details.type === "tool_calls" && delta.step_details.tool_calls && accumulatedRunStep.step_details.type === "tool_calls") {
        for (const toolCall of delta.step_details.tool_calls) {
          if (toolCall.index === __classPrivateFieldGet(this, _AssistantStream_currentToolCallIndex, "f")) {
            __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "toolCallDelta", toolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index]);
          } else {
            if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
              __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "toolCallDone", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
            }
            __classPrivateFieldSet(this, _AssistantStream_currentToolCallIndex, toolCall.index, "f");
            __classPrivateFieldSet(this, _AssistantStream_currentToolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index], "f");
            if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
              __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "toolCallCreated", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
            }
          }
        }
      }
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "runStepDelta", event.data.delta, accumulatedRunStep);
      break;
    }
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired": {
      __classPrivateFieldSet(this, _AssistantStream_currentRunStepSnapshot, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_activeRunStepID, void 0, "f");
      const details = event.data.step_details;
      if (details.type === "tool_calls" && __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
        __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "toolCallDone", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
      }
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "runStepDone", event.data, accumulatedRunStep);
      __classPrivateFieldSet(this, _AssistantStream_currentToolCallIndex, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_currentToolCall, void 0, "f");
      break;
    }
    case "thread.run.step.in_progress": {
      break;
    }
  }
}, _AssistantStream_emitExposed = function _AssistantStream_emitExposed2(event, ...args) {
  if (this._hasListeners(event)) {
    for (const value of args) {
      markAssistantStreamValueExternallyMutable(value);
    }
  }
  this._emit(event, ...args);
}, _AssistantStream_handleEvent = function _AssistantStream_handleEvent2(event) {
  __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "event", event);
}, _AssistantStream_accumulateRunStep = function _AssistantStream_accumulateRunStep2(event, runStepID) {
  switch (event.event) {
    case "thread.run.step.created": {
      __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID] = event.data;
      return event.data;
    }
    case "thread.run.step.delta": {
      const snapshot = __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID];
      if (!snapshot) {
        throw new Error("Received a RunStepDelta before creation of a snapshot");
      }
      const data = event.data;
      if (data.delta) {
        const accumulated = accumulateAssistantStreamDelta(snapshot, data.delta, true);
        __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID] = accumulated;
      }
      return __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID];
    }
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
    case "thread.run.step.in_progress": {
      __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID] = event.data;
      break;
    }
  }
  if (__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID]) {
    return __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[runStepID];
  }
  throw new Error("No snapshot available");
}, _AssistantStream_accumulateMessage = function _AssistantStream_accumulateMessage2(event, snapshot) {
  const newContent = [];
  switch (event.event) {
    case "thread.message.created": {
      return [event.data, newContent];
    }
    case "thread.message.delta": {
      if (!snapshot) {
        throw new Error("Received a delta with no existing snapshot (there should be one from message creation)");
      }
      const data = event.data;
      if (data.delta.content) {
        assertSafeAssistantStreamDelta(data.delta);
        const cacheArrays = !isAssistantStreamValueExternallyMutable(snapshot);
        const commitProjection = createAssistantStreamArrayDeltaCommit(snapshot.content, data.delta.content, "content", cacheArrays);
        for (const contentElement of data.delta.content) {
          if (hasOwn(snapshot.content, contentElement.index)) {
            const currentContent = snapshot.content[contentElement.index];
            snapshot.content[contentElement.index] = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateContent).call(this, contentElement, currentContent, cacheArrays);
          } else {
            defineAssistantStreamArrayEntry(snapshot.content, contentElement.index, contentElement);
            newContent.push(contentElement);
          }
        }
        commitProjection();
      }
      return [snapshot, newContent];
    }
    case "thread.message.in_progress":
    case "thread.message.completed":
    case "thread.message.incomplete": {
      if (snapshot) {
        return [snapshot, newContent];
      }
      throw new Error("Received thread message event with no existing snapshot");
    }
  }
  throw new Error("Tried to accumulate a non-message event");
}, _AssistantStream_accumulateContent = function _AssistantStream_accumulateContent2(contentElement, currentContent, cacheArrays) {
  return accumulateAssistantStreamDelta(currentContent, contentElement, cacheArrays);
}, _AssistantStream_handleRun = function _AssistantStream_handleRun2(event) {
  __classPrivateFieldSet(this, _AssistantStream_currentRunSnapshot, event.data, "f");
  switch (event.event) {
    case "thread.run.created": {
      break;
    }
    case "thread.run.queued": {
      break;
    }
    case "thread.run.in_progress": {
      break;
    }
    case "thread.run.requires_action":
    case "thread.run.cancelled":
    case "thread.run.failed":
    case "thread.run.completed":
    case "thread.run.expired":
    case "thread.run.incomplete": {
      __classPrivateFieldSet(this, _AssistantStream_finalRun, event.data, "f");
      if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
        __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_emitExposed).call(this, "toolCallDone", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
      }
      __classPrivateFieldSet(this, _AssistantStream_currentToolCallIndex, void 0, "f");
      __classPrivateFieldSet(this, _AssistantStream_currentToolCall, void 0, "f");
      break;
    }
    case "thread.run.cancelling": {
      break;
    }
  }
};
function assertNever2(_x) {
  return _x;
}

// ../../../node_modules/openai/lib/polling.mjs
function sleepUntilAborted(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    let registered;
    let settled = false;
    const removeAbortListener = (listener) => {
      try {
        signal.removeEventListener("abort", listener);
      } catch {
      }
    };
    const cleanup = () => {
      if (timer !== void 0) {
        clearTimeout(timer);
        timer = void 0;
      }
      if (registered) {
        const listener = registered;
        registered = void 0;
        removeAbortListener(listener);
      }
    };
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        const error = new APIUserAbortError();
        Object.defineProperty(error, "cause", {
          value: signal.reason,
          writable: true,
          configurable: true
        });
        reject(error);
      } catch (error) {
        reject(error);
      }
    };
    if (signal.aborted) {
      abort();
      return;
    }
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }, milliseconds);
    registered = abort;
    try {
      signal.addEventListener("abort", abort, { once: true });
      if (settled) {
        removeAbortListener(abort);
      } else if (signal.aborted) {
        abort();
      }
    } catch (error) {
      if (settled) {
        removeAbortListener(abort);
      } else {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}
async function pollWithResponse(retrieve, intermediateStatuses, terminalStatuses, options) {
  const headers = buildHeaders([
    options?.headers,
    {
      "X-Stainless-Poll-Helper": "true",
      "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
    }
  ]);
  while (true) {
    const { data, response } = await retrieve(headers).withResponse();
    const { status } = data;
    if (intermediateStatuses.includes(status)) {
      let sleepInterval = 5e3;
      if (options?.pollIntervalMs) {
        sleepInterval = options.pollIntervalMs;
      } else {
        const headerInterval = response.headers.get("openai-poll-after-ms");
        if (headerInterval) {
          const headerIntervalMs = Number.parseInt(headerInterval);
          if (!Number.isNaN(headerIntervalMs)) {
            sleepInterval = headerIntervalMs;
          }
        }
      }
      const signal = options && Object.prototype.propertyIsEnumerable.call(options, "signal") ? options.signal : void 0;
      await (signal ? sleepUntilAborted(sleepInterval, signal) : sleep(sleepInterval));
    } else if (terminalStatuses.includes(status)) {
      return data;
    }
  }
}

// ../../../node_modules/openai/lib/assistant-run-polling.mjs
function pollAssistantRun(resource, runID, params, options) {
  return pollWithResponse((headers) => resource.retrieve(runID, params, {
    ...options,
    headers: { ...options?.headers, ...headers }
  }), ["queued", "in_progress", "cancelling"], ["requires_action", "incomplete", "cancelled", "completed", "failed", "expired"], options);
}

// ../../../node_modules/openai/resources/beta/threads/runs/runs.mjs
var Runs = class extends APIResource {
  constructor() {
    super(...arguments);
    this.steps = new Steps(this._client);
  }
  create(threadID, params, options) {
    const { include, ...body } = params;
    return this._client.post(path`/threads/${threadID}/runs`, {
      query: { include },
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: params.stream ?? false,
      __synthesizeEventData: true,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieves a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(runID, params, options) {
    const { thread_id } = params;
    return this._client.get(path`/threads/${thread_id}/runs/${runID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Modifies a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(runID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Returns a list of runs belonging to a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(threadID, query = {}, options) {
    return this._client.getAPIList(path`/threads/${threadID}/runs`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Cancels a run that is `in_progress`.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  cancel(runID, params, options) {
    const { thread_id } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * A helper to create a run an poll for a terminal state. More information on Run
   * lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndPoll(threadId, body, options) {
    const run = await this.create(threadId, body, options);
    return await this.poll(run.id, { thread_id: threadId }, options);
  }
  /**
   * Create a Run stream
   *
   * @deprecated use `stream` instead
   */
  createAndStream(threadId, body, options) {
    return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
  }
  /**
   * A helper to poll a run status until it reaches a terminal state. More
   * information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async poll(runId, params, options) {
    return await pollAssistantRun(this, runId, params, options);
  }
  /**
   * Create a Run stream
   */
  stream(threadId, body, options) {
    return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
  }
  submitToolOutputs(runID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}/submit_tool_outputs`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: params.stream ?? false,
      __synthesizeEventData: true,
      __security: { bearerAuth: true }
    });
  }
  /**
   * A helper to submit a tool output to a run and poll for a terminal run state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async submitToolOutputsAndPoll(runId, params, options) {
    const run = await this.submitToolOutputs(runId, params, options);
    return await this.poll(run.id, params, options);
  }
  /**
   * Submit the tool outputs from a previous run and stream the run to a terminal
   * state. More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  submitToolOutputsStream(runId, params, options) {
    return AssistantStream.createToolAssistantStream(runId, this._client.beta.threads.runs, params, options);
  }
};
Runs.Steps = Steps;

// ../../../node_modules/openai/resources/beta/threads/threads.mjs
var Threads2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.runs = new Runs(this._client);
    this.messages = new Messages2(this._client);
  }
  /**
   * Create a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  create(body = {}, options) {
    return this._client.post("/threads", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieves a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(threadID, options) {
    return this._client.get(path`/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Modifies a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(threadID, body, options) {
    return this._client.post(path`/threads/${threadID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  delete(threadID, options) {
    return this._client.delete(path`/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  createAndRun(body, options) {
    return this._client.post("/threads/runs", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: body.stream ?? false,
      __synthesizeEventData: true,
      __security: { bearerAuth: true }
    });
  }
  /**
   * A helper to create a thread, start a run and then poll for a terminal state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndRunPoll(body, options) {
    const run = await this.createAndRun(body, options);
    return await this.runs.poll(run.id, { thread_id: run.thread_id }, options);
  }
  /**
   * Create a thread and stream the run back
   */
  createAndRunStream(body, options) {
    return AssistantStream.createThreadAssistantStream(body, this._client.beta.threads, options);
  }
};
Threads2.Runs = Runs;
Threads2.Messages = Messages2;

// ../../../node_modules/openai/resources/beta/beta.mjs
var Beta = class extends APIResource {
  constructor() {
    super(...arguments);
    this.realtime = new Realtime(this._client);
    this.responses = new Responses(this._client);
    this.chatkit = new ChatKit(this._client);
    this.assistants = new Assistants(this._client);
    this.threads = new Threads2(this._client);
  }
};
Beta.Realtime = Realtime;
Beta.Responses = Responses;
Beta.ChatKit = ChatKit;
Beta.Assistants = Assistants;
Beta.Threads = Threads2;

// ../../../node_modules/openai/resources/completions.mjs
var Completions2 = class extends APIResource {
  create(body, options) {
    return this._client.post("/completions", {
      body,
      ...options,
      stream: body.stream ?? false,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/containers/files/content.mjs
var Content = class extends APIResource {
  /**
   * Retrieve Container File Content
   */
  retrieve(fileID, params, options) {
    const { container_id } = params;
    return this._client.get(path`/containers/${container_id}/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/containers/files/files.mjs
var Files = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content(this._client);
  }
  /**
   * Create a Container File
   *
   * You can send either a multipart/form-data request with the raw file content, or
   * a JSON request with a file ID.
   */
  create(containerID, body, options) {
    return this._client.post(path`/containers/${containerID}/files`, maybeMultipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  /**
   * Retrieve Container File
   */
  retrieve(fileID, params, options) {
    const { container_id } = params;
    return this._client.get(path`/containers/${container_id}/files/${fileID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List Container files
   */
  list(containerID, query = {}, options) {
    return this._client.getAPIList(path`/containers/${containerID}/files`, CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete Container File
   */
  delete(fileID, params, options) {
    const { container_id } = params;
    return this._client.delete(path`/containers/${container_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};
Files.Content = Content;

// ../../../node_modules/openai/resources/containers/containers.mjs
var Containers = class extends APIResource {
  constructor() {
    super(...arguments);
    this.files = new Files(this._client);
  }
  /**
   * Create Container
   */
  create(body, options) {
    return this._client.post("/containers", { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Retrieve Container
   */
  retrieve(containerID, options) {
    return this._client.get(path`/containers/${containerID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List Containers
   */
  list(query = {}, options) {
    return this._client.getAPIList("/containers", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete Container
   */
  delete(containerID, options) {
    return this._client.delete(path`/containers/${containerID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};
Containers.Files = Files;

// ../../../node_modules/openai/resources/content-provenance-checks.mjs
var ContentProvenanceChecks = class extends APIResource {
  /**
   * Check whether an image or audio file contains known OpenAI provenance signals.
   * [Learn more about content provenance](/api/docs/guides/content-provenance).
   *
   * If `not_detected`, it means the tool did not find supported signals in the
   * uploaded file. The content could still have been generated by OpenAI if the
   * metadata was stripped or has evidence of tampering, the watermark was degraded,
   * it comes from a legacy generation model, or it was created before provenance
   * signals were available. Content could also still be AI-generated by another
   * company's model, which the tool currently does not detect.
   */
  create(body, options) {
    return this._client.post("/content_provenance_checks", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
};

// ../../../node_modules/openai/resources/conversations/items.mjs
var Items = class extends APIResource {
  /**
   * Create items in a conversation with the given ID.
   */
  create(conversationID, params, options) {
    const { include, ...body } = params;
    return this._client.post(path`/conversations/${conversationID}/items`, {
      query: { include },
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Get a single item from a conversation with the given IDs.
   */
  retrieve(itemID, params, options) {
    const { conversation_id, ...query } = params;
    return this._client.get(path`/conversations/${conversation_id}/items/${itemID}`, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List all items for a conversation with the given ID.
   */
  list(conversationID, query = {}, options) {
    return this._client.getAPIList(path`/conversations/${conversationID}/items`, ConversationCursorPage, { query, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Delete an item from a conversation with the given IDs.
   */
  delete(itemID, params, options) {
    const { conversation_id } = params;
    return this._client.delete(path`/conversations/${conversation_id}/items/${itemID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/conversations/conversations.mjs
var Conversations = class extends APIResource {
  constructor() {
    super(...arguments);
    this.items = new Items(this._client);
  }
  /**
   * Create a conversation.
   */
  create(body = {}, options) {
    return this._client.post("/conversations", { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Get a conversation
   */
  retrieve(conversationID, options) {
    return this._client.get(path`/conversations/${conversationID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Update a conversation
   */
  update(conversationID, body, options) {
    return this._client.post(path`/conversations/${conversationID}`, {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a conversation. Items in the conversation will not be deleted.
   */
  delete(conversationID, options) {
    return this._client.delete(path`/conversations/${conversationID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
};
Conversations.Items = Items;

// ../../../node_modules/openai/lib/embeddings.mjs
function createEmbedding(client, body, options) {
  const hasUserProvidedEncodingFormat = !!body.encoding_format;
  const encodingFormat = hasUserProvidedEncodingFormat ? body.encoding_format : "base64";
  if (hasUserProvidedEncodingFormat) {
    loggerFor(client).debug("embeddings/user defined encoding_format:", body.encoding_format);
  }
  const response = client.post("/embeddings", {
    body: {
      ...body,
      encoding_format: encodingFormat
    },
    ...options,
    __security: { bearerAuth: true }
  });
  if (hasUserProvidedEncodingFormat) {
    return response;
  }
  loggerFor(client).debug("embeddings/decoding base64 embeddings from base64");
  return response._thenUnwrap((data) => {
    if (data && data.data) {
      const embeddings = data.data;
      const { length } = embeddings;
      for (let index = 0; index < length; index += 1) {
        if (index in embeddings) {
          const embeddingBase64Obj = embeddings[index];
          const embeddingBase64Str = embeddingBase64Obj.embedding;
          embeddingBase64Obj.embedding = toFloat32Array(embeddingBase64Str);
        }
      }
    }
    return data;
  });
}

// ../../../node_modules/openai/resources/embeddings.mjs
var Embeddings = class extends APIResource {
  create(body, options) {
    return createEmbedding(this._client, body, options);
  }
};

// ../../../node_modules/openai/resources/evals/runs/output-items.mjs
var OutputItems = class extends APIResource {
  /**
   * Get an evaluation run output item by ID.
   */
  retrieve(outputItemID, params, options) {
    const { eval_id, run_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${run_id}/output_items/${outputItemID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Get a list of output items for an evaluation run.
   */
  list(runID, params, options) {
    const { eval_id, ...query } = params;
    return this._client.getAPIList(path`/evals/${eval_id}/runs/${runID}/output_items`, CursorPage, { query, ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/resources/evals/runs/runs.mjs
var Runs2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.outputItems = new OutputItems(this._client);
  }
  /**
   * Kicks off a new run for a given evaluation, specifying the data source, and what
   * model configuration to use to test. The datasource will be validated against the
   * schema specified in the config of the evaluation.
   */
  create(evalID, body, options) {
    return this._client.post(path`/evals/${evalID}/runs`, {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Get an evaluation run by ID.
   */
  retrieve(runID, params, options) {
    const { eval_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${runID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Get a list of runs for an evaluation.
   */
  list(evalID, query = {}, options) {
    return this._client.getAPIList(path`/evals/${evalID}/runs`, CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete an eval run.
   */
  delete(runID, params, options) {
    const { eval_id } = params;
    return this._client.delete(path`/evals/${eval_id}/runs/${runID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Cancel an ongoing evaluation run.
   */
  cancel(runID, params, options) {
    const { eval_id } = params;
    return this._client.post(path`/evals/${eval_id}/runs/${runID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
};
Runs2.OutputItems = OutputItems;

// ../../../node_modules/openai/resources/evals/evals.mjs
var Evals = class extends APIResource {
  constructor() {
    super(...arguments);
    this.runs = new Runs2(this._client);
  }
  /**
   * Create the structure of an evaluation that can be used to test a model's
   * performance. An evaluation is a set of testing criteria and the config for a
   * data source, which dictates the schema of the data used in the evaluation. After
   * creating an evaluation, you can run it on different models and model parameters.
   * We support several types of graders and datasources. For more information, see
   * the [Evals guide](https://platform.openai.com/docs/guides/evals).
   */
  create(body, options) {
    return this._client.post("/evals", { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Get an evaluation by ID.
   */
  retrieve(evalID, options) {
    return this._client.get(path`/evals/${evalID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Update certain properties of an evaluation.
   */
  update(evalID, body, options) {
    return this._client.post(path`/evals/${evalID}`, { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * List evaluations for a project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/evals", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete an evaluation.
   */
  delete(evalID, options) {
    return this._client.delete(path`/evals/${evalID}`, { ...options, __security: { bearerAuth: true } });
  }
};
Evals.Runs = Runs2;

// ../../../node_modules/openai/lib/file-processing.mjs
async function waitForFileProcessing(resource, id, pollInterval, maxWait) {
  const terminalStates = /* @__PURE__ */ new Set(["processed", "error", "deleted"]);
  const start = Date.now();
  let file = await resource.retrieve(id);
  while (!file.status || !terminalStates.has(file.status)) {
    await sleep(pollInterval);
    file = await resource.retrieve(id);
    if (Date.now() - start > maxWait) {
      throw new APIConnectionTimeoutError({
        message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`
      });
    }
  }
  return file;
}

// ../../../node_modules/openai/resources/files.mjs
var Files2 = class extends APIResource {
  /**
   * Upload a file that can be used across various endpoints. Individual files can be
   * up to 512 MB, and each project can store up to 2.5 TB of files in total. There
   * is no organization-wide storage limit. Uploads to this endpoint are rate-limited
   * to 1,000 requests per minute per authenticated user.
   *
   * - The Assistants API supports files up to 2 million tokens and of specific file
   *   types. See the
   *   [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools)
   *   for details.
   * - The Fine-tuning API only supports `.jsonl` files. The input also has certain
   *   required formats for fine-tuning
   *   [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input)
   *   or
   *   [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
   *   models.
   * - The Batch API only supports `.jsonl` files up to 200 MB in size. The input
   *   also has a specific required
   *   [format](https://platform.openai.com/docs/api-reference/batch/request-input).
   * - For Retrieval or `file_search` ingestion, upload files here first. If you need
   *   to attach multiple uploaded files to the same vector store, use
   *   [`/vector_stores/{vector_store_id}/file_batches`](https://platform.openai.com/docs/api-reference/vector-stores-file-batches/createBatch)
   *   instead of attaching them one by one. Vector store attachment has separate
   *   limits from file upload, including 2,000 attached files per minute per
   *   organization.
   *
   * Please [contact us](https://help.openai.com/) if you need to increase these
   * storage limits.
   */
  create(body, options) {
    return this._client.post("/files", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  /**
   * Returns information about a specific file.
   */
  retrieve(fileID, options) {
    return this._client.get(path`/files/${fileID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Returns a list of files.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/files", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a file and remove it from all vector stores.
   */
  delete(fileID, options) {
    return this._client.delete(path`/files/${fileID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Returns a response containing the contents of the specified file.
   */
  content(fileID, options) {
    return this._client.get(path`/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    });
  }
  /**
   * Waits for the given file to be processed, default timeout is 30 mins.
   */
  async waitForProcessing(id, { pollInterval = 5e3, maxWait = 30 * 60 * 1e3 } = {}) {
    return await waitForFileProcessing(this, id, pollInterval, maxWait);
  }
};

// ../../../node_modules/openai/resources/fine-tuning/methods.mjs
var Methods = class extends APIResource {
};

// ../../../node_modules/openai/resources/fine-tuning/alpha/graders.mjs
var Graders = class extends APIResource {
  /**
   * Run a grader.
   *
   * @example
   * ```ts
   * const response = await client.fineTuning.alpha.graders.run({
   *   grader: {
   *     input: 'input',
   *     name: 'name',
   *     operation: 'eq',
   *     reference: 'reference',
   *     type: 'string_check',
   *   },
   *   model_sample: 'model_sample',
   * });
   * ```
   */
  run(body, options) {
    return this._client.post("/fine_tuning/alpha/graders/run", {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Validate a grader.
   *
   * @example
   * ```ts
   * const response =
   *   await client.fineTuning.alpha.graders.validate({
   *     grader: {
   *       input: 'input',
   *       name: 'name',
   *       operation: 'eq',
   *       reference: 'reference',
   *       type: 'string_check',
   *     },
   *   });
   * ```
   */
  validate(body, options) {
    return this._client.post("/fine_tuning/alpha/graders/validate", {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/fine-tuning/alpha/alpha.mjs
var Alpha = class extends APIResource {
  constructor() {
    super(...arguments);
    this.graders = new Graders(this._client);
  }
};
Alpha.Graders = Graders;

// ../../../node_modules/openai/resources/fine-tuning/checkpoints/permissions.mjs
var Permissions = class extends APIResource {
  /**
   * **NOTE:** Calling this endpoint requires an [admin API key](../admin-api-keys).
   *
   * This enables organization owners to share fine-tuned models with other projects
   * in their organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const permissionCreateResponse of client.fineTuning.checkpoints.permissions.create(
   *   'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
   *   { project_ids: ['string'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  create(fineTunedModelCheckpoint, body, options) {
    return this._client.getAPIList(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, Page, { body, method: "post", ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   *
   * @deprecated Retrieve is deprecated. Please swap to the paginated list method instead.
   */
  retrieve(fineTunedModelCheckpoint, query = {}, options) {
    return this._client.get(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true }
    });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const permissionListResponse of client.fineTuning.checkpoints.permissions.list(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(fineTunedModelCheckpoint, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, ConversationCursorPage, { query, ...options, __security: { adminAPIKeyAuth: true } });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to delete a permission for a
   * fine-tuned model checkpoint.
   *
   * @example
   * ```ts
   * const permission =
   *   await client.fineTuning.checkpoints.permissions.delete(
   *     'cp_zc4Q7MP6XxulcVzj4MZdwsAB',
   *     {
   *       fine_tuned_model_checkpoint:
   *         'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
   *     },
   *   );
   * ```
   */
  delete(permissionID, params, options) {
    const { fine_tuned_model_checkpoint } = params;
    return this._client.delete(path`/fine_tuning/checkpoints/${fine_tuned_model_checkpoint}/permissions/${permissionID}`, { ...options, __security: { adminAPIKeyAuth: true } });
  }
};

// ../../../node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.mjs
var Checkpoints = class extends APIResource {
  constructor() {
    super(...arguments);
    this.permissions = new Permissions(this._client);
  }
};
Checkpoints.Permissions = Permissions;

// ../../../node_modules/openai/resources/fine-tuning/jobs/checkpoints.mjs
var Checkpoints2 = class extends APIResource {
  /**
   * List checkpoints for a fine-tuning job.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJobCheckpoint of client.fineTuning.jobs.checkpoints.list(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(fineTuningJobID, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/jobs/${fineTuningJobID}/checkpoints`, CursorPage, { query, ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/resources/fine-tuning/jobs/jobs.mjs
var Jobs = class extends APIResource {
  constructor() {
    super(...arguments);
    this.checkpoints = new Checkpoints2(this._client);
  }
  /**
   * Creates a fine-tuning job which begins the process of creating a new model from
   * a given dataset.
   *
   * Response includes details of the enqueued job including job status and the name
   * of the fine-tuned models once complete.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.create({
   *   model: 'gpt-4o-mini',
   *   training_file: 'file-abc123',
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/fine_tuning/jobs", { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Get info about a fine-tuning job.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.retrieve(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  retrieve(fineTuningJobID, options) {
    return this._client.get(path`/fine_tuning/jobs/${fineTuningJobID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List your organization's fine-tuning jobs
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJob of client.fineTuning.jobs.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/fine_tuning/jobs", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Immediately cancel a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.cancel(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  cancel(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/cancel`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Get status updates for a fine-tuning job.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJobEvent of client.fineTuning.jobs.listEvents(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  listEvents(fineTuningJobID, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/jobs/${fineTuningJobID}/events`, CursorPage, { query, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Pause a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.pause(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  pause(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/pause`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Resume a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.resume(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  resume(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/resume`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
};
Jobs.Checkpoints = Checkpoints2;

// ../../../node_modules/openai/resources/fine-tuning/fine-tuning.mjs
var FineTuning = class extends APIResource {
  constructor() {
    super(...arguments);
    this.methods = new Methods(this._client);
    this.jobs = new Jobs(this._client);
    this.checkpoints = new Checkpoints(this._client);
    this.alpha = new Alpha(this._client);
  }
};
FineTuning.Methods = Methods;
FineTuning.Jobs = Jobs;
FineTuning.Checkpoints = Checkpoints;
FineTuning.Alpha = Alpha;

// ../../../node_modules/openai/resources/graders/grader-models.mjs
var GraderModels = class extends APIResource {
};

// ../../../node_modules/openai/resources/graders/graders.mjs
var Graders2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.graderModels = new GraderModels(this._client);
  }
};
Graders2.GraderModels = GraderModels;

// ../../../node_modules/openai/resources/images.mjs
var Images = class extends APIResource {
  /**
   * Creates a variation of a given image. This endpoint only supports `dall-e-2`.
   *
   * @example
   * ```ts
   * const imagesResponse = await client.images.createVariation({
   *   image: fs.createReadStream('otter.png'),
   * });
   * ```
   */
  createVariation(body, options) {
    return this._client.post("/images/variations", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  edit(body, options) {
    return this._client.post("/images/edits", multipartFormRequestOptions({
      body,
      ...options,
      stream: body.stream ?? false,
      __metadata: { ...options?.__metadata, ...body.model == null ? {} : { model: body.model } },
      __security: { bearerAuth: true }
    }, this._client));
  }
  generate(body, options) {
    return this._client.post("/images/generations", {
      body,
      ...options,
      stream: body.stream ?? false,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/models.mjs
var Models = class extends APIResource {
  /**
   * Retrieves a model instance, providing basic information about the model such as
   * the owner and permissioning.
   */
  retrieve(model, options) {
    return this._client.get(path`/models/${model}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Lists the currently available models, and provides basic information about each
   * one such as the owner and availability.
   */
  list(options) {
    return this._client.getAPIList("/models", Page, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Delete a fine-tuned model. You must have the Owner role in your organization to
   * delete a model.
   */
  delete(model, options) {
    return this._client.delete(path`/models/${model}`, { ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/resources/moderations.mjs
var Moderations = class extends APIResource {
  /**
   * Classifies if text and/or image inputs are potentially harmful. Learn more in
   * the [moderation guide](https://platform.openai.com/docs/guides/moderation).
   */
  create(body, options) {
    return this._client.post("/moderations", { body, ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/internal/multipart-encoding.mjs
async function encodedMultipartFormRequestOptions(options, client, encodings, rawBodyField = null) {
  if (options.body === null || typeof options.body !== "object" || Array.isArray(options.body)) {
    throw new TypeError("Multipart request body must be an object");
  }
  const body = Object.fromEntries(Object.entries(options.body).filter(([, value]) => value !== void 0));
  if (rawBodyField !== null && Object.keys(body).length === 1 && Object.prototype.hasOwnProperty.call(body, rawBodyField)) {
    const value = body[rawBodyField];
    if (typeof value !== "string")
      throw new TypeError("Raw multipart alternative must be a string");
    return {
      ...options,
      body: value,
      headers: buildHeaders([options.headers, { "content-type": encodings[rawBodyField].content_type }])
    };
  }
  const encoded = [];
  for (const [name, encoding] of Object.entries(encodings)) {
    if (!Object.prototype.hasOwnProperty.call(body, name))
      continue;
    const value = body[name];
    const data = encoding.json ? JSON.stringify(value) : value;
    if (typeof data !== "string")
      throw new TypeError(`Multipart field ${name} must encode as a string`);
    encoded.push([name, makeFile([data], "", { type: encoding.content_type })]);
    delete body[name];
  }
  const multipart = await multipartFormRequestOptions({ ...options, body }, client);
  const form = multipart.body;
  if (!(form instanceof FormData)) {
    await form.cancel();
    throw new TypeError("Unexpected streaming upload in typed multipart request body");
  }
  for (const [name, part] of encoded)
    form.append(name, part, "");
  return {
    ...options,
    body: form,
    headers: buildHeaders([options.headers, { "content-type": null }])
  };
}

// ../../../node_modules/openai/resources/realtime/calls.mjs
var Calls = class extends APIResource {
  /**
   * Create a new Realtime API call over WebRTC and receive the SDP answer needed to
   * complete the peer connection.
   *
   * @example
   * ```ts
   * await client.realtime.calls.create({
   *   sdp: 'sdp',
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/calls", encodedMultipartFormRequestOptions({
      body,
      ...options,
      headers: buildHeaders([{ Accept: "application/sdp" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    }, this._client, {
      sdp: { content_type: "application/sdp", json: false },
      session: { content_type: "application/json", json: true }
    }, "sdp"));
  }
  /**
   * Accept an incoming SIP call and configure the realtime session that will handle
   * it.
   *
   * @example
   * ```ts
   * await client.realtime.calls.accept('call_id', {
   *   type: 'realtime',
   * });
   * ```
   */
  accept(callID, body, options) {
    return this._client.post(path`/realtime/calls/${callID}/accept`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * End an active Realtime API call, whether it was initiated over SIP or WebRTC.
   *
   * @example
   * ```ts
   * await client.realtime.calls.hangup('call_id');
   * ```
   */
  hangup(callID, options) {
    return this._client.post(path`/realtime/calls/${callID}/hangup`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Transfer an active SIP call to a new destination using the SIP REFER verb.
   *
   * @example
   * ```ts
   * await client.realtime.calls.refer('call_id', {
   *   target_uri: 'tel:+14155550123',
   * });
   * ```
   */
  refer(callID, body, options) {
    return this._client.post(path`/realtime/calls/${callID}/refer`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Decline an incoming SIP call by returning a SIP status code to the caller.
   *
   * @example
   * ```ts
   * await client.realtime.calls.reject('call_id');
   * ```
   */
  reject(callID, body = {}, options) {
    return this._client.post(path`/realtime/calls/${callID}/reject`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/realtime/client-secrets.mjs
var ClientSecrets = class extends APIResource {
  /**
   * Create a Realtime client secret with an associated session configuration.
   *
   * Client secrets are short-lived tokens that can be passed to a client app, such
   * as a web frontend or mobile client, which grants access to the Realtime API
   * without leaking your main API key. You can configure a custom TTL for each
   * client secret.
   *
   * You can also attach session configuration options to the client secret, which
   * will be applied to any sessions created using that client secret, but these can
   * also be overridden by the client connection.
   *
   * [Learn more about authentication with client secrets over WebRTC](https://platform.openai.com/docs/guides/realtime-webrtc).
   *
   * Returns the created client secret and the effective session object. The client
   * secret is a string that looks like `ek_1234`.
   *
   * @example
   * ```ts
   * const clientSecret =
   *   await client.realtime.clientSecrets.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/client_secrets", {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/realtime/realtime.mjs
var Realtime2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.clientSecrets = new ClientSecrets(this._client);
    this.calls = new Calls(this._client);
  }
};
Realtime2.ClientSecrets = ClientSecrets;
Realtime2.Calls = Calls;

// ../../../node_modules/openai/lib/ResponsesParser.mjs
function maybeParseResponse(response, params) {
  if (!params || !hasAutoParseableInput2(params)) {
    const parsed = {
      ...response,
      output_parsed: null,
      output: response.output.map((item) => {
        if (item.type === "function_call") {
          return {
            ...item,
            parsed_arguments: null
          };
        }
        if (item.type === "message") {
          return {
            ...item,
            content: item.content.map((content) => ({
              ...content,
              parsed: null
            }))
          };
        }
        return item;
      })
    };
    if (needsOutputText(response, parsed)) {
      addOutputText(parsed);
    }
    return parsed;
  }
  return parseResponse(response, params);
}
function parseResponse(response, params) {
  const shouldParse = !response.status || response.status === "completed";
  const output = response.output.map((item) => {
    if (item.type === "function_call") {
      return shouldParse ? parseToolCall2(params, item) : { ...item, parsed_arguments: null };
    }
    if (item.type === "message") {
      const content = item.content.map((content2) => {
        if (content2.type === "output_text") {
          return {
            ...content2,
            parsed: shouldParse ? parseTextFormat(params, content2.text) : null
          };
        }
        return content2;
      });
      return {
        ...item,
        content
      };
    }
    return item;
  });
  const parsed = { ...response, output };
  if (needsOutputText(response, parsed)) {
    addOutputText(parsed);
  }
  Object.defineProperty(parsed, "output_parsed", {
    enumerable: true,
    get() {
      for (const output2 of parsed.output) {
        if (output2.type !== "message") {
          continue;
        }
        for (const content of output2.content) {
          if (content.type === "output_text" && content.parsed !== null) {
            return content.parsed;
          }
        }
      }
      return null;
    }
  });
  return parsed;
}
function parseTextFormat(params, content) {
  return parseResponseFormatContent(params.text?.format, content);
}
function hasAutoParseableInput2(params) {
  if (isParseableResponseFormat(params.text?.format)) {
    return true;
  }
  return Array.isArray(params.tools) && params.tools.some((tool) => isAutoParsableTool2(tool) || tool.type === "function" && tool.strict === true);
}
function isAutoParsableTool2(tool) {
  return tool?.["$brand"] === "auto-parseable-tool";
}
function getInputToolByName(input_tools, name) {
  return input_tools.find((tool) => tool.type === "function" && tool.name === name);
}
function parseToolCall2(params, toolCall) {
  const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
  let parsedArguments = null;
  if (isAutoParsableTool2(inputTool)) {
    parsedArguments = inputTool.$parseRaw(toolCall.arguments);
  } else if (inputTool?.strict) {
    parsedArguments = parseResponseFormatContent({ type: "json_schema", $parseRaw: void 0 }, toolCall.arguments);
  }
  return {
    ...toolCall,
    parsed_arguments: parsedArguments
  };
}
function needsOutputText(response, target) {
  return !Object.getOwnPropertyDescriptor(response, "output_text") || target.output_text == null;
}
function addOutputText(rsp) {
  const texts = [];
  for (const output of rsp.output) {
    if (output.type !== "message") {
      continue;
    }
    for (const content of output.content) {
      if (content.type === "output_text") {
        texts.push(content.text);
      }
    }
  }
  rsp.output_text = texts.join("");
}

// ../../../node_modules/openai/internal/responses/output-text-index.mjs
var OutputTextIndex = class {
  constructor() {
    this.capacity = 1;
    this.values = [0, 0];
    this.size = 0;
  }
  get length() {
    return this.size;
  }
  append(value) {
    if (this.size === this.capacity) {
      this.grow();
    }
    const index = this.size;
    this.size += 1;
    this.update(index, value);
  }
  update(index, value) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`missing output at index ${index}`);
    }
    let node = this.capacity + index;
    const difference = value - (this.values[node] ?? 0);
    if (difference === 0) {
      return;
    }
    while (node >= 1) {
      this.values[node] = (this.values[node] ?? 0) + difference;
      node = Math.floor(node / 2);
    }
  }
  prefixSum(end) {
    if (!Number.isSafeInteger(end) || end < 0 || end > this.size) {
      throw new RangeError(`missing output at index ${end}`);
    }
    let start = this.capacity;
    let stop = this.capacity + end;
    let sum = 0;
    while (start < stop) {
      if (start % 2 === 1) {
        sum += this.values[start] ?? 0;
        start += 1;
      }
      if (stop % 2 === 1) {
        stop -= 1;
        sum += this.values[stop] ?? 0;
      }
      start = Math.floor(start / 2);
      stop = Math.floor(stop / 2);
    }
    return sum;
  }
  grow() {
    const previousCapacity = this.capacity;
    this.capacity *= 2;
    const values = Array.from({ length: this.capacity * 2 }, () => 0);
    for (let index = 0; index < this.size; index += 1) {
      values[this.capacity + index] = this.values[previousCapacity + index] ?? 0;
    }
    for (let index = this.capacity - 1; index > 0; index -= 1) {
      values[index] = (values[index * 2] ?? 0) + (values[index * 2 + 1] ?? 0);
    }
    this.values = values;
  }
};

// ../../../node_modules/openai/internal/responses/canonical-output-text.mjs
function createCanonicalResponseContext() {
  return {
    canonicalSnapshot: void 0,
    outputTextLengths: /* @__PURE__ */ new WeakMap(),
    outputTextIndex: new OutputTextIndex()
  };
}
function getOutputText(context, output) {
  if (output.type !== "message") {
    return "";
  }
  let text = "";
  for (const content of output.content) {
    if (content.type === "output_text") {
      text += content.text;
    }
  }
  context.outputTextLengths.set(output, text.length);
  return text;
}
function ensureCanonicalOutputText(context, snapshot) {
  if (context.canonicalSnapshot === snapshot) {
    return;
  }
  const outputTextIndex = new OutputTextIndex();
  let text = "";
  for (const output of snapshot.output) {
    const outputText = getOutputText(context, output);
    text += outputText;
    outputTextIndex.append(outputText.length);
  }
  snapshot.output_text = text;
  context.outputTextIndex = outputTextIndex;
  context.canonicalSnapshot = snapshot;
}
function cloneResponse(context, response) {
  context.canonicalSnapshot = void 0;
  context.outputTextLengths = /* @__PURE__ */ new WeakMap();
  context.outputTextIndex = new OutputTextIndex();
  const snapshot = structuredClone(response);
  if (!Object.getOwnPropertyDescriptor(snapshot, "output_text") || snapshot.output_text === null || snapshot.output_text === void 0) {
    ensureCanonicalOutputText(context, snapshot);
  } else if (snapshot.output.length === 0 && snapshot.output_text === "") {
    context.canonicalSnapshot = snapshot;
  }
  return snapshot;
}
function updateCachedOutputTextLength(context, output, outputIndex, previousText, nextText) {
  const length = context.outputTextLengths.get(output);
  if (length !== void 0) {
    const nextLength = length - previousText.length + nextText.length;
    context.outputTextLengths.set(output, nextLength);
    context.outputTextIndex.update(outputIndex, nextLength);
  }
}
function replaceOutputTextSuffix(snapshot, previousText, nextText) {
  if (previousText.length === 0) {
    snapshot.output_text += nextText;
    return;
  }
  snapshot.output_text = snapshot.output_text.slice(0, snapshot.output_text.length - previousText.length) + nextText;
}
function getPrecedingContentTextLength(context, output, contentIndex, nextText) {
  if (contentIndex === void 0 || output?.type !== "message") {
    return 0;
  }
  if (contentIndex < output.content.length - contentIndex - 1) {
    let precedingContentLength = 0;
    for (let index = 0; index < contentIndex; index += 1) {
      const precedingContent = output.content[index];
      if (precedingContent?.type === "output_text") {
        precedingContentLength += precedingContent.text.length;
      }
    }
    return precedingContentLength;
  }
  let followingContentLength = 0;
  for (let index = contentIndex + 1; index < output.content.length; index += 1) {
    const followingContent = output.content[index];
    if (followingContent?.type === "output_text") {
      followingContentLength += followingContent.text.length;
    }
  }
  const outputTextLength = context.outputTextLengths.get(output) ?? getOutputText(context, output).length;
  return outputTextLength - followingContentLength - nextText.length;
}
function updateOutputText(context, snapshot, outputIndex, previousText, nextText, contentIndex) {
  if (previousText === nextText) {
    return;
  }
  const output = snapshot.output[outputIndex];
  if (outputIndex === snapshot.output.length - 1 && (contentIndex === void 0 || output?.type === "message" && contentIndex === output.content.length - 1)) {
    replaceOutputTextSuffix(snapshot, previousText, nextText);
    return;
  }
  const precedingContentLength = getPrecedingContentTextLength(context, output, contentIndex, nextText);
  const offset = context.outputTextIndex.prefixSum(outputIndex) + precedingContentLength;
  if (offset + previousText.length === snapshot.output_text.length) {
    replaceOutputTextSuffix(snapshot, previousText, nextText);
    return;
  }
  snapshot.output_text = snapshot.output_text.slice(0, offset) + nextText + snapshot.output_text.slice(offset + previousText.length);
}

// ../../../node_modules/openai/internal/responses/response-accumulator.mjs
var responseOutputIdentityIndexes = /* @__PURE__ */ new WeakMap();
function validateArrayIndex(collection, index, kind, allowAppend = false) {
  if (!Number.isSafeInteger(index) || index < 0 || index > collection.length || (index === collection.length ? !allowAppend || index in collection : !hasOwn(collection, index))) {
    throw new OpenAIError(`missing ${kind} at index ${index}`);
  }
}
function validateArrayAppend(collection, index, kind) {
  if (index !== collection.length) {
    throw new OpenAIError(`missing ${kind} at index ${index}`);
  }
  validateArrayIndex(collection, index, kind, true);
}
function getOutput(snapshot, outputIndex) {
  validateArrayIndex(snapshot.output, outputIndex, "output");
  const output = snapshot.output[outputIndex];
  if (!output) {
    throw new OpenAIError(`missing output at index ${outputIndex}`);
  }
  return output;
}
function hasRoutedOutputCallIdentity(output) {
  return output.type === "function_call" || output.type === "custom_tool_call" || output.type === "shell_call" || output.type === "shell_call_output";
}
function getOutputItemIdentityKeys(output, eventType) {
  if (!hasOwn(output, "type") || typeof output.type !== "string") {
    throw new OpenAIError(`expected an own output item type for ${eventType}`);
  }
  const optionalPlatformID = output.type === "function_call" || output.type === "custom_tool_call";
  const identities = [];
  if (hasOwn(output, "id")) {
    if (typeof output.id !== "string" || output.id.length === 0) {
      throw new OpenAIError(`expected a non-empty output item id for ${eventType}`);
    }
    identities.push(`id:${output.id}`);
  } else if (!optionalPlatformID) {
    throw new OpenAIError(`expected a non-empty output item id for ${eventType}`);
  }
  if (hasRoutedOutputCallIdentity(output)) {
    if (!hasOwn(output, "call_id") || typeof output.call_id !== "string" || output.call_id.length === 0) {
      throw new OpenAIError(`expected a non-empty output item call_id for ${eventType}`);
    }
    identities.push(`call:${output.type}:${output.call_id}`);
  }
  return identities;
}
function assertOutputItemIdentitiesAvailable(identities, keys) {
  for (const key of keys) {
    if (identities.has(key)) {
      throw new OpenAIError(`duplicate output item identity '${key}'`);
    }
  }
}
function addOutputItemIdentities(identities, keys) {
  assertOutputItemIdentitiesAvailable(identities, keys);
  for (const key of keys) {
    identities.add(key);
  }
}
function createResponseOutputIdentityIndex(snapshot) {
  const identityIndex = {
    snapshot,
    output: snapshot.output,
    length: snapshot.output.length,
    identities: /* @__PURE__ */ new Set()
  };
  for (let index = 0; index < snapshot.output.length; index += 1) {
    const output = getOutput(snapshot, index);
    addOutputItemIdentities(identityIndex.identities, getOutputItemIdentityKeys(output, "response snapshot"));
  }
  return identityIndex;
}
function getResponseOutputIdentityIndex(context, snapshot) {
  const cached = responseOutputIdentityIndexes.get(context);
  if (cached && cached.snapshot === snapshot && cached.output === snapshot.output && cached.length === snapshot.output.length) {
    return cached;
  }
  const identityIndex = createResponseOutputIdentityIndex(snapshot);
  responseOutputIdentityIndexes.set(context, identityIndex);
  return identityIndex;
}
function cloneValidatedResponse(context, response) {
  const nextContext = createCanonicalResponseContext();
  const snapshot = cloneResponse(nextContext, response);
  const identityIndex = createResponseOutputIdentityIndex(snapshot);
  context.canonicalSnapshot = nextContext.canonicalSnapshot;
  context.outputTextLengths = nextContext.outputTextLengths;
  context.outputTextIndex = nextContext.outputTextIndex;
  responseOutputIdentityIndexes.set(context, identityIndex);
  return snapshot;
}
var expectedOutputItemTypes = {
  "response.output_text.delta": "message",
  "response.output_text.done": "message",
  "response.output_text.annotation.added": "message",
  "response.refusal.delta": "message",
  "response.refusal.done": "message",
  "response.function_call_arguments.delta": "function_call",
  "response.function_call_arguments.done": "function_call",
  "response.custom_tool_call_input.delta": "custom_tool_call",
  "response.custom_tool_call_input.done": "custom_tool_call",
  "response.mcp_call_arguments.delta": "mcp_call",
  "response.mcp_call_arguments.done": "mcp_call",
  "response.mcp_call.in_progress": "mcp_call",
  "response.mcp_call.completed": "mcp_call",
  "response.mcp_call.failed": "mcp_call",
  "response.shell_call_output_content.delta": "shell_call_output",
  "response.shell_call_output_content.done": "shell_call_output",
  "response.reasoning_text.delta": "reasoning",
  "response.reasoning_text.done": "reasoning",
  "response.reasoning_summary_part.added": "reasoning",
  "response.reasoning_summary_part.done": "reasoning",
  "response.reasoning_summary_text.delta": "reasoning",
  "response.reasoning_summary_text.done": "reasoning",
  "response.code_interpreter_call_code.delta": "code_interpreter_call",
  "response.code_interpreter_call_code.done": "code_interpreter_call",
  "response.code_interpreter_call.in_progress": "code_interpreter_call",
  "response.code_interpreter_call.interpreting": "code_interpreter_call",
  "response.code_interpreter_call.completed": "code_interpreter_call",
  "response.file_search_call.in_progress": "file_search_call",
  "response.file_search_call.searching": "file_search_call",
  "response.file_search_call.completed": "file_search_call",
  "response.web_search_call.in_progress": "web_search_call",
  "response.web_search_call.searching": "web_search_call",
  "response.web_search_call.completed": "web_search_call",
  "response.image_generation_call.in_progress": "image_generation_call",
  "response.image_generation_call.generating": "image_generation_call",
  "response.image_generation_call.completed": "image_generation_call",
  "response.image_generation_call.partial_image": "image_generation_call",
  "response.mcp_list_tools.in_progress": "mcp_list_tools",
  "response.mcp_list_tools.completed": "mcp_list_tools",
  "response.mcp_list_tools.failed": "mcp_list_tools"
};
function getExpectedOutputItemType(event) {
  if (event.type === "response.content_part.added" || event.type === "response.content_part.done") {
    return event.part.type === "reasoning_text" ? "reasoning" : "message";
  }
  return expectedOutputItemTypes[event.type];
}
function validateCompletedOutputItemIdentity(event, snapshot) {
  const output = getOutput(snapshot, event.output_index);
  const replacement = event.item;
  getOutputItemIdentityKeys(output, event.type);
  getOutputItemIdentityKeys(replacement, event.type);
  if (!hasOwn(replacement, "type") || output.type !== replacement.type) {
    throw new OpenAIError(`expected output item type '${output.type}', got '${replacement.type}'`);
  }
  const outputID = hasOwn(output, "id") ? output.id : void 0;
  const replacementID = hasOwn(replacement, "id") ? replacement.id : void 0;
  if (outputID !== replacementID) {
    throw new OpenAIError(`expected output item id '${outputID}', got '${replacementID}'`);
  }
  if (hasRoutedOutputCallIdentity(output) && hasRoutedOutputCallIdentity(replacement) && output.call_id !== replacement.call_id) {
    throw new OpenAIError(`expected output item call_id '${output.call_id}', got '${replacement.call_id}'`);
  }
}
function validateOutputItemIdentity(event, snapshot, rejectInvalidShellTargets) {
  if (event.type === "response.output_item.done") {
    validateCompletedOutputItemIdentity(event, snapshot);
    return;
  }
  if (rejectInvalidShellTargets && (event.type === "response.shell_call_command.added" || event.type === "response.shell_call_command.delta" || event.type === "response.shell_call_command.done")) {
    const output2 = getOutput(snapshot, event.output_index);
    if (!hasOwn(output2, "type") || output2.type !== "shell_call") {
      throw new OpenAIError(`expected output item type 'shell_call', got '${output2.type}'`);
    }
    return;
  }
  if (event.type !== "response.content_part.added" && event.type !== "response.content_part.done" && !hasOwn(expectedOutputItemTypes, event.type)) {
    return;
  }
  const itemEvent = event;
  if (!hasOwn(event, "item_id") || typeof itemEvent.item_id !== "string" || itemEvent.item_id.length === 0) {
    throw new OpenAIError(`expected a non-empty item_id for ${event.type}`);
  }
  const output = getOutput(snapshot, itemEvent.output_index);
  const outputID = hasOwn(output, "id") ? output.id : void 0;
  if (outputID !== itemEvent.item_id) {
    throw new OpenAIError(`expected item_id '${outputID}', got '${itemEvent.item_id}'`);
  }
  const expectedType = getExpectedOutputItemType(itemEvent);
  if (output.type !== expectedType) {
    throw new OpenAIError(`expected output item type '${expectedType}', got '${output.type}'`);
  }
}
function getContent(content, contentIndex) {
  validateArrayIndex(content, contentIndex, "content");
  const part = content[contentIndex];
  if (!part) {
    throw new OpenAIError(`missing content at index ${contentIndex}`);
  }
  return part;
}
function getShellOutputContent(snapshot, output, commandIndex) {
  const shellCall = snapshot.output.find((item) => item.type === "shell_call" && item.call_id === output.call_id);
  if (shellCall) {
    validateArrayIndex(shellCall.action.commands, commandIndex, "command");
  } else {
    validateArrayIndex(output.output, commandIndex, "content", true);
  }
  while (output.output.length <= commandIndex) {
    output.output.push({
      stdout: "",
      stderr: "",
      outcome: { type: "exit", exit_code: 0 }
    });
  }
  return getContent(output.output, commandIndex);
}
function createSupportedResponseEventTypes(eventTypes) {
  return new Set(eventTypes);
}
var supportedResponseEventTypes = createSupportedResponseEventTypes([
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_text.annotation.added",
  "response.refusal.delta",
  "response.refusal.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
  "response.mcp_call_arguments.delta",
  "response.mcp_call_arguments.done",
  "response.shell_call_command.added",
  "response.shell_call_command.done",
  "response.shell_call_command.delta",
  "response.shell_call_output_content.delta",
  "response.shell_call_output_content.done",
  "response.reasoning_text.delta",
  "response.reasoning_text.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.code_interpreter_call_code.delta",
  "response.code_interpreter_call_code.done",
  "response.code_interpreter_call.in_progress",
  "response.code_interpreter_call.interpreting",
  "response.code_interpreter_call.completed",
  "response.file_search_call.in_progress",
  "response.file_search_call.searching",
  "response.file_search_call.completed",
  "response.web_search_call.in_progress",
  "response.web_search_call.searching",
  "response.web_search_call.completed",
  "response.image_generation_call.in_progress",
  "response.image_generation_call.generating",
  "response.image_generation_call.completed",
  "response.mcp_call.in_progress",
  "response.mcp_call.completed",
  "response.mcp_call.failed",
  "response.created",
  "response.queued",
  "response.in_progress",
  "response.completed",
  "response.failed",
  "response.incomplete",
  "response.audio.delta",
  "response.audio.done",
  "response.audio.transcript.delta",
  "response.audio.transcript.done",
  "response.image_generation_call.partial_image",
  "response.mcp_list_tools.in_progress",
  "response.mcp_list_tools.completed",
  "response.mcp_list_tools.failed",
  "keepalive",
  "error"
]);
function assertNever3(_value) {
  throw new OpenAIError("Unhandled response stream event: unknown");
}
var responseEventRoutingFields = [
  "item_id",
  "output_index",
  "content_index",
  "annotation_index",
  "command_index",
  "summary_index"
];
function sanitizeResponseEvent(event) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(event, "type");
  } catch {
    return assertNever3(event);
  }
  const type = descriptor?.value;
  if (typeof type !== "string" || !supportedResponseEventTypes.has(type)) {
    return assertNever3(event);
  }
  const stableValues = /* @__PURE__ */ new Map([["type", type]]);
  const itemScoped = type === "response.output_item.added" || type === "response.output_item.done" || type === "response.content_part.added" || type === "response.content_part.done" || type === "response.shell_call_command.added" || type === "response.shell_call_command.delta" || type === "response.shell_call_command.done" || hasOwn(expectedOutputItemTypes, type);
  if (itemScoped) {
    try {
      for (const field of responseEventRoutingFields) {
        const routingDescriptor = Object.getOwnPropertyDescriptor(event, field);
        stableValues.set(field, routingDescriptor ? Reflect.get(event, field, event) : void 0);
      }
      if (type === "response.output_item.done") {
        stableValues.set("item", structuredClone(Reflect.get(event, "item", event)));
      } else if (type === "response.content_part.added" || type === "response.content_part.done") {
        stableValues.set("part", structuredClone(Reflect.get(event, "part", event)));
      }
    } catch {
      return assertNever3(event);
    }
  }
  return new Proxy(event, {
    get(target, property) {
      return stableValues.has(property) ? stableValues.get(property) : Reflect.get(target, property, target);
    }
  });
}
function accumulateOutputItemEvent(event, snapshot, context) {
  switch (event.type) {
    case "response.output_item.added": {
      validateArrayAppend(snapshot.output, event.output_index, "output");
      const identityIndex = getResponseOutputIdentityIndex(context, snapshot);
      const output = structuredClone(event.item);
      const identities = getOutputItemIdentityKeys(output, event.type);
      assertOutputItemIdentitiesAvailable(identityIndex.identities, identities);
      if (output.type === "message") {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output.push(output);
      addOutputItemIdentities(identityIndex.identities, identities);
      identityIndex.length = snapshot.output.length;
      const text = getOutputText(context, output);
      if (context.canonicalSnapshot === snapshot) {
        context.outputTextIndex.append(text.length);
      }
      if (text) {
        snapshot.output_text += text;
      }
      return true;
    }
    case "response.output_item.done": {
      const output = getOutput(snapshot, event.output_index);
      const previousText = getOutputText(context, output);
      const replacement = event.item;
      if (output.type === "message" || replacement.type === "message") {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output[event.output_index] = replacement;
      const nextText = getOutputText(context, replacement);
      if (context.canonicalSnapshot === snapshot) {
        context.outputTextIndex.update(event.output_index, nextText.length);
      }
      updateOutputText(context, snapshot, event.output_index, previousText, nextText);
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateContentPartAddedEvent(event, snapshot, context) {
  switch (event.type) {
    case "response.content_part.added": {
      const output = getOutput(snapshot, event.output_index);
      const { type } = output;
      const { part } = event;
      if (type === "message" && part.type !== "reasoning_text") {
        validateArrayAppend(output.content, event.content_index, "content");
        const content = part;
        if (content.type === "output_text") {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content.push(content);
        if (content.type === "output_text") {
          updateCachedOutputTextLength(context, output, event.output_index, "", content.text);
          updateOutputText(context, snapshot, event.output_index, "", content.text, event.content_index);
        }
      } else if (type === "reasoning" && part.type === "reasoning_text") {
        const content = output.content ?? [];
        validateArrayAppend(content, event.content_index, "content");
        if (!output.content) {
          output.content = content;
        }
        content.push(part);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateContentPartDoneEvent(event, snapshot, context) {
  switch (event.type) {
    case "response.content_part.done": {
      const output = getOutput(snapshot, event.output_index);
      const { part } = event;
      if (output.type === "message" && part.type !== "reasoning_text") {
        const content = getContent(output.content, event.content_index);
        const previousText = content.type === "output_text" ? content.text : "";
        const replacement = part;
        if (content.type === "output_text" || replacement.type === "output_text") {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content[event.content_index] = replacement;
        const nextText = replacement.type === "output_text" ? replacement.text : "";
        updateCachedOutputTextLength(context, output, event.output_index, previousText, nextText);
        updateOutputText(context, snapshot, event.output_index, previousText, nextText, event.content_index);
      } else if (output.type === "reasoning" && part.type === "reasoning_text") {
        const { content } = output;
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        getContent(content, event.content_index);
        content[event.content_index] = part;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateOutputTextEvent(event, snapshot, context) {
  switch (event.type) {
    case "response.output_text.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "message") {
        const content = getContent(output.content, event.content_index);
        if (content.type !== "output_text") {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = previousText + event.delta;
        updateCachedOutputTextLength(context, output, event.output_index, previousText, content.text);
        if (event.output_index === snapshot.output.length - 1 && event.content_index === output.content.length - 1) {
          snapshot.output_text += event.delta;
        } else {
          updateOutputText(context, snapshot, event.output_index, previousText, content.text, event.content_index);
        }
      }
      return true;
    }
    case "response.output_text.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "message") {
        const content = getContent(output.content, event.content_index);
        if (content.type !== "output_text") {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = event.text;
        updateCachedOutputTextLength(context, output, event.output_index, previousText, event.text);
        updateOutputText(context, snapshot, event.output_index, previousText, event.text, event.content_index);
      }
      return true;
    }
    case "response.output_text.annotation.added": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "message") {
        const content = getContent(output.content, event.content_index);
        if (content.type !== "output_text") {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        validateArrayIndex(content.annotations, event.annotation_index, "annotation", true);
        content.annotations[event.annotation_index] = structuredClone(event.annotation);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateRefusalAndArgumentsEvent(event, snapshot) {
  switch (event.type) {
    case "response.refusal.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "message") {
        const content = getContent(output.content, event.content_index);
        if (content.type !== "refusal") {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal += event.delta;
      }
      return true;
    }
    case "response.refusal.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "message") {
        const content = getContent(output.content, event.content_index);
        if (content.type !== "refusal") {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal = event.refusal;
      }
      return true;
    }
    case "response.function_call_arguments.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "function_call") {
        output.arguments += event.delta;
      }
      return true;
    }
    case "response.function_call_arguments.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "function_call") {
        output.arguments = event.arguments;
      }
      return true;
    }
    case "response.custom_tool_call_input.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "custom_tool_call") {
        output.input += event.delta;
      }
      return true;
    }
    case "response.custom_tool_call_input.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "custom_tool_call") {
        output.input = event.input;
      }
      return true;
    }
    case "response.mcp_call_arguments.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "mcp_call") {
        output.arguments += event.delta;
      }
      return true;
    }
    case "response.mcp_call_arguments.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "mcp_call") {
        output.arguments = event.arguments;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateShellEvent(event, snapshot) {
  switch (event.type) {
    case "response.shell_call_command.added":
    case "response.shell_call_command.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "shell_call") {
        const allowAppend = event.type === "response.shell_call_command.added";
        validateArrayIndex(output.action.commands, event.command_index, "command", allowAppend);
        output.action.commands[event.command_index] = event.command;
      }
      return true;
    }
    case "response.shell_call_command.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "shell_call") {
        validateArrayIndex(output.action.commands, event.command_index, "command");
        output.action.commands[event.command_index] += event.delta;
      }
      return true;
    }
    case "response.shell_call_output_content.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "shell_call_output") {
        const content = getShellOutputContent(snapshot, output, event.command_index);
        content.stdout += event.delta.stdout ?? "";
        content.stderr += event.delta.stderr ?? "";
      }
      return true;
    }
    case "response.shell_call_output_content.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "shell_call_output") {
        const content = getContent(event.output, 0);
        getShellOutputContent(snapshot, output, event.command_index);
        output.output[event.command_index] = structuredClone(content);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateReasoningEvent(event, snapshot) {
  switch (event.type) {
    case "response.reasoning_text.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "reasoning") {
        if (!output.content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        const content = getContent(output.content, event.content_index);
        if (content.type !== "reasoning_text") {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text += event.delta;
      }
      return true;
    }
    case "response.reasoning_text.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "reasoning") {
        if (!output.content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        const content = getContent(output.content, event.content_index);
        if (content.type !== "reasoning_text") {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text = event.text;
      }
      return true;
    }
    case "response.reasoning_summary_part.added": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "reasoning") {
        validateArrayAppend(output.summary, event.summary_index, "content");
        output.summary.push(structuredClone(event.part));
      }
      return true;
    }
    case "response.reasoning_summary_part.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "reasoning") {
        getContent(output.summary, event.summary_index);
        output.summary[event.summary_index] = structuredClone(event.part);
      }
      return true;
    }
    case "response.reasoning_summary_text.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "reasoning") {
        const part = getContent(output.summary, event.summary_index);
        part.text += event.delta;
      }
      return true;
    }
    case "response.reasoning_summary_text.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "reasoning") {
        const part = getContent(output.summary, event.summary_index);
        part.text = event.text;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateCodeInterpreterEvent(event, snapshot) {
  switch (event.type) {
    case "response.code_interpreter_call_code.delta": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "code_interpreter_call") {
        output.code = (output.code ?? "") + event.delta;
      }
      return true;
    }
    case "response.code_interpreter_call_code.done": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "code_interpreter_call") {
        output.code = event.code;
      }
      return true;
    }
    case "response.code_interpreter_call.in_progress": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "code_interpreter_call") {
        output.status = "in_progress";
      }
      return true;
    }
    case "response.code_interpreter_call.interpreting": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "code_interpreter_call") {
        output.status = "interpreting";
      }
      return true;
    }
    case "response.code_interpreter_call.completed": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "code_interpreter_call") {
        output.status = "completed";
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateSearchStatusEvent(event, snapshot) {
  switch (event.type) {
    case "response.file_search_call.in_progress": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "file_search_call") {
        output.status = "in_progress";
      }
      return true;
    }
    case "response.file_search_call.searching": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "file_search_call") {
        output.status = "searching";
      }
      return true;
    }
    case "response.file_search_call.completed": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "file_search_call") {
        output.status = "completed";
      }
      return true;
    }
    case "response.web_search_call.in_progress": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "web_search_call") {
        output.status = "in_progress";
      }
      return true;
    }
    case "response.web_search_call.searching": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "web_search_call") {
        output.status = "searching";
      }
      return true;
    }
    case "response.web_search_call.completed": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "web_search_call") {
        output.status = "completed";
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function accumulateImageAndMcpStatusEvent(event, snapshot) {
  switch (event.type) {
    case "response.image_generation_call.in_progress": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "image_generation_call") {
        output.status = "in_progress";
      }
      return true;
    }
    case "response.image_generation_call.generating": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "image_generation_call") {
        output.status = "generating";
      }
      return true;
    }
    case "response.image_generation_call.completed": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "image_generation_call") {
        output.status = "completed";
      }
      return true;
    }
    case "response.mcp_call.in_progress": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "mcp_call") {
        output.status = "in_progress";
      }
      return true;
    }
    case "response.mcp_call.completed": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "mcp_call") {
        output.status = "completed";
      }
      return true;
    }
    case "response.mcp_call.failed": {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === "mcp_call") {
        output.status = "failed";
      }
      return true;
    }
    default: {
      return false;
    }
  }
}
function isResponseLifecycleEvent(event) {
  switch (event.type) {
    case "response.created":
    case "response.queued":
    case "response.in_progress":
    case "response.completed":
    case "response.failed":
    case "response.incomplete": {
      return true;
    }
    default: {
      return false;
    }
  }
}
function isIgnoredResponseEvent(event) {
  switch (event.type) {
    case "response.audio.delta":
    case "response.audio.done":
    case "response.audio.transcript.delta":
    case "response.audio.transcript.done":
    case "response.image_generation_call.partial_image":
    case "response.mcp_list_tools.in_progress":
    case "response.mcp_list_tools.completed":
    case "response.mcp_list_tools.failed":
    case "keepalive":
    case "error": {
      return true;
    }
    default: {
      return false;
    }
  }
}
function createResponseContext() {
  return createCanonicalResponseContext();
}
function accumulateResponseWithContext(event, snapshot, context, rejectInvalidShellTargets = false, onSanitizedEvent) {
  const dispatchEvent = sanitizeResponseEvent(event);
  if (onSanitizedEvent && dispatchEvent.type !== "keepalive") {
    onSanitizedEvent(dispatchEvent);
  }
  if (!snapshot) {
    if (dispatchEvent.type !== "response.created") {
      throw new OpenAIError(`When snapshot hasn't been set yet, expected 'response.created' event, got ${dispatchEvent.type}`);
    }
    return cloneValidatedResponse(context, dispatchEvent.response);
  }
  validateOutputItemIdentity(dispatchEvent, snapshot, rejectInvalidShellTargets);
  if (accumulateOutputItemEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateContentPartAddedEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateContentPartDoneEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateOutputTextEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateRefusalAndArgumentsEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateShellEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateReasoningEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateCodeInterpreterEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateSearchStatusEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateImageAndMcpStatusEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (isResponseLifecycleEvent(dispatchEvent)) {
    return cloneValidatedResponse(context, dispatchEvent.response);
  }
  if (isIgnoredResponseEvent(dispatchEvent)) {
    return snapshot;
  }
  return assertNever3(dispatchEvent);
}

// ../../../node_modules/openai/lib/responses/ResponseStream.mjs
var _ResponseStream_instances;
var _ResponseStream_params;
var _ResponseStream_currentResponseSnapshot;
var _ResponseStream_finalResponse;
var _ResponseStream_accumulatorContext;
var _ResponseStream_beginRequest;
var _ResponseStream_addEvent;
var _ResponseStream_endRequest;
var ResponseStream = class _ResponseStream extends EventStream {
  /** Creates an unstarted stream, retaining request parameters for structured-output parsing. */
  constructor(params) {
    super();
    _ResponseStream_instances.add(this);
    _ResponseStream_params.set(this, void 0);
    _ResponseStream_currentResponseSnapshot.set(this, void 0);
    _ResponseStream_finalResponse.set(this, void 0);
    _ResponseStream_accumulatorContext.set(this, createResponseContext());
    __classPrivateFieldSet(this, _ResponseStream_params, params, "f");
  }
  /** Starts a new response stream or replays an existing response by its identifier. */
  static createResponse(client, params, options) {
    const runner = new _ResponseStream(params);
    runner._run(() => runner._createOrRetrieveResponse(client, params, {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: "stream" }
    }));
    return runner;
  }
  /** Consumes serialized response events from a readable stream in another runtime. */
  static fromReadableStream(stream) {
    const runner = new _ResponseStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  async _createOrRetrieveResponse(client, params, options) {
    this._listenForAbort(options?.signal);
    __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_beginRequest).call(this);
    let stream;
    let starting_after = null;
    if ("response_id" in params) {
      stream = await client.responses.retrieve(params.response_id, { stream: true }, { ...options, signal: this.controller.signal, stream: true });
      starting_after = params.starting_after ?? null;
    } else {
      stream = await client.responses.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    }
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_addEvent).call(this, event, starting_after);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_endRequest).call(this);
  }
  async _fromReadableStream(readableStream, options) {
    this._listenForAbort(options?.signal);
    __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_beginRequest).call(this);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    for await (const event of stream) {
      __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_addEvent).call(this, event, null);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_endRequest).call(this);
  }
  /** Iterates over response events; stopping iteration early aborts the underlying request. */
  [(_ResponseStream_params = /* @__PURE__ */ new WeakMap(), _ResponseStream_currentResponseSnapshot = /* @__PURE__ */ new WeakMap(), _ResponseStream_finalResponse = /* @__PURE__ */ new WeakMap(), _ResponseStream_accumulatorContext = /* @__PURE__ */ new WeakMap(), _ResponseStream_instances = /* @__PURE__ */ new WeakSet(), _ResponseStream_beginRequest = function _ResponseStream_beginRequest2() {
    if (this.ended) {
      return;
    }
    __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, void 0, "f");
    __classPrivateFieldSet(this, _ResponseStream_accumulatorContext, createResponseContext(), "f");
  }, _ResponseStream_addEvent = function _ResponseStream_addEvent2(event, starting_after) {
    if (this.ended) {
      return;
    }
    const maybeEmit = (name, event2) => {
      if (starting_after == null || event2.sequence_number > starting_after) {
        this._emit(name, event2);
      }
    };
    if (event.type === "error") {
      const error = "error" in event && typeof event.error === "object" && event.error !== null ? event.error : event;
      throw new APIError(void 0, error, event.message, void 0);
    }
    let dispatchEvent = event;
    const response = accumulateResponseWithContext(event, __classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f"), __classPrivateFieldGet(this, _ResponseStream_accumulatorContext, "f"), true, (sanitizedEvent) => {
      dispatchEvent = sanitizedEvent;
    });
    __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, response, "f");
    maybeEmit("event", event);
    switch (dispatchEvent.type) {
      case "response.output_text.delta": {
        const output = response.output[dispatchEvent.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${dispatchEvent.output_index}`);
        }
        if (output.type === "message") {
          const content = output.content[dispatchEvent.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${dispatchEvent.content_index}`);
          }
          if (content.type !== "output_text") {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }
          maybeEmit("response.output_text.delta", {
            ...dispatchEvent,
            type: dispatchEvent.type,
            item_id: dispatchEvent.item_id,
            output_index: dispatchEvent.output_index,
            content_index: dispatchEvent.content_index,
            snapshot: content.text
          });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const output = response.output[dispatchEvent.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${dispatchEvent.output_index}`);
        }
        if (output.type === "function_call") {
          maybeEmit("response.function_call_arguments.delta", {
            ...dispatchEvent,
            type: dispatchEvent.type,
            item_id: dispatchEvent.item_id,
            output_index: dispatchEvent.output_index,
            snapshot: output.arguments
          });
        }
        break;
      }
      default: {
        maybeEmit(dispatchEvent.type, event);
        break;
      }
    }
  }, _ResponseStream_endRequest = function _ResponseStream_endRequest2() {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any events`);
    }
    __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, void 0, "f");
    __classPrivateFieldSet(this, _ResponseStream_accumulatorContext, createResponseContext(), "f");
    const parsedResponse = finalizeResponse(snapshot, __classPrivateFieldGet(this, _ResponseStream_params, "f"));
    __classPrivateFieldSet(this, _ResponseStream_finalResponse, parsedResponse, "f");
    return parsedResponse;
  }, Symbol.asyncIterator)]() {
    return this._createIterator((push) => {
      const onEvent = (event) => push(event);
      this.on("event", onEvent);
      return () => this.off("event", onEvent);
    }, { onReturn: () => this.abort() });
  }
  /**
   * Waits for the stream to end and returns its latest accumulated response.
   *
   * A clean end after at least one response event resolves even when the response is
   * incomplete. Network errors, cancellation, and streams without a response reject.
   */
  async finalResponse() {
    await this.done();
    const response = __classPrivateFieldGet(this, _ResponseStream_finalResponse, "f");
    if (!response) {
      throw new OpenAIError("stream ended without producing a Response");
    }
    return response;
  }
};
function finalizeResponse(snapshot, params) {
  return maybeParseResponse(snapshot, params);
}

// ../../../node_modules/openai/resources/responses/input-items.mjs
var InputItems2 = class extends APIResource {
  /**
   * Returns a list of input items for a given response.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const responseItem of client.responses.inputItems.list(
   *   'response_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(responseID, query = {}, options) {
    return this._client.getAPIList(path`/responses/${responseID}/input_items`, CursorPage, { query, ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/resources/responses/input-tokens.mjs
var InputTokens2 = class extends APIResource {
  /**
   * Returns input token counts of the request.
   *
   * Returns an object with `object` set to `response.input_tokens` and an
   * `input_tokens` count.
   *
   * @example
   * ```ts
   * const response = await client.responses.inputTokens.count();
   * ```
   */
  count(body = {}, options) {
    return this._client.post("/responses/input_tokens", {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/responses/responses.mjs
var Responses2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.inputItems = new InputItems2(this._client);
    this.inputTokens = new InputTokens2(this._client);
  }
  create(body, options) {
    return this._client.post("/responses", {
      body,
      ...options,
      stream: body.stream ?? false,
      __security: { bearerAuth: true }
    })._thenUnwrap((rsp) => {
      if ("object" in rsp && rsp.object === "response") {
        addOutputText(rsp);
      }
      return rsp;
    });
  }
  retrieve(responseID, query = {}, options) {
    return this._client.get(path`/responses/${responseID}`, {
      query,
      ...options,
      stream: query?.stream ?? false,
      __security: { bearerAuth: true }
    })._thenUnwrap((rsp) => {
      if ("object" in rsp && rsp.object === "response") {
        addOutputText(rsp);
      }
      return rsp;
    });
  }
  /**
   * Deletes a model response with the given ID.
   *
   * @example
   * ```ts
   * await client.responses.delete(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  delete(responseID, options) {
    return this._client.delete(path`/responses/${responseID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  parse(body, options) {
    return this._client.responses.create(body, options)._thenUnwrap((response) => parseResponse(response, body));
  }
  /**
   * Creates a model response stream
   */
  stream(body, options) {
    return ResponseStream.createResponse(this._client, body, options);
  }
  /**
   * Cancels a model response with the given ID. Only responses created with the
   * `background` parameter set to `true` can be cancelled.
   * [Learn more](https://platform.openai.com/docs/guides/background).
   *
   * @example
   * ```ts
   * const response = await client.responses.cancel(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  cancel(responseID, options) {
    return this._client.post(path`/responses/${responseID}/cancel`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Compact a conversation. Returns a compacted response object.
   *
   * Learn when and how to compact long-running conversations in the
   * [conversation state guide](https://platform.openai.com/docs/guides/conversation-state#managing-the-context-window).
   * For ZDR-compatible compaction details, see
   * [Compaction (advanced)](https://platform.openai.com/docs/guides/conversation-state#compaction-advanced).
   *
   * @example
   * ```ts
   * const compactedResponse = await client.responses.compact({
   *   model: 'gpt-6-astra',
   * });
   * ```
   */
  compact(body, options) {
    return this._client.post("/responses/compact", { body, ...options, __security: { bearerAuth: true } });
  }
};
Responses2.InputItems = InputItems2;
Responses2.InputTokens = InputTokens2;

// ../../../node_modules/openai/resources/safety/alerts.mjs
var Alerts = class extends APIResource {
  /**
   * Get a safety alert belonging to the authenticated API project.
   */
  retrieve(id, options) {
    return this._client.get(path`/safety/alerts/${id}`, { ...options, __security: { bearerAuth: true } });
  }
};

// ../../../node_modules/openai/resources/safety/safety.mjs
var Safety = class extends APIResource {
  constructor() {
    super(...arguments);
    this.alerts = new Alerts(this._client);
  }
};
Safety.Alerts = Alerts;

// ../../../node_modules/openai/resources/skills/content.mjs
var Content2 = class extends APIResource {
  /**
   * Download a skill zip bundle by its ID.
   */
  retrieve(skillID, options) {
    return this._client.get(path`/skills/${skillID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/skills/versions/content.mjs
var Content3 = class extends APIResource {
  /**
   * Download a skill version zip bundle.
   */
  retrieve(version, params, options) {
    const { skill_id } = params;
    return this._client.get(path`/skills/${skill_id}/versions/${version}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/skills/versions/versions.mjs
var Versions = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content3(this._client);
  }
  /**
   * Create a new immutable skill version.
   */
  create(skillID, body = {}, options) {
    return this._client.post(path`/skills/${skillID}/versions`, maybeMultipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client, {
      stripFilenames: false
    }));
  }
  /**
   * Get a specific skill version.
   */
  retrieve(version, params, options) {
    const { skill_id } = params;
    return this._client.get(path`/skills/${skill_id}/versions/${version}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List skill versions for a skill.
   */
  list(skillID, query = {}, options) {
    return this._client.getAPIList(path`/skills/${skillID}/versions`, CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a skill version.
   */
  delete(version, params, options) {
    const { skill_id } = params;
    return this._client.delete(path`/skills/${skill_id}/versions/${version}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
};
Versions.Content = Content3;

// ../../../node_modules/openai/resources/skills/skills.mjs
var Skills = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content2(this._client);
    this.versions = new Versions(this._client);
  }
  /**
   * Create a new skill.
   */
  create(body = {}, options) {
    return this._client.post("/skills", maybeMultipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client, {
      stripFilenames: false
    }));
  }
  /**
   * Get a skill by its ID.
   */
  retrieve(skillID, options) {
    return this._client.get(path`/skills/${skillID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Update the default version pointer for a skill.
   */
  update(skillID, body, options) {
    return this._client.post(path`/skills/${skillID}`, {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * List all skills for the current project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/skills", CursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a skill by its ID.
   */
  delete(skillID, options) {
    return this._client.delete(path`/skills/${skillID}`, { ...options, __security: { bearerAuth: true } });
  }
};
Skills.Content = Content2;
Skills.Versions = Versions;

// ../../../node_modules/openai/resources/uploads/parts.mjs
var Parts = class extends APIResource {
  /**
   * Adds a
   * [Part](https://platform.openai.com/docs/api-reference/uploads/part-object) to an
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object.
   * A Part represents a chunk of bytes from the file you are trying to upload.
   *
   * Each Part can be at most 64 MB, and you can add Parts until you hit the Upload
   * maximum of 8 GB.
   *
   * It is possible to add multiple Parts in parallel. You can decide the intended
   * order of the Parts when you
   * [complete the Upload](https://platform.openai.com/docs/api-reference/uploads/complete).
   */
  create(uploadID, body, options) {
    return this._client.post(path`/uploads/${uploadID}/parts`, multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
};

// ../../../node_modules/openai/resources/uploads/uploads.mjs
var Uploads = class extends APIResource {
  constructor() {
    super(...arguments);
    this.parts = new Parts(this._client);
  }
  /**
   * Creates an intermediate
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object
   * that you can add
   * [Parts](https://platform.openai.com/docs/api-reference/uploads/part-object) to.
   * Currently, an Upload can accept at most 8 GB in total and expires after an hour
   * after you create it.
   *
   * Once you complete the Upload, we will create a
   * [File](https://platform.openai.com/docs/api-reference/files/object) object that
   * contains all the parts you uploaded. This File is usable in the rest of our
   * platform as a regular File object.
   *
   * For certain `purpose` values, the correct `mime_type` must be specified. Please
   * refer to documentation for the
   * [supported MIME types for your use case](https://platform.openai.com/docs/assistants/tools/file-search#supported-files).
   *
   * For guidance on the proper filename extensions for each purpose, please follow
   * the documentation on
   * [creating a File](https://platform.openai.com/docs/api-reference/files/create).
   *
   * Returns the Upload object with status `pending`.
   */
  create(body, options) {
    return this._client.post("/uploads", { body, ...options, __security: { bearerAuth: true } });
  }
  /**
   * Cancels the Upload. No Parts may be added after an Upload is cancelled.
   *
   * Returns the Upload object with status `cancelled`.
   */
  cancel(uploadID, options) {
    return this._client.post(path`/uploads/${uploadID}/cancel`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Completes the
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object).
   *
   * Within the returned Upload object, there is a nested
   * [File](https://platform.openai.com/docs/api-reference/files/object) object that
   * is ready to use in the rest of the platform.
   *
   * You can specify the order of the Parts by passing in an ordered list of the Part
   * IDs.
   *
   * The number of bytes uploaded upon completion must match the number of bytes
   * initially specified when creating the Upload object. No Parts may be added after
   * an Upload is completed. Returns the Upload object with status `completed`,
   * including an additional `file` property containing the created usable File
   * object.
   */
  complete(uploadID, body, options) {
    return this._client.post(path`/uploads/${uploadID}/complete`, {
      body,
      ...options,
      __security: { bearerAuth: true }
    });
  }
};
Uploads.Parts = Parts;

// ../../../node_modules/openai/lib/vector-store-polling.mjs
function pollVectorStoreFile(resource, vectorStoreID, fileID, options) {
  return pollWithResponse((headers) => resource.retrieve(fileID, { vector_store_id: vectorStoreID }, { ...options, headers }), ["in_progress"], ["failed", "completed"], options);
}
function pollVectorStoreFileBatch(resource, vectorStoreID, batchID, options) {
  return pollWithResponse((headers) => resource.retrieve(batchID, { vector_store_id: vectorStoreID }, { ...options, headers }), ["in_progress"], ["failed", "cancelled", "completed"], options);
}

// ../../../node_modules/openai/lib/Util.mjs
var allSettledWithThrow = async (promises) => {
  const results = await Promise.allSettled(promises);
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length) {
    throw Object.defineProperty(new Error(`${rejected.length} promise(s) failed`), "rejections", {
      configurable: true,
      value: rejected.map(({ reason }) => reason),
      writable: true
    });
  }
  const values = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      values.push(result.value);
    }
  }
  return values;
};

// ../../../node_modules/openai/lib/vector-store-upload.mjs
async function uploadAndPollVectorStoreFileBatch(resource, client, vectorStoreId, files, fileIds, options) {
  if (files === null || files === void 0 || files.length === 0) {
    throw new Error("No `files` provided to process. If you've already uploaded files you should use `.createAndPoll()` instead");
  }
  const configuredConcurrency = options?.maxConcurrency ?? 5;
  const concurrencyLimit = Math.min(configuredConcurrency, files.length);
  const fileIterator = files.values();
  const allFileIds = [...fileIds];
  async function processFiles(iterator) {
    for (const item of iterator) {
      const fileObj = await client.files.create({ file: item, purpose: "assistants" }, options);
      allFileIds.push(fileObj.id);
    }
  }
  const workers = [];
  workers.length = concurrencyLimit;
  for (let index = 0; index < workers.length; index += 1) {
    workers[index] = processFiles(fileIterator);
  }
  await allSettledWithThrow(workers);
  return await resource.createAndPoll(vectorStoreId, { file_ids: allFileIds }, options);
}

// ../../../node_modules/openai/resources/vector-stores/file-batches.mjs
var FileBatches = class extends APIResource {
  /**
   * Create a vector store file batch.
   */
  create(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}/file_batches`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieves a vector store file batch.
   */
  retrieve(batchID, params, options) {
    const { vector_store_id } = params;
    return this._client.get(path`/vector_stores/${vector_store_id}/file_batches/${batchID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Cancel a vector store file batch. This attempts to cancel the processing of
   * files in this batch as soon as possible.
   */
  cancel(batchID, params, options) {
    const { vector_store_id } = params;
    return this._client.post(path`/vector_stores/${vector_store_id}/file_batches/${batchID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Create a vector store batch and poll until all files have been processed.
   */
  async createAndPoll(vectorStoreId, body, options) {
    const batch = await this.create(vectorStoreId, body, options);
    return await this.poll(vectorStoreId, batch.id, options);
  }
  /**
   * Returns a list of vector store files in a batch.
   */
  listFiles(batchID, params, options) {
    const { vector_store_id, ...query } = params;
    return this._client.getAPIList(path`/vector_stores/${vector_store_id}/file_batches/${batchID}/files`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Wait for the given file batch to be processed.
   *
   * Note: this will return even if one of the files failed to process, you need to
   * check batch.file_counts.failed_count to handle this case.
   */
  async poll(vectorStoreID, batchID, options) {
    return await pollVectorStoreFileBatch(this, vectorStoreID, batchID, options);
  }
  /**
   * Uploads the given files concurrently and then creates a vector store file batch.
   *
   * The concurrency limit is configurable using the `maxConcurrency` parameter.
   */
  async uploadAndPoll(vectorStoreId, { files, fileIds = [] }, options) {
    return await uploadAndPollVectorStoreFileBatch(this, this._client, vectorStoreId, files, fileIds, options);
  }
};

// ../../../node_modules/openai/resources/vector-stores/files.mjs
var Files3 = class extends APIResource {
  /**
   * Create a vector store file by attaching a
   * [File](https://platform.openai.com/docs/api-reference/files) to a
   * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object).
   */
  create(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}/files`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieves a vector store file.
   */
  retrieve(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.get(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Update attributes on a vector store file.
   */
  update(fileID, params, options) {
    const { vector_store_id, ...body } = params;
    return this._client.post(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Returns a list of vector store files.
   */
  list(vectorStoreID, query = {}, options) {
    return this._client.getAPIList(path`/vector_stores/${vectorStoreID}/files`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a vector store file. This will remove the file from the vector store but
   * the file itself will not be deleted. To delete the file, use the
   * [delete file](https://platform.openai.com/docs/api-reference/files/delete)
   * endpoint.
   */
  delete(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.delete(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Attach a file to the given vector store and wait for it to be processed.
   */
  async createAndPoll(vectorStoreId, body, options) {
    const file = await this.create(vectorStoreId, body, options);
    return await this.poll(vectorStoreId, file.id, options);
  }
  /**
   * Wait for the vector store file to finish processing.
   *
   * Note: this will return even if the file failed to process, you need to check
   * file.last_error and file.status to handle these cases
   */
  async poll(vectorStoreID, fileID, options) {
    return await pollVectorStoreFile(this, vectorStoreID, fileID, options);
  }
  /**
   * Upload a file to the `files` API and then attach it to the given vector store.
   *
   * Note the file will be asynchronously processed (you can use the alternative
   * polling helper method to wait for processing to complete).
   */
  async upload(vectorStoreId, file, options) {
    const fileInfo = await this._client.files.create({ file, purpose: "assistants" }, options);
    return this.create(vectorStoreId, { file_id: fileInfo.id }, options);
  }
  /**
   * Add a file to a vector store and poll until processing is complete.
   */
  async uploadAndPoll(vectorStoreId, file, options) {
    const fileInfo = await this.upload(vectorStoreId, file, options);
    return await this.poll(vectorStoreId, fileInfo.id, options);
  }
  /**
   * Retrieve the parsed contents of a vector store file.
   */
  content(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.getAPIList(path`/vector_stores/${vector_store_id}/files/${fileID}/content`, Page, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};

// ../../../node_modules/openai/resources/vector-stores/vector-stores.mjs
var VectorStores = class extends APIResource {
  constructor() {
    super(...arguments);
    this.files = new Files3(this._client);
    this.fileBatches = new FileBatches(this._client);
  }
  /**
   * Create a vector store.
   */
  create(body, options) {
    return this._client.post("/vector_stores", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Retrieves a vector store.
   */
  retrieve(vectorStoreID, options) {
    return this._client.get(path`/vector_stores/${vectorStoreID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Modifies a vector store.
   */
  update(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Returns a list of vector stores.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/vector_stores", CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Delete a vector store.
   */
  delete(vectorStoreID, options) {
    return this._client.delete(path`/vector_stores/${vectorStoreID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
  /**
   * Search a vector store for relevant chunks based on a query and file attributes
   * filter.
   */
  search(vectorStoreID, body, options) {
    return this._client.getAPIList(path`/vector_stores/${vectorStoreID}/search`, Page, {
      body,
      method: "post",
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      __security: { bearerAuth: true }
    });
  }
};
VectorStores.Files = Files3;
VectorStores.FileBatches = FileBatches;

// ../../../node_modules/openai/resources/videos.mjs
var Videos = class extends APIResource {
  /**
   * Create a new video generation job from a prompt and optional reference assets.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  create(body, options) {
    return this._client.post("/videos", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  /**
   * Fetch the latest metadata for a generated video.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  retrieve(videoID, options) {
    return this._client.get(path`/videos/${videoID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * List recently generated videos for the current project.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/videos", ConversationCursorPage, {
      query,
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Permanently delete a completed or failed video and its stored assets.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  delete(videoID, options) {
    return this._client.delete(path`/videos/${videoID}`, { ...options, __security: { bearerAuth: true } });
  }
  /**
   * Create a character from an uploaded video.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  createCharacter(body, options) {
    return this._client.post("/videos/characters", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  /**
   * Download the generated video bytes or a derived preview asset.
   *
   * Streams the rendered video content for the specified video job.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  downloadContent(videoID, query = {}, options) {
    return this._client.get(path`/videos/${videoID}/content`, {
      query,
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true
    });
  }
  /**
   * Create a new video generation job by editing a source video or existing
   * generated video.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  edit(body, options) {
    return this._client.post("/videos/edits", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  /**
   * Create an extension of a completed video.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  extend(body, options) {
    return this._client.post("/videos/extensions", multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
  /**
   * Fetch a character.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  getCharacter(characterID, options) {
    return this._client.get(path`/videos/characters/${characterID}`, {
      ...options,
      __security: { bearerAuth: true }
    });
  }
  /**
   * Create a remix of a completed video using a refreshed prompt.
   *
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  remix(videoID, body, options) {
    return this._client.post(path`/videos/${videoID}/remix`, maybeMultipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client));
  }
};

// ../../../node_modules/openai/lib/webhook-signature.mjs
var MAX_DIRECT_WEBHOOK_VERIFICATIONS = 32;
var SHA256_SIGNATURE_LENGTH = 32;
function webhookSignatureRequiresSigning(signatureHeader) {
  return signatureHeader.split(" ", MAX_DIRECT_WEBHOOK_VERIFICATIONS + 1).length > MAX_DIRECT_WEBHOOK_VERIFICATIONS;
}
function* signatureCandidates(signatureHeader) {
  let start = 0;
  while (start <= signatureHeader.length) {
    const separator = signatureHeader.indexOf(" ", start);
    const candidate = signatureHeader.slice(start, separator === -1 ? void 0 : separator);
    yield candidate.startsWith("v1,") ? candidate.slice(3) : candidate;
    if (separator === -1) {
      break;
    }
    start = separator + 1;
  }
}
function decodeSignature(signature) {
  try {
    const signatureBytes = fromBase64(signature);
    return signatureBytes.byteLength === SHA256_SIGNATURE_LENGTH ? signatureBytes : void 0;
  } catch {
    return void 0;
  }
}
function firstValidLengthSignature(signatureHeader) {
  for (const signature of signatureCandidates(signatureHeader)) {
    const signatureBytes = decodeSignature(signature);
    if (signatureBytes) {
      return signatureBytes;
    }
  }
  return void 0;
}
function selectMatchingSignature(signatureHeader, expectedSignature, firstSignature) {
  let matchingSignature = firstSignature;
  for (const signature of signatureCandidates(signatureHeader)) {
    const signatureBytes = decodeSignature(signature);
    if (!signatureBytes) {
      continue;
    }
    let difference = 0;
    for (const [index, byte] of signatureBytes.entries()) {
      difference |= byte ^ (expectedSignature[index] ?? 0);
    }
    if (difference === 0) {
      matchingSignature = signatureBytes;
    }
  }
  return matchingSignature;
}
async function verifyWebhookSignature(payload, signatureHeader, timestamp, webhookId, secret, tolerance) {
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (Number.isNaN(timestampSeconds)) {
    throw new InvalidWebhookSignatureError("Invalid webhook timestamp format");
  }
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (nowSeconds - timestampSeconds > tolerance) {
    throw new InvalidWebhookSignatureError("Webhook timestamp is too old");
  }
  if (timestampSeconds > nowSeconds + tolerance) {
    throw new InvalidWebhookSignatureError("Webhook timestamp is too new");
  }
  const useBoundedVerification = webhookSignatureRequiresSigning(signatureHeader);
  const firstSignature = useBoundedVerification ? firstValidLengthSignature(signatureHeader) : void 0;
  if (useBoundedVerification && !firstSignature) {
    throw new InvalidWebhookSignatureError("The given webhook signature does not match the expected signature");
  }
  const decodedSecret = Uint8Array.from(secret.startsWith("whsec_") ? fromBase64(secret.slice("whsec_".length)) : encodeUTF8(secret));
  const signedPayload = webhookId ? `${webhookId}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
  const signedPayloadBytes = Uint8Array.from(encodeUTF8(signedPayload));
  const key = await crypto.subtle.importKey("raw", decodedSecret, { name: "HMAC", hash: "SHA-256" }, false, useBoundedVerification ? ["sign", "verify"] : ["verify"]);
  if (useBoundedVerification && firstSignature) {
    const expectedSignature = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedPayloadBytes));
    const signatureToVerify = selectMatchingSignature(signatureHeader, expectedSignature, firstSignature);
    try {
      if (await crypto.subtle.verify("HMAC", key, Uint8Array.from(signatureToVerify), signedPayloadBytes)) {
        return;
      }
    } catch {
    }
    throw new InvalidWebhookSignatureError("The given webhook signature does not match the expected signature");
  }
  for (const signature of signatureCandidates(signatureHeader)) {
    try {
      const signatureBytes = Uint8Array.from(fromBase64(signature));
      const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, signedPayloadBytes);
      if (isValid) {
        return;
      }
    } catch {
    }
  }
  throw new InvalidWebhookSignatureError("The given webhook signature does not match the expected signature");
}

// ../../../node_modules/openai/resources/webhooks/webhooks.mjs
var _Webhooks_instances;
var _Webhooks_validateSecret;
var _Webhooks_getRequiredHeader;
var Webhooks = class extends APIResource {
  constructor() {
    super(...arguments);
    _Webhooks_instances.add(this);
  }
  /**
   * Validates that the given payload was sent by OpenAI and parses the payload.
   */
  async unwrap(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
    await this.verifySignature(payload, headers, secret, tolerance);
    return JSON.parse(payload);
  }
  /**
   * Validates whether or not the webhook payload was sent by OpenAI.
   *
   * An error will be raised if the webhook payload was not sent by OpenAI.
   *
   * @param payload - The webhook payload
   * @param headers - The webhook headers
   * @param secret - The webhook secret (optional, will use client secret if not provided)
   * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
   */
  async verifySignature(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
    if (typeof crypto === "undefined" || typeof crypto.subtle?.importKey !== "function" || typeof crypto.subtle.verify !== "function") {
      throw new Error("Webhook signature verification is only supported when the `crypto` global is defined");
    }
    __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_validateSecret).call(this, secret);
    const headersObj = buildHeaders([headers]).values;
    const signatureHeader = __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-signature");
    const timestamp = __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-timestamp");
    const webhookId = __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-id");
    if (webhookSignatureRequiresSigning(signatureHeader) && typeof crypto.subtle.sign !== "function") {
      throw new Error("Webhook signature verification is only supported when the `crypto` global is defined");
    }
    return await verifyWebhookSignature(payload, signatureHeader, timestamp, webhookId, secret, tolerance);
  }
};
_Webhooks_instances = /* @__PURE__ */ new WeakSet(), _Webhooks_validateSecret = function _Webhooks_validateSecret2(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(`The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function`);
  }
}, _Webhooks_getRequiredHeader = function _Webhooks_getRequiredHeader2(headers, name) {
  if (!headers) {
    throw new Error(`Headers are required`);
  }
  const value = headers.get(name);
  if (value === null || value === void 0) {
    throw new Error(`Missing required header: ${name}`);
  }
  return value;
};

// ../../../node_modules/openai/internal/provider.mjs
var providerDefinitionsKey = /* @__PURE__ */ Symbol.for("openai.node.providerDefinitions.v1");
var providerGlobal = globalThis;
var existingProviderDefinitions = providerGlobal[providerDefinitionsKey];
var providerDefinitions = existingProviderDefinitions ?? /* @__PURE__ */ new WeakMap();
if (!existingProviderDefinitions) {
  Object.defineProperty(providerGlobal, providerDefinitionsKey, { value: providerDefinitions });
}
function configureProvider(provider) {
  const definition = providerDefinitions.get(provider);
  if (!definition) {
    throw new Error("Invalid provider. Providers must be created with createProvider().");
  }
  return definition.configure();
}

// ../../../node_modules/openai/client.mjs
var _OpenAI_instances;
var _a3;
var _OpenAI_encoder;
var _OpenAI_x509Authentication;
var _OpenAI_x509Credential;
var _OpenAI_x509Fetch;
var _OpenAI_explicitDataResidency;
var _OpenAI_responseAttempts;
var _OpenAI_baseURLOverridden;
function isRunningInBrowserOrBrowserWorker() {
  if (isRunningInBrowser())
    return true;
  const scope = globalThis;
  return typeof scope.WorkerGlobalScope === "function" && scope instanceof scope.WorkerGlobalScope && typeof scope.WorkerNavigator === "function" && scope.navigator instanceof scope.WorkerNavigator && typeof scope.navigator?.userAgent === "string" && scope.navigator.userAgent !== "Cloudflare-Workers" && scope.process?.versions?.node === void 0 && scope.Deno === void 0 && scope.Bun === void 0 && scope.EdgeRuntime === void 0 && scope.WebSocketPair === void 0;
}
var WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER = "workload-identity-auth";
var inheritedDataResidencySelection = /* @__PURE__ */ Symbol("inheritedDataResidencySelection");
var OpenAI = class {
  /**
   * API Client for interfacing with the OpenAI API.
   *
   * @param {string | null | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? null]
   * @param {string | null | undefined} [opts.adminAPIKey=process.env['OPENAI_ADMIN_KEY'] ?? null]
   * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
   * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
   * @param {string | null | undefined} [opts.webhookSecret=process.env['OPENAI_WEBHOOK_SECRET'] ?? null]
   * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
   * @param {Provider} [opts.provider] - Configure a third-party API provider. Mutually exclusive with top-level authentication and base URL options.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor(clientOptions = {}) {
    _OpenAI_instances.add(this);
    _OpenAI_encoder.set(this, void 0);
    _OpenAI_x509Authentication.set(this, void 0);
    _OpenAI_x509Credential.set(this, void 0);
    _OpenAI_x509Fetch.set(this, void 0);
    _OpenAI_explicitDataResidency.set(this, false);
    _OpenAI_responseAttempts.set(this, /* @__PURE__ */ new WeakMap());
    this.completions = new Completions2(this);
    this.chat = new Chat(this);
    this.embeddings = new Embeddings(this);
    this.files = new Files2(this);
    this.images = new Images(this);
    this.contentProvenanceChecks = new ContentProvenanceChecks(this);
    this.audio = new Audio(this);
    this.moderations = new Moderations(this);
    this.models = new Models(this);
    this.fineTuning = new FineTuning(this);
    this.graders = new Graders2(this);
    this.vectorStores = new VectorStores(this);
    this.safety = new Safety(this);
    this.webhooks = new Webhooks(this);
    this.beta = new Beta(this);
    this.batches = new Batches(this);
    this.uploads = new Uploads(this);
    this.admin = new Admin(this);
    this.responses = new Responses2(this);
    this.realtime = new Realtime2(this);
    this.conversations = new Conversations(this);
    this.evals = new Evals(this);
    this.containers = new Containers(this);
    this.skills = new Skills(this);
    this.videos = new Videos(this);
    const { credential, options: normalizedOptions } = normalizeX509CredentialOptions(clientOptions);
    clientOptions = normalizedOptions;
    const residencyBaseURL = resolveDataResidency(clientOptions);
    const provider = clientOptions.provider;
    const { baseURL = provider ? null : readEnv("OPENAI_BASE_URL"), dataResidency: _dataResidency, [inheritedDataResidencySelection]: inheritedResidencySelection = false, apiKey = provider ? null : readEnv("OPENAI_API_KEY") ?? null, adminAPIKey = provider ? null : readEnv("OPENAI_ADMIN_KEY") ?? null, organization = provider ? null : readEnv("OPENAI_ORG_ID") ?? null, project = provider ? null : readEnv("OPENAI_PROJECT_ID") ?? null, webhookSecret = readEnv("OPENAI_WEBHOOK_SECRET") ?? null, workloadIdentity, x509Transport, credential: _credential, ...opts } = clientOptions;
    if (provider) {
      const conflictingOptions = ["apiKey", "adminAPIKey", "workloadIdentity", "x509Transport", "baseURL", "dataResidency"].filter((key) => (key === "workloadIdentity" ? workloadIdentity : clientOptions[key]) != null);
      if (conflictingOptions.length) {
        throw new OpenAIError(`The \`provider\` option cannot be used with ${conflictingOptions.map((key) => `\`${key}\``).join(", ")}. Configure authentication and the base URL through the provider instead.`);
      }
    }
    const identity = isX509WorkloadIdentity(workloadIdentity) ? { x509: workloadIdentity, legacy: void 0 } : { x509: void 0, legacy: workloadIdentity };
    const x509Identity = identity.x509;
    const usesX509Identity = x509Identity !== void 0;
    const providerRuntime = provider ? configureProvider(provider) : void 0;
    const options = {
      apiKey,
      adminAPIKey,
      organization,
      project,
      webhookSecret,
      workloadIdentity,
      x509Transport,
      provider,
      ...opts,
      baseURL: providerRuntime?.baseURL ?? residencyBaseURL ?? (baseURL || (usesX509Identity ? X509_API_BASE_URL : `https://api.openai.com/v1`))
    };
    if (x509Transport && !usesX509Identity) {
      throw new OpenAIError("An X.509 transport requires an X.509 workload identity.");
    }
    if (usesX509Identity) {
      if (residencyBaseURL !== void 0 || inheritedResidencySelection) {
        throw new OpenAIError("X.509 workload identity does not support data residency selection.");
      }
      if (clientOptions.fetch !== void 0) {
        throw new OpenAIError("X.509 workload identity does not support a custom fetch implementation.");
      }
      assertX509APIOrigin(options.baseURL);
      assertX509RequestOptions(options.fetchOptions);
      if (this.fetchWithAuth !== _a3.prototype.fetchWithAuth || this.fetchWithTimeout !== _a3.prototype.fetchWithTimeout) {
        throw new OpenAIError("X.509 workload identity does not support overridden fetch dispatch hooks.");
      }
    }
    if (apiKey && workloadIdentity) {
      throw new OpenAIError("The `apiKey` and `workloadIdentity` options are mutually exclusive");
    }
    if (!providerRuntime && !apiKey && !adminAPIKey && !workloadIdentity) {
      throw new OpenAIError("Missing credentials. Please pass an `apiKey`, `workloadIdentity`, `adminAPIKey`, or set the `OPENAI_API_KEY` or `OPENAI_ADMIN_KEY` environment variable.");
    }
    if (!options.dangerouslyAllowBrowser && isRunningInBrowserOrBrowserWorker()) {
      throw new OpenAIError("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n");
    }
    this.baseURL = options.baseURL;
    __classPrivateFieldSet(this, _OpenAI_explicitDataResidency, residencyBaseURL !== void 0 || inheritedResidencySelection, "f");
    this.timeout = options.timeout ?? _a3.DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;
    const defaultLogLevel = "warn";
    this.logLevel = defaultLogLevel;
    this.logLevel = parseLogLevel(options.logLevel, "ClientOptions.logLevel", this) ?? parseLogLevel(readEnv("OPENAI_LOG"), "process.env['OPENAI_LOG']", this) ?? defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? getDefaultFetch();
    __classPrivateFieldSet(this, _OpenAI_encoder, FallbackEncoder, "f");
    const customHeadersEnv = provider || credential ? void 0 : readEnv("OPENAI_CUSTOM_HEADERS");
    if (customHeadersEnv) {
      const parsed = {};
      for (const line of customHeadersEnv.split("\n")) {
        const colon = line.indexOf(":");
        if (colon >= 0) {
          parsed[line.substring(0, colon).trim()] = line.substring(colon + 1).trim();
        }
      }
      options.defaultHeaders = buildHeaders([parsed, options.defaultHeaders]);
    }
    this._options = options;
    this._provider = providerRuntime;
    if (x509Identity) {
      const authentication = new X509WorkloadIdentityAuth(x509Identity, x509Transport, organization, project);
      this._workloadIdentityAuth = authentication;
      __classPrivateFieldSet(this, _OpenAI_x509Authentication, authentication, "f");
      __classPrivateFieldSet(this, _OpenAI_x509Credential, credential, "f");
      __classPrivateFieldSet(this, _OpenAI_x509Fetch, authentication.fetch(), "f");
      this.fetch = __classPrivateFieldGet(this, _OpenAI_x509Fetch, "f");
      markApprovedX509Client2(this);
    } else if (identity.legacy) {
      this._workloadIdentityAuth = new WorkloadIdentityAuth(identity.legacy, this.fetch);
    }
    this.apiKey = typeof apiKey === "string" ? apiKey : null;
    this.adminAPIKey = adminAPIKey;
    this.organization = organization;
    this.project = project;
    this.webhookSecret = webhookSecret;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options) {
    const residencyBaseURL = resolveDataResidency(options);
    const x509Authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f");
    const inheritedOptions = {
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") ? void 0 : this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this._options.apiKey,
      adminAPIKey: this.adminAPIKey,
      workloadIdentity: x509Authentication?.identitySnapshot() ?? this._options.workloadIdentity,
      x509Transport: this._options.x509Transport,
      organization: this.organization,
      project: this.project,
      webhookSecret: this.webhookSecret
    };
    const { credential, provider } = prepareX509ClientClone(inheritedOptions, options, __classPrivateFieldGet(this, _OpenAI_x509Credential, "f"), x509Authentication !== void 0);
    if (residencyBaseURL !== void 0) {
      delete inheritedOptions.baseURL;
    }
    const clientOptions = {
      ...inheritedOptions,
      ...options,
      credential,
      provider,
      [inheritedDataResidencySelection]: __classPrivateFieldGet(this, _OpenAI_explicitDataResidency, "f") && residencyBaseURL === void 0 && !hasOwn(options, "baseURL") && options.credential === void 0 && !provider
    };
    const client = new this.constructor(clientOptions);
    if (provider && new URL(client.baseURL).origin !== new URL(this.baseURL).origin) {
      Object.assign(client._options, {
        defaultHeaders: options.defaultHeaders,
        defaultQuery: options.defaultQuery,
        fetchOptions: options.fetchOptions,
        fetch: options.fetch
      });
      client.fetchOptions = options.fetchOptions;
      client.fetch = options.fetch ?? getDefaultFetch();
      client.organization = options.organization ?? null;
      client.project = options.project ?? null;
    }
    if (__classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") && __classPrivateFieldGet(client, _OpenAI_x509Authentication, "f") && this.baseURL === client.baseURL && __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f").matches(__classPrivateFieldGet(client, _OpenAI_x509Authentication, "f"))) {
      client._workloadIdentityAuth = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f");
      __classPrivateFieldSet(client, _OpenAI_x509Authentication, __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f"), "f");
      __classPrivateFieldSet(client, _OpenAI_x509Fetch, __classPrivateFieldGet(this, _OpenAI_x509Fetch, "f"), "f");
    }
    return client;
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values, nulls }, schemes = {
    bearerAuth: true,
    adminAPIKeyAuth: true
  }) {
    if (values.get("authorization") || values.get("api-key")) {
      return;
    }
    if (nulls.has("authorization") || nulls.has("api-key")) {
      return;
    }
    if (this._workloadIdentityAuth && schemes.bearerAuth) {
      return;
    }
    throw new Error('Could not resolve authentication method. Expected either apiKey or adminAPIKey to be set. Or for one of the "Authorization" or "api-key" headers to be explicitly omitted');
  }
  async authHeaders(opts, schemes = {
    bearerAuth: true,
    adminAPIKeyAuth: true
  }) {
    const authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") ?? this._workloadIdentityAuth;
    if (authentication instanceof X509WorkloadIdentityAuth && schemes.adminAPIKeyAuth && this.adminAPIKey !== null) {
      return await this.adminAPIKeyAuth(opts);
    }
    return buildHeaders([
      schemes.bearerAuth ? await this.bearerAuth(opts) : null,
      schemes.adminAPIKeyAuth ? await this.adminAPIKeyAuth(opts) : null
    ]);
  }
  async bearerAuth(opts) {
    const authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") ?? this._workloadIdentityAuth;
    if (authentication) {
      if (authentication instanceof X509WorkloadIdentityAuth) {
        if (authentication === this._workloadIdentityAuth && (this.fetchWithAuth !== _a3.prototype.fetchWithAuth || this.fetchWithTimeout !== _a3.prototype.fetchWithTimeout)) {
          throw new OpenAIError("X.509 workload identity does not support overridden fetch dispatch hooks.");
        }
        const snapshots = authentication.headerSnapshots();
        if (!X509WorkloadIdentityAuth.shouldAuthenticate(opts, snapshots.defaultHeaders, snapshots.requestHeaders)) {
          return void 0;
        }
      }
      const token = authentication instanceof X509WorkloadIdentityAuth ? await authentication.getToken(opts, {
        apiURL: authentication.requestAPIURL(),
        ...authentication.headerSnapshots(),
        ...authentication.requestSnapshot(),
        signal: authentication.effectiveSignal(),
        ...authentication.tenantSnapshot()
      }) : await authentication.getToken();
      return buildHeaders([{ Authorization: `Bearer ${token}` }]);
    }
    if (this.apiKey == null) {
      return void 0;
    }
    return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
  }
  async adminAPIKeyAuth(opts) {
    if (this.adminAPIKey == null) {
      return void 0;
    }
    return buildHeaders([{ Authorization: `Bearer ${this.adminAPIKey}` }]);
  }
  stringifyQuery(query) {
    return stringifyQuery(query);
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  makeStatusError(status, error, message, headers) {
    const normalizedError = error && typeof error === "object" && error.error == null ? { error } : error;
    return APIError.generate(status, normalizedError, message, headers);
  }
  async _callApiKey() {
    if (this._provider)
      return false;
    const apiKey = this._options.apiKey;
    if (typeof apiKey !== "function")
      return false;
    let token;
    try {
      token = await apiKey();
    } catch (err) {
      if (err instanceof OpenAIError)
        throw err;
      throw new OpenAIError(
        `Failed to get token from 'apiKey' function: ${err.message}`,
        // @ts-ignore
        { cause: err }
      );
    }
    if (typeof token !== "string" || !token) {
      throw new OpenAIError(`Expected 'apiKey' function argument to return a string but it returned ${token}`);
    }
    this.apiKey = token;
    return true;
  }
  buildURL(path2, query, defaultBaseURL) {
    const baseURL = !__classPrivateFieldGet(this, _OpenAI_instances, "m", _OpenAI_baseURLOverridden).call(this) && defaultBaseURL || this.baseURL;
    const url = isAbsoluteURL(path2) ? new URL(path2) : new URL(baseURL + (baseURL.endsWith("/") && path2.startsWith("/") ? path2.slice(1) : path2));
    const defaultQuery = this.defaultQuery();
    const pathQuery = Object.fromEntries(url.searchParams);
    if (!isEmptyObj(defaultQuery) || !isEmptyObj(pathQuery)) {
      query = { ...pathQuery, ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(options) {
    if (this._provider)
      return;
    const security = options.__security ?? { bearerAuth: true };
    if (security.bearerAuth) {
      await this._callApiKey();
    }
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url, options }) {
  }
  get(path2, opts) {
    return this.methodRequest("get", path2, opts);
  }
  post(path2, opts) {
    return this.methodRequest("post", path2, opts);
  }
  patch(path2, opts) {
    return this.methodRequest("patch", path2, opts);
  }
  put(path2, opts) {
    return this.methodRequest("put", path2, opts);
  }
  delete(path2, opts) {
    return this.methodRequest("delete", path2, opts);
  }
  methodRequest(method, path2, opts) {
    return this.request(Promise.resolve(opts).then((opts2) => {
      return { method, path: path2, ...opts2 };
    }));
  }
  request(options, remainingRetries = null) {
    const authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") ?? this._workloadIdentityAuth;
    const request = authentication instanceof X509WorkloadIdentityAuth ? Promise.resolve(options).then((resolved) => authentication.runRequest(() => this.makeRequest(resolved, remainingRetries, void 0), this)) : this.makeRequest(options, remainingRetries, void 0);
    return this.responsePromise(request);
  }
  responsePromise(request, parse = (client, props) => this.parseResponseWithTimeout(client, props)) {
    const promise = new APIPromise(this, request, (client, props) => {
      const resume = __classPrivateFieldGet(this, _OpenAI_responseAttempts, "f").get(props.controller)?.continueRequest;
      return resume ? resume(() => parse(client, props)) : parse(client, props);
    });
    promise.withResponse = async () => {
      const data = await promise;
      const { response } = await request;
      return { data, response, request_id: response.headers.get("x-request-id") };
    };
    promise._thenUnwrap = (transform) => this.responsePromise(request, async (client, props) => addRequestID(transform(await parse(client, props), props), props.response));
    return promise;
  }
  async parseResponseWithTimeout(client, props) {
    if (props.options.stream || props.options.__binaryResponse || props.response.status === 204 || props.response.headers.get("content-length") === "0") {
      return defaultParseResponse(client, props);
    }
    while (true) {
      const attempt = __classPrivateFieldGet(this, _OpenAI_responseAttempts, "f").get(props.controller);
      const timeout = attempt?.timeout ?? props.options.timeout ?? this.timeout;
      const x509Authentication = attempt?.authentication;
      const callerSignal = x509Authentication ? props.controller.signal : props.options.signal;
      const abortError = () => x509Authentication && callerSignal ? this._makeUserAbortError(callerSignal) : new APIUserAbortError();
      let remaining;
      try {
        remaining = x509Authentication?.remainingTimeout(props.options, timeout) ?? Math.max(0, props.startTime + timeout - Date.now());
      } catch (error) {
        const cancellation = callerSignal?.aborted ? abortError() : void 0;
        props.controller.abort();
        void CancelReadableStream(props.response.body).catch(() => void 0);
        throw cancellation ?? error;
      }
      let timer;
      let abortListener;
      let timedOut = false;
      try {
        if (callerSignal?.aborted && attempt?.helperMethod !== "runTools") {
          throw abortError();
        }
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            props.controller.abort();
            reject(new APIConnectionTimeoutError());
          }, remaining);
          if (callerSignal) {
            abortListener = () => {
              if (!timedOut)
                reject(abortError());
            };
            callerSignal.addEventListener("abort", abortListener, { once: true });
          }
        });
        return await Promise.race([defaultParseResponse(client, props), timeoutPromise]);
      } catch (error) {
        if (callerSignal?.aborted && !timedOut) {
          throw abortError();
        }
        if (!timedOut) {
          if (x509Authentication && error instanceof SyntaxError) {
            throw new SyntaxError("X.509 workload identity API response contains invalid JSON.");
          }
          if (x509Authentication && !(error instanceof OpenAIError)) {
            throw new APIConnectionError({
              message: "X.509 workload identity API response body could not be read."
            });
          }
          throw error;
        }
        const retriesRemaining = attempt?.retriesRemaining ?? 0;
        if (!retriesRemaining || attempt?.hasStreamingBody || props.options.__metadata?.["hasStreamingBody"] || globalThis.ReadableStream && props.options.body instanceof globalThis.ReadableStream || typeof props.options.body === "object" && props.options.body !== null && (Symbol.asyncIterator in props.options.body || Symbol.iterator in props.options.body && "next" in props.options.body && typeof props.options.body.next === "function")) {
          throw new APIConnectionTimeoutError();
        }
        if (timer !== void 0)
          clearTimeout(timer);
        if (abortListener)
          callerSignal?.removeEventListener("abort", abortListener);
        abortListener = void 0;
        const next = await this.retryRequest(props.options, retriesRemaining, props.retryOfRequestLogID ?? props.requestLogID);
        Object.assign(props, next);
      } finally {
        if (timer !== void 0)
          clearTimeout(timer);
        if (abortListener)
          callerSignal?.removeEventListener("abort", abortListener);
      }
    }
  }
  /** Keeps terminal X.509 error-body consumption inside the original logical request deadline. */
  async readX509ResponseError(response, options, timeout, controller, authentication) {
    const deadline = new AbortController();
    const callerSignal = controller.signal;
    let timedOut = false;
    const cancel = () => deadline.abort(callerSignal.reason);
    callerSignal.addEventListener("abort", cancel, { once: true });
    if (callerSignal.aborted) {
      cancel();
    }
    try {
      const remaining = authentication.remainingTimeout(options, timeout);
      const expiration = authentication.waitForRetry(remaining, deadline.signal).then(() => {
        throw new APIConnectionTimeoutError();
      });
      const body = await Promise.race([
        response.text().catch(() => "X.509 workload identity API response body could not be read."),
        expiration
      ]);
      if (callerSignal.aborted) {
        throw this._makeUserAbortError(callerSignal);
      }
      return body;
    } catch (error) {
      if (error instanceof APIConnectionTimeoutError) {
        timedOut = !callerSignal.aborted;
        controller.abort();
        void CancelReadableStream(response.body).catch(() => void 0);
      }
      if (callerSignal.aborted && !timedOut) {
        throw this._makeUserAbortError(callerSignal);
      }
      throw error;
    } finally {
      callerSignal.removeEventListener("abort", cancel);
      deadline.abort();
    }
  }
  async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    const x509Authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f");
    x509Authentication?.beginRequestPreparation();
    await this.prepareOptions(options);
    x509Authentication?.beginRequestPlanning();
    let built;
    try {
      const candidate = await this.buildRequest(options, {
        retryCount: maxRetries - retriesRemaining
      });
      built = { req: candidate.req, url: candidate.url, timeout: candidate.timeout };
      if (x509Authentication) {
        validatePositiveInteger("timeout", built.timeout);
        x509Authentication.authorizePlannedRequest(built.url, built.req, built.timeout);
        if (X509WorkloadIdentityAuth.isStreamingRequestBody(built.req.body)) {
          options.__metadata = { ...options.__metadata, hasStreamingBody: true };
        }
        await this.prepareRequest(built.req, { url: built.url, options });
        await this._provider?.prepareRequest?.(built.req, { url: built.url, options });
        x509Authentication.beginRequestPlanning();
        x509Authentication.authorizePlannedRequest(built.url, built.req, built.timeout, true);
        if (X509WorkloadIdentityAuth.isStreamingRequestBody(built.req.body)) {
          options.__metadata = { ...options.__metadata, hasStreamingBody: true };
        }
        const callerSignal2 = x509Authentication.requestSnapshot().signal;
        if (callerSignal2?.aborted || built.req.signal?.aborted) {
          throw this._makeUserAbortError(callerSignal2?.aborted ? callerSignal2 : built.req.signal);
        }
        x509Authentication.setEffectiveSignal(built.req.signal || callerSignal2 ? createRequestController(built.req.signal ?? callerSignal2, callerSignal2).signal : void 0);
        x509Authentication.beginRequestNetwork();
        const security2 = options.__security ?? { bearerAuth: true };
        const authenticationHeaders = await this.authHeaders(options, security2);
        const suppliedHeaders = x509Authentication.headerSnapshots();
        const supplied = buildHeaders([suppliedHeaders.defaultHeaders, suppliedHeaders.requestHeaders]);
        for (const [name, value] of authenticationHeaders?.values ?? []) {
          if (!supplied.nulls.has(name) && !built.req.headers.has(name)) {
            built.req.headers.set(name, value);
          }
        }
        this.validateHeaders(buildHeaders([supplied, built.req.headers]), security2);
      }
    } catch (error) {
      x509Authentication?.retireRequestBody();
      if (x509Authentication && retriesRemaining && !options.__metadata?.["hasStreamingBody"] && X509WorkloadIdentityAuth.isRetryableFailure(error)) {
        return await this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? "x509-token-exchange", X509WorkloadIdentityAuth.retryHeaders(error));
      }
      throw error;
    }
    const { req, url } = built;
    const timeout = x509Authentication ? Math.min(built.timeout, x509Authentication.requestSnapshot().timeout) : built.timeout;
    x509Authentication?.bindRequest(options, req, this.adminAPIKey);
    let hasStreamingBody = options.__metadata?.["hasStreamingBody"] === true;
    if (!x509Authentication) {
      await this.prepareRequest(req, { url, options });
      await this._provider?.prepareRequest?.(req, { url, options });
    }
    x509Authentication?.adoptRequestHeaders(req);
    if (x509Authentication && X509WorkloadIdentityAuth.isStreamingRequestBody(req.body)) {
      hasStreamingBody = true;
    }
    const requestLogID = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0");
    const retryLogStr = retryOfRequestLogID === void 0 ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = x509Authentication?.requestStartedAt(options) ?? Date.now();
    loggerFor(this).debug(`[${requestLogID}] sending request`, formatRequestDetails({
      retryOfRequestLogID,
      method: options.method,
      url,
      options: x509Authentication ? { body: req.body, ...x509Authentication.requestSnapshot() } : options,
      headers: req.headers
    }));
    const callerSignal = x509Authentication ? x509Authentication.requestSnapshot().signal : options.signal;
    if (callerSignal?.aborted || req.signal?.aborted) {
      throw this._makeUserAbortError(callerSignal?.aborted ? callerSignal : req.signal);
    }
    const security = options.__security ?? { bearerAuth: true };
    const controller = x509Authentication || this.fetchWithTimeout === _a3.prototype.fetchWithTimeout ? createRequestController(req.signal ?? (x509Authentication ? callerSignal : void 0), x509Authentication ? callerSignal : void 0) : new AbortController();
    const remainingTimeout = x509Authentication?.remainingTimeout(options, timeout) ?? timeout;
    const fetchWithAuth = x509Authentication ? _a3.prototype.fetchWithAuth : this.fetchWithAuth;
    x509Authentication?.releaseRequestBody(req.body);
    const response = await fetchWithAuth.call(this, url, req, remainingTimeout, controller, security).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (callerSignal?.aborted || req.signal?.aborted) {
        throw this._makeUserAbortError(callerSignal?.aborted ? callerSignal : req.signal);
      }
      const isTimeout = isAbortError(response) || /timed? ?out/i.test(String(response) + ("cause" in response ? String(response.cause) : ""));
      if (retriesRemaining && !hasStreamingBody && (!x509Authentication || isTransientX509ConnectionError2(response))) {
        loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${retryMessage}`);
        loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${retryMessage})`, formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: x509Authentication ? "X.509 workload identity API connection failed." : response.message
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      const terminalMessage = hasStreamingBody ? "error; streaming body cannot be retried" : "error; no more retries left";
      loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${terminalMessage}`);
      loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${terminalMessage})`, formatRequestDetails({
        retryOfRequestLogID,
        url,
        durationMs: headersTime - startTime,
        message: x509Authentication ? "X.509 workload identity API connection failed." : response.message
      }));
      if (response instanceof OAuthError || response instanceof SubjectTokenProviderError) {
        throw response;
      }
      if (isTimeout) {
        const transportCause = "cause" in response ? response.cause : void 0;
        const isHeadersTimeout = typeof transportCause === "object" && transportCause !== null && "code" in transportCause && transportCause.code === "UND_ERR_HEADERS_TIMEOUT";
        const timeoutError = isHeadersTimeout ? new APIConnectionTimeoutError({
          message: "Request timed out. Node.js fetch timed out waiting for response headers; configure a matching undici fetch and fetchOptions.dispatcher with an Agent whose headersTimeout is at least the SDK timeout."
        }) : new APIConnectionTimeoutError();
        if (x509Authentication) {
          throw new APIConnectionTimeoutError();
        }
        throw Object.assign(timeoutError, { cause: response });
      }
      if (x509Authentication) {
        throw new APIConnectionError({ message: "X.509 workload identity API connection failed." });
      }
      throw new APIConnectionError({
        message: getConnectionErrorMessage(response),
        cause: response
      });
    }
    const specialHeaders = [...response.headers.entries()].filter(([name]) => name === "x-request-id").map(([name, value]) => ", " + name + ": " + JSON.stringify(value)).join("");
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${redactURL(url)} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      const rejectedX509Credential = response.status === 401 && x509Authentication && security.bearerAuth && x509Authentication.usedWorkloadToken(options);
      if (rejectedX509Credential) {
        x509Authentication.invalidateToken();
      }
      if (response.status === 401 && (x509Authentication || this._workloadIdentityAuth) && security.bearerAuth && (!x509Authentication || x509Authentication.usedWorkloadToken(options)) && (!x509Authentication || retriesRemaining > 0) && !hasStreamingBody && !options.__metadata?.["workloadIdentityTokenRefreshed"]) {
        if (x509Authentication) {
          void CancelReadableStream(response.body).catch(() => void 0);
        } else {
          await CancelReadableStream(response.body);
          this._workloadIdentityAuth?.invalidateToken();
        }
        const replayOptions = {
          ...options,
          __metadata: {
            ...options.__metadata,
            workloadIdentityTokenRefreshed: true
          }
        };
        return this.makeRequest(replayOptions, x509Authentication ? retriesRemaining - 1 : retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      const shouldRetry = rejectedX509Credential && options.__metadata?.["workloadIdentityTokenRefreshed"] ? false : await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry && !hasStreamingBody) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        if (x509Authentication) {
          void CancelReadableStream(response.body).catch(() => void 0);
        } else {
          await CancelReadableStream(response.body);
        }
        loggerFor(this).info(`${responseInfo} - ${retryMessage2}`);
        loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage2})`, formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          durationMs: headersTime - startTime
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID, response.headers);
      }
      const retryMessage = shouldRetry ? hasStreamingBody ? `error; streaming body cannot be retried` : `error; no more retries left` : `error; not retryable`;
      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
      const errText = x509Authentication ? await this.readX509ResponseError(response, options, timeout, controller, x509Authentication) : await response.text().catch((err2) => castToError(err2).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? void 0 : errText;
      loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage})`, formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        message: errMessage,
        durationMs: Date.now() - startTime
      }));
      const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
      throw err;
    }
    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(`[${requestLogID}] response start`, formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      headers: response.headers,
      durationMs: headersTime - startTime
    }));
    const continueRequest = x509Authentication?.continuation();
    x509Authentication?.releaseRequestCredentials();
    __classPrivateFieldGet(this, _OpenAI_responseAttempts, "f").set(controller, {
      timeout,
      retriesRemaining,
      hasStreamingBody,
      ...x509Authentication ? { authentication: x509Authentication } : {},
      helperMethod: options.__metadata?.["helperMethod"],
      ...continueRequest ? { continueRequest } : {}
    });
    return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
  }
  getAPIList(path2, Page2, opts) {
    return this.requestAPIList(Page2, opts && "then" in opts ? opts.then((opts2) => ({ method: "get", path: path2, ...opts2 })) : { method: "get", path: path2, ...opts });
  }
  requestAPIList(Page2, options) {
    const authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") ?? this._workloadIdentityAuth;
    const request = authentication instanceof X509WorkloadIdentityAuth ? Promise.resolve(options).then((resolved) => authentication.runRequest(() => this.makeRequest(resolved, null, void 0), this)) : this.makeRequest(options, null, void 0);
    const page = new PagePromise(this, request, Page2);
    const guarded = this.responsePromise(request, async (client, props) => {
      const body = await this.parseResponseWithTimeout(client, props);
      return new Page2(client, props.response, body, props.options);
    });
    page.then = guarded.then.bind(guarded);
    page.catch = guarded.catch.bind(guarded);
    page.finally = guarded.finally.bind(guarded);
    page.withResponse = guarded.withResponse.bind(guarded);
    page._thenUnwrap = guarded._thenUnwrap.bind(guarded);
    return page;
  }
  async fetchWithAuth(url, init, timeout, controller, schemes = {
    bearerAuth: true,
    adminAPIKeyAuth: true
  }) {
    if (this._workloadIdentityAuth && !__classPrivateFieldGet(this, _OpenAI_x509Fetch, "f") && schemes.bearerAuth) {
      const headers = init.headers;
      const authHeader = headers.get("Authorization");
      if (!authHeader || authHeader === `Bearer ${WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER}`) {
        const token = await this._workloadIdentityAuth.getToken();
        headers.set("Authorization", `Bearer ${token}`);
      }
    }
    const fetchWithTimeout = __classPrivateFieldGet(this, _OpenAI_x509Fetch, "f") ? _a3.prototype.fetchWithTimeout : this.fetchWithTimeout;
    const response = await fetchWithTimeout.call(this, url, init, timeout, controller);
    return response;
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, method, ...options } = init || {};
    const abort = this._makeAbort(controller);
    const composed = !!signal && composedCallerSignals.get(controller) === signal;
    if (signal && !composed)
      signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, ms);
    const isReadableBody = globalThis.ReadableStream && options.body instanceof globalThis.ReadableStream || typeof options.body === "object" && options.body !== null && Symbol.asyncIterator in options.body;
    const fetchOptions = {
      signal: controller.signal,
      ...isReadableBody ? { duplex: "half" } : {},
      method: "GET",
      ...options
    };
    if (method) {
      fetchOptions.method = method.toUpperCase();
    }
    try {
      return await (__classPrivateFieldGet(this, _OpenAI_x509Fetch, "f") ?? this.fetch).call(void 0, url, fetchOptions);
    } catch (err) {
      if (signal && !composed)
        signal.removeEventListener("abort", abort);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  async shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true")
      return true;
    if (shouldRetryHeader === "false")
      return false;
    if (response.status === 408)
      return true;
    if (response.status === 409)
      return true;
    if (response.status === 429)
      return true;
    if (response.status >= 500)
      return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders?.get("retry-after-ms");
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders?.get("retry-after");
    if (retryAfterHeader && timeoutMillis === void 0) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1e3;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (timeoutMillis === void 0 || !Number.isFinite(timeoutMillis) || timeoutMillis < 0 || timeoutMillis > 60 * 1e3) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    const x509Authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f");
    if (x509Authentication) {
      const remaining = x509Authentication.remainingTimeout(options, x509Authentication.requestSnapshot().timeout);
      if (timeoutMillis >= remaining) {
        throw new APIConnectionTimeoutError();
      }
    }
    if (x509Authentication) {
      await x509Authentication.waitForRetry(timeoutMillis, x509Authentication.effectiveSignal());
    } else {
      await sleep(timeoutMillis);
    }
    return this.makeRequest(options, retriesRemaining - 1, requestLogID);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1e3;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    if (__classPrivateFieldGet(this, _OpenAI_x509Authentication, "f") && !__classPrivateFieldGet(this, _OpenAI_x509Authentication, "f").inRequest(this)) {
      const authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f");
      return await authentication.runRequest(async () => {
        const built = await _a3.prototype.buildRequest.call(this, inputOptions, { retryCount });
        authentication.releaseRequestBody(built.req.body);
        return built;
      }, this);
    }
    const options = { ...inputOptions };
    const x509Authentication = __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f");
    const x509Tenant = x509Authentication?.snapshotTenant(this.organization, this.project);
    const x509Headers = x509Authentication?.snapshotHeaders(this._options.defaultHeaders, options.headers);
    if (x509Headers) {
      options.headers = x509Headers.requestHeaders;
    }
    const x509ClientFetchOptions = x509Authentication ? snapshotX509RequestOptions(this.fetchOptions) : void 0;
    const x509RequestFetchOptions = x509Authentication ? snapshotX509RequestOptions(options.fetchOptions) : void 0;
    const { method, path: path2, query, defaultBaseURL } = options;
    const url = this.buildURL(path2, query, defaultBaseURL);
    x509Authentication?.snapshotAPIURL(url);
    const explicitTimeout = "timeout" in options;
    if (explicitTimeout)
      validatePositiveInteger("timeout", options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    if (x509Authentication && x509RequestFetchOptions) {
      x509Authentication.snapshotRequest(options.signal, options.timeout, x509RequestFetchOptions);
    }
    if (x509Authentication) {
      const snapshot = x509Authentication.requestSnapshot();
      options.timeout = snapshot.timeout;
      if (snapshot.signal === void 0) {
        delete options.signal;
      } else {
        options.signal = snapshot.signal;
      }
    }
    const { bodyHeaders, body, isStreamingBody } = this.buildBody({ options });
    if (isStreamingBody) {
      inputOptions.__metadata = {
        ...inputOptions.__metadata,
        hasStreamingBody: true
      };
      x509Authentication?.ownRequestBody(body, options.body);
    }
    const reqHeaders = await this.buildHeaders({
      options: inputOptions,
      method,
      bodyHeaders,
      retryCount,
      x509Headers,
      x509Timeout: explicitTimeout ? options.timeout : void 0,
      x509Tenant
    });
    const req = {
      method,
      headers: reqHeaders,
      ...options.signal && { signal: options.signal },
      ...globalThis.ReadableStream && body instanceof globalThis.ReadableStream && { duplex: "half" },
      ...body && { body },
      ...(x509Authentication ? x509ClientFetchOptions : this.fetchOptions) ?? {},
      ...(x509Authentication ? x509RequestFetchOptions : options.fetchOptions) ?? {}
    };
    return { req, url, timeout: options.timeout };
  }
  async buildHeaders({ options, method, bodyHeaders, retryCount, x509Headers, x509Timeout, x509Tenant }) {
    let idempotencyHeaders = {};
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }
    const helperMethod = options.__metadata?.["helperMethod"];
    const timeout = x509Headers ? x509Timeout : options.timeout;
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: "application/json",
        ...!isRunningInBrowserOrBrowserWorker() ? { "User-Agent": this.getUserAgent() } : void 0,
        "X-Stainless-Retry-Count": String(retryCount),
        ...timeout ? { "X-Stainless-Timeout": String(Math.trunc(timeout / 1e3)) } : {},
        ...getPlatformHeaders(),
        ...typeof helperMethod === "string" ? { "X-Stainless-Helper-Method": helperMethod } : {},
        "OpenAI-Organization": x509Tenant ? x509Tenant.organization : this.organization,
        "OpenAI-Project": x509Tenant ? x509Tenant.project : this.project
      },
      this._provider || __classPrivateFieldGet(this, _OpenAI_x509Authentication, "f")?.isPlanningRequest() ? void 0 : await this.authHeaders(options, options.__security ?? { bearerAuth: true }),
      x509Headers?.defaultHeaders ?? this._options.defaultHeaders,
      bodyHeaders,
      x509Headers?.requestHeaders ?? options.headers
    ]);
    if (!this._provider && !__classPrivateFieldGet(this, _OpenAI_x509Authentication, "f")?.isPlanningRequest()) {
      this.validateHeaders(headers, options.__security ?? { bearerAuth: true });
    }
    return headers.values;
  }
  _makeAbort(controller) {
    return () => controller.abort();
  }
  _makeUserAbortError(signal) {
    const error = new APIUserAbortError();
    Object.defineProperty(error, "cause", { value: signal.reason, writable: true, configurable: true });
    return error;
  }
  buildBody({ options }) {
    const { body, headers: rawHeaders } = options;
    if (!body) {
      if (body === void 0 && "body" in options) {
        return { ...__classPrivateFieldGet(this, _OpenAI_encoder, "f").call(this, { body, headers: buildHeaders([rawHeaders]) }), isStreamingBody: false };
      }
      return { bodyHeaders: void 0, body: void 0, isStreamingBody: false };
    }
    const headers = buildHeaders([rawHeaders]);
    const isReadableStream2 = typeof globalThis.ReadableStream !== "undefined" && body instanceof globalThis.ReadableStream;
    const isRetryableBody = !isReadableStream2 && (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || typeof globalThis.Blob !== "undefined" && body instanceof globalThis.Blob || body instanceof URLSearchParams || body instanceof FormData);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && // Preserve legacy string encoding behavior for now
      headers.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && body instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      isReadableStream2
    ) {
      return { bodyHeaders: void 0, body, isStreamingBody: !isRetryableBody };
    } else if (typeof body === "object" && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function")) {
      return {
        bodyHeaders: void 0,
        body: ReadableStreamFrom(body),
        isStreamingBody: true
      };
    } else if (typeof body === "object" && headers.values.get("content-type") === "application/x-www-form-urlencoded") {
      return {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(body),
        isStreamingBody: false
      };
    } else {
      return { ...__classPrivateFieldGet(this, _OpenAI_encoder, "f").call(this, { body, headers }), isStreamingBody: false };
    }
  }
};
_a3 = OpenAI, _OpenAI_encoder = /* @__PURE__ */ new WeakMap(), _OpenAI_x509Authentication = /* @__PURE__ */ new WeakMap(), _OpenAI_x509Credential = /* @__PURE__ */ new WeakMap(), _OpenAI_x509Fetch = /* @__PURE__ */ new WeakMap(), _OpenAI_explicitDataResidency = /* @__PURE__ */ new WeakMap(), _OpenAI_responseAttempts = /* @__PURE__ */ new WeakMap(), _OpenAI_instances = /* @__PURE__ */ new WeakSet(), _OpenAI_baseURLOverridden = function _OpenAI_baseURLOverridden2() {
  return __classPrivateFieldGet(this, _OpenAI_explicitDataResidency, "f") || this._provider !== void 0 || this.baseURL !== "https://api.openai.com/v1";
};
OpenAI.OpenAI = _a3;
OpenAI.DEFAULT_TIMEOUT = 6e5;
OpenAI.OpenAIError = OpenAIError;
OpenAI.APIError = APIError;
OpenAI.APIConnectionError = APIConnectionError;
OpenAI.APIConnectionTimeoutError = APIConnectionTimeoutError;
OpenAI.APIUserAbortError = APIUserAbortError;
OpenAI.NotFoundError = NotFoundError;
OpenAI.ConflictError = ConflictError;
OpenAI.RateLimitError = RateLimitError;
OpenAI.BadRequestError = BadRequestError;
OpenAI.AuthenticationError = AuthenticationError;
OpenAI.InternalServerError = InternalServerError;
OpenAI.PermissionDeniedError = PermissionDeniedError;
OpenAI.UnprocessableEntityError = UnprocessableEntityError;
OpenAI.InvalidWebhookSignatureError = InvalidWebhookSignatureError;
OpenAI.toFile = toFile;
OpenAI.toStreamingFile = toStreamingFile;
OpenAI.Completions = Completions2;
OpenAI.Chat = Chat;
OpenAI.Embeddings = Embeddings;
OpenAI.Files = Files2;
OpenAI.Images = Images;
OpenAI.ContentProvenanceChecks = ContentProvenanceChecks;
OpenAI.Audio = Audio;
OpenAI.Moderations = Moderations;
OpenAI.Models = Models;
OpenAI.FineTuning = FineTuning;
OpenAI.Graders = Graders2;
OpenAI.VectorStores = VectorStores;
OpenAI.Safety = Safety;
OpenAI.Webhooks = Webhooks;
OpenAI.Beta = Beta;
OpenAI.Batches = Batches;
OpenAI.Uploads = Uploads;
OpenAI.Admin = Admin;
OpenAI.Responses = Responses2;
OpenAI.Realtime = Realtime2;
OpenAI.Conversations = Conversations;
OpenAI.Evals = Evals;
OpenAI.Containers = Containers;
OpenAI.Skills = Skills;
OpenAI.Videos = Videos;
var composedCallerSignals = /* @__PURE__ */ new WeakMap();
function createRequestController(callerSignal, originalSignal) {
  const controller = new AbortController();
  if (!callerSignal)
    return controller;
  const nativeAbortSignal = globalThis.AbortSignal;
  if (typeof nativeAbortSignal?.any !== "function" || !(callerSignal instanceof nativeAbortSignal)) {
    return controller;
  }
  try {
    const signals = [controller.signal, callerSignal];
    if (originalSignal && originalSignal !== callerSignal) {
      signals.push(originalSignal);
    }
    const composed = nativeAbortSignal.any(signals);
    Object.defineProperty(controller, "signal", { value: composed, configurable: true });
    composedCallerSignals.set(controller, callerSignal);
  } catch {
  }
  return controller;
}
function getConnectionErrorMessage(error) {
  if (isUndiciDispatcherVersionMismatchError(error)) {
    return `Connection error. This may be caused by passing an undici dispatcher, such as ProxyAgent, that is incompatible with the fetch implementation. If you are using undici's ProxyAgent, pass the fetch implementation from the same undici package: import { fetch, ProxyAgent } from 'undici'; new OpenAI({ fetch, fetchOptions: { dispatcher: new ProxyAgent(...) } });`;
  }
  return void 0;
}
function isUndiciDispatcherVersionMismatchError(error) {
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    const err = current;
    if (err.code === "UND_ERR_INVALID_ARG" && typeof err.message === "string" && err.message.includes("invalid onRequestStart method")) {
      return true;
    }
    current = err.cause;
  }
  return false;
}

// ../../../node_modules/openai/internal/bedrock.mjs
var brand_privateBedrockClient = /* @__PURE__ */ Symbol.for("openai.privateBedrockClient");

// ../../../node_modules/openai/bedrock.mjs
var _a4;
_a4 = brand_privateBedrockClient;

// node_modules/@quilltap/plugin-utils/dist/index.mjs
var import_fs = require("fs");
function parseOpenAIToolCalls(response) {
  const toolCalls = [];
  try {
    const resp = response;
    let toolCallsArray = resp?.tool_calls;
    if (!toolCallsArray) {
      toolCallsArray = resp?.toolCalls;
    }
    if (!toolCallsArray) {
      const choices = resp?.choices;
      toolCallsArray = choices?.[0]?.message?.tool_calls || choices?.[0]?.message?.toolCalls;
    }
    if (!toolCallsArray) {
      const choices = resp?.choices;
      toolCallsArray = choices?.[0]?.delta?.tool_calls || choices?.[0]?.delta?.toolCalls;
    }
    if (toolCallsArray && Array.isArray(toolCallsArray) && toolCallsArray.length > 0) {
      for (const toolCall of toolCallsArray) {
        const tc = toolCall;
        if (tc.type === "function" && tc.function) {
          const argsStr = tc.function.arguments || "{}";
          const trimmed = argsStr.trim();
          if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
            continue;
          }
          try {
            toolCalls.push({
              name: tc.function.name,
              arguments: JSON.parse(argsStr),
              callId: tc.id || void 0
            });
          } catch {
            continue;
          }
        }
      }
    }
  } catch (error) {
    console.error("[plugin-utils] Error parsing OpenAI tool calls:", error);
  }
  return toolCalls;
}
function getCoreLoggerFactory() {
  return globalThis.__quilltap_logger_factory ?? null;
}
function createConsoleLoggerWithChild(prefix, minLevel = "debug", baseContext = {}) {
  const levels = ["debug", "info", "warn", "error"];
  const shouldLog = (level) => levels.indexOf(level) >= levels.indexOf(minLevel);
  const formatContext = (context) => {
    const merged = { ...baseContext, ...context };
    const entries = Object.entries(merged).filter(([key]) => key !== "context").map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
    return entries ? ` ${entries}` : "";
  };
  const logger4 = {
    debug: (message, context) => {
      if (shouldLog("debug")) {
        console.debug(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },
    info: (message, context) => {
      if (shouldLog("info")) {
        console.info(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },
    warn: (message, context) => {
      if (shouldLog("warn")) {
        console.warn(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },
    error: (message, context, error) => {
      if (shouldLog("error")) {
        console.error(
          `[${prefix}] ${message}${formatContext(context)}`,
          error ? `
${error.stack || error.message}` : ""
        );
      }
    },
    child: (additionalContext) => {
      return createConsoleLoggerWithChild(prefix, minLevel, {
        ...baseContext,
        ...additionalContext
      });
    }
  };
  return logger4;
}
function createPluginLogger(pluginName, minLevel = "debug") {
  const coreFactory = getCoreLoggerFactory();
  if (coreFactory) {
    return coreFactory(pluginName);
  }
  return createConsoleLoggerWithChild(pluginName, minLevel);
}
var GLOBAL_VERSION_KEY = "__quilltap_app_version";
function getQuilltapVersion() {
  const version = globalThis[GLOBAL_VERSION_KEY];
  return typeof version === "string" ? version : "unknown";
}
function getQuilltapUserAgent() {
  return `Quilltap/${getQuilltapVersion()}`;
}
var DEFAULT_REQUEST_TIMEOUT_MS = 3e5;
function resolveRequestTimeoutMs(params, defaultMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const requested = params.requestTimeoutMs;
  return typeof requested === "number" && requested > 0 ? requested : defaultMs;
}
function buildRequestAbortSignal(params, defaultMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(resolveRequestTimeoutMs(params, defaultMs));
}
function applyProfileParameters(body, params, allowlist, normalize) {
  const profile = params.profileParameters;
  if (!profile || typeof profile !== "object") return;
  const bag = profile;
  for (const key of allowlist) {
    const raw = bag[key];
    if (raw === void 0 || raw === null) continue;
    if (typeof raw === "string" && raw === "") continue;
    const value = normalize ? normalize(key, raw, params, body) : raw;
    if (value === void 0) continue;
    body[key] = value;
  }
}
function collapseLeadingSystemMessages(messages) {
  let runLength = 0;
  while (runLength < messages.length && messages[runLength].role === "system") {
    runLength++;
  }
  if (runLength < 2) return messages;
  const run = messages.slice(0, runLength);
  const merged = {
    ...run[0],
    content: run.map((m) => m.content ?? "").filter((c) => c.length > 0).join("\n\n")
  };
  return [merged, ...messages.slice(runLength)];
}
var rewriteLogger = createPluginLogger("host-rewrite");

// think-parser.ts
var OPEN_TAG = "<think>";
var CLOSE_TAG = "</think>";
function partialTagSuffixLength(text, tag) {
  const max = Math.min(text.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (tag.startsWith(text.slice(text.length - k))) return k;
  }
  return 0;
}
var ThinkTagStreamParser = class {
  constructor() {
    this.pending = "";
    this.inThink = false;
    this.sawThinkBlock = false;
    this.emittedVisible = false;
    this.reasoningText = "";
  }
  /** Reasoning captured so far (raw, monotonically growing). */
  get reasoning() {
    return this.reasoningText;
  }
  /** Feed a content delta; returns the displayable text it releases. */
  push(delta) {
    this.pending += delta;
    let out = "";
    for (; ; ) {
      if (this.inThink) {
        const close = this.pending.indexOf(CLOSE_TAG);
        if (close !== -1) {
          this.reasoningText += this.pending.slice(0, close);
          this.pending = this.pending.slice(close + CLOSE_TAG.length);
          this.inThink = false;
          continue;
        }
        const hold2 = partialTagSuffixLength(this.pending, CLOSE_TAG);
        this.reasoningText += this.pending.slice(0, this.pending.length - hold2);
        this.pending = this.pending.slice(this.pending.length - hold2);
        break;
      }
      const open = this.pending.indexOf(OPEN_TAG);
      const orphanEligible = !this.sawThinkBlock && !this.emittedVisible;
      if (orphanEligible) {
        const close = this.pending.indexOf(CLOSE_TAG);
        if (close !== -1 && (open === -1 || close < open)) {
          this.reasoningText += out + this.pending.slice(0, close);
          out = "";
          this.pending = this.pending.slice(close + CLOSE_TAG.length);
          this.sawThinkBlock = true;
          continue;
        }
      }
      if (open !== -1) {
        out += this.pending.slice(0, open);
        this.pending = this.pending.slice(open + OPEN_TAG.length);
        this.inThink = true;
        this.sawThinkBlock = true;
        continue;
      }
      const holdOpen = partialTagSuffixLength(this.pending, OPEN_TAG);
      const holdClose = orphanEligible ? partialTagSuffixLength(this.pending, CLOSE_TAG) : 0;
      const hold = Math.max(holdOpen, holdClose);
      out += this.pending.slice(0, this.pending.length - hold);
      this.pending = this.pending.slice(this.pending.length - hold);
      break;
    }
    return this.sanitize(out);
  }
  /** Release whatever is still held. Call exactly once, at end of stream. */
  flush() {
    const tail = this.pending;
    this.pending = "";
    if (this.inThink) {
      this.reasoningText += tail;
      return "";
    }
    return this.sanitize(tail);
  }
  /**
   * Drop the whitespace a template leaves between the think block and the
   * real answer — but only when a think block was actually consumed, so
   * ordinary responses come through untouched.
   */
  sanitize(text) {
    if (!text) return text;
    if (!this.emittedVisible && this.sawThinkBlock) {
      text = text.replace(/^\s+/, "");
      if (!text) return text;
    }
    this.emittedVisible = true;
    return text;
  }
};
function extractThinkBlocks(content) {
  const parser = new ThinkTagStreamParser();
  const out = parser.push(content) + parser.flush();
  return { content: out, reasoning: parser.reasoning };
}

// profile-options.ts
var OLLAMA_OPTION_PARAM_ALLOWLIST = [
  "num_ctx",
  "top_k",
  "min_p",
  "repeat_penalty",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "mirostat",
  "mirostat_tau",
  "mirostat_eta"
];
var OLLAMA_TOP_LEVEL_PARAM_ALLOWLIST = ["keep_alive"];
var NUMERIC_OPTIONS = /* @__PURE__ */ new Set([
  "num_ctx",
  "top_k",
  "min_p",
  "repeat_penalty",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "mirostat",
  "mirostat_tau",
  "mirostat_eta"
]);
var POSITIVE_INTEGER_OPTIONS = /* @__PURE__ */ new Set(["num_ctx"]);
var OLLAMA_THINK_LEVELS = ["low", "medium", "high", "max"];
var DEFAULT_REQUEST_TIMEOUT_SECONDS = 300;
function resolveThinkSetting(params) {
  const value = params.profileParameters?.enable_thinking;
  if (value !== true && value !== "true") return false;
  const effort = params.profileParameters?.thinking_effort;
  if (typeof effort === "string" && OLLAMA_THINK_LEVELS.includes(effort)) {
    return effort;
  }
  return true;
}
function resolveProfileTimeoutMs(params) {
  const value = params.profileParameters?.request_timeout_seconds;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1e3 : DEFAULT_REQUEST_TIMEOUT_SECONDS * 1e3;
}
function normalizeOption(key, value) {
  if (NUMERIC_OPTIONS.has(key)) {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(n)) return void 0;
    if (POSITIVE_INTEGER_OPTIONS.has(key)) {
      return n > 0 ? Math.floor(n) : void 0;
    }
    return n;
  }
  return value;
}
function normalizeTopLevel(key, value) {
  if (key === "keep_alive") {
    if (typeof value === "string") {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }
  return value;
}
function applyOllamaProfileParameters(body, params) {
  const options = body.options ?? {};
  applyProfileParameters(
    options,
    params,
    OLLAMA_OPTION_PARAM_ALLOWLIST,
    (key, value) => normalizeOption(key, value)
  );
  body.options = options;
  applyProfileParameters(
    body,
    params,
    OLLAMA_TOP_LEVEL_PARAM_ALLOWLIST,
    (key, value) => normalizeTopLevel(key, value)
  );
}

// provider.ts
var logger = createPluginLogger("qtap-plugin-ollama");
function isThinkRejection(errorText) {
  return /think/i.test(errorText);
}
async function fetchWithThinkRetry(send, requestBody, ctx) {
  let response = await send();
  let errorText = "";
  if (!response.ok) {
    errorText = await response.text();
    if ("think" in requestBody && isThinkRejection(errorText)) {
      logger.warn("Ollama rejected the think parameter; retrying without it", {
        context: ctx.context,
        model: ctx.model,
        enableThinking: ctx.enableThinking,
        error: errorText
      });
      delete requestBody.think;
      response = await send();
      if (!response.ok) errorText = await response.text();
    }
  }
  return { response, errorText };
}
var OllamaProvider = class {
  constructor(baseUrl) {
    this.supportsFileAttachments = false;
    this.supportedMimeTypes = [];
    this.supportsWebSearch = false;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
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
  /**
   * Build the `/api/chat` request body — the ONE build both sendMessage and
   * streamMessage call, so the streaming and non-streaming shapes cannot
   * drift apart. Returns the resolved think setting alongside the body
   * because both callers log it.
   */
  buildRequestBody(params, stream) {
    const mappedMessages = params.messages.filter((m) => {
      if (m.role === "tool" && !m.toolCallId) return false;
      return true;
    }).map((m) => {
      if (m.role === "tool" && m.toolCallId) {
        return {
          role: "tool",
          tool_call_id: m.toolCallId,
          content: m.content
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: tc.function
          }))
        };
      }
      return {
        role: m.role,
        content: m.content
      };
    });
    const messages = collapseLeadingSystemMessages(mappedMessages);
    const enableThinking = resolveThinkSetting(params);
    const requestBody = {
      model: params.model,
      messages,
      stream,
      // Ollama's native thinking switch (0.9+; older servers ignore unknown
      // fields). When off, thinking-capable models answer directly; when on,
      // Ollama returns the reasoning separately as `message.thinking` — as
      // deltas when streaming. Newer servers also accept an effort level in
      // place of the boolean.
      think: enableThinking,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop
      }
    };
    applyOllamaProfileParameters(requestBody, params);
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools;
    }
    return { requestBody, enableThinking };
  }
  async sendMessage(params, apiKey) {
    const attachmentResults = this.collectAttachmentFailures(params);
    const { requestBody, enableThinking } = this.buildRequestBody(params, false);
    try {
      const doFetch = () => fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getQuilltapUserAgent()
        },
        body: JSON.stringify(requestBody),
        // Non-streaming: the whole exchange is one JSON blob, so bounding the
        // entire request is right. A local endpoint that stops answering — a
        // model still loading, a crashed runner — fails instead of hanging.
        signal: buildRequestAbortSignal(params, resolveProfileTimeoutMs(params))
      });
      const { response, errorText } = await fetchWithThinkRetry(doFetch, requestBody, {
        context: "OllamaProvider.sendMessage",
        model: params.model,
        enableThinking
      });
      if (!response.ok) {
        logger.error("Ollama API error response", { context: "OllamaProvider.sendMessage", status: response.status, error: errorText });
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }
      const data = await response.json();
      const rawContent = typeof data.message?.content === "string" ? data.message.content : "";
      const { content, reasoning: inlineReasoning } = extractThinkBlocks(rawContent);
      const nativeThinking = typeof data.message?.thinking === "string" ? data.message.thinking : "";
      const reasoningContent = nativeThinking + inlineReasoning;
      if (reasoningContent) {
        logger.debug("Ollama response carried reasoning", {
          context: "OllamaProvider.sendMessage",
          model: params.model,
          enableThinking,
          nativeChars: nativeThinking.length,
          inlineChars: inlineReasoning.length
        });
      }
      return {
        content,
        finishReason: data.done ? "stop" : "length",
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0)
        },
        raw: data,
        attachmentResults,
        ...reasoningContent ? { reasoningContent } : {}
      };
    } catch (error) {
      logger.error("Ollama sendMessage failed", { context: "OllamaProvider.sendMessage", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      throw error;
    }
  }
  async *streamMessage(params, apiKey) {
    const attachmentResults = this.collectAttachmentFailures(params);
    const { requestBody, enableThinking } = this.buildRequestBody(params, true);
    try {
      const openStream = async () => {
        const controller = new AbortController();
        const firstByteTimer = setTimeout(
          () => controller.abort(),
          resolveRequestTimeoutMs(params, resolveProfileTimeoutMs(params))
        );
        try {
          return await fetch(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": getQuilltapUserAgent()
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });
        } finally {
          clearTimeout(firstByteTimer);
        }
      };
      const { response, errorText } = await fetchWithThinkRetry(openStream, requestBody, {
        context: "OllamaProvider.streamMessage",
        model: params.model,
        enableThinking
      });
      if (!response.ok) {
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
      const thinkParser = new ThinkTagStreamParser();
      let reasoningSoFar = "";
      let inlineReasoningSeen = 0;
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let lines;
          if (done) {
            lines = buffer.split("\n");
            buffer = "";
          } else {
            lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
          }
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            try {
              const data = JSON.parse(trimmedLine);
              if (data.model) {
                lastModel = data.model;
              }
              if (data.message?.tool_calls && Array.isArray(data.message.tool_calls)) {
                toolCalls = [...toolCalls, ...data.message.tool_calls];
              }
              let reasoningGrew = false;
              if (typeof data.message?.thinking === "string" && data.message.thinking) {
                reasoningSoFar += data.message.thinking;
                reasoningGrew = true;
              }
              if (data.message?.content) {
                const visible = thinkParser.push(data.message.content);
                if (thinkParser.reasoning.length > inlineReasoningSeen) {
                  reasoningSoFar += thinkParser.reasoning.slice(inlineReasoningSeen);
                  inlineReasoningSeen = thinkParser.reasoning.length;
                  reasoningGrew = true;
                }
                if (visible) {
                  chunkCount++;
                  totalContent += visible;
                  yield {
                    content: visible,
                    done: false,
                    ...reasoningGrew ? { reasoningContent: reasoningSoFar } : {}
                  };
                  reasoningGrew = false;
                }
              } else if (data.message && !data.message.content && !data.done && !data.message.tool_calls) {
              }
              if (reasoningGrew) {
                yield {
                  content: "",
                  done: false,
                  reasoningContent: reasoningSoFar
                };
              }
              if (data.prompt_eval_count) {
                totalPromptTokens = data.prompt_eval_count;
              }
              if (data.eval_count) {
                totalCompletionTokens = data.eval_count;
              }
              if (data.done) {
                const tail = thinkParser.flush();
                if (thinkParser.reasoning.length > inlineReasoningSeen) {
                  reasoningSoFar += thinkParser.reasoning.slice(inlineReasoningSeen);
                  inlineReasoningSeen = thinkParser.reasoning.length;
                }
                if (tail) {
                  chunkCount++;
                  totalContent += tail;
                  yield { content: tail, done: false };
                }
                if (reasoningSoFar) {
                  logger.debug("Ollama stream carried reasoning", {
                    context: "OllamaProvider.streamMessage",
                    model: lastModel,
                    enableThinking,
                    reasoningChars: reasoningSoFar.length,
                    inlineChars: inlineReasoningSeen
                  });
                }
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
                  rawResponse,
                  ...reasoningSoFar ? { reasoningContent: reasoningSoFar } : {}
                };
              }
            } catch (e) {
              if (done) {
                logger.debug("Discarding unparseable Ollama stream tail", {
                  context: "OllamaProvider.streamMessage",
                  provider: "ollama",
                  line: trimmedLine.substring(0, 100),
                  error: e instanceof Error ? e.message : String(e)
                });
              } else {
                logger.warn("Failed to parse Ollama stream line", {
                  context: "OllamaProvider.streamMessage",
                  provider: "ollama",
                  line: trimmedLine.substring(0, 100),
                  error: e instanceof Error ? e.message : String(e)
                });
              }
            }
          }
          if (done) break;
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
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: {
          "User-Agent": getQuilltapUserAgent()
        }
      });
      const isValid = response.ok;
      return isValid;
    } catch (error) {
      logger.error("Ollama server validation failed", { context: "OllamaProvider.validateApiKey", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: {
          "User-Agent": getQuilltapUserAgent()
        }
      });
      if (!response.ok) {
        logger.error("Failed to fetch Ollama models", { context: "OllamaProvider.getAvailableModels", status: response.status });
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      const models = data.models?.map((m) => m.name) ?? [];
      return models;
    } catch (error) {
      logger.error("Failed to fetch Ollama models", { context: "OllamaProvider.getAvailableModels", baseUrl: this.baseUrl }, error instanceof Error ? error : void 0);
      return [];
    }
  }
};

// embedding-provider.ts
var logger2 = createPluginLogger("qtap-plugin-ollama");
var NUM_CTX_CEILING = 16384;
var NUM_CTX_FALLBACK = 8192;
var numCtxCache = /* @__PURE__ */ new Map();
var numCtxInflight = /* @__PURE__ */ new Map();
function assertFiniteEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("No embedding returned from Ollama");
  }
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== "number" || !Number.isFinite(embedding[i])) {
      throw new Error("Ollama returned a non-finite (NaN/Inf) embedding");
    }
  }
}
var OllamaEmbeddingProvider = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || "http://localhost:11434";
  }
  /**
   * Generate an embedding for the given text.
   *
   * Note: Ollama doesn't require an API key, but the interface requires it.
   * The apiKey parameter is ignored for Ollama. The options parameter is
   * accepted to match the EmbeddingProvider contract; `dimensions` has no
   * effect on Ollama's embedding endpoint, and num_ctx is derived internally.
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'nomic-embed-text')
   * @param apiKey Ignored for Ollama (no API key required)
   * @param options Ignored for Ollama (see note above)
   * @returns The embedding result
   */
  async generateEmbedding(text, model, apiKey, options) {
    void apiKey;
    void options;
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot embed empty input");
    }
    const numCtx = await this.resolveNumCtx(model);
    const requestPayload = {
      model,
      input: text,
      truncate: true,
      options: { num_ctx: numCtx }
    };
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": getQuilltapUserAgent()
      },
      body: JSON.stringify(requestPayload)
    });
    if (response.status === 404) {
      logger2.warn("Ollama /api/embed not found (404); falling back to legacy /api/embeddings", {
        context: "OllamaEmbeddingProvider.generateEmbedding",
        model
      });
      return this.generateEmbeddingLegacy(text, model);
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error || response.statusText;
      logger2.error("Ollama embedding failed", {
        context: "OllamaEmbeddingProvider.generateEmbedding",
        status: response.status,
        model,
        numCtx,
        error: errorMessage
      });
      throw new Error(`Ollama embedding failed: ${errorMessage}`);
    }
    const data = await response.json();
    const embedding = Array.isArray(data.embeddings) ? data.embeddings[0] : void 0;
    assertFiniteEmbedding(embedding);
    return {
      embedding,
      model,
      dimensions: embedding.length
    };
  }
  /**
   * Legacy embedding path for Ollama servers without /api/embed.
   *
   * The legacy endpoint does not reliably honour `truncate`, so we send the
   * minimal payload and let Ollama use whatever context it loaded with.
   */
  async generateEmbeddingLegacy(text, model) {
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot embed empty input");
    }
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": getQuilltapUserAgent()
      },
      body: JSON.stringify({ model, prompt: text })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error || response.statusText;
      logger2.error("Ollama embedding failed (legacy endpoint)", {
        context: "OllamaEmbeddingProvider.generateEmbeddingLegacy",
        status: response.status,
        model,
        error: errorMessage
      });
      throw new Error(`Ollama embedding failed: ${errorMessage}`);
    }
    const data = await response.json();
    const embedding = data.embedding;
    assertFiniteEmbedding(embedding);
    return {
      embedding,
      model,
      dimensions: embedding.length
    };
  }
  /**
   * Resolve the context window to request for a model, derived from the model's
   * own reported context length and capped at NUM_CTX_CEILING. Cached per
   * `${baseUrl}::${model}` (successful derivations only), with concurrent
   * lookups for the same key deduped.
   */
  async resolveNumCtx(model) {
    const key = `${this.baseUrl}::${model}`;
    const cached = numCtxCache.get(key);
    if (cached !== void 0) {
      return cached;
    }
    let inflight = numCtxInflight.get(key);
    if (!inflight) {
      inflight = this.fetchModelNumCtx(model);
      numCtxInflight.set(key, inflight);
    }
    try {
      const { numCtx, derived } = await inflight;
      if (derived) {
        numCtxCache.set(key, numCtx);
      }
      return numCtx;
    } finally {
      numCtxInflight.delete(key);
    }
  }
  /**
   * Query /api/show for the model's metadata and pull out its context length.
   * Returns `{ derived: false }` with the fallback when the call fails or the
   * model reports no context length.
   */
  async fetchModelNumCtx(model) {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getQuilltapUserAgent()
        },
        body: JSON.stringify({ model })
      });
      if (!response.ok) {
        logger2.warn("Ollama /api/show failed; using fallback num_ctx", {
          context: "OllamaEmbeddingProvider.fetchModelNumCtx",
          model,
          status: response.status,
          fallback: NUM_CTX_FALLBACK
        });
        return { numCtx: NUM_CTX_FALLBACK, derived: false };
      }
      const data = await response.json();
      const modelInfo = data && data.model_info || {};
      let modelCtx;
      for (const [k, v] of Object.entries(modelInfo)) {
        if ((k.endsWith(".context_length") || k === "context_length") && typeof v === "number" && v > 0) {
          modelCtx = v;
          break;
        }
      }
      if (!modelCtx) {
        logger2.warn("Ollama /api/show returned no context_length; using fallback num_ctx", {
          context: "OllamaEmbeddingProvider.fetchModelNumCtx",
          model,
          fallback: NUM_CTX_FALLBACK
        });
        return { numCtx: NUM_CTX_FALLBACK, derived: false };
      }
      const numCtx = Math.min(modelCtx, NUM_CTX_CEILING);
      return { numCtx, derived: true };
    } catch (error) {
      logger2.warn(
        "Ollama /api/show threw; using fallback num_ctx",
        {
          context: "OllamaEmbeddingProvider.fetchModelNumCtx",
          model,
          fallback: NUM_CTX_FALLBACK,
          // PluginLogger.warn takes (message, context) — only error() accepts a
          // third Error argument. This was passed as a third argument and
          // silently dropped, so the warning carried no cause. Fold it in.
          error: error instanceof Error ? error.message : String(error)
        }
      );
      return { numCtx: NUM_CTX_FALLBACK, derived: false };
    }
  }
  /**
   * Generate embeddings for multiple texts in a batch
   *
   * Note: Ollama doesn't have a native batch API, so this processes texts sequentially.
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey Ignored for Ollama
   * @param options Ignored for Ollama (matches interface)
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(texts, model, apiKey, options) {
    const results = [];
    for (const text of texts) {
      const result = await this.generateEmbedding(text, model, apiKey, options);
      results.push(result);
    }
    return results;
  }
  /**
   * Get available embedding models from Ollama
   *
   * @param apiKey Ignored for Ollama
   * @returns Array of model names that support embeddings
   */
  async getAvailableModels(apiKey) {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: {
          "User-Agent": getQuilltapUserAgent()
        }
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const models = data.models?.map((m) => m.name) || [];
      return models;
    } catch (error) {
      logger2.error("Failed to fetch Ollama models", {
        context: "OllamaEmbeddingProvider.getAvailableModels",
        baseUrl: this.baseUrl
      }, error instanceof Error ? error : void 0);
      return [];
    }
  }
  /**
   * Check if the Ollama server is available
   *
   * @returns True if the Ollama server is reachable
   */
  async isAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: {
          "User-Agent": getQuilltapUserAgent()
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
};

// node_modules/@quilltap/plugin-utils/dist/tools/index.mjs
var TOOL_NAME_ALIASES = {
  // Direct mappings
  "search": "search",
  "generate_image": "generate_image",
  "search_web": "search_web",
  // Memory/Search tool aliases
  "memory": "search",
  "memory_search": "search",
  "search_memory": "search",
  "memories": "search",
  "search_memories": "search",
  "search_scriptorium": "search",
  // Image tool aliases
  "image": "generate_image",
  "create_image": "generate_image",
  "image_generation": "generate_image",
  "gen_image": "generate_image",
  // Web search aliases
  "web_search": "search_web",
  "websearch": "search_web",
  "web": "search_web",
  // Help tool aliases
  "help_search": "help_search",
  "helpsearch": "help_search",
  "search_help": "help_search",
  "help_navigate": "help_navigate",
  "helpnavigate": "help_navigate"
};
function normalizeToolName(name) {
  const normalized = name.toLowerCase().trim();
  return TOOL_NAME_ALIASES[normalized] || name;
}
function convertToToolCallRequest(parsed) {
  switch (parsed.toolName) {
    case "search":
      return {
        name: "search",
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || "",
          limit: parsed.arguments.limit
        }
      };
    case "generate_image":
      return {
        name: "generate_image",
        arguments: {
          prompt: parsed.arguments.prompt || parsed.arguments.description || Object.values(parsed.arguments)[0] || ""
        }
      };
    case "search_web":
      return {
        name: "search_web",
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || ""
        }
      };
    case "help_search":
      return {
        name: "help_search",
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || "",
          limit: parsed.arguments.limit
        }
      };
    case "help_navigate":
      return {
        name: "help_navigate",
        arguments: {
          url: parsed.arguments.url || parsed.arguments.path || Object.values(parsed.arguments)[0] || ""
        }
      };
    default:
      return {
        name: parsed.toolName,
        arguments: parsed.arguments
      };
  }
}
function parseFunctionCallsFormat(response) {
  const results = [];
  const functionCallsPattern = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
  let wrapperMatch;
  while ((wrapperMatch = functionCallsPattern.exec(response)) !== null) {
    const wrapperContent = wrapperMatch[1];
    const wrapperStartIndex = wrapperMatch.index;
    const contentOffset = wrapperStartIndex + "<function_calls>".length;
    const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
    let invokeMatch;
    while ((invokeMatch = invokePattern.exec(wrapperContent)) !== null) {
      const toolName = invokeMatch[1];
      const paramContent = invokeMatch[2];
      const invokeStartIndex = contentOffset + invokeMatch.index;
      const invokeEndIndex = invokeStartIndex + invokeMatch[0].length;
      const args = {};
      let format = "claude";
      const deepseekParamPattern = /<parameter\s+name=["']([^"']+)["']\s+string=["']([^"']*)["'][^>]*>([^<]*)<\/parameter>/gi;
      let paramMatch;
      while ((paramMatch = deepseekParamPattern.exec(paramContent)) !== null) {
        const paramName = paramMatch[1];
        const stringAttr = paramMatch[2];
        const value = paramMatch[3].trim();
        if (stringAttr === "false") {
          const numVal = Number(value);
          if (!isNaN(numVal)) {
            args[paramName] = numVal;
          } else if (value === "true") {
            args[paramName] = true;
          } else if (value === "false") {
            args[paramName] = false;
          } else {
            args[paramName] = value;
          }
        } else {
          args[paramName] = value;
        }
        format = "deepseek";
      }
      if (Object.keys(args).length === 0) {
        const claudeParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
        while ((paramMatch = claudeParamPattern.exec(paramContent)) !== null) {
          args[paramMatch[1]] = paramMatch[2].trim();
        }
      }
      const antmlParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/antml:parameter>/gi;
      while ((paramMatch = antmlParamPattern.exec(paramContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }
      results.push({
        toolName: normalizeToolName(toolName),
        arguments: args,
        fullMatch: invokeMatch[0],
        startIndex: invokeStartIndex,
        endIndex: invokeEndIndex,
        format
      });
    }
  }
  return results;
}
function parseToolCallFormat(response) {
  const results = [];
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = toolCallPattern.exec(response)) !== null) {
    const content = match[1];
    const startIndex = match.index;
    const nameMatch = /<name>([^<]+)<\/name>/i.exec(content);
    if (!nameMatch) continue;
    const toolName = nameMatch[1].trim();
    const args = {};
    const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(content);
    if (argsMatch) {
      const argsContent = argsMatch[1];
      const argPattern = /<(\w+)>([^<]*)<\/\1>/gi;
      let argMatch;
      while ((argMatch = argPattern.exec(argsContent)) !== null) {
        args[argMatch[1]] = argMatch[2].trim();
      }
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: "generic"
    });
  }
  return results;
}
function parseFunctionCallFormat(response) {
  const results = [];
  const functionCallPattern = /<function_call\s+name=["']([^"']+)["']>([\s\S]*?)<\/function_call>/gi;
  let match;
  while ((match = functionCallPattern.exec(response)) !== null) {
    const toolName = match[1];
    const content = match[2];
    const startIndex = match.index;
    const args = {};
    const paramPattern = /<param\s+name=["']([^"']+)["']>([^<]*)<\/param>/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    const parameterPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
    while ((paramMatch = parameterPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: "function_call"
    });
  }
  return results;
}
function parseToolUseFormat(response) {
  const results = [];
  const toolUsePattern = /<tool_use(?:\s+name=["']([^"']+)["'])?\s*>([\s\S]*?)<\/tool_use>/gi;
  let match;
  while ((match = toolUsePattern.exec(response)) !== null) {
    const attrName = match[1];
    const content = match[2];
    const startIndex = match.index;
    const trimmedContent = content.trim();
    if (trimmedContent.startsWith("{")) {
      try {
        const jsonBlob = JSON.parse(trimmedContent);
        if (typeof jsonBlob === "object" && jsonBlob !== null && jsonBlob.name) {
          const args2 = jsonBlob.input || jsonBlob.arguments || jsonBlob.parameters || {};
          results.push({
            toolName: normalizeToolName(jsonBlob.name),
            arguments: typeof args2 === "object" && args2 !== null ? args2 : {},
            fullMatch: match[0],
            startIndex,
            endIndex: startIndex + match[0].length,
            format: "tool_use"
          });
          continue;
        }
      } catch {
      }
    }
    let toolName = attrName;
    if (!toolName) {
      const nameMatch = /<name>([^<]+)<\/name>/i.exec(content);
      if (!nameMatch) continue;
      toolName = nameMatch[1].trim();
    }
    const args = {};
    const argsMatch = /<(?:arguments|input|parameters)>([\s\S]*?)<\/(?:arguments|input|parameters)>/i.exec(content);
    if (argsMatch) {
      const argsContent = argsMatch[1].trim();
      if (argsContent.startsWith("{")) {
        try {
          const parsed = JSON.parse(argsContent);
          if (typeof parsed === "object" && parsed !== null) {
            Object.assign(args, parsed);
          }
        } catch {
        }
      }
      if (Object.keys(args).length === 0) {
        const argPattern = /<(\w+)>([^<]*)<\/\1>/gi;
        let argMatch;
        while ((argMatch = argPattern.exec(argsContent)) !== null) {
          args[argMatch[1]] = argMatch[2].trim();
        }
      }
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: "tool_use"
    });
  }
  return results;
}
function parseInvokeFormat(response) {
  const results = [];
  const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  let match;
  while ((match = invokePattern.exec(response)) !== null) {
    const toolName = match[1];
    const paramContent = match[2];
    const startIndex = match.index;
    const args = {};
    const paramPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(paramContent)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: "invoke"
    });
  }
  return results;
}
function parseAllXMLFormats(response) {
  const allResults = [];
  allResults.push(...parseFunctionCallsFormat(response));
  allResults.push(...parseToolCallFormat(response));
  allResults.push(...parseFunctionCallFormat(response));
  allResults.push(...parseToolUseFormat(response));
  allResults.push(...parseInvokeFormat(response));
  const seen = /* @__PURE__ */ new Set();
  const deduped = allResults.filter((result) => {
    if (seen.has(result.startIndex)) {
      return false;
    }
    seen.add(result.startIndex);
    return true;
  });
  deduped.sort((a, b) => a.startIndex - b.startIndex);
  return deduped;
}
function parseAllXMLAsToolCalls(response) {
  return parseAllXMLFormats(response).map(convertToToolCallRequest);
}
function hasAnyXMLToolMarkers(response) {
  return /<function_calls>/i.test(response) || /<tool_call>/i.test(response) || /<function_call\s+/i.test(response) || /<tool_use[\s>]/i.test(response) || /<invoke\s+name=/i.test(response);
}
function stripAllXMLToolMarkers(response) {
  let stripped = response;
  stripped = stripped.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "");
  stripped = stripped.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  stripped = stripped.replace(/<function_call\s+[^>]*>[\s\S]*?<\/function_call>/gi, "");
  stripped = stripped.replace(/<tool_use[\s>][\s\S]*?<\/tool_use>/gi, "");
  stripped = stripped.replace(/<invoke\s+name=["'][^"']*["']>[\s\S]*?<\/invoke>/gi, "");
  stripped = stripped.replace(/\n{3,}/g, "\n\n").replace(/  +/g, " ").trim();
  return stripped;
}

// index.ts
var logger3 = createPluginLogger("qtap-plugin-ollama");
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
  webSearch: false,
  // The provider forwards native tool definitions and normalizes tool_calls,
  // and modern local models (Qwen3 family, Llama 3.x, …) handle them. The
  // per-profile "Allow tool use" checkbox remains the gate; models without
  // template tool support can use the pseudo-tool (simple-json) format.
  toolUse: true
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "File attachments not yet supported (requires multimodal model detection)",
  notes: "Multimodal models like llava can process images, but require model-specific implementation"
};
var messageFormat = {
  supportsNameField: false,
  supportedRoles: []
};
var cheapModels = {
  defaultModel: "llama3.2:3b",
  recommendedModels: ["llama3.2:3b", "llama3.2:1b", "phi3:mini", "mistral:7b", "gemma2:2b"]
};
var optionsSchema = {
  groups: [
    {
      title: "Ollama Options",
      fields: [
        {
          key: "enable_thinking",
          label: "Enable Thinking",
          type: "boolean",
          default: false,
          helpText: "Let thinking-capable models (Qwen3, DeepSeek-R1, and kin) reason before answering. Reasoning streams into the thinking display rather than the reply. When off (the default), the model is asked to answer directly \u2014 best when you need clean output such as JSON. Either way, any <think> blocks that leak into the reply are routed to the thinking display."
        },
        {
          key: "thinking_effort",
          label: "Thinking Effort",
          type: "enum",
          default: "",
          showIf: { field: "enable_thinking", equals: true },
          enumValues: [
            { value: "", label: "Model default", description: "Let the model decide how long to think" },
            { value: "low", label: "Low", description: "Shortest reasoning, quickest replies" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "max", label: "Maximum", description: "Longest reasoning, slowest replies" }
          ],
          helpText: "How long the model may reason before answering. On a local machine every reasoning token is wall-clock time, so this is the largest speed control you have. Needs a recent Ollama and a model whose template understands effort levels; older servers fall back to plain thinking."
        },
        {
          key: "keep_alive",
          label: "Keep Model Loaded",
          type: "enum",
          default: "",
          enumValues: [
            { value: "", label: "Server default", description: "Whatever your Ollama is configured to do" },
            { value: "0", label: "Unload immediately", description: "Free the memory as soon as the reply is done" },
            { value: "5m", label: "5 minutes" },
            { value: "30m", label: "30 minutes" },
            { value: "1h", label: "1 hour" },
            { value: "-1", label: "Keep loaded", description: "Never unload while the server runs" }
          ],
          helpText: 'How long Ollama keeps this model in memory after a reply. The server unloads after five minutes by default, and reloading a large model costs half a minute on the next message. Set per profile, so a big chat model can stay resident while a small utility one unloads at once. Leave on "Server default" and your OLLAMA_KEEP_ALIVE setting is left entirely alone.'
        },
        {
          key: "request_timeout_seconds",
          label: "Request Timeout (seconds)",
          type: "number",
          default: DEFAULT_REQUEST_TIMEOUT_SECONDS,
          helpText: `How long to wait for the server before giving up (default ${DEFAULT_REQUEST_TIMEOUT_SECONDS}). While streaming this covers only the wait for the first token, so a long answer is never cut off mid-sentence \u2014 but loading a large model and reading a long prompt both happen before that first token. Raise it if big models on a busy machine abort with "operation was aborted"; lower it if you would rather a stalled server fail quickly. Leave blank for the default.`
        }
      ]
    },
    {
      title: "Sampling",
      helpText: "Sent only when filled in; blank leaves the model\u2019s own default in charge. Model publishers usually name the values they want \u2014 Qwen3 asks for Top K 20 and Min P 0.",
      fields: [
        {
          key: "top_k",
          label: "Top K",
          type: "number",
          helpText: "Keep only the K most likely next tokens."
        },
        {
          key: "min_p",
          label: "Min P",
          type: "number",
          helpText: "Drop tokens less likely than this fraction of the best one."
        },
        {
          key: "repeat_penalty",
          label: "Repeat Penalty",
          type: "number",
          helpText: "Penalty applied to tokens already used. Above 1 discourages repetition; 1 disables it."
        },
        {
          key: "presence_penalty",
          label: "Presence Penalty",
          type: "number",
          helpText: "Discourages tokens that have appeared at all. Some publishers recommend a value for non-thinking mode (Qwen3.8 asks for 1.5)."
        },
        {
          key: "frequency_penalty",
          label: "Frequency Penalty",
          type: "number",
          helpText: "Discourages tokens in proportion to how often they have already appeared."
        },
        {
          key: "seed",
          label: "Seed",
          type: "number",
          helpText: "Fixes the sampler so the same prompt gives the same answer."
        }
      ]
    }
  ]
};
var plugin = {
  metadata,
  icon: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M7 2l2 5h6l2-5h-2l-1.5 3h-3L9 2H7zM12 8a6 6 0 100 12 6 6 0 000-12zm-2 4a1 1 0 110 2 1 1 0 010-2zm4 0a1 1 0 110 2 1 1 0 010-2z", fill: "currentColor", fillRule: "evenodd" }
    ]
  },
  config,
  capabilities,
  attachmentSupport,
  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: "openai",
  // Ollama uses OpenAI-compatible format
  cheapModels,
  defaultContextWindow: 8192,
  // Conservative default for local models
  /**
   * Connection-profile options schema rendered by the host's profile editor.
   */
  getProviderOptionsSchema: () => optionsSchema,
  /**
   * Which profile option decides whether a turn will be a thinking turn.
   * The host needs the answer to pick the multi-character turn anchor: Ollama
   * opens a thinking model's reasoning block from the chat template at the
   * start of the assistant turn, so a `[Name]` prefill means the block is
   * never opened and the reasoning is lost entirely (bug 68). No
   * `thinksByDefault` fallback applies here — Ollama's models are whatever the
   * user has pulled, so an unticked box is the only honest answer, and a
   * thinking-off profile rightly keeps the stronger prefill anchor.
   */
  thinkingTurnRule: {
    optionKey: "enable_thinking",
    enabledValues: [true],
    disabledValues: [false]
  },
  /**
   * Factory method to create an Ollama LLM provider instance
   * Requires baseUrl parameter for Ollama server connection
   */
  createProvider: (baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    return new OllamaProvider(url);
  },
  /**
   * Ollama does not support image generation
   */
  createImageProvider: (baseUrl) => {
    throw new Error("Ollama does not support image generation");
  },
  /**
   * Factory method to create an Ollama embedding provider instance
   */
  createEmbeddingProvider: (baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    return new OllamaEmbeddingProvider(url);
  },
  /**
   * Get list of available models from Ollama server
   * No API key required, uses baseUrl to connect to local/remote Ollama instance
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    try {
      const provider = new OllamaProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger3.error("Failed to fetch Ollama models", { context: "plugin.getAvailableModels", baseUrl: url }, error instanceof Error ? error : void 0);
      return [];
    }
  },
  /**
   * Validate Ollama server connection
   * Ollama doesn't use API keys, just verifies server is reachable
   */
  validateApiKey: async (apiKey, baseUrl) => {
    const url = baseUrl || config.baseUrlDefault;
    try {
      const provider = new OllamaProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger3.error("Error validating Ollama server", { context: "plugin.validateApiKey", baseUrl: url }, error instanceof Error ? error : void 0);
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
  /**
   * Format tools from OpenAI format to OpenAI format
   * Ollama uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    try {
      const formattedTools = [];
      for (const tool of tools) {
        if (!("function" in tool)) {
          logger3.warn("Skipping tool with invalid format", {
            context: "plugin.formatTools"
          });
          continue;
        }
        formattedTools.push(tool);
      }
      return formattedTools;
    } catch (error) {
      logger3.error(
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
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger3.error(
        "Error parsing tool calls from Ollama response",
        { context: "plugin.parseToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Detect spontaneous XML tool call markers in Ollama text responses
   * Checks all XML formats since local models are unpredictable
   */
  hasTextToolMarkers(text) {
    return hasAnyXMLToolMarkers(text);
  },
  /**
   * Parse spontaneous XML tool calls from Ollama text responses
   */
  parseTextToolCalls(text) {
    try {
      const results = parseAllXMLAsToolCalls(text);
      return results;
    } catch (error) {
      logger3.error(
        "Error parsing text tool calls",
        { context: "ollama.parseTextToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Strip spontaneous XML tool call markers from Ollama text responses
   */
  stripTextToolMarkers(text) {
    return stripAllXMLToolMarkers(text);
  }
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
