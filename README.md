# Cedoka Global Operations Platform

This application uses Supabase project `erxhhqrzxgsklyhsuulx`.

## First-time Supabase setup

1. Apply the migrations in `supabase/migrations` in filename order. This folder is the single source of truth; do not use a combined SQL bundle.
2. Create `admin@cedoka.com` in Supabase Dashboard > Authentication > Users and enable auto-confirm.
3. Run `FIX_ADMIN_LOGIN.sql` in the Supabase SQL Editor.
4. Deploy both Edge Functions:

```bash
supabase functions deploy create-user-account --project-ref erxhhqrzxgsklyhsuulx --use-api
supabase functions deploy update-user-status --project-ref erxhhqrzxgsklyhsuulx --use-api
supabase functions deploy register-staff --project-ref erxhhqrzxgsklyhsuulx --use-api
```

The service-role key stays inside Supabase Edge Functions and must never be added to Vite or browser environment files.

Public registration creates an inactive Sales Person request. Administrators approve or reject it from User Management. Direct staff creation by an authorized administrator is active immediately and does not require approval.

The application currently has no file-upload controls. This prevents uncompressed documents or images from consuming storage; an upload pipeline should add client-side compression and server-side size/type limits before attachments are enabled.

## Local development

```bash
npm install
npm run dev
```
