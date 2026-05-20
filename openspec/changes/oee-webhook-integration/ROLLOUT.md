# Rollout Notes: OEE Webhook Integration

## Secret Configuration

The `oee-trigger` edge function requires two environment variables to be configured as Edge Function Secrets in the Supabase Dashboard:

### 1. OEE_SECRET_KEY

- **Purpose**: Bearer token shared with the external OEE application for authentication.
- **Setup**: Go to Supabase Dashboard → Project Settings → Edge Functions → Secrets.
- **Name**: `OEE_SECRET_KEY`
- **Value**: A strong random string (e.g., 32+ alphanumeric characters).
- **Share**: Provide this token securely to the OEE team along with the endpoint URL.

### 2. SUPABASE_SERVICE_ROLE_KEY

- **Purpose**: Allows the edge function to bypass RLS and perform asset lookups + work order inserts.
- **Setup**: Go to Supabase Dashboard → Project Settings → API → Service Role Key.
- **Name**: `SUPABASE_SERVICE_ROLE_KEY`
- **Value**: Copy the service role key from the dashboard.
- **⚠️ Warning**: Treat this key as highly sensitive. Never commit it to version control.

### 3. SUPABASE_URL

- **Purpose**: The Supabase project URL used by the edge function to initialize the client.
- **Setup**: Go to Supabase Dashboard → Project Settings → API → URL.
- **Name**: `SUPABASE_URL`
- **Value**: `https://zbnritimnflkgihbfahb.supabase.co`

## Deployment Steps

1. **Configure secrets** in the Supabase Dashboard (see above).
2. **Deploy the function**:
   ```bash
   supabase functions deploy oee-trigger
   ```
3. **Verify deployment**:
   ```bash
   curl -X POST https://zbnritimnflkgihbfahb.supabase.co/functions/v1/oee-trigger \
     -H "Authorization: Bearer <OEE_SECRET_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"equipment_id":"EQ-001","sintoma":"Test symptom"}'
   ```
4. **Provide endpoint + secret to OEE team**.

## Rollback

- Delete the edge function: `supabase functions delete oee-trigger`
- Remove the `OEE_SECRET_KEY` secret from the dashboard.
- Existing work orders created by the webhook remain in the database.

## Local Development / Testing

```bash
# Set env vars locally (do NOT commit .env files with secrets)
export SUPABASE_URL=https://zbnritimnflkgihbfahb.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
export OEE_SECRET_KEY=test-secret

# Serve locally (requires Supabase CLI)
supabase functions serve oee-trigger

# Invoke with curl
curl -X POST http://localhost:54321/functions/v1/oee-trigger \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"EQ-001","sintoma":"Local test"}'
```

## Testing

Run unit tests with Deno:

```bash
cd supabase/functions/oee-trigger
deno test --allow-env index_test.ts
```

Run integration tests (requires live Supabase credentials):

```bash
export SUPABASE_URL=https://zbnritimnflkgihbfahb.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<your-key>
export OEE_SECRET_KEY=test-secret
deno test --allow-env --allow-net index_test.ts
```
