// The package ships no types; only `validateAppDefinition` is used (ADR 0023 D3).
declare module "zapier-platform-schema" {
  const schema: {
    validateAppDefinition(app: unknown): { errors: { stack: string }[]; valid: boolean };
  };
  export default schema;
}
