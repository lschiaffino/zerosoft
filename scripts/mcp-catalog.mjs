#!/usr/bin/env node
/**
 * Genera el catálogo de operaciones del MCP unificado (docs/mcp.md):
 *   lib/mcp/catalog.generated.ts     operaciones con esquema, clase y calidad (JSON en un string: tsc no lo infiere)
 *   lib/mcp/route-table.generated.ts carga perezosa del handler real de cada ruta
 *
 * Lee con el compilador de TypeScript cada route handler de app/api y
 * lib/routes: métodos exportados, parámetros de path, query (searchParams) y
 * body (esquemas zod, tipos de `as`, o los campos que el handler lee).
 *
 * Uso: NODE_OPTIONS=--max-old-space-size=6144 node scripts/mcp-catalog.mjs [--report]
 * tests/unit/mcp-catalog.test.ts falla si una ruta queda fuera del catálogo y
 * de la lista de exclusiones (lib/mcp/excludes.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { excludeReason, appOfPath, ACCESS_OVERRIDES, READ_POST, MUTATING_GET_OK } = await import(pathToFileURL(path.join(ROOT, 'lib/mcp/excludes.mjs')).href);
const { HAND_SCHEMAS } = await import(pathToFileURL(path.join(ROOT, 'lib/mcp/hand-schemas.mjs')).href);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'route.ts' || e.name === 'route.tsx') out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'app/api')), ...walk(path.join(ROOT, 'lib/routes'))].sort();

function urlOf(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.startsWith('app/api/')) return rel.replace(/^app/, '').replace(/\/route\.tsx?$/, '');
  return rel.replace(/^lib\/routes/, '/api').replace(/\/route\.tsx?$/, '');
}

const cfgPath = path.join(ROOT, 'tsconfig.json');
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, ROOT);
const program = ts.createProgram({
  rootNames: files,
  options: { ...cfg.options, noEmit: true, skipLibCheck: true, incremental: false, composite: false, tsBuildInfoFile: undefined },
});
const checker = program.getTypeChecker();

const isProjectFile = (sf) => sf && !sf.isDeclarationFile && !sf.fileName.includes('/node_modules/');

function resolveSymbol(node) {
  let s = checker.getSymbolAtLocation(node);
  if (s && s.flags & ts.SymbolFlags.Alias) {
    try { s = checker.getAliasedSymbol(s); } catch { /* sin alias */ }
  }
  return s;
}

function declOf(node) {
  const s = resolveSymbol(node);
  return s?.valueDeclaration ?? s?.declarations?.[0];
}

function fnBodyOf(decl) {
  if (!decl) return null;
  if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isArrowFunction(decl) || ts.isFunctionExpression(decl)) return decl;
  if (ts.isVariableDeclaration(decl) && decl.initializer) return decl.initializer; // const GET = withAuth(async (req) => …)
  return null;
}

function typeIsZod(node) {
  try {
    const t = checker.getTypeAtLocation(node);
    return Boolean(t.getProperty?.('safeParse'));
  } catch { return false; }
}

// ---------- tipo de TS → JSON Schema ----------

function typeOfSymbol(sym, at) {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0] ?? at;
  return checker.getTypeOfSymbolAtLocation(sym, decl);
}

function typeToSchema(type, depth = 0, seen = new Set()) {
  if (depth > 6 || seen.has(type)) return {};
  const f = type.flags;
  if (f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown) return {};
  if (f & ts.TypeFlags.StringLiteral) return { type: 'string', enum: [type.value] };
  if (f & ts.TypeFlags.NumberLiteral) return { type: 'number', enum: [type.value] };
  if (f & ts.TypeFlags.BooleanLiteral) return { type: 'boolean' };
  if (f & ts.TypeFlags.String) return { type: 'string' };
  if (f & ts.TypeFlags.Number) return { type: 'number' };
  if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (f & ts.TypeFlags.Null) return { type: 'null' };
  if (f & ts.TypeFlags.Undefined || f & ts.TypeFlags.Void) return {};
  if (type.isUnion()) {
    const parts = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
    if (parts.every((t) => t.flags & ts.TypeFlags.StringLiteral)) return { type: 'string', enum: parts.map((t) => t.value) };
    if (parts.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { type: 'boolean' };
    const nonNull = parts.filter((t) => !(t.flags & ts.TypeFlags.Null));
    const hasNull = nonNull.length !== parts.length;
    if (nonNull.length === 1) {
      const s = typeToSchema(nonNull[0], depth + 1, seen);
      if (hasNull && typeof s.type === 'string') return { ...s, type: [s.type, 'null'], ...(s.enum ? { enum: [...s.enum, null] } : {}) };
      return s;
    }
    if (nonNull.every((t) => t.flags & ts.TypeFlags.StringLiteral)) {
      return { type: hasNull ? ['string', 'null'] : 'string', enum: [...nonNull.map((t) => t.value), ...(hasNull ? [null] : [])] };
    }
    if (nonNull.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { type: hasNull ? ['boolean', 'null'] : 'boolean' };
    return { anyOf: parts.map((t) => typeToSchema(t, depth + 1, seen)) };
  }
  if (checker.isArrayType?.(type) || checker.isTupleType?.(type)) {
    const args = checker.getTypeArguments(type);
    return { type: 'array', items: args[0] ? typeToSchema(args[0], depth + 1, seen) : {} };
  }
  if (type.getCallSignatures?.().length) return {};
  if (f & ts.TypeFlags.Object || type.isIntersection?.()) {
    const name = type.getSymbol()?.getName();
    if (name === 'Date') return { type: 'string', format: 'date-time' };
    const next = new Set(seen); next.add(type);
    const props = checker.getPropertiesOfType(type);
    const index = type.getStringIndexType?.();
    if (!props.length) {
      if (index) return { type: 'object', additionalProperties: typeToSchema(index, depth + 1, next) };
      return { type: 'object' };
    }
    const properties = {};
    const required = [];
    for (const p of props) {
      const t = typeOfSymbol(p);
      if (!t) continue;
      properties[p.getName()] = typeToSchema(t, depth + 1, next);
      if (!(p.flags & ts.SymbolFlags.Optional) && !(t.isUnion?.() && t.types.some((x) => x.flags & ts.TypeFlags.Undefined))) required.push(p.getName());
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}), ...(index ? { additionalProperties: typeToSchema(index, depth + 1, next) } : {}) };
  }
  return {};
}

function zodInputFromType(node) {
  try {
    const t = checker.getTypeAtLocation(node);
    const input = t.getProperty?.('_input');
    if (!input) return null;
    return typeToSchema(typeOfSymbol(input, node));
  } catch { return null; }
}

// ---------- expresión zod → JSON Schema ----------

function literalValue(n) {
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return -Number(n.operand.text);
  try {
    if (ts.isBinaryExpression(n)) {
      const a = literalValue(n.left); const b = literalValue(n.right);
      if (typeof a === 'number' && typeof b === 'number') {
        if (n.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return a * b;
        if (n.operatorToken.kind === ts.SyntaxKind.PlusToken) return a + b;
      }
    }
    const t = checker.getTypeAtLocation(n);
    if (t.isLiteral?.()) return t.value;
    const decl = ts.isIdentifier(n) ? declOf(n) : ts.isPropertyAccessExpression(n) ? declOf(n.name) : null;
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer && decl.initializer !== n) return literalValue(decl.initializer);
  } catch { /* nada */ }
  return undefined;
}

function stringList(n) {
  const out = [];
  try {
    const t = checker.getTypeAtLocation(n);
    const args = checker.isArrayType?.(t) || checker.isTupleType?.(t) ? checker.getTypeArguments(t) : [];
    for (const a of args) {
      if (a.isUnion?.()) for (const u of a.types) if (u.flags & ts.TypeFlags.StringLiteral) out.push(u.value);
      if (a.flags & ts.TypeFlags.StringLiteral) out.push(a.value);
    }
  } catch { /* nada */ }
  return out;
}

class Unresolved extends Error {}

/** Devuelve { schema, optional } o lanza Unresolved. ctx.misses cuenta campos que cayeron al tipo inferido. */
function zodToJson(node, ctx, depth = 0) {
  if (depth > 40) throw new Unresolved('depth');
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node)) node = node.expression;

  if (ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && !(ts.isIdentifier(node.expression) && node.expression.text === 'z'))) {
    const decl = declOf(ts.isIdentifier(node) ? node : node.name);
    if (decl && (ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl)) && decl.initializer) return zodToJson(decl.initializer, ctx, depth + 1);
    throw new Unresolved('id');
  }
  if (!ts.isCallExpression(node)) throw new Unresolved('kind');

  const callee = node.expression;
  // Fábrica propia: fooSchema(): seguimos su return.
  if (ts.isIdentifier(callee)) {
    const fn = fnBodyOf(declOf(callee));
    if (fn && fn.body) {
      if (!ts.isBlock(fn.body)) return zodToJson(fn.body, ctx, depth + 1);
      let ret = null;
      const find = (n) => { if (ret) return; if (ts.isReturnStatement(n)) { ret = n.expression; return; } if (ts.isFunctionLike(n)) return; ts.forEachChild(n, find); };
      ts.forEachChild(fn.body, find);
      if (ret) return zodToJson(ret, ctx, depth + 1);
    }
    throw new Unresolved('call');
  }
  if (!ts.isPropertyAccessExpression(callee)) throw new Unresolved('callee');
  const m = callee.name.text;
  const a = node.arguments;

  const objExpr = callee.expression;
  const zRoot = ts.isIdentifier(objExpr) && objExpr.text === 'z';
  const zCoerce = ts.isPropertyAccessExpression(objExpr) && objExpr.name.text === 'coerce';
  if (zRoot || zCoerce) {
    switch (m) {
      case 'string': return { schema: { type: 'string' } };
      case 'number': return { schema: { type: 'number' } };
      case 'bigint': return { schema: { type: 'integer' } };
      case 'boolean': return { schema: { type: 'boolean' } };
      case 'date': return { schema: { type: 'string', format: 'date-time' } };
      case 'null': return { schema: { type: 'null' } };
      case 'any': case 'unknown': case 'custom': case 'instanceof': return { schema: {} };
      case 'literal': { const v = literalValue(a[0]); return { schema: v === undefined ? {} : { const: v, ...(typeof v === 'string' ? { type: 'string' } : typeof v === 'number' ? { type: 'number' } : typeof v === 'boolean' ? { type: 'boolean' } : {}) } }; }
      case 'enum': {
        const list = ts.isArrayLiteralExpression(a[0]) ? a[0].elements.map(literalValue).filter((v) => v !== undefined) : stringList(a[0]);
        if (!list.length) throw new Unresolved('enum');
        return { schema: { type: 'string', enum: list } };
      }
      case 'nativeEnum': return { schema: {} };
      case 'array': case 'set': return { schema: { type: 'array', items: zodToJson(a[0], ctx, depth + 1).schema } };
      case 'tuple': return { schema: { type: 'array', items: ts.isArrayLiteralExpression(a[0]) && a[0].elements[0] ? zodToJson(a[0].elements[0], ctx, depth + 1).schema : {} } };
      case 'record': return { schema: { type: 'object', additionalProperties: zodToJson(a[a.length - 1], ctx, depth + 1).schema } };
      case 'map': return { schema: { type: 'object' } };
      case 'union': case 'discriminatedUnion': {
        const arr = m === 'union' ? a[0] : a[1];
        if (!ts.isArrayLiteralExpression(arr)) throw new Unresolved('union');
        return { schema: { anyOf: arr.elements.map((e) => zodToJson(e, ctx, depth + 1).schema) } };
      }
      case 'intersection': return { schema: { allOf: [zodToJson(a[0], ctx, depth + 1).schema, zodToJson(a[1], ctx, depth + 1).schema] } };
      case 'lazy': {
        ctx.lazy = (ctx.lazy ?? 0) + 1;
        if (ctx.lazy > 2) return { schema: {} };
        const fn = a[0];
        if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return zodToJson(fn.body, ctx, depth + 1);
        return { schema: {} };
      }
      case 'preprocess': return zodToJson(a[1], ctx, depth + 1);
      case 'object': case 'strictObject': case 'looseObject': return objectShape(a[0], ctx, depth);
      default: throw new Unresolved(`z.${m}`);
    }
  }

  const base = () => zodToJson(callee.expression, ctx, depth + 1);
  switch (m) {
    case 'optional': return { ...base(), optional: true };
    case 'nullish': { const b = base(); return { schema: nullable(b.schema), optional: true }; }
    case 'nullable': { const b = base(); return { ...b, schema: nullable(b.schema) }; }
    case 'default': case 'catch': { const b = base(); const v = a[0] ? literalValue(a[0]) : undefined; return { schema: v === undefined ? b.schema : { ...b.schema, default: v }, optional: true }; }
    case 'describe': { const b = base(); const v = a[0] ? literalValue(a[0]) : undefined; return { ...b, schema: typeof v === 'string' ? { ...b.schema, description: v } : b.schema }; }
    case 'min': case 'gte': case 'nonempty': case 'max': case 'lte': case 'length': case 'gt': case 'lt': case 'positive': case 'nonnegative': case 'negative': case 'int': case 'finite': case 'safe': {
      const b = base(); const s = { ...b.schema };
      const isStr = s.type === 'string'; const isArr = s.type === 'array'; const v = a[0] ? literalValue(a[0]) : undefined;
      const lo = isStr ? 'minLength' : isArr ? 'minItems' : 'minimum';
      const hi = isStr ? 'maxLength' : isArr ? 'maxItems' : 'maximum';
      if (m === 'int') s.type = 'integer';
      else if (m === 'positive') s.exclusiveMinimum = 0;
      else if (m === 'nonnegative') s.minimum = 0;
      else if (m === 'negative') s.exclusiveMaximum = 0;
      else if (m === 'nonempty') s[lo] = 1;
      else if (typeof v === 'number') {
        if (m === 'min' || m === 'gte') s[lo] = v;
        if (m === 'max' || m === 'lte') s[hi] = v;
        if (m === 'gt') s.exclusiveMinimum = v;
        if (m === 'lt') s.exclusiveMaximum = v;
        if (m === 'length') { s[lo] = v; s[hi] = v; }
      }
      return { ...b, schema: s };
    }
    case 'email': case 'url': case 'uuid': case 'datetime': case 'date': case 'time': case 'ip': case 'cuid': case 'ulid': case 'nanoid': case 'emoji': case 'base64': {
      const b = base(); const fmt = { email: 'email', url: 'uri', uuid: 'uuid', datetime: 'date-time', date: 'date', time: 'time' }[m];
      return { ...b, schema: fmt ? { ...b.schema, format: fmt } : b.schema };
    }
    case 'regex': {
      const b = base();
      const r = a[0] && ts.isRegularExpressionLiteral(a[0]) ? a[0].text.replace(/^\/(.*)\/[a-z]*$/s, '$1') : undefined;
      return { ...b, schema: r ? { ...b.schema, pattern: r } : b.schema };
    }
    case 'startsWith': case 'endsWith': case 'includes': case 'trim': case 'toLowerCase': case 'toUpperCase': case 'refine': case 'superRefine': case 'transform': case 'pipe': case 'brand': case 'readonly': case 'strict': case 'passthrough': case 'strip': case 'catchall': case 'unwrap': case 'removeDefault': case 'normalize':
      return base();
    case 'or': { const b = base(); return { ...b, schema: { anyOf: [b.schema, zodToJson(a[0], ctx, depth + 1).schema] } }; }
    case 'and': { const b = base(); return { ...b, schema: { allOf: [b.schema, zodToJson(a[0], ctx, depth + 1).schema] } }; }
    case 'array': { const b = base(); return { schema: { type: 'array', items: b.schema } }; }
    case 'extend': case 'merge': case 'safeExtend': {
      const b = base();
      const ext = m === 'merge' ? zodToJson(a[0], ctx, depth + 1).schema : objectShape(a[0], ctx, depth).schema;
      return { schema: mergeObj(b.schema, ext) };
    }
    case 'partial': case 'deepPartial': { const b = base(); const s = { ...b.schema }; delete s.required; return { schema: s }; }
    case 'required': { const b = base(); return { schema: { ...b.schema, required: Object.keys(b.schema.properties ?? {}) } }; }
    case 'pick': case 'omit': {
      const b = base();
      const keys = a[0] && ts.isObjectLiteralExpression(a[0]) ? a[0].properties.map((p) => p.name?.getText().replace(/['"]/g, '')) : [];
      const props = {};
      for (const [k, v] of Object.entries(b.schema.properties ?? {})) if ((m === 'pick') === keys.includes(k)) props[k] = v;
      const req = (b.schema.required ?? []).filter((k) => k in props);
      return { schema: { type: 'object', properties: props, ...(req.length ? { required: req } : {}) } };
    }
    case 'keyof': return { schema: { type: 'string' } };
    case 'element': { const b = base(); return { schema: b.schema.items ?? {} }; }
    default: throw new Unresolved(`.${m}`);
  }
}

function nullable(s) {
  if (typeof s.type === 'string') return { ...s, type: [s.type, 'null'], ...(s.enum ? { enum: [...s.enum, null] } : {}) };
  if (Array.isArray(s.type)) return s;
  return { anyOf: [s, { type: 'null' }] };
}
function mergeObj(a, b) {
  const required = [...new Set([...(a.required ?? []).filter((k) => !b.properties?.[k]), ...(b.required ?? [])])];
  return { type: 'object', properties: { ...(a.properties ?? {}), ...(b.properties ?? {}) }, ...(required.length ? { required } : {}) };
}
function objectShape(arg, ctx, depth) {
  while (ts.isParenthesizedExpression(arg) || ts.isAsExpression(arg)) arg = arg.expression;
  if (ts.isIdentifier(arg)) { const d = declOf(arg); if (d && ts.isVariableDeclaration(d) && d.initializer) arg = d.initializer; }
  if (!ts.isObjectLiteralExpression(arg)) throw new Unresolved('shape');
  let schema = { type: 'object', properties: {} };
  const req = [];
  for (const p of arg.properties) {
    if (ts.isSpreadAssignment(p)) {
      const e = p.expression;
      if (ts.isPropertyAccessExpression(e) && e.name.text === 'shape') schema = mergeObj(schema, zodToJson(e.expression, ctx, depth + 1).schema);
      else {
        const d = ts.isIdentifier(e) ? declOf(e) : null;
        if (d && ts.isVariableDeclaration(d) && d.initializer) schema = mergeObj(schema, objectShape(d.initializer, ctx, depth + 1).schema);
        else throw new Unresolved('spread');
      }
      continue;
    }
    const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null;
    if (!key) throw new Unresolved('computed');
    const init = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : null;
    if (!init) throw new Unresolved('prop');
    let r;
    try {
      r = zodToJson(init, ctx, depth + 1);
    } catch (e) {
      if (!(e instanceof Unresolved)) throw e;
      ctx.misses = (ctx.misses ?? 0) + 1;
      r = { schema: zodInputFromType(init) ?? {}, optional: isOptionalZod(init) };
    }
    schema.properties[key] = r.schema;
    if (!r.optional) req.push(key);
  }
  const required = [...new Set([...(schema.required ?? []), ...req])];
  if (required.length) schema.required = required; else delete schema.required;
  return { schema };
}
function isOptionalZod(node) {
  try {
    const t = checker.getTypeAtLocation(node); const input = t.getProperty?.('_input');
    if (!input) return false;
    const it = typeOfSymbol(input, node);
    return Boolean(it.isUnion?.() && it.types.some((x) => x.flags & ts.TypeFlags.Undefined));
  } catch { return false; }
}

function schemaOfZodNode(node) {
  const ctx = {};
  try {
    const { schema } = zodToJson(node, ctx);
    return { schema, exact: !ctx.misses };
  } catch (e) {
    if (!(e instanceof Unresolved)) throw e;
    const fallback = zodInputFromType(node);
    if (fallback && Object.keys(fallback).length) return { schema: fallback, exact: true, typeOnly: true };
    return null;
  }
}

// ---------- análisis de un handler ----------

const AUTH_NAMES = new Set(['getCurrentUser', 'requireUser', 'requireApiUser', 'getServerSession']);
const BODY_READERS = /^(readJson|readBody|parseBody|jsonBody|safeJson|parseJson|getJson|readJsonBody|readObject|v1Body)$/;
const BODY_READER_CALL = /\.json\(\)|\b(readJson|readBody|parseBody|jsonBody|safeJson|parseJson|getJson|readJsonBody|readObject|v1Body)\(/;
const authMemo = new Map();
const mutMemo = new Map();

function callId(n) {
  const c = n.expression;
  return ts.isIdentifier(c) ? c : ts.isPropertyAccessExpression(c) ? c.name : null;
}

function reachesAuth(fnNode, depth = 0) {
  if (!fnNode) return false;
  if (authMemo.has(fnNode)) return authMemo.get(fnNode);
  authMemo.set(fnNode, false);
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const id = callId(n);
      if (id && AUTH_NAMES.has(id.text)) { found = true; return; }
      if (id && depth < 8) {
        const d = declOf(id);
        if (d && isProjectFile(d.getSourceFile()) && reachesAuth(fnBodyOf(d), depth + 1)) { found = true; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode);
  authMemo.set(fnNode, found);
  return found;
}

/** SQL de escritura alcanzable (profundidad acotada), sin entrar a la sesión ni a los ayudantes HTTP. */
const SESSION_FILES = /\/lib\/(session|teams|workspace|seed|rate-limit|db|api-auth)\.ts$|-http\.ts$|\/http\.ts$|-session\.ts$/;
function reachesMutation(fnNode, depth = 0) {
  if (!fnNode) return [];
  if (mutMemo.has(fnNode)) return mutMemo.get(fnNode);
  const hits = new Set();
  mutMemo.set(fnNode, []);
  const SQL = /^\s*(INSERT|UPDATE|DELETE\s+FROM|REPLACE)\b/;
  const label = (text, n) => `${text.replace(/\s+/g, ' ').trim().slice(0, 70)} @${path.basename(n.getSourceFile().fileName)}`;
  const visit = (n) => {
    if (ts.isStringLiteralLike(n) && SQL.test(n.text)) hits.add(label(n.text, n));
    if (ts.isTemplateExpression(n) && SQL.test(n.head.text)) hits.add(label(n.head.text, n));
    if (ts.isCallExpression(n) && depth < 4) {
      const id = callId(n);
      if (id) {
        const d = declOf(id);
        const sf = d?.getSourceFile();
        if (d && isProjectFile(sf) && !SESSION_FILES.test(sf.fileName)) for (const h of reachesMutation(fnBodyOf(d), depth + 1)) hits.add(h);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode);
  const out = [...hits];
  mutMemo.set(fnNode, out);
  return out;
}

const textOf = (n) => n.getText();

function analyzeHandler(fnNode) {
  const out = { query: new Map(), bodySchemas: [], bodyFields: new Map(), bodyVars: new Set(), bodyRead: false, form: false, formFields: new Set(), zodQuery: [], typed: [] };
  const seen = new Set();
  const pushTyped = (typeNode) => {
    const s = typeToSchema(checker.getNonNullableType(checker.getTypeFromTypeNode(typeNode)));
    if (s.properties && Object.keys(s.properties).length) out.typed.push(s);
  };
  const scan = (root, depth) => {
    if (!root || seen.has(root) || depth > 3) return;
    seen.add(root);
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const it = textOf(n.initializer);
        if (BODY_READER_CALL.test(it) && !/\.safeParse|\.parse\(/.test(it)) {
          out.bodyRead = true;
          if (ts.isIdentifier(n.name)) out.bodyVars.add(n.name.text);
          if (ts.isObjectBindingPattern(n.name)) for (const el of n.name.elements) { const k = (el.propertyName ?? el.name).getText(); if (!out.bodyFields.has(k)) out.bodyFields.set(k, {}); }
          let e = n.initializer;
          while (ts.isParenthesizedExpression(e)) e = e.expression;
          if (ts.isAsExpression(e)) pushTyped(e.type);
        }
        if (ts.isAsExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && out.bodyVars.has(n.initializer.expression.text) && ts.isIdentifier(n.name)) {
          out.bodyVars.add(n.name.text);
          pushTyped(n.initializer.type);
        }
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && BODY_READER_CALL.test(textOf(n.right))) {
        out.bodyRead = true; out.bodyVars.add(n.left.text);
        let e = n.right;
        while (ts.isParenthesizedExpression(e)) e = e.expression;
        if (ts.isAsExpression(e)) pushTyped(e.type);
      }
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        if (ts.isPropertyAccessExpression(c)) {
          const m = c.name.text;
          if ((m === 'safeParse' || m === 'parse' || m === 'safeParseAsync' || m === 'parseAsync') && n.arguments[0] && typeIsZod(c.expression)) {
            const argText = textOf(n.arguments[0]);
            const isQuery = /searchParams|fromEntries/.test(argText);
            const fieldMatch = /^(\w+)\??\.(\w+)$/.exec(argText);
            const isBody = BODY_READER_CALL.test(argText) || out.bodyVars.has(argText) || out.bodyVars.has(argText.split(/\s*\?\?/)[0]) || /await \w+\((req|request)\)/.test(argText);
            if (isQuery) { const s = schemaOfZodNode(c.expression); if (s) out.zodQuery.push(s); }
            else if (isBody) { out.bodyRead = true; const s = schemaOfZodNode(c.expression); out.bodySchemas.push(s ?? { schema: {}, exact: false }); }
            else if (fieldMatch && out.bodyVars.has(fieldMatch[1])) { const s = schemaOfZodNode(c.expression); out.bodyFields.set(fieldMatch[2], s?.schema ?? {}); }
          }
          if (m === 'get' || m === 'getAll' || m === 'has') {
            const objText = textOf(c.expression);
            const key = n.arguments[0];
            if (key && ts.isStringLiteralLike(key)) {
              if (/searchParams|\bsp$/.test(objText) && !/headers|cookies/i.test(objText)) {
                out.query.set(key.text, m === 'getAll' ? { type: 'array', items: { type: 'string' } } : { type: 'string' });
              } else if (/\bform|\bfd\b|formData/i.test(objText)) out.formFields.add(key.text);
            }
          }
          if (m === 'formData') { out.form = true; out.bodyRead = true; }
          if (m === 'json' && /^(req|request|_req|r)$/.test(textOf(c.expression))) out.bodyRead = true;
        }
        const id = callId(n);
        const isReader = id && BODY_READERS.test(id.text);
        if (isReader) {
          out.bodyRead = true;
          for (const arg of n.arguments) if (typeIsZod(arg)) { const s = schemaOfZodNode(arg); out.bodySchemas.push(s ?? { schema: {}, exact: false }); }
        }
        // Ayudantes a los que les pasan req: se siguen; si además reciben un esquema, es el del body.
        const passesReq = n.arguments.some((a) => /^(req|request|_req)$/.test(textOf(a)));
        if (passesReq && !isReader) {
          const zodArg = n.arguments.find((a) => typeIsZod(a));
          if (zodArg) { out.bodyRead = true; const s = schemaOfZodNode(zodArg); out.bodySchemas.push(s ?? { schema: {}, exact: false }); }
        }
        // El body pasa entero a otra función: parseOrThrow(schema, body), createThing(actor, body).
        const mentionsBody = (a) => BODY_READER_CALL.test(textOf(a)) || [...out.bodyVars].some((v) => new RegExp(`\\b${v}\\b`).test(textOf(a)));
        const bodyArgIdx = !isReader && !(ts.isPropertyAccessExpression(c) && /^(safeParse|parse)/.test(c.name.text)) ? n.arguments.findIndex(mentionsBody) : -1;
        if (bodyArgIdx >= 0) {
          out.bodyRead = true;
          const zodArg = n.arguments.find((a) => typeIsZod(a));
          if (zodArg) { const s = schemaOfZodNode(zodArg); out.bodySchemas.push(s ?? { schema: {}, exact: false }); }
          else if (id) {
            const fn = fnBodyOf(declOf(id));
            const param = fn?.parameters?.[bodyArgIdx];
            if (param && isProjectFile(fn.getSourceFile())) {
              if (ts.isIdentifier(param.name)) out.bodyVars.add(param.name.text);
              let e = n.arguments[bodyArgIdx];
              while (ts.isParenthesizedExpression(e)) e = e.expression;
              if (ts.isAsExpression(e) && e.type.kind !== ts.SyntaxKind.NeverKeyword && e.type.kind !== ts.SyntaxKind.UnknownKeyword) pushTyped(e.type);
              else if (param.type) pushTyped(param.type);
              scan(fn, depth + 1);
            }
          }
        }
        if (id) {
          const d = declOf(id);
          const sf = d?.getSourceFile();
          if (d && isProjectFile(sf) && (sf === root.getSourceFile() || passesReq)) {
            const fn = fnBodyOf(d);
            if (fn && fn !== root) scan(fn, depth + 1);
          }
        }
      }
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && out.bodyVars.has(n.expression.text)) {
        const k = n.name.text;
        if (!['success', 'data', 'error'].includes(k)) {
          const parent = n.parent;
          let s = out.bodyFields.get(k) ?? {};
          if (!Object.keys(s).length) {
            if (ts.isTypeOfExpression(parent) && ts.isBinaryExpression(parent.parent)) {
              const v = parent.parent.right;
              if (ts.isStringLiteralLike(v) && ['string', 'number', 'boolean'].includes(v.text)) s = { type: v.text };
            } else if (ts.isCallExpression(parent)) {
              const f = textOf(parent.expression);
              if (f === 'str' || f === 'String') s = { type: 'string' };
              if (f === 'Number' || f === 'num') s = { type: 'number' };
              if (f === 'bool' || f === 'Boolean') s = { type: 'boolean' };
              if (f === 'Array.isArray') s = { type: 'array' };
            }
          }
          out.bodyFields.set(k, s);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  };
  scan(fnNode, 0);
  return out;
}

function commentAt(text, pos) {
  const ranges = ts.getLeadingCommentRanges(text, pos) ?? [];
  const last = ranges[ranges.length - 1];
  if (!last) return '';
  return text.slice(last.pos, last.end).replace(/^\/\*\*?|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').replace(/^\/\/\s?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 320);
}

// ---------- nombres ----------

const snake = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
const isParam = (s) => s.startsWith('[');

function verbFor(method, segments, hasGet) {
  const last = segments[segments.length - 1];
  const lastParam = last && isParam(last);
  const lastStatic = segments.filter((s) => !isParam(s)).pop() ?? '';
  if (method === 'GET') return lastParam ? 'get' : 'list';
  if (method === 'DELETE') return 'delete';
  if (method === 'PATCH' || method === 'PUT') return 'update';
  if (lastParam) return 'post';
  if (!hasGet && !/s$/.test(lastStatic)) return null; // acción: …/deals/[id]/move
  return 'create';
}

// ---------- recorrido ----------

const ops = [];
const mutatingGets = [];
const excluded = [];
const routeFiles = {};
const seenIds = new Map();

for (const file of files) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;
  const text = sf.getFullText();
  if (text.includes('Generado por scripts/consolidate-routes.mjs')) continue;
  const url = urlOf(file);
  const modSym = checker.getSymbolAtLocation(sf);
  if (!modSym) continue;
  const handlers = {};
  for (const e of checker.getExportsOfModule(modSym)) {
    if (!METHODS.includes(e.name)) continue;
    let s = e;
    if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    handlers[e.name] = s.valueDeclaration ?? s.declarations?.[0];
  }
  routeFiles[url] = path.relative(ROOT, file).split(path.sep).join('/');
  const segs = url.split('/').slice(2);
  const fileComment = commentAt(text, 0).slice(0, 240);
  for (const method of Object.keys(handlers).sort()) {
    const reason = excludeReason(url, method);
    if (reason) { excluded.push({ path: url, method, reason }); continue; }
    const decl = handlers[method];
    const fn = fnBodyOf(decl) ?? decl;
    const a = analyzeHandler(fn);
    const auth = reachesAuth(fn);
    const verb = verbFor(method, segs, Boolean(handlers.GET));
    const staticParts = segs.filter((s) => !isParam(s)).map(snake).filter(Boolean);
    let id = [...staticParts, ...(verb ? [verb] : [])].join('.');
    const pathParams = segs.filter(isParam).map((s) => ({ name: s.replace(/[[\].]/g, ''), catchAll: s.startsWith('[...') || s.startsWith('[[...'), optional: s.startsWith('[[') }));
    let bodySchema = null;
    let quality = 'real';
    const key = `${method} ${url}`;
    const hand = HAND_SCHEMAS[key];
    if (hand) {
      bodySchema = hand.body ?? null;
    } else if (a.bodyRead) {
      const exact = a.bodySchemas.filter((s) => s.schema && Object.keys(s.schema).length);
      if (exact.length) {
        const uniq = [...new Map(exact.map((s) => [JSON.stringify(s.schema), s.schema])).values()];
        bodySchema = uniq.length === 1 ? uniq[0] : { anyOf: uniq };
        if (exact.some((s) => !s.exact)) quality = 'partial';
      } else if (a.typed.length) {
        bodySchema = a.typed[0];
        const extra = {};
        for (const [k, v] of a.bodyFields) if (!bodySchema.properties?.[k]) extra[k] = v;
        bodySchema = { ...bodySchema, properties: { ...bodySchema.properties, ...extra } };
      } else if (a.bodyFields.size) {
        bodySchema = { type: 'object', properties: Object.fromEntries(a.bodyFields), additionalProperties: true, description: 'Fields read by the handler. Required fields and exact types were not derived.' };
        quality = 'partial';
      } else if (a.form && a.formFields.size) {
        bodySchema = { type: 'object', properties: Object.fromEntries([...a.formFields].map((k) => [k, {}])) };
        quality = 'partial';
      } else {
        bodySchema = { type: 'object', additionalProperties: true };
        quality = 'loose';
      }
    }
    // Calidad honesta: campos sin tipo no cuentan como esquema real.
    if (!hand && quality === 'real' && bodySchema?.properties) {
      const vals = Object.values(bodySchema.properties);
      const empty = vals.filter((v) => !Object.keys(v).length).length;
      if (vals.length && empty / vals.length > 0.3) quality = 'partial';
    }
    const queryProps = Object.fromEntries(a.query);
    let queryRequired = [];
    for (const z of a.zodQuery) { Object.assign(queryProps, z.schema?.properties ?? {}); queryRequired = [...queryRequired, ...(z.schema?.required ?? [])]; }
    const querySchema = hand?.query ?? (Object.keys(queryProps).length ? { type: 'object', properties: queryProps, ...(queryRequired.length ? { required: [...new Set(queryRequired)] } : {}) } : null);
    // Clase: lo desconocido cuenta como escritura o destructivo, nunca lectura.
    const last = segs[segs.length - 1] ?? '';
    let access;
    if (ACCESS_OVERRIDES[key]) access = ACCESS_OVERRIDES[key];
    else if (method === 'DELETE') access = 'destructive';
    else if (method === 'GET') {
      const hits = reachesMutation(fn);
      if (hits.length) mutatingGets.push(`${key}${MUTATING_GET_OK.has(key) ? ' [OK]' : ''}\n    ${hits.join('\n    ')}`);
      access = hits.length && !MUTATING_GET_OK.has(key) ? 'write' : 'read';
    }
    else if (READ_POST.has(key)) access = 'read';
    else if (/^(delete|remove|purge|erase|wipe|destroy|bulk-delete|clear|reset|void|cancel|unpublish|disconnect|revoke|merge)/.test(last)) access = 'destructive';
    else access = 'write';
    const baseId = id || snake(url);
    id = baseId;
    if (seenIds.has(id)) {
      const parts = pathParams.map((p) => p.name).join('_') || method.toLowerCase();
      id = `${baseId}.by_${snake(parts)}`;
      let n = 2;
      while (seenIds.has(id)) id = `${baseId}.by_${snake(parts)}${n++}`;
    }
    seenIds.set(id, key);
    const properties = {};
    const required = [];
    if (pathParams.length) {
      const reqNames = pathParams.filter((p) => !p.optional).map((p) => p.name);
      properties.path = {
        type: 'object',
        properties: Object.fromEntries(pathParams.map((p) => [p.name, p.catchAll ? { type: 'array', items: { type: 'string' } } : { type: 'string' }])),
        ...(reqNames.length ? { required: reqNames } : {}),
      };
      if (reqNames.length) required.push('path');
    }
    if (querySchema) properties.query = querySchema;
    if (bodySchema) {
      properties.body = bodySchema;
      if (bodySchema.required?.length) required.push('body');
    }
    const comment = commentAt(text, decl.getFullStart());
    ops.push({
      id,
      app: appOfPath(url),
      method,
      path: url,
      access,
      quality,
      session: auth,
      body: a.form ? 'form' : bodySchema ? 'json' : 'none',
      params: pathParams.map((p) => p.name),
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
      doc: hand?.description ?? (comment || (Object.keys(handlers).length === 1 ? fileComment : '')),
    });
  }
}

ops.sort((a, b) => a.id.localeCompare(b.id));

const used = [...new Set(ops.map((o) => o.path))].sort();
const lines = [
  '// Generado por scripts/mcp-catalog.mjs: no editar a mano.',
  '// Carga perezosa del handler real de cada ruta del catálogo: el MCP solo puede llegar a estas.',
  '',
  'export const ROUTE_TABLE: Record<string, () => Promise<unknown>> = {',
];
for (const u of used) {
  const f = routeFiles[u].replace(/\.tsx?$/, '');
  lines.push(`  ${JSON.stringify(u)}: () => import(${JSON.stringify(`@/${f}`)}),`);
}
lines.push('};', '');
fs.writeFileSync(path.join(ROOT, 'lib/mcp/route-table.generated.ts'), lines.join('\n'));

const catalog = {
  operations: ops,
  excluded: excluded.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method)),
};
fs.writeFileSync(
  path.join(ROOT, 'lib/mcp/catalog.generated.ts'),
  `// Generado por scripts/mcp-catalog.mjs: no editar a mano.\n// eslint-disable-next-line\nexport const CATALOG_JSON = ${JSON.stringify(JSON.stringify(catalog))};\n`,
);

const per = {};
for (const o of ops) {
  const p = (per[o.app] ??= { ops: 0, real: 0, partial: 0, loose: 0, read: 0, write: 0, destructive: 0, nosession: 0 });
  p.ops++; p[o.quality]++; p[o.access]++;
  if (!o.session) p.nosession++;
}
console.table(per);
console.log('total', ops.length, 'excluidas', excluded.length);
if (process.argv.includes('--report')) {
  const rp = path.join(process.env.MCP_REPORT_DIR ?? '/tmp', 'mcp-report.txt');
  fs.writeFileSync(rp, [
    '## sin sesión detectada', ...ops.filter((o) => !o.session).map((o) => `${o.method} ${o.path}`),
    '## GET con SQL de escritura alcanzable', ...mutatingGets,
    '## loose', ...ops.filter((o) => o.quality === 'loose').map((o) => `${o.method} ${o.path}`),
    '## partial', ...ops.filter((o) => o.quality === 'partial').map((o) => `${o.method} ${o.path}`),
    '## POST read-like', ...ops.filter((o) => o.method === 'POST' && /search|query|preview|lookup|validate|check|estimate|calculate|suggest/.test(o.path)).map((o) => `${o.method} ${o.path} ${o.access}`),
    '## excluidas', ...excluded.map((e) => `${e.method} ${e.path}: ${e.reason}`),
  ].join('\n'));
  console.log('informe en', rp);
}
