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

// plugins/dist/qtap-plugin-upgrade/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  getPendingMigrations: () => getPendingMigrations,
  loadMigrationState: () => loadMigrationState,
  migrations: () => migrations,
  plugin: () => plugin,
  runMigrations: () => runMigrations
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

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path3, errorMaps, issueData } = params;
  const fullPath = [...path3, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path3, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path3;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// lib/env.ts
var envSchema = external_exports.object({
  // Node environment
  NODE_ENV: external_exports.enum(["development", "production", "test"]).default("development"),
  // Database (optional - JSON store is now the default)
  DATABASE_URL: external_exports.string().url().optional(),
  // NextAuth
  NEXTAUTH_URL: external_exports.string().url().min(1, "NEXTAUTH_URL is required"),
  NEXTAUTH_SECRET: external_exports.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  // OAuth Providers
  GOOGLE_CLIENT_ID: external_exports.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: external_exports.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  // Optional OAuth providers (Phase 2.0+)
  APPLE_ID: external_exports.string().optional(),
  APPLE_SECRET: external_exports.string().optional(),
  GITHUB_ID: external_exports.string().optional(),
  GITHUB_SECRET: external_exports.string().optional(),
  // Encryption
  ENCRYPTION_MASTER_PEPPER: external_exports.string().min(32, "ENCRYPTION_MASTER_PEPPER must be at least 32 characters"),
  // Rate Limiting (optional)
  RATE_LIMIT_API_MAX: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_API_WINDOW: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_AUTH_MAX: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_AUTH_WINDOW: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_CHAT_MAX: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_CHAT_WINDOW: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_GENERAL_MAX: external_exports.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_GENERAL_WINDOW: external_exports.string().regex(/^\d+$/).optional(),
  // Logging (optional)
  LOG_LEVEL: external_exports.enum(["error", "warn", "info", "debug"]).optional().default("info"),
  LOG_OUTPUT: external_exports.enum(["console", "file", "both"]).optional().default("console"),
  LOG_FILE_PATH: external_exports.string().optional().default("./logs"),
  LOG_FILE_MAX_SIZE: external_exports.string().regex(/^\d+$/).optional(),
  LOG_FILE_MAX_FILES: external_exports.string().regex(/^\d+$/).optional(),
  // Production SSL (optional)
  DOMAIN: external_exports.string().optional(),
  SSL_EMAIL: external_exports.string().email().optional()
});
function validateEnv() {
  try {
    const env2 = envSchema.parse(process.env);
    return env2;
  } catch (error) {
    if (error instanceof external_exports.ZodError) {
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
  logRequest(method, path3, statusCode, duration, context) {
    this.info("HTTP request", {
      method,
      path: path3,
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

// plugins/dist/qtap-plugin-upgrade/migration-runner.ts
var import_promises = __toESM(require("node:fs/promises"));
var import_node_path = __toESM(require("node:path"));

// package.json
var package_default = {
  name: "quilltap",
  version: "1.8.1",
  private: true,
  author: {
    name: "Charles Sebold",
    email: "charles@sebold.tech",
    url: "https://foundry-9.com"
  },
  description: "A chat client application for hosted AI models designed for role play",
  license: "MIT",
  repository: {
    type: "git",
    url: "https://github.com/foundry-9/quilltap.git"
  },
  scripts: {
    dev: "next dev",
    devssl: "next dev --experimental-https --experimental-https-key ./certs/localhost-key.pem --experimental-https-cert ./certs/localhost.pem",
    build: "npm run lint && next build",
    "build:plugins": "tsx scripts/build-plugins.ts",
    start: "next start",
    lint: "eslint .",
    "lint:fix": "eslint . --fix",
    test: "LOG_LEVEL=error npm run test:all",
    "test:unit": "LOG_LEVEL=error jest",
    "test:integration": "LOG_LEVEL=error jest --config jest.integration.config.ts",
    "test:all": "LOG_LEVEL=error jest && LOG_LEVEL=error jest --config jest.integration.config.ts",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "migrate-files": "tsx scripts/migrate-files.ts",
    "migrate-files:dry-run": "tsx scripts/migrate-files.ts --dry-run",
    "consolidate-images": "tsx scripts/consolidate-images.ts",
    "consolidate-images:dry-run": "tsx scripts/consolidate-images.ts --dry-run",
    "cleanup-old-files": "tsx scripts/cleanup-old-files.ts",
    "generate:schemas": "tsx scripts/generate-plugin-manifest-schema.ts"
  },
  dependencies: {
    "@anthropic-ai/sdk": "^0.71.0",
    "@google/generative-ai": "^0.24.1",
    "@openrouter/sdk": "^0.1.27",
    bcrypt: "^5.1.1",
    glob: "^12.0.0",
    "jest-fetch-mock": "^3.0.3",
    next: "^16.0.5",
    "next-auth": "^4.24.7",
    "node-fetch": "^3.3.2",
    openai: "^6.9.0",
    qrcode: "^1.5.4",
    react: "^19.2.0",
    "react-dom": "^19.2.0",
    "react-markdown": "^10.1.0",
    "react-syntax-highlighter": "^16.1.0",
    "remark-gfm": "^4.0.1",
    speakeasy: "^2.0.0",
    zod: "^3.23.0"
  },
  devDependencies: {
    "@eslint/eslintrc": "^3.3.1",
    "@jest/globals": "^30.2.0",
    "@playwright/test": "^1.49.0",
    "@tailwindcss/postcss": "^4.1.17",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@types/bcrypt": "^5.0.2",
    "@types/jest": "^30.0.0",
    "@types/node": "^22.0.0",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@types/react-syntax-highlighter": "^15.5.13",
    "@types/speakeasy": "^2.0.10",
    autoprefixer: "^10.4.22",
    dotenv: "^17.2.3",
    eslint: "^9.39.1",
    "eslint-config-next": "^16.0.5",
    jest: "^30.2.0",
    "jest-environment-jsdom": "^30.2.0",
    postcss: "^8.4.0",
    tailwindcss: "^4.1.17",
    "ts-jest": "^29.4.5",
    "ts-node": "^10.9.2",
    tsx: "^4.7.0",
    typescript: "^5.6.0",
    "zod-to-json-schema": "^3.25.0"
  },
  overrides: {
    glob: "^12.0.0",
    cookie: "^0.7.0"
  }
};

// plugins/dist/qtap-plugin-upgrade/migration-runner.ts
var MIGRATIONS_STATE_FILE = import_node_path.default.join(process.cwd(), "data", "settings", "migrations.json");
async function loadMigrationState() {
  try {
    const content = await import_promises.default.readFile(MIGRATIONS_STATE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      completedMigrations: [],
      lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
      quilltapVersion: package_default.version
    };
  }
}
async function saveMigrationState(state) {
  const dir = import_node_path.default.dirname(MIGRATIONS_STATE_FILE);
  await import_promises.default.mkdir(dir, { recursive: true });
  await import_promises.default.writeFile(
    MIGRATIONS_STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}
function isMigrationCompleted(state, migrationId) {
  return state.completedMigrations.some((m) => m.id === migrationId);
}
async function recordCompletedMigration(state, result) {
  const record = {
    id: result.id,
    completedAt: result.timestamp,
    quilltapVersion: package_default.version,
    itemsAffected: result.itemsAffected,
    message: result.message
  };
  const updatedState = {
    ...state,
    completedMigrations: [...state.completedMigrations, record],
    lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
    quilltapVersion: package_default.version
  };
  await saveMigrationState(updatedState);
  return updatedState;
}
function sortMigrationsByDependency(migrations2) {
  const sorted = [];
  const visited = /* @__PURE__ */ new Set();
  const visiting = /* @__PURE__ */ new Set();
  function visit(migration) {
    if (visited.has(migration.id)) return;
    if (visiting.has(migration.id)) {
      throw new Error(`Circular dependency detected in migrations: ${migration.id}`);
    }
    visiting.add(migration.id);
    if (migration.dependsOn) {
      for (const depId of migration.dependsOn) {
        const dep = migrations2.find((m) => m.id === depId);
        if (dep) {
          visit(dep);
        }
      }
    }
    visiting.delete(migration.id);
    visited.add(migration.id);
    sorted.push(migration);
  }
  for (const migration of migrations2) {
    visit(migration);
  }
  return sorted;
}
async function runMigrations(migrations2) {
  const startTime = Date.now();
  const results = [];
  let migrationsRun = 0;
  let migrationsSkipped = 0;
  logger.info("Starting migration runner", {
    context: "upgrade-plugin.runMigrations",
    totalMigrations: migrations2.length
  });
  let state = await loadMigrationState();
  const sortedMigrations = sortMigrationsByDependency(migrations2);
  for (const migration of sortedMigrations) {
    if (isMigrationCompleted(state, migration.id)) {
      logger.debug("Migration already completed, skipping", {
        context: "upgrade-plugin.runMigrations",
        migrationId: migration.id
      });
      migrationsSkipped++;
      continue;
    }
    const shouldRun = await migration.shouldRun();
    if (!shouldRun) {
      logger.debug("Migration conditions not met, skipping", {
        context: "upgrade-plugin.runMigrations",
        migrationId: migration.id
      });
      migrationsSkipped++;
      continue;
    }
    logger.info("Running migration", {
      context: "upgrade-plugin.runMigrations",
      migrationId: migration.id,
      description: migration.description
    });
    try {
      const result = await migration.run();
      results.push(result);
      if (result.success) {
        state = await recordCompletedMigration(state, result);
        migrationsRun++;
        logger.info("Migration completed successfully", {
          context: "upgrade-plugin.runMigrations",
          migrationId: migration.id,
          itemsAffected: result.itemsAffected,
          durationMs: result.durationMs
        });
      } else {
        logger.error("Migration failed", {
          context: "upgrade-plugin.runMigrations",
          migrationId: migration.id,
          error: result.error
        });
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Migration threw an exception", {
        context: "upgrade-plugin.runMigrations",
        migrationId: migration.id,
        error: errorMessage
      });
      results.push({
        id: migration.id,
        success: false,
        itemsAffected: 0,
        message: "Migration failed with exception",
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      break;
    }
  }
  const totalDurationMs = Date.now() - startTime;
  const allSucceeded = results.every((r) => r.success);
  logger.info("Migration runner completed", {
    context: "upgrade-plugin.runMigrations",
    success: allSucceeded,
    migrationsRun,
    migrationsSkipped,
    totalDurationMs
  });
  return {
    success: allSucceeded,
    migrationsRun,
    migrationsSkipped,
    results,
    totalDurationMs
  };
}
async function getPendingMigrations(migrations2) {
  const state = await loadMigrationState();
  const pending = [];
  for (const migration of migrations2) {
    if (!isMigrationCompleted(state, migration.id)) {
      const shouldRun = await migration.shouldRun();
      if (shouldRun) {
        pending.push(migration.id);
      }
    }
  }
  return pending;
}

// lib/json-store/core/json-store.ts
var fs3 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var import_util4 = require("util");
var crypto = __toESM(require("crypto"));
var mkdir2 = (0, import_util4.promisify)(fs3.mkdir);
var readFile2 = (0, import_util4.promisify)(fs3.readFile);
var writeFile2 = (0, import_util4.promisify)(fs3.writeFile);
var appendFile2 = (0, import_util4.promisify)(fs3.appendFile);
var rename2 = (0, import_util4.promisify)(fs3.rename);
var unlink2 = (0, import_util4.promisify)(fs3.unlink);
var readdir2 = (0, import_util4.promisify)(fs3.readdir);
var stat2 = (0, import_util4.promisify)(fs3.stat);
var JsonStore = class {
  constructor(config = {}) {
    this.locks = /* @__PURE__ */ new Map();
    this.cache = /* @__PURE__ */ new Map();
    this.dataDir = config.dataDir || process.env.DATA_DIR || "./data";
    this.enableCache = config.enableCache ?? true;
    this.lockTimeout = config.lockTimeout ?? 5e3;
    this.fsyncInterval = config.fsyncInterval ?? 10;
    if (!fs3.existsSync(this.dataDir)) {
      fs3.mkdirSync(this.dataDir, { recursive: true });
    }
  }
  /**
   * Get the configured data directory path
   */
  getDataDir() {
    return this.dataDir;
  }
  /**
   * Resolve a relative path within data directory
   */
  resolvePath(...segments) {
    return path2.join(this.dataDir, ...segments);
  }
  /**
   * Ensure a directory exists
   */
  async ensureDir(dirPath) {
    await mkdir2(dirPath, { recursive: true });
  }
  /**
   * Acquire a lock for a file path
   */
  async acquireLock(filePath) {
    const lockPath = `${filePath}.lock`;
    const lockDir = path2.dirname(lockPath);
    const startTime = Date.now();
    await this.ensureDir(lockDir);
    while (true) {
      try {
        const fd = fs3.openSync(lockPath, fs3.constants.O_CREAT | fs3.constants.O_EXCL | fs3.constants.O_WRONLY);
        fs3.closeSync(fd);
        return;
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
        try {
          const stats = await stat2(lockPath);
          if (Date.now() - stats.mtimeMs > 3e4) {
            await unlink2(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - startTime > this.lockTimeout) {
          throw new Error(`Failed to acquire lock for ${filePath} within ${this.lockTimeout}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
  /**
   * Release a lock for a file path
   */
  async releaseLock(filePath) {
    const lockPath = `${filePath}.lock`;
    try {
      await unlink2(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.error(`Failed to release lock for ${filePath}`, { context: { filePath } }, error instanceof Error ? error : void 0);
      }
    }
  }
  /**
   * Read JSON file with caching
   */
  async readJson(filePath) {
    const fullPath = this.resolvePath(filePath);
    const cacheKey = fullPath;
    if (this.enableCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    try {
      const content = await readFile2(fullPath, "utf-8");
      const data = JSON.parse(content);
      if (this.enableCache) {
        this.cache.set(cacheKey, data);
      }
      return data;
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(`Failed to read JSON from ${filePath}: ${error.message}`);
    }
  }
  /**
   * Write JSON file atomically with locking
   */
  async writeJson(filePath, data) {
    const fullPath = this.resolvePath(filePath);
    const dir = path2.dirname(fullPath);
    await this.ensureDir(dir);
    await this.acquireLock(fullPath);
    try {
      const tempPath = `${fullPath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
      const content = JSON.stringify(data, null, 2);
      await writeFile2(tempPath, content, "utf-8");
      await rename2(tempPath, fullPath);
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } finally {
      await this.releaseLock(fullPath);
    }
  }
  /**
   * Read JSONL file line by line
   */
  async readJsonl(filePath) {
    const fullPath = this.resolvePath(filePath);
    try {
      const content = await readFile2(fullPath, "utf-8");
      const lines = content.trim().split("\n").filter((line) => line.length > 0);
      return lines.map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw new Error(`Failed to read JSONL from ${filePath}: ${error.message}`);
    }
  }
  /**
   * Write raw content to file atomically with locking (for pre-formatted JSONL)
   */
  async writeRaw(filePath, content) {
    const fullPath = this.resolvePath(filePath);
    const dir = path2.dirname(fullPath);
    await this.ensureDir(dir);
    await this.acquireLock(fullPath);
    try {
      const tempPath = `${fullPath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
      await writeFile2(tempPath, content, "utf-8");
      await rename2(tempPath, fullPath);
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } finally {
      await this.releaseLock(fullPath);
    }
  }
  /**
   * Write JSONL file atomically (full rewrite for updates/deletes)
   */
  async writeJsonl(filePath, items) {
    const content = items.length > 0 ? items.map((item) => JSON.stringify(item)).join("\n") + "\n" : "";
    await this.writeRaw(filePath, content);
  }
  /**
   * Append to JSONL file (line-delimited JSON)
   */
  async appendJsonl(filePath, items) {
    const fullPath = this.resolvePath(filePath);
    const dir = path2.dirname(fullPath);
    await this.ensureDir(dir);
    await this.acquireLock(fullPath);
    try {
      const lines = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
      if (fs3.existsSync(fullPath)) {
        await appendFile2(fullPath, lines, "utf-8");
      } else {
        await writeFile2(fullPath, lines, "utf-8");
      }
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } finally {
      await this.releaseLock(fullPath);
    }
  }
  /**
   * Get file size in bytes
   */
  async getFileSize(filePath) {
    const fullPath = this.resolvePath(filePath);
    try {
      const stats = await stat2(fullPath);
      return stats.size;
    } catch (error) {
      if (error.code === "ENOENT") {
        return 0;
      }
      throw error;
    }
  }
  /**
   * Check if file exists
   */
  exists(filePath) {
    const fullPath = this.resolvePath(filePath);
    return fs3.existsSync(fullPath);
  }
  /**
   * List files in a directory
   */
  async listDir(dirPath) {
    const fullPath = this.resolvePath(dirPath);
    try {
      return await readdir2(fullPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
  /**
   * Delete a file
   */
  async deleteFile(filePath) {
    const fullPath = this.resolvePath(filePath);
    try {
      await unlink2(fullPath);
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  /**
   * Clear in-memory cache
   */
  clearCache() {
    this.cache.clear();
  }
  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      enabled: this.enableCache
    };
  }
};

// lib/json-store/repositories/base.repository.ts
var BaseRepository = class {
  constructor(jsonStore, schema) {
    this.jsonStore = jsonStore;
    this.schema = schema;
  }
  /**
   * Validate data against schema
   */
  validate(data) {
    return this.schema.parse(data);
  }
  /**
   * Safely validate without throwing
   */
  validateSafe(data) {
    try {
      const validated = this.validate(data);
      return { success: true, data: validated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Generate UUID v4
   */
  generateId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  /**
   * Get current ISO timestamp
   */
  getCurrentTimestamp() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
};

// lib/json-store/schemas/plugin-manifest.ts
var PluginCapabilityEnum = external_exports.enum([
  "CHAT_COMMANDS",
  // Provides custom chat commands
  "MESSAGE_PROCESSORS",
  // Processes/transforms messages
  "UI_COMPONENTS",
  // Provides React components
  "DATA_STORAGE",
  // Adds database tables/storage
  "API_ROUTES",
  // Adds new API endpoints
  "AUTH_METHODS",
  // Provides authentication methods
  "WEBHOOKS",
  // Handles webhooks
  "BACKGROUND_TASKS",
  // Runs background jobs
  "CUSTOM_MODELS",
  // Adds new data models
  "FILE_HANDLERS",
  // Handles file operations
  "NOTIFICATIONS",
  // Provides notification system
  "BACKEND_INTEGRATIONS",
  // Integrates with external services
  "LLM_PROVIDER",
  // Provides LLM integration
  "IMAGE_PROVIDER",
  // Provides image generation
  "EMBEDDING_PROVIDER",
  // Provides embedding generation
  "THEME",
  // Provides UI theme
  "DATABASE_BACKEND",
  // Replaces/augments database
  "FILE_BACKEND",
  // Replaces/augments file storage
  "UPGRADE_MIGRATION"
  // Provides version upgrade migrations (runs early in startup)
]);
var FrontendFrameworkEnum = external_exports.enum([
  "REACT",
  "PREACT",
  "VUE",
  "SVELTE",
  "NONE"
]);
var CSSFrameworkEnum = external_exports.enum([
  "TAILWIND",
  "BOOTSTRAP",
  "MATERIAL_UI",
  "CSS_MODULES",
  "STYLED_COMPONENTS",
  "NONE"
]);
var PluginAuthorSchema = external_exports.object({
  name: external_exports.string().min(1).max(100),
  email: external_exports.string().email().optional(),
  url: external_exports.string().url().optional()
});
var CompatibilitySchema = external_exports.object({
  /** Minimum Quilltap version (semver) */
  quilltapVersion: external_exports.string().regex(/^>=?\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/),
  /** Maximum Quilltap version (optional) */
  quilltapMaxVersion: external_exports.string().regex(/^<=?\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/).optional(),
  /** Minimum Node.js version */
  nodeVersion: external_exports.string().regex(/^>=?\d+\.\d+\.\d+$/).optional()
});
var FunctionalitySchema = external_exports.object({
  /** @deprecated Use capabilities array instead */
  providesChatCommands: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesMessageProcessors: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesUIComponents: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesDataStorage: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesAPIRoutes: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesAuthenticationMethods: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesWebhooks: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesBackgroundTasks: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesCustomModels: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesFileHandlers: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesNotifications: external_exports.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesBackendIntegrations: external_exports.boolean().default(false).optional()
});
var HookConfigSchema = external_exports.object({
  /** Hook identifier */
  name: external_exports.string().min(1).max(100),
  /** Hook handler file path (relative to plugin root) */
  handler: external_exports.string(),
  /** Priority (lower = runs first) */
  priority: external_exports.number().int().min(0).max(100).default(50),
  /** Whether the hook is enabled */
  enabled: external_exports.boolean().default(true)
});
var APIRouteSchema = external_exports.object({
  /** Route path (e.g., "/api/plugin/my-route") */
  path: external_exports.string().regex(/^\/api\//),
  /** HTTP methods supported */
  methods: external_exports.array(external_exports.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])).min(1),
  /** Handler file path (relative to plugin root) */
  handler: external_exports.string(),
  /** Whether authentication is required */
  requiresAuth: external_exports.boolean().default(true),
  /** Description of what the route does */
  description: external_exports.string().optional()
});
var UIComponentSchema = external_exports.object({
  /** Component identifier (used for registration) */
  id: external_exports.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Human-readable name */
  name: external_exports.string().min(1).max(100),
  /** Component file path (relative to plugin root) */
  path: external_exports.string(),
  /** Where the component can be used */
  slots: external_exports.array(external_exports.string()).optional(),
  /** Props schema (JSON Schema) */
  propsSchema: external_exports.record(external_exports.unknown()).optional()
});
var DatabaseModelSchema = external_exports.object({
  /** Model name */
  name: external_exports.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
  /** Schema file path (Zod schema, relative to plugin root) */
  schemaPath: external_exports.string(),
  /** Collection/table name */
  collectionName: external_exports.string().regex(/^[a-z][a-z0-9-_]*$/),
  /** Description */
  description: external_exports.string().optional()
});
var PermissionsSchema = external_exports.object({
  /** File system access paths (relative to data directory) */
  fileSystem: external_exports.array(external_exports.string()).default([]),
  /** Network access (domains/URLs the plugin needs to access) */
  network: external_exports.array(external_exports.string()).default([]),
  /** Environment variables the plugin needs */
  environment: external_exports.array(external_exports.string()).default([]),
  /** Whether the plugin needs database access */
  database: external_exports.boolean().default(false),
  /** Whether the plugin needs user data access */
  userData: external_exports.boolean().default(false)
});
var ConfigSchemaSchema = external_exports.object({
  /** Configuration key */
  key: external_exports.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  /** Display label */
  label: external_exports.string().min(1).max(100),
  /** Input type */
  type: external_exports.enum(["text", "number", "boolean", "select", "textarea", "password", "url", "email"]),
  /** Default value */
  default: external_exports.unknown().optional(),
  /** Whether the field is required */
  required: external_exports.boolean().default(false),
  /** Help text */
  description: external_exports.string().optional(),
  /** Options for select type */
  options: external_exports.array(external_exports.object({
    label: external_exports.string(),
    value: external_exports.unknown()
  })).optional(),
  /** Validation pattern (regex) */
  pattern: external_exports.string().optional(),
  /** Minimum value (for number type) */
  min: external_exports.number().optional(),
  /** Maximum value (for number type) */
  max: external_exports.number().optional()
});
var ProviderConfigSchema = external_exports.object({
  /** Internal identifier for the provider (e.g., 'OPENAI', 'ANTHROPIC') */
  providerName: external_exports.string().regex(/^[A-Z][A-Z0-9_]*$/),
  /** Human-readable display name (e.g., 'OpenAI', 'Anthropic') */
  displayName: external_exports.string().min(1).max(100),
  /** Short description of the provider */
  description: external_exports.string().min(1).max(500),
  /** 2-4 character abbreviation for use in icons/badges (e.g., 'OAI', 'ANT') */
  abbreviation: external_exports.string().min(2).max(4).regex(/^[A-Z0-9]+$/),
  /** Color configuration using Tailwind CSS classes */
  colors: external_exports.object({
    /** Background color class (e.g., 'bg-blue-500') */
    bg: external_exports.string().min(1),
    /** Text color class (e.g., 'text-white') */
    text: external_exports.string().min(1),
    /** Icon color class (e.g., 'text-blue-600') */
    icon: external_exports.string().min(1)
  }),
  /** Whether the provider requires an API key */
  requiresApiKey: external_exports.boolean().default(true),
  /** Whether the provider requires a custom base URL */
  requiresBaseUrl: external_exports.boolean().default(false),
  /** Custom label for the API key field (defaults to 'API Key') */
  apiKeyLabel: external_exports.string().min(1).max(100).optional(),
  /** Custom label for the base URL field (defaults to 'Base URL') */
  baseUrlLabel: external_exports.string().min(1).max(100).optional(),
  /** Default base URL for the provider (if customizable) */
  baseUrlDefault: external_exports.string().url().optional(),
  /** Capabilities supported by this provider */
  capabilities: external_exports.object({
    /** Supports chat/completion endpoints */
    chat: external_exports.boolean().default(true).optional(),
    /** Supports image generation */
    imageGeneration: external_exports.boolean().default(false).optional(),
    /** Supports embeddings */
    embeddings: external_exports.boolean().default(false).optional(),
    /** Supports web search */
    webSearch: external_exports.boolean().default(false).optional()
  }).optional(),
  /** File attachment support configuration */
  attachmentSupport: external_exports.object({
    /** Whether attachments are supported */
    supported: external_exports.boolean().default(false),
    /** List of supported MIME types (e.g., ['image/jpeg', 'application/pdf']) */
    mimeTypes: external_exports.array(external_exports.string()).default([]),
    /** Description of attachment support */
    description: external_exports.string().optional()
  }).optional()
});
var PluginManifestSchema = external_exports.object({
  // ===== JSON SCHEMA REFERENCE =====
  /** JSON Schema reference (for IDE support) */
  $schema: external_exports.string().optional(),
  // ===== BASIC METADATA =====
  /** Plugin package name (must start with 'qtap-plugin-') */
  name: external_exports.string().regex(/^qtap-plugin-[a-z0-9-]+$/),
  /** Display title */
  title: external_exports.string().min(1).max(100),
  /** Plugin description */
  description: external_exports.string().min(1).max(500),
  /** Semantic version */
  version: external_exports.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/),
  /** Author information */
  author: external_exports.union([external_exports.string(), PluginAuthorSchema]),
  /** License (SPDX identifier) */
  license: external_exports.string().default("MIT"),
  /** Main entry point (JavaScript/TypeScript file) */
  main: external_exports.string().default("index.js"),
  /** Homepage URL */
  homepage: external_exports.string().url().optional(),
  /** Repository URL */
  repository: external_exports.union([
    external_exports.string().url(),
    external_exports.object({
      type: external_exports.string(),
      url: external_exports.string().url()
    })
  ]).optional(),
  /** Bug tracker URL */
  bugs: external_exports.union([
    external_exports.string().url(),
    external_exports.object({
      url: external_exports.string().url(),
      email: external_exports.string().email().optional()
    })
  ]).optional(),
  // ===== COMPATIBILITY =====
  /** Version compatibility requirements */
  compatibility: CompatibilitySchema,
  /** Dependencies (other plugins required) */
  requires: external_exports.record(external_exports.string()).optional(),
  /** Peer dependencies */
  peerDependencies: external_exports.record(external_exports.string()).optional(),
  // ===== CAPABILITIES =====
  /** Modern capability flags (preferred over functionality object) */
  capabilities: external_exports.array(PluginCapabilityEnum).default([]),
  /** @deprecated Legacy functionality flags */
  functionality: FunctionalitySchema.optional(),
  // ===== TECHNICAL DETAILS =====
  /** Frontend framework used */
  frontend: FrontendFrameworkEnum.default("REACT").optional(),
  /** CSS framework used */
  styling: CSSFrameworkEnum.default("TAILWIND").optional(),
  /** TypeScript support */
  typescript: external_exports.boolean().default(true).optional(),
  // ===== HOOKS & EXTENSIONS =====
  /** Hook registrations */
  hooks: external_exports.array(HookConfigSchema).default([]).optional(),
  /** API routes provided */
  apiRoutes: external_exports.array(APIRouteSchema).default([]).optional(),
  /** UI components provided */
  components: external_exports.array(UIComponentSchema).default([]).optional(),
  /** Database models/tables */
  models: external_exports.array(DatabaseModelSchema).default([]).optional(),
  // ===== CONFIGURATION =====
  /** Configuration schema for the plugin */
  configSchema: external_exports.array(ConfigSchemaSchema).default([]).optional(),
  /** Default configuration values */
  defaultConfig: external_exports.record(external_exports.unknown()).default({}).optional(),
  /** Provider configuration (for LLM/service provider plugins) */
  providerConfig: ProviderConfigSchema.optional(),
  // ===== SECURITY & PERMISSIONS =====
  /** Permissions required by the plugin */
  permissions: PermissionsSchema.default({}).optional(),
  /** Whether the plugin is sandboxed */
  sandboxed: external_exports.boolean().default(true).optional(),
  // ===== METADATA =====
  /** Keywords for search/discovery */
  keywords: external_exports.array(external_exports.string()).default([]),
  /** Icon file path (relative to plugin root) */
  icon: external_exports.string().optional(),
  /** Screenshots (URLs or file paths) */
  screenshots: external_exports.array(external_exports.string()).default([]).optional(),
  /** Plugin category */
  category: external_exports.enum([
    "PROVIDER",
    "THEME",
    "INTEGRATION",
    "UTILITY",
    "ENHANCEMENT",
    "DATABASE",
    "STORAGE",
    "AUTHENTICATION",
    "OTHER"
  ]).default("OTHER").optional(),
  /** Whether the plugin is enabled by default */
  enabledByDefault: external_exports.boolean().default(false).optional(),
  /** Plugin status */
  status: external_exports.enum(["STABLE", "BETA", "ALPHA", "DEPRECATED"]).default("STABLE").optional()
}).strict();

// lib/json-store/schemas/types.ts
var ProviderEnum = external_exports.string().min(1, "Provider is required");
var ImageProviderEnum = external_exports.string().min(1, "Image provider is required");
var EmbeddingProfileProviderEnum = external_exports.enum(["OPENAI", "OLLAMA"]);
var RoleEnum = external_exports.enum(["SYSTEM", "USER", "ASSISTANT", "TOOL"]);
var ImageTagTypeEnum = external_exports.enum(["CHARACTER", "PERSONA", "CHAT", "THEME"]);
var AvatarDisplayModeEnum = external_exports.enum(["ALWAYS", "GROUP_ONLY", "NEVER"]);
var UUIDSchema = external_exports.string().uuid();
var TimestampSchema = external_exports.string().datetime().or(external_exports.date()).transform((d) => {
  if (d instanceof Date) return d.toISOString();
  return d;
});
var JsonSchema = external_exports.record(external_exports.unknown());
var EncryptedFieldSchema = external_exports.object({
  ciphertext: external_exports.string(),
  iv: external_exports.string(),
  authTag: external_exports.string()
});
var TOTPSecretSchema = EncryptedFieldSchema.extend({
  enabled: external_exports.boolean().default(false),
  verifiedAt: TimestampSchema.nullable().optional()
});
var BackupCodesSchema = external_exports.object({
  ciphertext: external_exports.string(),
  iv: external_exports.string(),
  authTag: external_exports.string(),
  createdAt: TimestampSchema
});
var UserSchema = external_exports.object({
  id: UUIDSchema,
  email: external_exports.string().email(),
  name: external_exports.string().nullable().optional(),
  image: external_exports.string().nullable().optional(),
  emailVerified: TimestampSchema.nullable().optional(),
  // Password authentication
  passwordHash: external_exports.string().nullable().optional(),
  // TOTP 2FA
  totp: TOTPSecretSchema.optional(),
  backupCodes: BackupCodesSchema.optional(),
  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var HexColorSchema = external_exports.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/);
var TagVisualStyleSchema = external_exports.object({
  emoji: external_exports.string().max(8).optional().nullable(),
  foregroundColor: HexColorSchema.default("#1f2937"),
  backgroundColor: HexColorSchema.default("#e5e7eb"),
  emojiOnly: external_exports.boolean().default(false),
  bold: external_exports.boolean().default(false),
  italic: external_exports.boolean().default(false),
  strikethrough: external_exports.boolean().default(false)
});
var TagStyleMapSchema = external_exports.record(TagVisualStyleSchema).default({});
var CheapLLMStrategyEnum = external_exports.enum(["USER_DEFINED", "PROVIDER_CHEAPEST", "LOCAL_FIRST"]);
var EmbeddingProviderEnum = external_exports.enum(["SAME_PROVIDER", "OPENAI", "LOCAL"]);
var CheapLLMSettingsSchema = external_exports.object({
  /** Strategy for selecting the cheap LLM provider */
  strategy: CheapLLMStrategyEnum.default("PROVIDER_CHEAPEST"),
  /** If USER_DEFINED, which connection profile to use */
  userDefinedProfileId: UUIDSchema.nullable().optional(),
  /** Global default cheap LLM profile - always use this if set */
  defaultCheapProfileId: UUIDSchema.nullable().optional(),
  /** Whether to fall back to local models if available */
  fallbackToLocal: external_exports.boolean().default(true),
  /** Provider for generating embeddings */
  embeddingProvider: EmbeddingProviderEnum.default("OPENAI"),
  /** Embedding profile ID to use for text embeddings */
  embeddingProfileId: UUIDSchema.nullable().optional()
});
var ChatSettingsSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  avatarDisplayMode: AvatarDisplayModeEnum.default("ALWAYS"),
  avatarDisplayStyle: external_exports.string().default("CIRCULAR"),
  tagStyles: TagStyleMapSchema,
  /** Cheap LLM settings for memory extraction and summarization */
  cheapLLMSettings: CheapLLMSettingsSchema.default({
    strategy: "PROVIDER_CHEAPEST",
    fallbackToLocal: true,
    embeddingProvider: "OPENAI"
  }),
  /** Profile ID to use for image description fallback (when provider doesn't support images) */
  imageDescriptionProfileId: UUIDSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var AccountSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  type: external_exports.string(),
  provider: external_exports.string(),
  providerAccountId: external_exports.string(),
  refresh_token: external_exports.string().nullable().optional(),
  access_token: external_exports.string().nullable().optional(),
  expires_at: external_exports.number().nullable().optional(),
  token_type: external_exports.string().nullable().optional(),
  scope: external_exports.string().nullable().optional(),
  id_token: external_exports.string().nullable().optional(),
  session_state: external_exports.string().nullable().optional()
});
var SessionSchema = external_exports.object({
  id: UUIDSchema,
  sessionToken: external_exports.string(),
  userId: UUIDSchema,
  expires: TimestampSchema
});
var VerificationTokenSchema = external_exports.object({
  identifier: external_exports.string(),
  token: external_exports.string(),
  expires: TimestampSchema
});
var ApiKeySchema = external_exports.object({
  id: UUIDSchema,
  label: external_exports.string(),
  provider: ProviderEnum,
  ciphertext: external_exports.string(),
  iv: external_exports.string(),
  authTag: external_exports.string(),
  isActive: external_exports.boolean().default(true),
  lastUsed: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var ConnectionProfileSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: external_exports.string(),
  provider: ProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: external_exports.string().nullable().optional(),
  modelName: external_exports.string(),
  parameters: JsonSchema.default({}),
  isDefault: external_exports.boolean().default(false),
  /** Whether this profile is suitable for use as a "cheap" LLM (low-cost tasks) */
  isCheap: external_exports.boolean().default(false),
  /** Whether web search is allowed for this profile (only if provider supports it) */
  allowWebSearch: external_exports.boolean().default(false),
  tags: external_exports.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var PhysicalDescriptionSchema = external_exports.object({
  id: UUIDSchema,
  name: external_exports.string().min(1),
  shortPrompt: external_exports.string().max(350).nullable().optional(),
  mediumPrompt: external_exports.string().max(500).nullable().optional(),
  longPrompt: external_exports.string().max(750).nullable().optional(),
  completePrompt: external_exports.string().max(1e3).nullable().optional(),
  fullDescription: external_exports.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var CharacterSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: external_exports.string(),
  title: external_exports.string().nullable().optional(),
  description: external_exports.string().nullable().optional(),
  personality: external_exports.string().nullable().optional(),
  scenario: external_exports.string().nullable().optional(),
  firstMessage: external_exports.string().nullable().optional(),
  exampleDialogues: external_exports.string().nullable().optional(),
  systemPrompt: external_exports.string().nullable().optional(),
  avatarUrl: external_exports.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  defaultConnectionProfileId: UUIDSchema.nullable().optional(),
  sillyTavernData: JsonSchema.nullable().optional(),
  isFavorite: external_exports.boolean().default(false),
  // Relationships
  personaLinks: external_exports.array(external_exports.object({
    personaId: UUIDSchema,
    isDefault: external_exports.boolean()
  })).default([]),
  tags: external_exports.array(UUIDSchema).default([]),
  avatarOverrides: external_exports.array(external_exports.object({
    chatId: UUIDSchema,
    imageId: UUIDSchema
  })).default([]),
  physicalDescriptions: external_exports.array(PhysicalDescriptionSchema).default([]),
  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var PersonaSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: external_exports.string(),
  title: external_exports.string().nullable().optional(),
  description: external_exports.string(),
  personalityTraits: external_exports.string().nullable().optional(),
  avatarUrl: external_exports.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  sillyTavernData: JsonSchema.nullable().optional(),
  // Relationships
  characterLinks: external_exports.array(UUIDSchema).default([]),
  tags: external_exports.array(UUIDSchema).default([]),
  physicalDescriptions: external_exports.array(PhysicalDescriptionSchema).default([]),
  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var MessageEventSchema = external_exports.object({
  type: external_exports.literal("message"),
  id: UUIDSchema,
  role: RoleEnum,
  content: external_exports.string(),
  rawResponse: JsonSchema.nullable().optional(),
  tokenCount: external_exports.number().nullable().optional(),
  swipeGroupId: external_exports.string().nullable().optional(),
  swipeIndex: external_exports.number().nullable().optional(),
  attachments: external_exports.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  // Debug: Memory extraction logs (Sprint 6)
  debugMemoryLogs: external_exports.array(external_exports.string()).optional()
});
var ContextSummaryEventSchema = external_exports.object({
  type: external_exports.literal("context-summary"),
  id: UUIDSchema,
  context: external_exports.string(),
  createdAt: TimestampSchema
});
var ChatEventSchema = external_exports.union([
  MessageEventSchema,
  ContextSummaryEventSchema
]);
var ParticipantTypeEnum = external_exports.enum(["CHARACTER", "PERSONA"]);
var ChatParticipantSchema = external_exports.object({
  id: UUIDSchema,
  // Participant type and identity
  type: ParticipantTypeEnum,
  characterId: UUIDSchema.nullable().optional(),
  // Set when type is CHARACTER
  personaId: UUIDSchema.nullable().optional(),
  // Set when type is PERSONA
  // LLM configuration (for AI characters only)
  connectionProfileId: UUIDSchema.nullable().optional(),
  // Required for CHARACTER, null for PERSONA
  imageProfileId: UUIDSchema.nullable().optional(),
  // Image generation profile
  // Per-chat customization
  systemPromptOverride: external_exports.string().nullable().optional(),
  // Custom scenario/context for this chat
  // Display and state
  displayOrder: external_exports.number().default(0),
  // For ordering in UI
  isActive: external_exports.boolean().default(true),
  // Temporarily disable without removing
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).refine(
  (data) => {
    if (data.type === "CHARACTER") {
      return data.characterId != null;
    }
    if (data.type === "PERSONA") {
      return data.personaId != null;
    }
    return false;
  },
  { message: "CHARACTER participants must have characterId, PERSONA participants must have personaId" }
).refine(
  (data) => {
    if (data.type === "CHARACTER") {
      return data.connectionProfileId != null;
    }
    return true;
  },
  { message: "CHARACTER participants must have a connectionProfileId" }
);
var ChatParticipantBaseSchema = external_exports.object({
  id: UUIDSchema,
  type: ParticipantTypeEnum,
  characterId: UUIDSchema.nullable().optional(),
  personaId: UUIDSchema.nullable().optional(),
  connectionProfileId: UUIDSchema.nullable().optional(),
  imageProfileId: UUIDSchema.nullable().optional(),
  systemPromptOverride: external_exports.string().nullable().optional(),
  displayOrder: external_exports.number().default(0),
  isActive: external_exports.boolean().default(true),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var ChatMetadataSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  // Participants array (replaces characterId, personaId, connectionProfileId, imageProfileId)
  participants: external_exports.array(ChatParticipantBaseSchema).default([]),
  title: external_exports.string(),
  contextSummary: external_exports.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: external_exports.array(UUIDSchema).default([]),
  messageCount: external_exports.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: external_exports.number().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).refine(
  (data) => data.participants.length > 0,
  { message: "Chat must have at least one participant" }
);
var ChatMetadataBaseSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  participants: external_exports.array(ChatParticipantBaseSchema).default([]),
  title: external_exports.string(),
  contextSummary: external_exports.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: external_exports.array(UUIDSchema).default([]),
  messageCount: external_exports.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: external_exports.number().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var ChatMetadataLegacySchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  characterId: UUIDSchema,
  personaId: UUIDSchema.nullable().optional(),
  connectionProfileId: UUIDSchema,
  imageProfileId: UUIDSchema.nullable().optional(),
  title: external_exports.string(),
  contextSummary: external_exports.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: external_exports.array(UUIDSchema).default([]),
  messageCount: external_exports.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: external_exports.number().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var BinaryIndexEntrySchema = external_exports.object({
  id: UUIDSchema,
  sha256: external_exports.string().length(64),
  type: external_exports.enum(["image", "chat_file", "avatar"]),
  userId: UUIDSchema,
  filename: external_exports.string(),
  relativePath: external_exports.string(),
  mimeType: external_exports.string(),
  size: external_exports.number(),
  width: external_exports.number().nullable().optional(),
  height: external_exports.number().nullable().optional(),
  source: external_exports.enum(["upload", "import", "generated"]).default("upload"),
  generationPrompt: external_exports.string().nullable().optional(),
  generationModel: external_exports.string().nullable().optional(),
  chatId: UUIDSchema.nullable().optional(),
  characterId: UUIDSchema.nullable().optional(),
  // For avatar overrides
  messageId: UUIDSchema.nullable().optional(),
  tags: external_exports.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var FileSourceEnum = external_exports.enum(["UPLOADED", "GENERATED", "IMPORTED", "SYSTEM"]);
var FileCategoryEnum = external_exports.enum(["IMAGE", "DOCUMENT", "AVATAR", "ATTACHMENT", "EXPORT"]);
var FileEntrySchema = external_exports.object({
  // Identity & Storage
  id: UUIDSchema,
  // File UUID (also the base filename in storage)
  userId: UUIDSchema,
  // Owner of the file
  sha256: external_exports.string().length(64),
  // Content hash for deduplication
  originalFilename: external_exports.string(),
  // Original filename from upload/generation
  mimeType: external_exports.string(),
  // Specific MIME type
  size: external_exports.number(),
  // File size in bytes
  // Image metadata (if applicable)
  width: external_exports.number().nullable().optional(),
  height: external_exports.number().nullable().optional(),
  // Linking - array of IDs this file is associated with
  linkedTo: external_exports.array(UUIDSchema).default([]),
  // messageId, chatId, characterId, personaId, etc.
  // Classification
  source: FileSourceEnum,
  // Where the file came from
  category: FileCategoryEnum,
  // What type of file it is
  // Generation metadata (for AI-generated files)
  generationPrompt: external_exports.string().nullable().optional(),
  generationModel: external_exports.string().nullable().optional(),
  generationRevisedPrompt: external_exports.string().nullable().optional(),
  description: external_exports.string().nullable().optional(),
  // AI description or user-provided description
  // Tags
  tags: external_exports.array(UUIDSchema).default([]),
  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var TagSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: external_exports.string(),
  nameLower: external_exports.string(),
  quickHide: external_exports.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var ImageProfileSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: external_exports.string(),
  provider: ImageProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: external_exports.string().nullable().optional(),
  modelName: external_exports.string(),
  parameters: JsonSchema.default({}),
  isDefault: external_exports.boolean().default(false),
  tags: external_exports.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var GeneralSettingsSchema = external_exports.object({
  version: external_exports.number().default(1),
  user: UserSchema,
  chatSettings: ChatSettingsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var ConnectionProfilesFileSchema = external_exports.object({
  version: external_exports.number().default(1),
  apiKeys: external_exports.array(ApiKeySchema).default([]),
  llmProfiles: external_exports.array(ConnectionProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var AuthAccountsSchema = external_exports.object({
  version: external_exports.number().default(1),
  accounts: external_exports.array(AccountSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var TagsFileSchema = external_exports.object({
  version: external_exports.number().default(1),
  tags: external_exports.array(TagSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var ImageProfilesFileSchema = external_exports.object({
  version: external_exports.number().default(1),
  profiles: external_exports.array(ImageProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var EmbeddingProfileSchema = external_exports.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: external_exports.string(),
  provider: EmbeddingProfileProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: external_exports.string().nullable().optional(),
  modelName: external_exports.string(),
  /** Embedding dimension size (provider-specific) */
  dimensions: external_exports.number().nullable().optional(),
  isDefault: external_exports.boolean().default(false),
  tags: external_exports.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var EmbeddingProfilesFileSchema = external_exports.object({
  version: external_exports.number().default(1),
  profiles: external_exports.array(EmbeddingProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var MemorySourceEnum = external_exports.enum(["AUTO", "MANUAL"]);
var MemorySchema = external_exports.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  personaId: UUIDSchema.nullable().optional(),
  // Optional: specific persona interaction
  chatId: UUIDSchema.nullable().optional(),
  // Optional: source chat reference
  content: external_exports.string(),
  // The actual memory content
  summary: external_exports.string(),
  // Distilled version for context injection
  keywords: external_exports.array(external_exports.string()).default([]),
  // For text-based search
  tags: external_exports.array(UUIDSchema).default([]),
  // Derived from character/persona/chat tags
  importance: external_exports.number().min(0).max(1).default(0.5),
  // 0-1 scale for prioritization
  embedding: external_exports.array(external_exports.number()).nullable().optional(),
  // Vector embedding for semantic search
  source: MemorySourceEnum.default("MANUAL"),
  // How it was created
  sourceMessageId: UUIDSchema.nullable().optional(),
  // If auto-created, which message triggered it
  lastAccessedAt: TimestampSchema.nullable().optional(),
  // For housekeeping decisions
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
var MemoriesFileSchema = external_exports.object({
  version: external_exports.number().default(1),
  memories: external_exports.array(MemorySchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

// lib/json-store/repositories/connection-profiles.repository.ts
var ConnectionProfilesRepository = class extends BaseRepository {
  constructor(jsonStore) {
    super(jsonStore, ConnectionProfileSchema);
  }
  /**
   * Get the connection profiles file path
   */
  getFilePath() {
    return "settings/connection-profiles.json";
  }
  /**
   * Read connection profiles file with default structure
   */
  async readProfilesFile() {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson(filePath);
      return ConnectionProfilesFileSchema.parse(data);
    } catch (error) {
      return {
        version: 1,
        apiKeys: [],
        llmProfiles: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp()
      };
    }
  }
  /**
   * Write connection profiles file with validation
   */
  async writeProfilesFile(data) {
    const validated = ConnectionProfilesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp()
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }
  /**
   * Find a connection profile by ID
   */
  async findById(id) {
    const file = await this.readProfilesFile();
    return file.llmProfiles.find((profile) => profile.id === id) || null;
  }
  /**
   * Find all connection profiles
   */
  async findAll() {
    const file = await this.readProfilesFile();
    return file.llmProfiles;
  }
  /**
   * Find connection profiles by user ID
   */
  async findByUserId(userId) {
    const file = await this.readProfilesFile();
    return file.llmProfiles.filter((profile) => profile.userId === userId);
  }
  /**
   * Find connection profiles with a specific tag
   */
  async findByTag(tagId) {
    const file = await this.readProfilesFile();
    return file.llmProfiles.filter((profile) => profile.tags.includes(tagId));
  }
  /**
   * Find default connection profile for user
   */
  async findDefault(userId) {
    const file = await this.readProfilesFile();
    return file.llmProfiles.find(
      (profile) => profile.userId === userId && profile.isDefault
    ) || null;
  }
  /**
   * Create a new connection profile
   */
  async create(data) {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();
    const profile = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
    const validated = this.validate(profile);
    const file = await this.readProfilesFile();
    file.llmProfiles.push(validated);
    await this.writeProfilesFile(file);
    this.jsonStore.clearCache();
    return validated;
  }
  /**
   * Update a connection profile
   */
  async update(id, data) {
    const file = await this.readProfilesFile();
    const index = file.llmProfiles.findIndex((profile) => profile.id === id);
    if (index === -1) {
      return null;
    }
    const existing = file.llmProfiles[index];
    const now = this.getCurrentTimestamp();
    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      // Preserve ID
      createdAt: existing.createdAt,
      // Preserve creation timestamp
      updatedAt: now
    };
    const validated = this.validate(updated);
    file.llmProfiles[index] = validated;
    await this.writeProfilesFile(file);
    this.jsonStore.clearCache();
    return validated;
  }
  /**
   * Delete a connection profile
   */
  async delete(id) {
    const file = await this.readProfilesFile();
    const initialLength = file.llmProfiles.length;
    file.llmProfiles = file.llmProfiles.filter((profile) => profile.id !== id);
    if (file.llmProfiles.length === initialLength) {
      return false;
    }
    await this.writeProfilesFile(file);
    this.jsonStore.clearCache();
    return true;
  }
  /**
   * Add a tag to a connection profile
   */
  async addTag(profileId, tagId) {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }
    if (!profile.tags.includes(tagId)) {
      profile.tags.push(tagId);
      return await this.update(profileId, { tags: profile.tags });
    }
    return profile;
  }
  /**
   * Remove a tag from a connection profile
   */
  async removeTag(profileId, tagId) {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }
    profile.tags = profile.tags.filter((id) => id !== tagId);
    return await this.update(profileId, { tags: profile.tags });
  }
  // ============================================================================
  // API KEY OPERATIONS
  // ============================================================================
  /**
   * Get all API keys
   */
  async getAllApiKeys() {
    const file = await this.readProfilesFile();
    return file.apiKeys;
  }
  /**
   * Find API key by ID
   */
  async findApiKeyById(id) {
    const file = await this.readProfilesFile();
    return file.apiKeys.find((key) => key.id === id) || null;
  }
  /**
   * Create a new API key
   */
  async createApiKey(data) {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();
    const apiKey = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
    const validated = ApiKeySchema.parse(apiKey);
    const file = await this.readProfilesFile();
    file.apiKeys.push(validated);
    await this.writeProfilesFile(file);
    this.jsonStore.clearCache();
    return validated;
  }
  /**
   * Update an API key
   */
  async updateApiKey(id, data) {
    const file = await this.readProfilesFile();
    const index = file.apiKeys.findIndex((key) => key.id === id);
    if (index === -1) {
      return null;
    }
    const existing = file.apiKeys[index];
    const now = this.getCurrentTimestamp();
    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      // Preserve ID
      createdAt: existing.createdAt,
      // Preserve creation timestamp
      updatedAt: now
    };
    const validated = ApiKeySchema.parse(updated);
    file.apiKeys[index] = validated;
    await this.writeProfilesFile(file);
    this.jsonStore.clearCache();
    return validated;
  }
  /**
   * Delete an API key
   */
  async deleteApiKey(id) {
    const file = await this.readProfilesFile();
    const initialLength = file.apiKeys.length;
    file.apiKeys = file.apiKeys.filter((key) => key.id !== id);
    if (file.apiKeys.length === initialLength) {
      return false;
    }
    await this.writeProfilesFile(file);
    this.jsonStore.clearCache();
    return true;
  }
  /**
   * Update API key last used timestamp
   */
  async recordApiKeyUsage(id) {
    return await this.updateApiKey(id, { lastUsed: this.getCurrentTimestamp() });
  }
};

// plugins/dist/qtap-plugin-upgrade/migrations/convert-openrouter-profiles.ts
function isOpenRouterEndpoint(baseUrl) {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    return url.hostname === "openrouter.ai" || url.hostname.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}
async function countProfilesToConvert() {
  const jsonStore = new JsonStore();
  const repo = new ConnectionProfilesRepository(jsonStore);
  try {
    const profiles = await repo.findAll();
    let count = 0;
    for (const profile of profiles) {
      if (profile.provider === "OPENAI_COMPATIBLE" && isOpenRouterEndpoint(profile.baseUrl)) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}
var convertOpenRouterProfilesMigration = {
  id: "convert-openrouter-profiles-v1",
  description: "Convert OPENAI_COMPATIBLE profiles using OpenRouter endpoint to native OPENROUTER provider",
  introducedInVersion: "1.7.0",
  async shouldRun() {
    const count = await countProfilesToConvert();
    return count > 0;
  },
  async run() {
    const startTime = Date.now();
    const jsonStore = new JsonStore();
    const repo = new ConnectionProfilesRepository(jsonStore);
    let converted = 0;
    const errors = [];
    try {
      const profiles = await repo.findAll();
      for (const profile of profiles) {
        if (profile.provider === "OPENAI_COMPATIBLE" && isOpenRouterEndpoint(profile.baseUrl)) {
          try {
            await repo.update(profile.id, {
              provider: "OPENROUTER",
              baseUrl: null,
              // OpenRouter provider doesn't use baseUrl
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            converted++;
            logger.debug("Converted profile from OPENAI_COMPATIBLE to OPENROUTER", {
              context: "migration.convert-openrouter-profiles",
              profileId: profile.id,
              profileName: profile.name
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            errors.push({
              profileId: profile.id,
              error: errorMessage
            });
            logger.error("Failed to convert profile", {
              context: "migration.convert-openrouter-profiles",
              profileId: profile.id
            }, error instanceof Error ? error : void 0);
          }
        }
      }
    } catch (error) {
      logger.error("Failed to read profiles", {
        context: "migration.convert-openrouter-profiles"
      }, error instanceof Error ? error : void 0);
      return {
        id: "convert-openrouter-profiles-v1",
        success: false,
        itemsAffected: converted,
        message: "Failed to read profiles",
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const success = errors.length === 0;
    return {
      id: "convert-openrouter-profiles-v1",
      success,
      itemsAffected: converted,
      message: success ? `Successfully converted ${converted} OpenRouter profiles` : `Converted ${converted} profiles with ${errors.length} errors`,
      error: errors.length > 0 ? `Failed on profiles: ${errors.map((e) => e.profileId).join(", ")}` : void 0,
      durationMs: Date.now() - startTime,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
};

// lib/json-store/repositories/image-profiles.repository.ts
var ImageProfilesRepository = class extends BaseRepository {
  constructor(jsonStore) {
    super(jsonStore, ImageProfileSchema);
  }
  /**
   * Get the image profiles file path
   */
  getFilePath() {
    return "settings/image-profiles.json";
  }
  /**
   * Read image profiles file with default structure
   */
  async readProfilesFile() {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson(filePath);
      return ImageProfilesFileSchema.parse(data);
    } catch (error) {
      return {
        version: 1,
        profiles: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp()
      };
    }
  }
  /**
   * Write image profiles file with validation
   */
  async writeProfilesFile(data) {
    const validated = ImageProfilesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp()
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }
  /**
   * Find an image profile by ID
   */
  async findById(id) {
    const file = await this.readProfilesFile();
    return file.profiles.find((profile) => profile.id === id) || null;
  }
  /**
   * Find all image profiles
   */
  async findAll() {
    const file = await this.readProfilesFile();
    return file.profiles;
  }
  /**
   * Find image profiles by user ID
   */
  async findByUserId(userId) {
    const file = await this.readProfilesFile();
    return file.profiles.filter((profile) => profile.userId === userId);
  }
  /**
   * Find image profiles with a specific tag
   */
  async findByTag(tagId) {
    const file = await this.readProfilesFile();
    return file.profiles.filter((profile) => profile.tags.includes(tagId));
  }
  /**
   * Find default image profile for user
   */
  async findDefault(userId) {
    const file = await this.readProfilesFile();
    return file.profiles.find(
      (profile) => profile.userId === userId && profile.isDefault
    ) || null;
  }
  /**
   * Find image profile by name for user
   */
  async findByName(userId, name) {
    const file = await this.readProfilesFile();
    return file.profiles.find(
      (profile) => profile.userId === userId && profile.name === name
    ) || null;
  }
  /**
   * Create a new image profile
   */
  async create(data) {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();
    const profile = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
    const validated = this.validate(profile);
    const file = await this.readProfilesFile();
    file.profiles.push(validated);
    await this.writeProfilesFile(file);
    return validated;
  }
  /**
   * Update an image profile
   */
  async update(id, data) {
    const file = await this.readProfilesFile();
    const index = file.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) {
      return null;
    }
    const existing = file.profiles[index];
    const now = this.getCurrentTimestamp();
    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      // Preserve ID
      createdAt: existing.createdAt,
      // Preserve creation timestamp
      updatedAt: now
    };
    const validated = this.validate(updated);
    file.profiles[index] = validated;
    await this.writeProfilesFile(file);
    return validated;
  }
  /**
   * Delete an image profile
   */
  async delete(id) {
    const file = await this.readProfilesFile();
    const initialLength = file.profiles.length;
    file.profiles = file.profiles.filter((profile) => profile.id !== id);
    if (file.profiles.length === initialLength) {
      return false;
    }
    await this.writeProfilesFile(file);
    return true;
  }
  /**
   * Add a tag to an image profile
   */
  async addTag(profileId, tagId) {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }
    if (!profile.tags.includes(tagId)) {
      profile.tags.push(tagId);
      return await this.update(profileId, { tags: profile.tags });
    }
    return profile;
  }
  /**
   * Remove a tag from an image profile
   */
  async removeTag(profileId, tagId) {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }
    profile.tags = profile.tags.filter((id) => id !== tagId);
    return await this.update(profileId, { tags: profile.tags });
  }
  /**
   * Unset default flag on all profiles for a user
   */
  async unsetAllDefaults(userId) {
    const file = await this.readProfilesFile();
    let changed = false;
    for (let i = 0; i < file.profiles.length; i++) {
      if (file.profiles[i].userId === userId && file.profiles[i].isDefault) {
        file.profiles[i] = {
          ...file.profiles[i],
          isDefault: false,
          updatedAt: this.getCurrentTimestamp()
        };
        changed = true;
      }
    }
    if (changed) {
      await this.writeProfilesFile(file);
    }
  }
};

// lib/json-store/repositories/embedding-profiles.repository.ts
var EmbeddingProfilesRepository = class extends BaseRepository {
  constructor(jsonStore) {
    super(jsonStore, EmbeddingProfileSchema);
  }
  /**
   * Get the embedding profiles file path
   */
  getFilePath() {
    return "settings/embedding-profiles.json";
  }
  /**
   * Read embedding profiles file with default structure
   */
  async readProfilesFile() {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson(filePath);
      return EmbeddingProfilesFileSchema.parse(data);
    } catch (error) {
      return {
        version: 1,
        profiles: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp()
      };
    }
  }
  /**
   * Write embedding profiles file with validation
   */
  async writeProfilesFile(data) {
    const validated = EmbeddingProfilesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp()
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }
  /**
   * Find an embedding profile by ID
   */
  async findById(id) {
    const file = await this.readProfilesFile();
    return file.profiles.find((profile) => profile.id === id) || null;
  }
  /**
   * Find all embedding profiles
   */
  async findAll() {
    const file = await this.readProfilesFile();
    return file.profiles;
  }
  /**
   * Find embedding profiles by user ID
   */
  async findByUserId(userId) {
    const file = await this.readProfilesFile();
    return file.profiles.filter((profile) => profile.userId === userId);
  }
  /**
   * Find embedding profiles with a specific tag
   */
  async findByTag(tagId) {
    const file = await this.readProfilesFile();
    return file.profiles.filter((profile) => profile.tags.includes(tagId));
  }
  /**
   * Find default embedding profile for user
   */
  async findDefault(userId) {
    const file = await this.readProfilesFile();
    return file.profiles.find(
      (profile) => profile.userId === userId && profile.isDefault
    ) || null;
  }
  /**
   * Find embedding profile by name for user
   */
  async findByName(userId, name) {
    const file = await this.readProfilesFile();
    return file.profiles.find(
      (profile) => profile.userId === userId && profile.name === name
    ) || null;
  }
  /**
   * Create a new embedding profile
   */
  async create(data) {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();
    const profile = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
    const validated = this.validate(profile);
    const file = await this.readProfilesFile();
    file.profiles.push(validated);
    await this.writeProfilesFile(file);
    return validated;
  }
  /**
   * Update an embedding profile
   */
  async update(id, data) {
    const file = await this.readProfilesFile();
    const index = file.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) {
      return null;
    }
    const existing = file.profiles[index];
    const now = this.getCurrentTimestamp();
    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      // Preserve ID
      createdAt: existing.createdAt,
      // Preserve creation timestamp
      updatedAt: now
    };
    const validated = this.validate(updated);
    file.profiles[index] = validated;
    await this.writeProfilesFile(file);
    return validated;
  }
  /**
   * Delete an embedding profile
   */
  async delete(id) {
    const file = await this.readProfilesFile();
    const initialLength = file.profiles.length;
    file.profiles = file.profiles.filter((profile) => profile.id !== id);
    if (file.profiles.length === initialLength) {
      return false;
    }
    await this.writeProfilesFile(file);
    return true;
  }
  /**
   * Add a tag to an embedding profile
   */
  async addTag(profileId, tagId) {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }
    if (!profile.tags.includes(tagId)) {
      profile.tags.push(tagId);
      return await this.update(profileId, { tags: profile.tags });
    }
    return profile;
  }
  /**
   * Remove a tag from an embedding profile
   */
  async removeTag(profileId, tagId) {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }
    profile.tags = profile.tags.filter((id) => id !== tagId);
    return await this.update(profileId, { tags: profile.tags });
  }
  /**
   * Unset default flag on all profiles for a user
   */
  async unsetAllDefaults(userId) {
    const file = await this.readProfilesFile();
    let changed = false;
    for (let i = 0; i < file.profiles.length; i++) {
      if (file.profiles[i].userId === userId && file.profiles[i].isDefault) {
        file.profiles[i] = {
          ...file.profiles[i],
          isDefault: false,
          updatedAt: this.getCurrentTimestamp()
        };
        changed = true;
      }
    }
    if (changed) {
      await this.writeProfilesFile(file);
    }
  }
};

// lib/plugins/registry.ts
var PluginRegistry = class {
  constructor() {
    this.state = {
      initialized: false,
      plugins: /* @__PURE__ */ new Map(),
      errors: /* @__PURE__ */ new Map(),
      capabilities: /* @__PURE__ */ new Map(),
      lastScanTime: null
    };
  }
  /**
   * Initialize the registry with scanned plugins
   */
  async initialize(scanResult) {
    logger.info("Initializing plugin registry", {
      pluginCount: scanResult.plugins.length,
      errorCount: scanResult.errors.length
    });
    this.state.plugins.clear();
    this.state.errors.clear();
    this.state.capabilities.clear();
    for (const plugin2 of scanResult.plugins) {
      this.registerPlugin(plugin2);
    }
    for (const error of scanResult.errors) {
      this.state.errors.set(error.pluginName, error.error);
    }
    this.state.initialized = true;
    this.state.lastScanTime = /* @__PURE__ */ new Date();
    logger.info("Plugin registry initialized", {
      registered: this.state.plugins.size,
      errors: this.state.errors.size
    });
  }
  /**
   * Register a single plugin
   */
  registerPlugin(plugin2) {
    const pluginName = plugin2.manifest.name;
    this.state.plugins.set(pluginName, plugin2);
    for (const capability of plugin2.capabilities) {
      if (!this.state.capabilities.has(capability)) {
        this.state.capabilities.set(capability, []);
      }
      this.state.capabilities.get(capability).push(pluginName);
    }
    logger.debug("Plugin registered", {
      name: pluginName,
      version: plugin2.manifest.version,
      capabilities: plugin2.capabilities
    });
  }
  /**
   * Get all registered plugins
   */
  getAll() {
    return Array.from(this.state.plugins.values());
  }
  /**
   * Get enabled plugins only
   */
  getEnabled() {
    return this.getAll().filter((p) => p.enabled);
  }
  /**
   * Get a specific plugin by name
   */
  get(name) {
    return this.state.plugins.get(name) || null;
  }
  /**
   * Get plugins by capability
   */
  getByCapability(capability) {
    const names = this.state.capabilities.get(capability) || [];
    return names.map((name) => this.state.plugins.get(name)).filter((p) => p !== void 0);
  }
  /**
   * Get enabled plugins by capability
   */
  getEnabledByCapability(capability) {
    return this.getByCapability(capability).filter((p) => p.enabled);
  }
  /**
   * Check if a plugin is registered
   */
  has(name) {
    return this.state.plugins.has(name);
  }
  /**
   * Enable a plugin
   */
  enable(name) {
    const plugin2 = this.state.plugins.get(name);
    if (!plugin2) {
      logger.warn("Cannot enable plugin: not found", { name });
      return false;
    }
    plugin2.enabled = true;
    logger.info("Plugin enabled", { name });
    return true;
  }
  /**
   * Disable a plugin
   */
  disable(name) {
    const plugin2 = this.state.plugins.get(name);
    if (!plugin2) {
      logger.warn("Cannot disable plugin: not found", { name });
      return false;
    }
    plugin2.enabled = false;
    logger.info("Plugin disabled", { name });
    return true;
  }
  /**
   * Get all available capabilities
   */
  getCapabilities() {
    return Array.from(this.state.capabilities.keys());
  }
  /**
   * Get registry statistics
   */
  getStats() {
    const all = this.getAll();
    const enabled = this.getEnabled();
    return {
      total: all.length,
      enabled: enabled.length,
      disabled: all.length - enabled.length,
      errors: this.state.errors.size,
      capabilities: this.state.capabilities.size,
      initialized: this.state.initialized,
      lastScan: this.state.lastScanTime?.toISOString() || null
    };
  }
  /**
   * Get all errors
   */
  getErrors() {
    return Array.from(this.state.errors.entries()).map(([plugin2, error]) => ({
      plugin: plugin2,
      error
    }));
  }
  /**
   * Check if registry is initialized
   */
  isInitialized() {
    return this.state.initialized;
  }
  /**
   * Reset the registry (for testing)
   */
  reset() {
    this.state.initialized = false;
    this.state.plugins.clear();
    this.state.errors.clear();
    this.state.capabilities.clear();
    this.state.lastScanTime = null;
    logger.debug("Plugin registry reset");
  }
  /**
   * Export registry state (for debugging/admin UI)
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastScanTime: this.state.lastScanTime?.toISOString() || null,
      plugins: Array.from(this.state.plugins.entries()).map(([name, plugin2]) => ({
        name,
        title: plugin2.manifest.title,
        version: plugin2.manifest.version,
        enabled: plugin2.enabled,
        capabilities: plugin2.capabilities,
        path: plugin2.pluginPath,
        source: plugin2.source
      })),
      errors: Array.from(this.state.errors.entries()).map(([name, error]) => ({
        name,
        error
      })),
      capabilities: Array.from(this.state.capabilities.entries()).map(([cap, plugins]) => ({
        capability: cap,
        plugins
      })),
      stats: this.getStats()
    };
  }
};
var pluginRegistry = new PluginRegistry();

// plugins/dist/qtap-plugin-upgrade/migrations/enable-provider-plugins.ts
var PROVIDER_TO_PLUGIN = {
  "OPENAI": "qtap-plugin-openai",
  "ANTHROPIC": "qtap-plugin-anthropic",
  "OLLAMA": "qtap-plugin-ollama",
  "OPENROUTER": "qtap-plugin-openrouter",
  "OPENAI_COMPATIBLE": "qtap-plugin-openai-compatible",
  "GROK": "qtap-plugin-grok",
  "GAB_AI": "qtap-plugin-gab-ai",
  "GOOGLE": "qtap-plugin-google",
  // Image-specific providers
  "GOOGLE_IMAGEN": "qtap-plugin-google"
  // Google Imagen is part of the Google plugin
};
async function getProvidersInUse() {
  const jsonStore = new JsonStore();
  const providers = /* @__PURE__ */ new Set();
  try {
    const connectionRepo = new ConnectionProfilesRepository(jsonStore);
    const connectionProfiles = await connectionRepo.findAll();
    for (const profile of connectionProfiles) {
      if (profile.provider) {
        providers.add(profile.provider);
      }
    }
    const imageRepo = new ImageProfilesRepository(jsonStore);
    const imageProfiles = await imageRepo.findAll();
    for (const profile of imageProfiles) {
      if (profile.provider) {
        providers.add(profile.provider);
      }
    }
    const embeddingRepo = new EmbeddingProfilesRepository(jsonStore);
    const embeddingProfiles = await embeddingRepo.findAll();
    for (const profile of embeddingProfiles) {
      if (profile.provider) {
        providers.add(profile.provider);
      }
    }
  } catch (error) {
    logger.warn("Error reading profiles for provider detection", {
      context: "migration.enable-provider-plugins",
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return providers;
}
async function checkProvidersNeedEnabling() {
  const providersInUse = await getProvidersInUse();
  const needsEnabling = [];
  const alreadyEnabled = [];
  for (const provider of providersInUse) {
    const pluginName = PROVIDER_TO_PLUGIN[provider];
    if (!pluginName) {
      logger.warn("Unknown provider, no plugin mapping", {
        context: "migration.enable-provider-plugins",
        provider
      });
      continue;
    }
    const plugin2 = pluginRegistry.get(pluginName);
    if (!plugin2) {
      logger.warn("Provider plugin not found", {
        context: "migration.enable-provider-plugins",
        provider,
        pluginName
      });
      continue;
    }
    if (plugin2.enabled) {
      alreadyEnabled.push(pluginName);
    } else {
      needsEnabling.push(pluginName);
    }
  }
  return { needsEnabling, alreadyEnabled };
}
var enableProviderPluginsMigration = {
  id: "enable-provider-plugins-v1",
  description: "Enable provider plugins for all providers currently in use by profiles",
  introducedInVersion: "1.8.0",
  dependsOn: ["convert-openrouter-profiles-v1"],
  // Run after OpenRouter conversion
  async shouldRun() {
    if (!pluginRegistry.isInitialized()) {
      logger.debug("Plugin registry not initialized yet, deferring migration", {
        context: "migration.enable-provider-plugins"
      });
      return false;
    }
    const { needsEnabling } = await checkProvidersNeedEnabling();
    return needsEnabling.length > 0;
  },
  async run() {
    const startTime = Date.now();
    const enabledPlugins = [];
    const errors = [];
    logger.info("Starting provider plugin enablement migration", {
      context: "migration.enable-provider-plugins"
    });
    const { needsEnabling, alreadyEnabled } = await checkProvidersNeedEnabling();
    logger.info("Provider plugin status", {
      context: "migration.enable-provider-plugins",
      needsEnabling: needsEnabling.length,
      alreadyEnabled: alreadyEnabled.length
    });
    for (const pluginName of needsEnabling) {
      try {
        const success2 = pluginRegistry.enable(pluginName);
        if (success2) {
          enabledPlugins.push(pluginName);
          logger.info("Enabled provider plugin", {
            context: "migration.enable-provider-plugins",
            pluginName
          });
        } else {
          errors.push({
            pluginName,
            error: "Failed to enable plugin (registry returned false)"
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          pluginName,
          error: errorMessage
        });
        logger.error("Failed to enable provider plugin", {
          context: "migration.enable-provider-plugins",
          pluginName,
          error: errorMessage
        });
      }
    }
    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;
    return {
      id: "enable-provider-plugins-v1",
      success,
      itemsAffected: enabledPlugins.length,
      message: success ? `Enabled ${enabledPlugins.length} provider plugins: ${enabledPlugins.join(", ")}` : `Enabled ${enabledPlugins.length} plugins with ${errors.length} errors`,
      error: errors.length > 0 ? `Failed plugins: ${errors.map((e) => `${e.pluginName}: ${e.error}`).join("; ")}` : void 0,
      durationMs,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
};

// plugins/dist/qtap-plugin-upgrade/migrations/index.ts
var migrations = [
  convertOpenRouterProfilesMigration,
  enableProviderPluginsMigration
];

// plugins/dist/qtap-plugin-upgrade/index.ts
var upgradeLogger = logger.child({
  module: "upgrade-plugin"
});
var plugin = {
  /**
   * Run all pending migrations
   */
  async runMigrations() {
    upgradeLogger.info("Starting upgrade migrations", {
      context: "upgrade-plugin.runMigrations",
      totalMigrations: migrations.length
    });
    const result = await runMigrations(migrations);
    if (result.success) {
      upgradeLogger.info("Upgrade migrations completed successfully", {
        context: "upgrade-plugin.runMigrations",
        migrationsRun: result.migrationsRun,
        migrationsSkipped: result.migrationsSkipped,
        totalDurationMs: result.totalDurationMs
      });
    } else {
      upgradeLogger.error("Upgrade migrations failed", {
        context: "upgrade-plugin.runMigrations",
        results: result.results.filter((r) => !r.success)
      });
    }
    return result;
  },
  /**
   * Check which migrations need to run
   */
  async getPendingMigrations() {
    return getPendingMigrations(migrations);
  },
  /**
   * Get list of all available migrations
   */
  getAllMigrations() {
    return migrations;
  },
  /**
   * Get current migration state
   */
  async getMigrationState() {
    return loadMigrationState();
  }
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getPendingMigrations,
  loadMigrationState,
  migrations,
  plugin,
  runMigrations
});
