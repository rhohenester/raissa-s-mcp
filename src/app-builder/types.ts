// ---------------------------------------------------------------------------
// App Builder — core data types
//
// Think of this like your React prop types, but for the "apps inside the app"
// that the agent builds and the workflow runner executes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data Model layer  (like a database schema)
// ---------------------------------------------------------------------------

export type FieldType = "string" | "number" | "boolean" | "date";

export interface Field {
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
}

export interface DataModel {
  name: string;
  description?: string;
  fields: Field[];
}

// ---------------------------------------------------------------------------
// Workflow layer  (like a server action or API route handler)
// ---------------------------------------------------------------------------

/**
 * What a single workflow step can do.
 *
 * create_record / list_records / update_record / delete_record
 *   → CRUD operations against an app's in-memory data store
 * output
 *   → emit a human-readable message as the step result
 */
export type WorkflowStepType =
  | "create_record"
  | "list_records"
  | "update_record"
  | "delete_record"
  | "output";

/**
 * A single step inside a workflow.
 *
 * Values in `data` or `filter` can reference workflow input using
 * double-brace template syntax:  "{{fieldName}}"
 * e.g. { title: "{{title}}" } pulls `title` from the workflow's input object.
 */
export interface WorkflowStep {
  /** Unique identifier within this workflow (used as result key if outputKey is absent). */
  id: string;
  type: WorkflowStepType;
  /** Which data model to operate on (required for CRUD steps). */
  modelName?: string;
  /**
   * Data to write (create / update) or template parameters.
   * String values are resolved against the current workflow context.
   */
  data?: Record<string, unknown>;
  /** Filter criteria for list_records (key/value equality). */
  filter?: Record<string, unknown>;
  /** Store this step's result in the context under this key for later steps. */
  outputKey?: string;
  /** Human-readable message emitted by an "output" step. Supports templates. */
  message?: string;
}

export interface Workflow {
  name: string;
  description: string;
  /** JSON-Schema-style declaration of what input this workflow accepts. */
  inputSchema?: Record<string, { type: string; description?: string; required?: boolean }>;
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------------------
// App — the top-level container
// ---------------------------------------------------------------------------

export interface App {
  id: string;
  name: string;
  description: string;
  purpose: string;
  dataModels: DataModel[];
  workflows: Workflow[];
  createdAt: string;
  /**
   * In-memory data store — think of this as the app's database.
   * Shape: modelName → array of records
   */
  data: Record<string, Record<string, unknown>[]>;
}

// ---------------------------------------------------------------------------
// Input shapes for the MCP tools
// ---------------------------------------------------------------------------

export interface CreateAppInput {
  name: string;
  description: string;
  purpose?: string;
}

export interface AddDataModelInput {
  appId: string;
  modelName: string;
  description?: string;
  fields: Field[];
}

export interface AddWorkflowInput {
  appId: string;
  workflowName: string;
  description: string;
  inputSchema?: Record<string, { type: string; description?: string }>;
  steps: WorkflowStep[];
}

export interface RunWorkflowInput {
  appId: string;
  workflowName: string;
  input?: Record<string, unknown>;
}
