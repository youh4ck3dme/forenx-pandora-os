-- WebAuthn / Passkey credentials for authentication
-- Each row stores one registered passkey per user.
-- credential_id is the base64url-encoded rawId from the authenticator.

create table if not exists public.webauthn_credentials (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  credential_id       text not null unique,          -- base64url rawId
  public_key_cbor     text not null,                 -- base64url CBOR-encoded COSE public key
  sign_count          bigint not null default 0,     -- monotonically increasing counter
  aaguid              text,                          -- authenticator AAGUID (may be zeroed)
  device_type         text,                          -- 'singleDevice' | 'multiDevice'
  backed_up           boolean not null default false,
  transports          text[],                        -- e.g. ['internal', 'hybrid']
  friendly_name       text,                          -- user-visible label
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz
);

-- Only the owning user may see their own credentials
alter table public.webauthn_credentials enable row level security;

create policy "owner_select" on public.webauthn_credentials
  for select using (auth.uid() = user_id);

create policy "owner_delete" on public.webauthn_credentials
  for delete using (auth.uid() = user_id);

-- Service role (server-side only) handles inserts and sign_count updates
-- No insert/update policy for authenticated role — only SUPABASE_SERVICE_ROLE_KEY may write.

create index if not exists webauthn_credentials_user_id_idx
  on public.webauthn_credentials(user_id);
