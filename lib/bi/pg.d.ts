// Tipos mínimos del driver de Postgres que usa lib/bi/external.ts (pg no trae los suyos).
declare module 'pg' {
  export interface FieldDef {
    name: string;
    dataTypeID: number;
  }
  export interface QueryResult {
    fields: FieldDef[];
    rows: unknown[][];
  }
  export interface ClientConfig {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: false | { rejectUnauthorized?: boolean; servername?: string };
    connectionTimeoutMillis?: number;
    query_timeout?: number;
    statement_timeout?: number;
    application_name?: string;
  }
  export class Client {
    constructor(config: ClientConfig);
    connect(): Promise<void>;
    query(text: string): Promise<QueryResult>;
    query(config: { text: string; rowMode?: 'array'; queryMode?: 'extended' }): Promise<QueryResult>;
    end(): Promise<void>;
    on(event: 'error', fn: (err: Error) => void): this;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
