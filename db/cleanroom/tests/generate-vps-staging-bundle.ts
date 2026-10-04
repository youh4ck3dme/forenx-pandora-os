import crypto from "crypto";

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(payload: Record<string, any>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", secret).update(dataToSign).digest();
  const encodedSignature = base64url(signature);
  return `${dataToSign}.${encodedSignature}`;
}

export function generateStagingSecrets() {
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  // Clean alphanumeric password to avoid connection string URL encoding bugs
  const postgresPassword = crypto.randomBytes(24).toString("hex");
  const encryptionKey = crypto.randomBytes(32).toString("hex");
  
  const payloadAnon = {
    role: "anon",
    iss: "supabase",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10, // 10 years
  };
  const anonKey = signJwt(payloadAnon, jwtSecret);

  const payloadService = {
    role: "service_role",
    iss: "supabase",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10, // 10 years
  };
  const serviceRoleKey = signJwt(payloadService, jwtSecret);

  return {
    jwtSecret,
    postgresPassword,
    encryptionKey,
    anonKey,
    serviceRoleKey,
  };
}

export function generateKongConfig(anonKey: string, serviceRoleKey: string): string {
  return `_format_version: "2.1"
_transform: true

services:
  - name: auth-v1
    url: http://auth:9999/
    routes:
      - name: auth-v1-all
        strip_path: true
        paths:
          - /auth/v1/

  - name: rest-v1
    url: http://rest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/

  - name: storage-v1
    url: http://storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/

plugins:
  - name: cors
    config:
      origins:
        - "*"
      methods:
        - GET
        - HEAD
        - PUT
        - PATCH
        - POST
        - DELETE
        - OPTIONS
      headers:
        - "*"
      exposed_headers:
        - "*"
      credentials: true
      max_age: 86400

  - name: key-auth
    config:
      key_names:
        - apikey
      hide_credentials: false

consumers:
  - username: anon
    keyauth_credentials:
      - key: "${anonKey}"

  - username: service_role
    keyauth_credentials:
      - key: "${serviceRoleKey}"
`;
}

export function generateComposeFile(): string {
  return `networks:
  pandora-staging-net:
    driver: bridge

services:
  db:
    image: public.ecr.aws/supabase/postgres:17.6.1.166
    container_name: pandora_staging_db
    restart: unless-stopped
    ports:
      - "127.0.0.1:54322:5432"
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
    volumes:
      - ./volumes/db/data:/var/lib/postgresql/data
    networks:
      - pandora-staging-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 15s

  rest:
    image: public.ecr.aws/supabase/postgrest:v14.5
    container_name: pandora_staging_rest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgresql://postgres:\${POSTGRES_PASSWORD}@db:5432/postgres
      PGRST_DB_SCHEMAS: public,storage
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${JWT_SECRET}
      PGRST_DB_USE_BUILTIN_AUTH: "false"
    networks:
      - pandora-staging-net

  auth:
    image: public.ecr.aws/supabase/gotrue:v2.197.0
    container_name: pandora_staging_auth
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: http://127.0.0.1:54321/auth/v1
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgresql://supabase_auth_admin:\${POSTGRES_PASSWORD}@db:5432/postgres?search_path=auth&sslmode=disable
      GOTRUE_SITE_URL: http://127.0.0.1:3000
      GOTRUE_URI_ALLOW_LIST: "*"
      GOTRUE_JWT_SECRET: \${JWT_SECRET}
      GOTRUE_JWT_EXP: 3600
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_MAILER_AUTOCONFIRM: "true"
      GOTRUE_SMTP_ADMIN_EMAIL: admin@pandora-staging.local
    networks:
      - pandora-staging-net
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:9999/health"]
      interval: 5s
      timeout: 5s
      retries: 10

  storage:
    image: public.ecr.aws/supabase/storage-api:v1.77.5
    container_name: pandora_staging_storage
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      rest:
        condition: service_started
    environment:
      ANON_KEY: \${ANON_KEY}
      SERVICE_KEY: \${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://rest:3000
      PGRST_JWT_SECRET: \${JWT_SECRET}
      DATABASE_URL: postgresql://postgres:\${POSTGRES_PASSWORD}@db:5432/postgres
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      GLOBAL_S3_BUCKET: stub
      STORAGE_BACKEND: file
      FILE_SIZE_LIMIT: 52428800
    volumes:
      - ./volumes/storage:/var/lib/storage
    networks:
      - pandora-staging-net
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:5000/status || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 5s

  kong:
    image: public.ecr.aws/supabase/kong:2.8.1
    container_name: pandora_staging_kong
    restart: unless-stopped
    depends_on:
      auth:
        condition: service_started
      rest:
        condition: service_started
      storage:
        condition: service_started
    ports:
      - "127.0.0.1:54321:8000"
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /var/lib/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth
      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: 160k
      KONG_NGINX_PROXY_PROXY_BUFFERS: 64 160k
    volumes:
      - ./volumes/api/kong.yml:/var/lib/kong/kong.yml:ro
    networks:
      - pandora-staging-net
`;
}
