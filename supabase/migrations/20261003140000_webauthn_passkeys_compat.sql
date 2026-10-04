-- WebAuthn / Passkeys Compatibility & Aliases
-- Ensures public.webauthn_credentials has both naming conventions:
-- counter (sign_count) and public_key (public_key_cbor),
-- and creates public.user_passkeys view for interoperability.

alter table if exists public.webauthn_credentials
  add column if not exists counter bigint default 0,
  add column if not exists public_key text;

-- Synchronize existing records if present
update public.webauthn_credentials
set counter = coalesce(counter, sign_count, 0),
    public_key = coalesce(public_key, public_key_cbor);

-- Interoperability view: user_passkeys
create or replace view public.user_passkeys as
  select
    id,
    user_id,
    credential_id,
    coalesce(public_key, public_key_cbor) as public_key,
    public_key_cbor,
    coalesce(counter, sign_count, 0) as counter,
    sign_count,
    transports,
    friendly_name,
    created_at,
    last_used_at
  from public.webauthn_credentials;

-- Grant permissions on view
grant select on public.user_passkeys to authenticated, service_role;
