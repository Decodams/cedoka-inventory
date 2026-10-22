# Cedoka Inventory - Session Summary

## Objective
**Round 1 (committed `93d673e`)**: ADMIN/MANAGER/BRANCH & INVENTORY ACCESS-CONTROL SPEC (33 sections) — strict multi-tenant RLS (Business → Location → Branch, one-admin-per-branch, IDOR prevention, audited movements, SQL tests). COMPLETE and pushed.

**Round 2 (committed `f2c8b64`)**: 9-phase master plan — restore records "removed" by strict-RLS migration `202609180004`, oversight-vs-ownership architecture (business/location/branch oversight; My vs Overseen), Super Admin command-centre dashboard, soft-delete tombstones, rewritten authorization suite (Section 27G). COMPLETE and pushed.

**Round 3 (committed `b1d4e41`)**: user's 18-item UX/security/feature spec — salesperson multi-branch visibility, report business/branch ownership + auto-select, urgency/escalation in-app notifications, offline/error/retry, consistent icons/no emojis/no mojibake, skeletons/empty screens/errors, tiny motions, sanitization, server-side API keys, keyboard-safe forms, all-screen-size design, serial picker, no gradients, engineering review, file-upload policy, report ownership selection. COMPLETE and pushed.

**Round 4 (UNCOMMITTED)**: two new features —
(a) **Auto-generate Weekly Report** from `daily_activities` (Mon–Sat sales week) with expert-system grouping/ordering into `activities_notes / challenges_notes / issues_notes / improvement_notes`, previewed before it is applied to the report form.
(b) **Quotations** — manager+ draft/view scoped to their branches, printable/downloadable quotation PDF (company details, Prepared for, Location, Date, quote no, valid until, items, totals, notes/terms, bank details; **no staff name**), and **Create receipt from quotation** (atomic, stock/serial aware, audit logged) linking `daily_sales.quotation_id`.

**Round 5 (UNCOMMITTED)**: Receipt fidelity + UI/UX audit & polish —
- Verified receipt feature is **not altered** by the new quotation feature (code diff + invariant check).
- Fixed the **quotation→sale amounts bug** where header discount was ignored, causing wrong subtotal/discount/total/balance on converted sales.
- Added **receipt-math assertions** (Q10/Q11) to `quotation_test.sql`: Σ sale_items.discount_value = daily_sales.discount_value; amount_paid = total; balance = 0; VAT quotes refused.
- Applied **new migration `202609220002`** (proportional header-discount allocation with last-line remainder, VAT guard, receipt invariant) — applied to linked DB.
- Full **page-by-page UI/UX audit** (23 pages) → fixed overlaps, overflow, clipping, loading-state focus loss, error swallowing, space waste.
- **Shared UI fixes**: Modal z-index (70 > offline banner 60), explicit table min-widths replacing fragile global CSS, placeholder rendering, button text-wrapping, safe-area padding, header/offline-banner overlap, mobile grid override removal.
- **High-severity fixes**: CustomersPage/InventoryPage loading-state early returns (focus loss on search), WeeklyReportsPage detail badge overlap, UserManagementPage delete error behind modal, ReconciliationPage variance row overflow + clipped input.

## Verified Ground Truth
- React/TS + Vite + Tailwind + Supabase (Postgres/RLS/Edge Functions/RPCs); Vercel → cedoka-inventory.vercel.app; remote `https://github.com/Decodams/cedoka-inventory.git`; branch `main` at `b1d4e41`
- Project ref `erxhhqrzxgsklyhsuulx`; CLI v2.115.0 (2.121.0 available); **Docker NOT installed** (no `db dump`; use `supabase db query --linked` only)
- `supabase db query --linked "SQL"` (positional arg) and `-f file.sql`; returns only the LAST result set; SQL starting with `--` parsed as flags (prepend `SELECT 1;`); PowerShell strips embedded `"` from native args — build claim JSON server-side via `json_build_object('sub',...,'role','authenticated')::text`; NOTICEs from DO blocks NOT surfaced by CLI (final result row only) — suites end with `result: ALL TESTS PASSED` row
- Gate: `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`, `npm run build` — all pass; **2 allowed warnings**: AuthContext react-refresh, SalesPage exhaustive-deps (`selectedProduct`); `tsconfig.app.json` includes only `src`
- Do NOT commit/push until user explicitly says so; update `.opencode/summary.md` before each commit
- Impersonation pattern: `PERFORM set_config('request.jwt.claims', '{"sub":"...","role":"authenticated"}', true); SET ROLE authenticated;` inside DO blocks (transaction-local)
- CLI supports `--file` for scripts run headless (used for migration + tests)

## Roster / IDs (live)
- Julia admin `afa6e895-92c2-4e60-9c3a-5b07da177f6d` (primary Asaba); Samuel Dim admin `abfc1c33-a599-4e73-8fef-a49c92eab80f` (primary Awka); Mercy manager `76bb8fa1-e143-4b68-88dd-b2fd568e94b2` (Ejigbo, branch manager); Super `f87e2e5f-c52e-4b9f-8ac0-d9ce3601c6f2`; martin Luter supervisor `7d93bb03-1382-4267-8fdd-89f8aec491fc` (INACTIVE)
- Businesses: Electronics `9ad5a468-2b61-40ad-b356-86e0722abe79`, Farm `ccd75ce5-66ff-43cb-878f-2087ac156458` (branches Ejigbo/Okanran/Okeafo), Default `0323311a-3fa1-4da1-b5b1-790791936191`, 4th `c8714478-a077-4c53-84d9-57886837c73b`
- Branches: Asaba `b96d1dce-4286-440b-9670-0df6bf198f6a`, Awka `41c060f0-a79d-4b95-ac14-249ce498a557`, Ejigbo `1cc8eff7-bb45-4ae0-9266-a151fa251288` (Mercy manager_id); Okanran `e1e10a5c-36a6-46d0-935a-5d7ca0513940`, Okeafo `e0ddf2fb-e81d-4d27-909d-920ed90dd29f`; Default `0993346a-f534-40ae-8aa8-a4b409ee5989`
- `user_business_assignments`: Samuel→Electronics, Julia→Electronics, Julia→Farm
- Notification recipients (migration trigger): branch `manager_id` + business admins (primary or `user_business_assignments`) + super admins, minus `auth.uid()`
- All 6 live products currently have `serial_tracking_mode = 'none'`

## Work State - COMPLETED (rounds 4+5, NOT committed)
- **Weekly report auto-generation**: `src/lib/weeklyReportGenerator.ts` → `buildWeeklyNotes` expert-system grouping; `src/components/AutoGenerateWeeklyReport.tsx` modal with business→branch cascade, **Week Ending (Saturday)** picker, Mon–Sat range, preview panel, "Apply to Report" → opens new draft form
- **Mon–Sat week rule**: new `getSalesWeekStart` / `getSalesWeekEnd` in `src/lib/dateUtils.ts`; WeeklyReportsPage now stores `week_start_date` = Monday, `week_end_date` = Saturday (old Sunday-based helpers kept for ReconciliationPage)
- **Overwrite protection**: saving a `submitted`/`reviewed` report asks for confirmation; duplicate branch+week insert surfaces a clear error
- **Quotations DB**: `supabase/migrations/202609210001_quotations.sql` (APPLIED) — `quotations` + `quotation_items`, `daily_sales.quotation_id`, `generate_quote_number()` (QT-YYYY-000001)
- **Quotations DB hardening**: `supabase/migrations/202609220001_quotation_conversion.sql` (APPLIED) — scoped RLS, `REVOKE ... FROM PUBLIC/anon`, `create_sale_from_quotation(uuid)` SECURITY DEFINER
- **Receipt-fidelity migration**: `supabase/migrations/202609220002_quotation_conversion_amounts.sql` (APPLIED) — corrected `create_sale_from_quotation`: proportional header-discount allocation with last-line remainder, VAT guard, enforces `daily_sales.discount_value == Σ sale_items.discount_value` and `amount_paid == total` (balance = 0)
- **Quotations UI**: `src/pages/QuotationsPage.tsx` — list/filter/search, create/edit/view modals, branch-scoped product picker with live stock, header discount + subtotal/total, status workflow, convert-to-receipt with success banner
- **Quotations PDF**: `src/components/QuotationPDF.tsx` — A4 company header + logo, "Prepared For", location/address, branch, date, quote no, valid until, items table, subtotal/discount/VAT/total, notes, terms, payment block; **no staff name**
- **Shared PDF helpers**: `src/lib/pdfCommon.ts` — company/address/contact/bank constants, `pdfMoney`, `loadLogoDataUrl`; `ReceiptPDF.tsx` refactored onto it (logic untouched, BOM verified)
- **Routing/nav**: `quotations` added to `PageKey` + `NAV_ITEMS` (manager+ only) in `AppShell.tsx`; lazy route + `ALL_PAGES` entry in `App.tsx`
- **Types**: `QuotationStatus`, `Quotation`, `QuotationItem` in `src/types/database.ts`
- **Tests**: `supabase/tests/quotation_test.sql` — Q1–Q9 RLS/conversion + **Q10 receipt math** + **Q11 VAT refusal** → **ALL TESTS PASSED**; existing `supabase/tests/authorization_test.sql` → **ALL TESTS PASSED**

### Shared UI / UX fixes (Round 5)
- `src/components/ui/Modal.tsx`: `z-50` → `z-[70]` (above offline banner `z-[60]`)
- `src/index.css`: removed fragile global `table:has(thead th:nth-child(5))` min-width heuristic; added explicit `min-w-[...]` on tables that genuinely need it (Procurement 42rem, Products 48rem, Reconciliation 56rem, Sales 34rem)
- `src/components/ui/Form.tsx`: removed `placeholder: _placeholder; void _placeholder` hack in `Input`/`Textarea` → placeholders now render
- `src/components/ui/Button.tsx`: removed `sm:whitespace-nowrap` + `overflow-hidden text-overflow-ellipsis`; now `whitespace-normal break-words` so long labels wrap
- `src/components/ui/Modal.tsx`: body padding `pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]`
- `src/components/AppShell.tsx`: header top padding `pt-[calc(0.875rem+env(safe-area-inset-top,0px))]` (+ `2.25rem` when offline) so offline banner never covers sticky header
- `src/index.css`: `safe-*` utilities now use `env(..., 0px)`; removed `@media (max-width:639px)` blanket override that forced `.grid-cols-2/.grid-cols-5` to 1 column (broke ProcurementPage GRN row)

### Page-specific fixes (Round 5)
- **CustomersPage**: scoped loading state to table body (keeps search input mounted on keystroke); `title` on truncated name/address; `aria-label` on search; conditional empty state copy
- **InventoryPage**: scoped loading state to list area; removed `shrink-0` from tab strip (lets it shrink & scroll internally); `title` on asset name/code/serial/branch/location; Condition/Status badges `capitalize`; SKU `truncate + title`
- **WeeklyReportsPage**: detail header `flex-wrap` + `min-w-0` (badges no longer overlap Escalate/Edit on phones); filter bar `flex flex-col sm:flex-row` with `w-full sm:w-56/44`; metric row `flex-wrap gap-x-4 gap-y-1`; `actionError` surfaced in header + amend modal + review card; detail cards `p-4 sm:p-6` + `space-y-4 sm:space-y-6`; status filter always rendered (was admin-only but query applied to all)
- **UserManagementPage**: `deleteError` rendered inside Delete modal (was at page level behind backdrop); email cell wrapped in `<span className="truncate" title={email}>` (truncate on flex container didn't work)
- **ReconciliationPage**: variance row `flex-col sm:flex-row min-w-0` + `truncate title` on product name; `EditableCell` input `w-24` + hide spinner; period header `flex-col sm:flex-row`; search+add row `flex-col sm:flex-row`; formula panel → collapsible `<details>`
- **AutoGenerateWeeklyReport**: preview header shows week range "N activities found for Oct 12 - Oct 17, 2026 (Monday to Saturday)"
- **QuotationPDF**: verified consistent with header-discount model (no change needed)

## Files changed (rounds 4+5)
- Migrations (applied): `supabase/migrations/202609210001_quotations.sql`, `supabase/migrations/202609220001_quotation_conversion.sql`, `supabase/migrations/202609220002_quotation_conversion_amounts.sql`
- Tests: `supabase/tests/quotation_test.sql` (extended with Q10/Q11)
- New pages/components: `src/pages/QuotationsPage.tsx`, `src/components/QuotationPDF.tsx`, `src/components/AutoGenerateWeeklyReport.tsx`, `src/lib/weeklyReportGenerator.ts`, `src/lib/pdfCommon.ts`
- Modified: `src/lib/dateUtils.ts` (+`getSalesWeekStart/End`, `weekRangeString`), `src/pages/WeeklyReportsPage.tsx`, `src/components/AppShell.tsx`, `src/App.tsx`, `src/components/ReceiptPDF.tsx`, `src/types/database.ts`
- UI fixes: `src/components/ui/Modal.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Form.tsx`, `src/index.css`
- Page fixes: `src/pages/CustomersPage.tsx`, `src/pages/InventoryPage.tsx`, `src/pages/WeeklyReportsPage.tsx`, `src/pages/UserManagementPage.tsx`, `src/pages/ReconciliationPage.tsx`, `src/components/AutoGenerateWeeklyReport.tsx`, `src/pages/SalesPage.tsx`, `src/pages/ProductsPage.tsx`, `src/pages/ProcurementPage.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/TransfersPage.tsx`, `src/pages/IssuesPage.tsx`, `src/pages/ActivitiesPage.tsx`, `src/pages/BusinessBranchPage.tsx`, `src/pages/AuditLogPage.tsx`, `src/components/SaleDetailModal.tsx`

## Next Move
- Await user review + explicit commit/push instruction (gate + both SQL suites already re-verified) — then commit with updated summary