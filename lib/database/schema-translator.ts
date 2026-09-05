/**
 * Schema Translator Module
 *
 * Introspects Zod schemas to extract field metadata and generate
 * SQLite table definitions. Handles the translation from document-oriented
 * schemas to relational table structures.
 *
 * Updated for Zod v4 compatibility - uses internal _zod.def API.
 */

import { z, ZodObject, ZodArray, ZodOptional, ZodNullable, ZodDefault, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodLiteral, ZodUnion, ZodRecord, ZodType } from 'zod';
import { FieldMetadata, SchemaMetadata, IndexDefinition } from './interfaces';
import { logger } from '@/lib/logger';

// ============================================================================
// Zod v4 Internal API Access Helpers
// ============================================================================

/**
 * Access the internal definition of a Zod schema (Zod v4 API)
 */
function getZodDef(schema: ZodType): any {
  return (schema as any)._zod?.def;
}

// ============================================================================
// Zod Schema Introspection
// ============================================================================

/**
 * Get the inner type from optional/nullable/default wrappers
 */
function unwrapType(schema: ZodType): { inner: ZodType; optional: boolean; nullable: boolean; defaultValue?: unknown } {
  let inner = schema;
  let optional = false;
  let nullable = false;
  let defaultValue: unknown = undefined;

  // Unwrap layers
  while (true) {
    if (inner instanceof ZodOptional) {
      optional = true;
      inner = inner.unwrap() as unknown as ZodType;
    } else if (inner instanceof ZodNullable) {
      nullable = true;
      inner = inner.unwrap() as unknown as ZodType;
    } else if (inner instanceof ZodDefault) {
      const def = getZodDef(inner);
      defaultValue = def?.defaultValue;
      const innerType = def?.innerType as ZodType | undefined;
      if (!innerType) break;
      inner = innerType;
    } else {
      break;
    }
  }

  return { inner, optional, nullable, defaultValue };
}

/**
 * Determine the base type from a Zod schema
 */
function getBaseType(schema: ZodType): FieldMetadata['type'] {
  const { inner } = unwrapType(schema);

  if (inner instanceof ZodString) return 'string';
  if (inner instanceof ZodNumber) return 'number';
  if (inner instanceof ZodBoolean) return 'boolean';
  if (inner instanceof ZodArray) return 'array';
  if (inner instanceof ZodObject) return 'object';
  if (inner instanceof ZodRecord) return 'object';  // z.record() is also stored as JSON
  if (inner instanceof ZodEnum) return 'string';
  if (inner instanceof ZodLiteral) {
    // Zod v4: values is an array
    const def = getZodDef(inner);
    const values = def?.values;
    const value = Array.isArray(values) ? values[0] : values;
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
  }
  if (inner instanceof ZodUnion) {
    // For unions, try to determine the common type
    const def = getZodDef(inner);
    const options = def?.options as ZodType[] || [];
    const types = options.map(opt => getBaseType(opt));
    if (types.length > 0 && types.every(t => t === types[0])) return types[0];
    return 'unknown';
  }

  // Check for date-like strings (ISO format) using instanceof instead of typeName
  if (inner instanceof ZodString) {
    const def = getZodDef(inner);
    const checks = def?.checks || [];
    // Zod v4: check objects have _zod.def with the check type
    if (checks.some((c: any) => {
      const checkDef = c?._zod?.def || c;
      const checkType = checkDef.check || checkDef.kind;
      return checkType === 'datetime' || checkType === 'date';
    })) {
      return 'date';
    }
  }

  return 'unknown';
}

/**
 * Get the check definition from a Zod v4 check object
 * In Zod v4, check objects are class instances with _zod.def containing the definition
 */
function getCheckDef(check: any): any {
  return check?._zod?.def || check;
}

/**
 * Extract string constraints
 */
function getStringConstraints(schema: ZodType): { maxLength?: number; minLength?: number } {
  const { inner } = unwrapType(schema);

  if (!(inner instanceof ZodString)) return {};

  const def = getZodDef(inner);
  const checks = def?.checks || [];
  const constraints: { maxLength?: number; minLength?: number } = {};

  for (const check of checks) {
    // Zod v4: check objects are class instances with _zod.def containing the definition
    const checkDef = getCheckDef(check);
    const checkType = checkDef.check || checkDef.kind;

    // Zod v4 uses "max_length"/"min_length" with "maximum"/"minimum" properties
    if (checkType === 'max_length' || checkType === 'max' || checkType === 'length') {
      if (checkDef.maximum !== undefined) constraints.maxLength = checkDef.maximum;
      else if (checkDef.value !== undefined) constraints.maxLength = checkDef.value;
    }
    if (checkType === 'min_length' || checkType === 'min') {
      if (checkDef.minimum !== undefined) constraints.minLength = checkDef.minimum;
      else if (checkDef.value !== undefined) constraints.minLength = checkDef.value;
    }
  }

  return constraints;
}

/**
 * Extract number constraints
 */
function getNumberConstraints(schema: ZodType): { min?: number; max?: number } {
  const { inner } = unwrapType(schema);

  if (!(inner instanceof ZodNumber)) return {};

  const def = getZodDef(inner);
  const checks = def?.checks || [];
  const constraints: { min?: number; max?: number } = {};

  for (const check of checks) {
    // Zod v4: check objects are class instances with _zod.def containing the definition
    const checkDef = getCheckDef(check);
    const checkType = checkDef.check || checkDef.kind;

    // Zod v4 uses "greater_than" for min and "less_than" for max
    // The value is in checkDef.value
    if (checkType === 'greater_than' || checkType === 'min') {
      if (checkDef.value !== undefined) constraints.min = checkDef.value;
    }
    if (checkType === 'less_than' || checkType === 'max') {
      if (checkDef.value !== undefined) constraints.max = checkDef.value;
    }
  }

  return constraints;
}

/**
 * Extract metadata from a single field
 */
function extractFieldMetadata(name: string, schema: ZodType): FieldMetadata {
  const { inner, optional, nullable, defaultValue } = unwrapType(schema);
  const type = getBaseType(schema);

  const metadata: FieldMetadata = {
    name,
    type,
    optional,
    nullable,
    defaultValue,
  };

  // Add type-specific constraints
  if (type === 'string') {
    const { maxLength } = getStringConstraints(schema);
    if (maxLength !== undefined) metadata.maxLength = maxLength;
  }

  if (type === 'number') {
    const { min, max } = getNumberConstraints(schema);
    if (min !== undefined) metadata.min = min;
    if (max !== undefined) metadata.max = max;
  }

  // Handle arrays - Zod v4 uses 'element' instead of 'type'
  if (inner instanceof ZodArray) {
    const def = getZodDef(inner);
    const elementSchema = def?.element;
    if (elementSchema) {
      metadata.elementType = extractFieldMetadata('element', elementSchema);
    }
  }

  // Handle nested objects
  if (inner instanceof ZodObject) {
    metadata.fields = extractObjectFields(inner);
  }

  // Mark common key fields
  if (name === 'id') {
    metadata.isPrimaryKey = true;
    metadata.indexed = true;
    metadata.unique = true;
  } else if (name === 'userId') {
    metadata.indexed = true;
  }

  return metadata;
}

/**
 * Extract all fields from a Zod object schema
 */
function extractObjectFields(schema: ZodObject<any>): FieldMetadata[] {
  // Zod v4: shape is a property, not a function
  const def = getZodDef(schema);
  const shape = def?.shape || {};
  const fields: FieldMetadata[] = [];

  for (const [name, fieldSchema] of Object.entries(shape)) {
    fields.push(extractFieldMetadata(name, fieldSchema as ZodType));
  }

  return fields;
}

/**
 * Extract complete schema metadata from a Zod schema
 */
export function extractSchemaMetadata(name: string, schema: z.ZodType): SchemaMetadata {
  // Ensure we have an object schema
  if (!(schema instanceof ZodObject)) {
    throw new Error(`Schema for ${name} must be a ZodObject`);
  }

  const fields = extractObjectFields(schema);

  // Find primary key
  const primaryKeyField = fields.find(f => f.isPrimaryKey);
  const primaryKey = primaryKeyField?.name || 'id';

  // Generate default indexes
  const indexes: IndexDefinition[] = [];

  // Index on userId for user-scoped queries
  if (fields.some(f => f.name === 'userId')) {
    indexes.push({
      name: `idx_${name}_userId`,
      fields: { userId: 1 },
    });
  }

  // Index on createdAt for time-based queries
  if (fields.some(f => f.name === 'createdAt')) {
    indexes.push({
      name: `idx_${name}_createdAt`,
      fields: { createdAt: -1 },
    });
  }

  return {
    name,
    fields,
    primaryKey,
    indexes,
  };
}

/**
 * Detect JSON, array, and boolean columns from a Zod schema — the column
 * classifications `SQLiteCollection` needs to serialize and deserialize rows.
 */
export function classifySchemaColumns(
  collectionName: string,
  schema: z.ZodType,
): { jsonColumns: string[]; arrayColumns: string[]; booleanColumns: string[] } {
  const metadata = extractSchemaMetadata(collectionName, schema);
  const jsonColumns = metadata.fields
    .filter(f => f.type === 'array' || f.type === 'object')
    .map(f => f.name);
  const arrayColumns = metadata.fields
    .filter(f => f.type === 'array')
    .map(f => f.name);
  const booleanColumns = metadata.fields
    .filter(f => f.type === 'boolean')
    .map(f => f.name);
  return { jsonColumns, arrayColumns, booleanColumns };
}

// ============================================================================
// SQLite DDL Generation
// ============================================================================

/**
 * Map field type to SQLite column type
 */
function mapToSQLiteType(field: FieldMetadata): string {
  switch (field.type) {
    case 'string':
    case 'date':
      return 'TEXT';
    case 'number':
      // Check if it's an integer
      if (field.min !== undefined && Number.isInteger(field.min) &&
          field.max !== undefined && Number.isInteger(field.max)) {
        return 'INTEGER';
      }
      return 'REAL';
    case 'boolean':
      return 'INTEGER'; // SQLite uses 0/1 for booleans
    case 'array':
    case 'object':
      return 'TEXT'; // Stored as JSON
    default:
      return 'TEXT';
  }
}

/**
 * Generate column constraints
 */
function generateColumnConstraints(field: FieldMetadata): string {
  const constraints: string[] = [];

  if (field.isPrimaryKey) {
    constraints.push('PRIMARY KEY');
  }

  if (!field.optional && !field.nullable && field.defaultValue === undefined) {
    constraints.push('NOT NULL');
  }

  if (field.unique && !field.isPrimaryKey) {
    constraints.push('UNIQUE');
  }

  if (field.defaultValue !== undefined) {
    const defaultStr = formatDefaultValue(field.defaultValue, field.type);
    constraints.push(`DEFAULT ${defaultStr}`);
  }

  return constraints.join(' ');
}

/**
 * Format a default value for SQL
 */
function formatDefaultValue(value: unknown, type: FieldMetadata['type']): string {
  if (value === null) return 'NULL';

  switch (type) {
    case 'string':
    case 'date':
      return `'${String(value).replace(/'/g, "''")}'`;
    case 'number':
      return String(value);
    case 'boolean':
      return value ? '1' : '0';
    case 'array':
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    case 'object':
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    default:
      return `'${String(value).replace(/'/g, "''")}'`;
  }
}

/**
 * Generate a column definition
 */
function generateColumnDef(field: FieldMetadata): string {
  const type = mapToSQLiteType(field);
  const constraints = generateColumnConstraints(field);

  return `  "${field.name}" ${type}${constraints ? ' ' + constraints : ''}`;
}

/**
 * Generate CREATE TABLE statement from schema metadata
 */
export function generateCreateTable(metadata: SchemaMetadata): string {
  const columns = metadata.fields.map(generateColumnDef);

  let sql = `CREATE TABLE IF NOT EXISTS "${metadata.name}" (\n`;
  sql += columns.join(',\n');
  sql += '\n)';

  return sql;
}

/**
 * Generate CREATE INDEX statements from schema metadata
 */
export function generateCreateIndexes(metadata: SchemaMetadata): string[] {
  if (!metadata.indexes || metadata.indexes.length === 0) {
    return [];
  }

  return metadata.indexes.map(index => {
    const columns = Object.entries(index.fields)
      .map(([field, direction]) => `"${field}" ${direction === 1 ? 'ASC' : 'DESC'}`)
      .join(', ');

    const unique = index.unique ? 'UNIQUE ' : '';

    return `CREATE ${unique}INDEX IF NOT EXISTS "${index.name}" ON "${metadata.name}" (${columns})`;
  });
}

/**
 * Generate all DDL statements for a schema
 */
export function generateDDL(name: string, schema: z.ZodType): string[] {
  try {
    const metadata = extractSchemaMetadata(name, schema);
    const statements: string[] = [];

    // Create table
    statements.push(generateCreateTable(metadata));

    // Create indexes
    statements.push(...generateCreateIndexes(metadata));
    return statements;
  } catch (error) {
    logger.error('Failed to generate DDL', {
      table: name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Schema Comparison (for migrations)
// ============================================================================

/**
 * Comparison result for schema differences
 */
export interface SchemaDiff {
  /** Fields that exist in new schema but not in current table */
  addedFields: FieldMetadata[];
  /** Fields that exist in current table but not in new schema */
  removedFields: string[];
  /** Fields with changed types or constraints */
  modifiedFields: Array<{ field: string; oldType: string; newType: string }>;
  /** New indexes to create */
  addedIndexes: IndexDefinition[];
  /** Indexes to remove */
  removedIndexes: string[];
}

/**
 * Compare schema metadata with current table structure
 * (To be implemented when we have table introspection)
 */
export function compareSchemas(
  newMetadata: SchemaMetadata,
  currentColumns: Array<{ name: string; type: string; nullable: boolean }>
): SchemaDiff {
  const diff: SchemaDiff = {
    addedFields: [],
    removedFields: [],
    modifiedFields: [],
    addedIndexes: [],
    removedIndexes: [],
  };

  const currentColumnNames = new Set(currentColumns.map(c => c.name));
  const newFieldNames = new Set(newMetadata.fields.map(f => f.name));

  // Find added fields
  for (const field of newMetadata.fields) {
    if (!currentColumnNames.has(field.name)) {
      diff.addedFields.push(field);
    }
  }

  // Find removed fields
  for (const column of currentColumns) {
    if (!newFieldNames.has(column.name)) {
      diff.removedFields.push(column.name);
    }
  }

  // Find modified fields (type changes)
  for (const field of newMetadata.fields) {
    const currentColumn = currentColumns.find(c => c.name === field.name);
    if (currentColumn) {
      const newSqlType = mapToSQLiteType(field);
      if (newSqlType !== currentColumn.type) {
        diff.modifiedFields.push({
          field: field.name,
          oldType: currentColumn.type,
          newType: newSqlType,
        });
      }
    }
  }

  return diff;
}

/**
 * Generate ALTER TABLE statements for schema changes
 * Note: SQLite has limited ALTER TABLE support, so some changes require table recreation
 */
export function generateAlterStatements(tableName: string, diff: SchemaDiff): string[] {
  const statements: string[] = [];

  // Add new columns (SQLite supports this)
  for (const field of diff.addedFields) {
    const type = mapToSQLiteType(field);
    const constraints = generateColumnConstraints(field);
    statements.push(`ALTER TABLE "${tableName}" ADD COLUMN "${field.name}" ${type}${constraints ? ' ' + constraints : ''}`);
  }

  // Note: SQLite doesn't support DROP COLUMN or MODIFY COLUMN directly
  // These would require table recreation (copy data, drop old table, create new, copy back)
  if (diff.removedFields.length > 0 || diff.modifiedFields.length > 0) {
    logger.warn('Schema changes require table recreation', {
      table: tableName,
      removedFields: diff.removedFields,
      modifiedFields: diff.modifiedFields.map(m => m.field),
    });
  }

  return statements;
}
