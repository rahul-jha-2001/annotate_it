export function schemaFingerprint(schema: object): string {
  return JSON.stringify(schema);
}

export function isDatasetAssemblyCurrent(
  assembledSchemaFingerprint: string | null,
  currentSchema: object,
): boolean {
  return assembledSchemaFingerprint !== null
    && assembledSchemaFingerprint === schemaFingerprint(currentSchema);
}
