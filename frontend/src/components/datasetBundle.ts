import { getAnnotationPlugin } from "../plugins/annotations/registry";
import type { LabelSchema } from "./annotator/types";

export interface MetadataFieldDefinition {
  key: string;
  label: string;
  type: "text" | "choice" | "number" | "boolean";
  options: string[];
}

export interface ParsedDatasetRow {
  filename: string;
  metadata: Record<string, string | number | boolean>;
  goldAnswer: Record<string, unknown> | null;
  errors: string[];
}

interface BundleOptions {
  annotationType: string;
  labels: string[];
  multiSelect: boolean;
}

export interface ParsedDatasetBundle {
  rows: ParsedDatasetRow[];
  metadataFields: MetadataFieldDefinition[];
  errors: string[];
}

const humanize = (value: string) => value
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, letter => letter.toUpperCase());

const toKey = (value: string) => value
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^[^a-z]+/, "")
  .replace(/_+$/, "");

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Metadata CSV contains an unclosed quoted value");
  row.push(field.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

function inferField(key: string, values: string[]): MetadataFieldDefinition {
  const populated = values.filter(Boolean);
  const lowered = populated.map(value => value.toLowerCase());
  const unique = [...new Set(populated)];
  if (populated.length && lowered.every(value => value === "true" || value === "false")) {
    return { key, label: humanize(key), type: "boolean", options: [] };
  }
  if (populated.length && populated.every(value => Number.isFinite(Number(value)))) {
    return { key, label: humanize(key), type: "number", options: [] };
  }
  if (populated.length && unique.length <= 20) {
    return { key, label: humanize(key), type: "choice", options: unique };
  }
  return { key, label: humanize(key), type: "text", options: [] };
}

function coerce(value: string, field: MetadataFieldDefinition): string | number | boolean {
  if (field.type === "number") return Number(value);
  if (field.type === "boolean") return value.toLowerCase() === "true";
  return value;
}

export function validateGold(answer: unknown, options: BundleOptions): string[] {
  const plugin = getAnnotationPlugin(options.annotationType);
  if (!plugin) return [`Unsupported annotation type: ${options.annotationType}`];
  const schema: LabelSchema = {
    annotation_type: options.annotationType,
    choices: options.labels,
    multi_select: options.multiSelect,
  };
  return plugin.validateGold(answer, schema);
}

export function parseDatasetBundle(
  filenames: string[],
  metadataCsv: string,
  goldJson: string,
  options: BundleOptions,
): ParsedDatasetBundle {
  const errors: string[] = [];
  const duplicateFiles = filenames.filter((filename, index) => filenames.indexOf(filename) !== index);
  if (duplicateFiles.length) errors.push(`Duplicate media filename: ${[...new Set(duplicateFiles)].join(", ")}`);

  let metadataFields: MetadataFieldDefinition[] = [];
  const metadataByFilename = new Map<string, Record<string, string | number | boolean>>();
  if (metadataCsv.trim()) {
    const csvRows = parseCsv(metadataCsv.replace(/^\uFEFF/, ""));
    if (!csvRows.length) throw new Error("Metadata CSV is empty");
    const headers = csvRows[0].map(header => header.trim());
    const filenameIndex = headers.indexOf("filename");
    if (filenameIndex < 0) throw new Error('Metadata CSV must include a "filename" column');
    if (new Set(headers).size !== headers.length) throw new Error("Metadata CSV has duplicate column names");
    const dataRows = csvRows.slice(1);
    metadataFields = headers
      .map((key, index) => ({ key, index }))
      .filter(column => column.key !== "filename")
      .map(column => ({
        ...inferField(toKey(column.key), dataRows.map(row => row[column.index] ?? "")),
        label: humanize(column.key),
      }));
    if (metadataFields.some(field => !field.key)) throw new Error("Metadata CSV has a column name that cannot be used as a field key");
    if (new Set(metadataFields.map(field => field.key)).size !== metadataFields.length) {
      throw new Error("Metadata CSV column names produce duplicate field keys");
    }
    const seen = new Set<string>();
    dataRows.forEach((row, rowIndex) => {
      const filename = row[filenameIndex]?.trim();
      if (!filename) {
        errors.push(`Metadata row ${rowIndex + 2} has no filename`);
        return;
      }
      if (seen.has(filename)) errors.push(`Duplicate metadata row: ${filename}`);
      seen.add(filename);
      const metadata: Record<string, string | number | boolean> = {};
      metadataFields.forEach((fieldDefinition, fieldIndex) => {
        const sourceIndex = headers.map((_, index) => index).filter(index => index !== filenameIndex)[fieldIndex];
        const value = row[sourceIndex] ?? "";
        if (value !== "") metadata[fieldDefinition.key] = coerce(value, fieldDefinition);
      });
      metadataByFilename.set(filename, metadata);
    });
    seen.forEach(filename => {
      if (!filenames.includes(filename)) errors.push(`Metadata has no matching media file: ${filename}`);
    });
  }

  const goldByFilename = new Map<string, Record<string, unknown>>();
  if (goldJson.trim()) {
    const parsed: unknown = JSON.parse(goldJson);
    if (!Array.isArray(parsed)) throw new Error("Gold answers must contain a JSON array");
    const seen = new Set<string>();
    parsed.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`Gold row ${index + 1} must be an object`);
        return;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.filename !== "string" || !candidate.filename) {
        errors.push(`Gold row ${index + 1} has no filename`);
        return;
      }
      if (seen.has(candidate.filename)) errors.push(`Duplicate gold row: ${candidate.filename}`);
      seen.add(candidate.filename);
      if (!filenames.includes(candidate.filename)) errors.push(`Gold answer has no matching media file: ${candidate.filename}`);
      if (candidate.answer && typeof candidate.answer === "object" && !Array.isArray(candidate.answer)) {
        goldByFilename.set(candidate.filename, candidate.answer as Record<string, unknown>);
      } else {
        errors.push(`Gold answer for ${candidate.filename} must be an object`);
      }
    });
  }

  const rows = filenames.map(filename => {
    const goldAnswer = goldByFilename.get(filename) ?? null;
    const rowErrors = metadataCsv.trim() && !metadataByFilename.has(filename)
      ? ["No metadata row matches this media file"]
      : [];
    return {
      filename,
      metadata: metadataByFilename.get(filename) ?? {},
      goldAnswer,
      errors: [...rowErrors, ...(goldAnswer ? validateGold(goldAnswer, options) : [])],
    };
  });
  return { rows, metadataFields, errors };
}
