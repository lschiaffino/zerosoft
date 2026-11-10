/**
 * GraphQL mínimo: parsea una operación (query con variables, campos, alias no,
 * argumentos y sub-selecciones) y la valida contra un mapa de tipos. Alcanza
 * para el fake de Linear (lib/track-linear-fake.ts) y para el test que revisa
 * las queries del importador contra el schema público de Linear
 * (lib/fixtures/linear-schema.json, sacado de su schema.graphql).
 */

export interface GqlField {
  name: string;
  args: Record<string, unknown>;
  selection: GqlField[];
}

export interface GqlOperation {
  /** query o mutation (el fake de Linear también acepta mutations). */
  kind: 'query' | 'mutation';
  name: string | null;
  variables: string[];
  selection: GqlField[];
}

/** Tipo → campo → { type, args }. Las claves "enum:X" son listas de valores. */
export type GqlSchemaMap = Record<string, Record<string, { type: string; args: string[] }> | string[]>;

type Tok = { k: 'name' | 'punct' | 'str' | 'num' | 'var'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s|,/.test(c)) {
      i++;
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (/[{}():!\[\]=]/.test(c)) {
      out.push({ k: 'punct', v: c });
      i++;
    } else if (c === '$') {
      const m = /^\$[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i));
      if (!m) throw new Error('bad variable');
      out.push({ k: 'var', v: m[0].slice(1) });
      i += m[0].length;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j++;
        s += src[j];
        j++;
      }
      out.push({ k: 'str', v: s });
      i = j + 1;
    } else if (/[-0-9]/.test(c)) {
      const m = /^-?\d+(\.\d+)?/.exec(src.slice(i));
      if (!m) throw new Error('bad number');
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
    } else {
      const m = /^[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i));
      if (!m) throw new Error(`unexpected "${c}"`);
      out.push({ k: 'name', v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

export function parseOperation(src: string, variables: Record<string, unknown> = {}): GqlOperation {
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const take = (v?: string) => {
    const tok = t[p++];
    if (!tok || (v !== undefined && tok.v !== v)) throw new Error(`expected ${v ?? 'token'}`);
    return tok;
  };

  let name: string | null = null;
  let kind: GqlOperation['kind'] = 'query';
  const vars: string[] = [];
  if (peek()?.k === 'name' && (peek().v === 'query' || peek().v === 'mutation')) {
    kind = take().v as GqlOperation['kind'];
    if (peek()?.k === 'name') name = take().v;
    if (peek()?.v === '(') {
      take('(');
      while (peek()?.v !== ')') {
        vars.push(take().v);
        take(':');
        // Tipo: Name, [Name], con ! opcionales.
        while (peek() && peek().v !== ')' && peek().k !== 'var') {
          if (peek().v === '=') {
            take('=');
            take();
            continue;
          }
          take();
        }
      }
      take(')');
    }
  }

  const value = (): unknown => {
    const tok = take();
    if (tok.k === 'var') return variables[tok.v] ?? null;
    if (tok.k === 'str') return tok.v;
    if (tok.k === 'num') return Number(tok.v);
    if (tok.k === 'name') return tok.v === 'true' ? true : tok.v === 'false' ? false : tok.v === 'null' ? null : tok.v;
    if (tok.v === '{') {
      const obj: Record<string, unknown> = {};
      while (peek()?.v !== '}') {
        const key = take().v;
        take(':');
        obj[key] = value();
      }
      take('}');
      return obj;
    }
    if (tok.v === '[') {
      const arr: unknown[] = [];
      while (peek()?.v !== ']') arr.push(value());
      take(']');
      return arr;
    }
    throw new Error('bad value');
  };

  const selection = (): GqlField[] => {
    take('{');
    const fields: GqlField[] = [];
    while (peek()?.v !== '}') {
      const fname = take().v;
      const args: Record<string, unknown> = {};
      if (peek()?.v === '(') {
        take('(');
        while (peek()?.v !== ')') {
          const a = take().v;
          take(':');
          args[a] = value();
        }
        take(')');
      }
      fields.push({ name: fname, args, selection: peek()?.v === '{' ? selection() : [] });
    }
    take('}');
    return fields;
  };

  const sel = selection();
  if (p !== t.length) throw new Error('trailing tokens');
  return { kind, name, variables: vars, selection: sel };
}

/** Errores como los de un servidor GraphQL ("Cannot query field ..."). Vacío si la operación es válida. */
export function validateOperation(op: GqlOperation, schema: GqlSchemaMap, root = op.kind === 'mutation' ? 'Mutation' : 'Query'): string[] {
  const errors: string[] = [];
  const walk = (type: string, fields: GqlField[]) => {
    const def = schema[type];
    if (!def || Array.isArray(def)) {
      errors.push(`Unknown type "${type}".`);
      return;
    }
    for (const f of fields) {
      if (f.name === '__typename') continue;
      const fd = def[f.name];
      if (!fd) {
        errors.push(`Cannot query field "${f.name}" on type "${type}".`);
        continue;
      }
      for (const a of Object.keys(f.args)) {
        if (!fd.args.includes(a)) errors.push(`Unknown argument "${a}" on field "${type}.${f.name}".`);
      }
      const leaf = !schema[fd.type] || Array.isArray(schema[fd.type]);
      if (leaf && f.selection.length) errors.push(`Field "${f.name}" must not have a selection since type "${fd.type}" has no subfields.`);
      if (!leaf && !f.selection.length) errors.push(`Field "${f.name}" of type "${fd.type}" must have a selection of subfields.`);
      if (!leaf && f.selection.length) walk(fd.type, f.selection);
    }
  };
  walk(root, op.selection);
  return errors;
}
