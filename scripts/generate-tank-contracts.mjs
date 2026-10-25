import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const source = new URL("../packages/core/tank-defense/character-catalog.json", import.meta.url);
const target = new URL("../server/internal/tanks/character-catalog.gen.json", import.meta.url);
const bytes = readFileSync(source);
JSON.parse(bytes.toString());
mkdirSync(fileURLToPath(new URL(".", target)), { recursive: true });
writeFileSync(target, bytes);

const root = new URL("../", import.meta.url);
const exported = JSON.parse(execFileSync("go", ["run", "./cmd/tank-contracts"], { cwd: fileURLToPath(new URL("server/", root)), encoding: "utf8" }));
writeFileSync(new URL("docs/tank-character-mcp-tools.json", root), JSON.stringify(exported, null, 2) + "\n");

const catalog = JSON.parse(bytes.toString());
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required });
const id = { type: "string", format: "uuid" }, date = { type: "string", format: "date-time" };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const issue = object({ code: { type: "string" }, path: { type: "string" }, message: { type: "string" } });
const map = object({ id: { enum: catalog.maps.map(map => map.id) }, levelId: { type: "integer", minimum: 1, maximum: catalog.maps.length }, version: { const: 1 } });
const parts = rules => object(Object.fromEntries(Object.entries(rules).map(([name, values]) => [name, object(Object.fromEntries(Object.keys(values).map(key => [key, { type: "integer" }])))])));
const catalogSchema = { ...object({ profile: { const: catalog.profile }, rulesVersion: { const: catalog.rulesVersion }, compilerVersion: { const: catalog.compilerVersion }, budget: { const: catalog.budget }, chassis: parts(catalog.chassis), armor: parts(catalog.armor), cannon: parts(catalog.cannon), maps: { type: "array", items: ref("TankMap") }, modes: { type: "array", items: { enum: catalog.modes } }, actions: { type: "array", items: { enum: catalog.actions } }, draftSchema: { type: "object", description: "JSON Schema for an agent-created draft; part cost and trimmed-name constraints are also checked by the compiler." } }), example: catalog };
const blueprint = object({ id: { type: "string" }, speed: { type: "integer" }, armor: { type: "integer" }, projectileSpeed: { type: "integer" }, fireInterval: { type: "integer" }, score: { const: 0 }, appearance: catalog.draftSchema.properties.appearance });
const validation = { ...object({ valid: { type: "boolean" }, errors: { type: "array", items: ref("TankValidationIssue") }, blueprint: ref("TankBlueprint"), cost: { type: "integer", minimum: 0 }, budget: { const: catalog.budget } }, ["valid", "errors", "cost", "budget"]), allOf: [{ if: { properties: { valid: { const: true } } }, then: { required: ["blueprint"], properties: { errors: { maxItems: 0 } } }, else: { properties: { errors: { minItems: 1 } } } }] };
const compatibility = object({ compatible: { const: true }, characterId: id, revision: { type: "integer", minimum: 1, maximum: 50 }, contentHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, map: ref("TankMap") });
const character = object({ id, revision: { type: "integer", minimum: 1, maximum: 50 }, workspaceId: id, ownerId: id, rulesVersion: { const: 1 }, compilerVersion: { const: 1 }, contentHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, draft: ref("TankCharacterDraft"), blueprint, cost: { type: "integer" }, createdAt: date });
const session = object({ id, workspaceId: id, ownerId: id, rulesVersion: { const: 1 }, mapId: { enum: catalog.maps.map(map => map.id) }, mapVersion: { const: 1 }, levelId: { type: "integer", minimum: 1, maximum: catalog.maps.length }, mode: { enum: catalog.modes }, character: ref("TankCharacter"), createdAt: date, expiresAt: date, playPath: { type: "string" }, playUrl: { type: "string", format: "uri" } });
const input = tool => exported.tools.find(item => item.name === tool).inputSchema;
const endpoint = (operationId, schema, body) => ({ operationId, ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}), responses: { 200: { description: "Success", content: { "application/json": { schema } } }, default: { description: "Error", content: { "application/json": { schema: ref("Problem") } } } } });
const ws = [{ name: "X-Workspace-ID", in: "header", required: true, schema: id }];
const paths = {
  "/api/tanks/v1/catalog": { parameters: ws, get: endpoint("getTankCatalog", ref("TankCatalog")) },
  "/api/tanks/v1/characters/validate": { parameters: ws, post: endpoint("validateTankCharacter", ref("TankValidation"), input("tank_validate_character")) },
  "/api/tanks/v1/characters": { parameters: ws, get: endpoint("listTankCharacters", object({ characters: { type: "array", items: ref("TankCharacter") } })), post: endpoint("saveTankCharacter", ref("TankCharacter"), input("tank_save_character")) },
  "/api/tanks/v1/characters/{id}": { parameters: [...ws, { name: "id", in: "path", required: true, schema: id }, { name: "revision", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } }], get: endpoint("getTankCharacter", ref("TankCharacter")) },
  "/api/tanks/v1/compatibility": { parameters: ws, post: endpoint("checkTankCompatibility", ref("TankCompatibility"), input("tank_check_compatibility")) },
  "/api/tanks/v1/sessions": { parameters: ws, post: endpoint("createTankSession", ref("TankPlaySession"), input("tank_create_session")) },
  "/api/tanks/v1/sessions/{id}": { parameters: [...ws, { name: "id", in: "path", required: true, schema: id }], get: endpoint("getTankSession", ref("TankPlaySession")) },
};
const api = { openapi: "3.1.0", info: { title: "Auro Classic Tank Characters", version: "1.0.0" }, security: [{ bearerAuth: [] }], paths, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas: { TankCatalog: catalogSchema, TankMap: map, TankValidationIssue: issue, TankBlueprint: blueprint, TankValidation: validation, TankCompatibility: compatibility, TankCharacterDraft: catalog.draftSchema, TankCharacter: character, TankPlaySession: session, Problem: object({ requestId: id, error: object({ code: { type: "string" }, message: { type: "string" }, issues: { type: "array", items: ref("TankValidationIssue") } }, ["code", "message"]) }) } } };
writeFileSync(new URL("docs/tank-character-api.openapi.json", root), JSON.stringify(api, null, 2) + "\n");
