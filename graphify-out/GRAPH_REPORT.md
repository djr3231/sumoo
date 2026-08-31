# Graph Report - C:\Development\sumoo  (2026-08-31)

## Corpus Check
- 151 files · ~136,871 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1111 nodes · 2597 edges · 95 communities (41 shown, 54 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Application API Routes
- Google Workspace Storage
- Bi-Monthly Report Processing
- OCR Deduplication Services
- Application Page Entry Points
- Command Combobox Primitives
- Receipt Table Controls
- Upload and PDF Export
- Bank Statement Parsing
- Project Architecture Documentation
- NPM Build Configuration
- Receipt Comparison Interface
- Google Drive Import
- Report Wizard Matching
- TypeScript Compiler Configuration
- Family Accounts Design
- Application Session Providers
- Shadcn Component Configuration
- Account Menu Controls
- Receipt Transaction Matching
- Settings Form Controls
- PWA Share Target Manifest
- Financial Reconciliation Documentation
- Spreadsheet Data Model
- Design System Redesign
- Runtime Package Dependencies
- Family Access Implementation Plans
- Mobile Share Target Design
- No Receipt Expense Design
- PDF Export Progress Design
- Pharmacy Expense Classification
- Report Wizard PDF Plans
- Report Sheet Generation
- Wizard Step Reachability
- Web Share File Intake
- Sumoo Application Icon
- Runtime Verification Handoff
- PDF Signature Scaling
- Government Report Template
- Shadcn MCP Server
- Handoff Plan Tracking
- Google Drive Access Scopes
- Class Variant Authority
- Release Popup Protocol
- Class Name Composition
- Command Menu Package
- Pharmacy Food Classification
- Draft Expense Ordering
- PDF Fit Export
- Receipt Expense Relationships
- ESLint Configuration
- Gemini AI SDK
- Google APIs Client
- Image Processing Library
- Lucide Icon Library
- Next.js Framework
- NextAuth Authentication
- Next.js Configuration
- Theme Switching Library
- CSV Parsing Library
- Phosphor Icon Library
- Radix UI Package
- Radix Dialog Primitive
- Radix Label Primitive
- Radix Progress Component
- Radix Select Component
- Radix Slot Component
- Radix Tabs Component
- Radix Toast Component
- React DOM Renderer
- File Dropzone Uploads
- Sharp Image Processing
- Sonner Toast Notifications
- Tailwind Class Merging
- UUID Identifier Generation
- Vaul Drawer Components
- Zod Schema Validation
- PWA Icon Installation
- Legacy Stack Documentation
- Redesign Execution Protocol
- Feature Branch Workflow
- Application Icon Asset
- OCR Visual Baseline
- Bank Action Evidence
- Dependency Security Findings
- OAuth Token Expiry
- Product Work Backlog
- Cash Receipt Coverage
- PWA Manifest Icon
- Drive Folder Combobox
- Loading State Foundation
- Toast Messaging Foundation
- Household Category Taxonomy

## God Nodes (most connected - your core abstractions)
1. `cn()` - 131 edges
2. `errorStatus()` - 53 edges
3. `requireCapability()` - 52 edges
4. `Capability` - 29 edges
5. `Receipt` - 26 edges
6. `sheetsClient()` - 25 edges
7. `Button()` - 24 edges
8. `apiFetch()` - 22 edges
9. `driveClient()` - 22 edges
10. `buildReportPdfBundle()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `User Owned Sheets Storage` --semantically_similar_to--> `User Spreadsheet Database`  [INFERRED] [semantically similar]
  SESSION-CONTEXT.md → ARCHITECTURE.md
- `Receipt Data Model` --semantically_similar_to--> `Receipt Schema`  [INFERRED] [semantically similar]
  SESSION-CONTEXT.md → ARCHITECTURE.md
- `Match Workbench Responsive Redesign` --semantically_similar_to--> `Responsive Receipts Redesign`  [INFERRED] [semantically similar]
  DOTO.md → REDESIGN-PLAN.md
- `Sumoo Product Mission` --semantically_similar_to--> `Sumoo Personal Receipt Scanner PWA`  [INFERRED] [semantically similar]
  SESSION-CONTEXT.md → README.md
- `RootLayout()` --calls--> `cn()`  [EXTRACTED]
  app/layout.tsx → lib/utils.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Sumoo Three Layer Architecture** — architecture_domain_types_layer, architecture_service_layer, architecture_api_boundary [EXTRACTED 1.00]
- **Bi-Monthly Report Core Flow** — insolvency_report_plan_source_documents, insolvency_report_plan_report_reconciliation, insolvency_report_plan_transaction_classifier, insolvency_report_plan_template_copy_generation [EXTRACTED 1.00]
- **Redesign Cross-Cutting Foundation** — redesign_plan_dark_mode_toggle, redesign_plan_messaging_foundation, redesign_plan_loader_foundation [EXTRACTED 1.00]
- **Mobile Share Target File Handoff Flow** — docs_superpowers_specs_2026_07_07_mobile_share_target_design_manifest_share_declaration, docs_superpowers_specs_2026_07_07_mobile_share_target_design_share_only_service_worker, docs_superpowers_specs_2026_07_07_mobile_share_target_design_shared_file_cache, docs_superpowers_specs_2026_07_07_mobile_share_target_design_shared_files_pickup_hook, docs_superpowers_specs_2026_07_07_mobile_share_target_design_uploadzone_file_queue, docs_superpowers_specs_2026_07_07_mobile_share_target_design_existing_ocr_pipeline [EXTRACTED 1.00]
- **PDF Progress Streaming Flow** — docs_superpowers_specs_2026_07_12_report_pdf_fit_and_progress_design_staged_pdf_progress, docs_superpowers_specs_2026_07_12_report_pdf_fit_and_progress_design_pdf_progress_event, docs_superpowers_specs_2026_07_12_report_pdf_fit_and_progress_design_ndjson_streaming_route, docs_superpowers_specs_2026_07_12_report_pdf_fit_and_progress_design_client_stream_parser, docs_superpowers_specs_2026_07_12_report_pdf_fit_and_progress_design_dialog_progress_feedback [EXTRACTED 1.00]
- **Family Account Access Flow** — docs_superpowers_specs_2026_07_17_family_members_design_family_account_model_b, docs_superpowers_specs_2026_07_17_family_members_design_membership_registry, docs_superpowers_specs_2026_07_17_family_members_design_signed_active_account_cookie, docs_superpowers_specs_2026_07_17_family_members_design_account_discovery, docs_superpowers_specs_2026_07_17_family_members_design_acting_context_resolution, docs_superpowers_specs_2026_07_17_family_members_design_server_permission_matrix [EXTRACTED 1.00]
- **Mobile shared-file ingestion flow** — docs_superpowers_plans_2026_07_07_mobile_share_target_web_share_target, docs_superpowers_plans_2026_07_07_mobile_share_target_share_only_service_worker, docs_superpowers_plans_2026_07_07_mobile_share_target_shared_files_cache, docs_superpowers_plans_2026_07_07_mobile_share_target_use_shared_files [EXTRACTED 1.00]
- **Family account authorization flow** — docs_superpowers_plans_2026_07_17_family_members_1_accounts_core_acting_context, docs_superpowers_plans_2026_07_17_family_members_1_accounts_core_signed_active_account_cookie, docs_superpowers_plans_2026_07_19_family_members_2_role_enforcement_capability_model, docs_superpowers_plans_2026_07_19_family_members_2_role_enforcement_server_authorization_boundary, docs_superpowers_plans_2026_07_19_family_members_3_management_sharing_manage_family_capability [EXTRACTED 1.00]
- **App Icon Visual Composition** — public_icons_icon_512_rounded_square_background, public_icons_icon_512_dark_navy_color_field, public_icons_icon_512_white_abstract_glyph [INFERRED 0.95]

## Communities (95 total, 54 thin omitted)

### Community 0 - "Application API Routes"
Cohesion: 0.06
Nodes (69): GET(), POST(), GET(), GET(), GET(), POST(), Body, POST() (+61 more)

### Community 1 - "Google Workspace Storage"
Cohesion: 0.06
Nodes (84): DELETE(), parseEmail(), POST(), ShareResult, ShareTarget, appendReceipts(), applyTabFormatting(), authClient() (+76 more)

### Community 2 - "Bi-Monthly Report Processing"
Cohesion: 0.06
Nodes (60): fmtDate(), isDraftExpense(), ReportWizard(), SalarySlip, CategorizedExpense, directPdfToCardCharges(), isSpreadsheet(), pdfToTxns() (+52 more)

### Community 3 - "OCR Deduplication Services"
Cohesion: 0.06
Nodes (61): isReceiptType(), POST(), roundAmount(), withTimeout(), asMediaType(), Body, classifyMethod(), DOC_TYPE_MAP (+53 more)

### Community 4 - "Application Page Entry Points"
Cohesion: 0.07
Nodes (41): handler, ComparePage(), ReceiptsPage(), ReportPage(), SettingsPage(), UploadPage(), AccountChip(), roleLabel() (+33 more)

### Community 5 - "Command Combobox Primitives"
Cohesion: 0.08
Nodes (37): ComboboxChip(), ComboboxChips(), ComboboxChipsInput(), ComboboxClear(), ComboboxGroup(), ComboboxLabel(), ComboboxSeparator(), ComboboxTrigger() (+29 more)

### Community 6 - "Receipt Table Controls"
Cohesion: 0.07
Nodes (32): COLUMNS, decodePeriod(), encodePeriod(), PAGE_SIZE_OPTIONS, PERIOD_OPTIONS, PeriodChoice, PeriodSelect(), ReceiptCard (+24 more)

### Community 7 - "Upload and PDF Export"
Cohesion: 0.09
Nodes (30): PdfExportDialog(), PdfExportDialogProps, PdfExportForm(), progressLabel(), todayDDMMYYYY(), drawFitted(), Mode, SignatureField() (+22 more)

### Community 8 - "Bank Statement Parsing"
Cohesion: 0.09
Nodes (36): POST(), charges, parseStatementPDF(), CARD_CURRENCY_KEYS, CARD_ILS_KEYS, CARD_MERCHANT_KEYS, CARD_SETTLEMENT_KEYS, CARD_TXN_DATE_KEYS (+28 more)

### Community 9 - "Project Architecture Documentation"
Cohesion: 0.07
Nodes (36): Architecture Source of Truth, Design System Source of Truth, Project Rules for Codex, Report Anonymity, API and Component Boundary, Const Enum Pattern, Domain Types Layer, Exhaustive Switches (+28 more)

### Community 10 - "NPM Build Configuration"
Cohesion: 0.06
Nodes (34): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, postcss, shadcn, tailwindcss (+26 more)

### Community 11 - "Receipt Comparison Interface"
Cohesion: 0.11
Nodes (26): CompareView(), DeleteReceiptDialog(), DeleteReceiptDialogProps, OcrResponse, Phase, postJson(), ReceiptCard(), ReceiptCheck() (+18 more)

### Community 12 - "Google Drive Import"
Cohesion: 0.09
Nodes (28): DEFAULT_ITEM, DriveFilePicker(), FileItem, FileSelection, Props, DEFAULT_ITEM, DriveFolderPicker(), FolderItem (+20 more)

### Community 13 - "Report Wizard Matching"
Cohesion: 0.15
Nodes (19): fmtDate(), MatchWorkbench(), SortKey, ExpenseRow, SOURCE_LABEL, STEPS, Checkbox(), Input() (+11 more)

### Community 14 - "TypeScript Compiler Configuration"
Cohesion: 0.07
Nodes (27): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts (+19 more)

### Community 15 - "Family Accounts Design"
Cohesion: 0.11
Nodes (27): Available Account Discovery, Acting Context Resolution, Client Account Context, Owner Drive Asset Sharing, Family Account Model B, Family Role Model, Family Access Security Boundary, Header Account Switcher (+19 more)

### Community 16 - "Application Session Providers"
Cohesion: 0.11
Nodes (17): metadata, publicSans, RootLayout(), viewport, GlobalLoading(), Providers(), ServiceWorkerRegister(), SessionGuard() (+9 more)

### Community 17 - "Shadcn Component Configuration"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 18 - "Account Menu Controls"
Cohesion: 0.13
Nodes (17): DropdownMenu(), DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioGroup(), DropdownMenuRadioItem(), DropdownMenuSeparator() (+9 more)

### Community 19 - "Receipt Transaction Matching"
Cohesion: 0.18
Nodes (18): POST(), MatchResult, appendTxns(), compareCandidates(), daysBetween(), levenshtein(), matchReceiptsToLines(), MatchResult (+10 more)

### Community 20 - "Settings Form Controls"
Cohesion: 0.16
Nodes (15): FamilyResponse, SettingsResponse, Badge(), badgeVariants, Select(), SelectContent(), SelectGroup(), SelectItem() (+7 more)

### Community 21 - "PWA Share Target Manifest"
Cohesion: 0.11
Nodes (17): background_color, description, dir, display, icons, lang, name, files (+9 more)

### Community 22 - "Financial Reconciliation Documentation"
Cohesion: 0.12
Nodes (17): Amount-Only Forex Match Weakness, Card Bank Reconciliation, Currency Column Exact-Match Bug, Forex Fee Principal Merge, Foreign Amount Join, Forex Principal Parser, parseCardXLSX, Settlement Date Cutoff (+9 more)

### Community 23 - "Spreadsheet Data Model"
Cohesion: 0.18
Nodes (11): Receipt Schema, Settings Schema, User Spreadsheet Database, Mixed Payment Linked Rows, Receipt Dedup Pipeline, Drive Bulk Import Flow, Card List Payment Classification, Receipt Data Model (+3 more)

### Community 24 - "Design System Redesign"
Cohesion: 0.20
Nodes (11): Forbidden Styling Patterns, Locked Theme Tokens, Class Based Dark Mode, Registered Shadcn Preset b1tzID8AS, RTL Mobile First Rules, Shadcn Primitive Policy, Match Workbench Responsive Redesign, Dark Mode Toggle (+3 more)

### Community 25 - "Runtime Package Dependencies"
Cohesion: 0.22
Nodes (9): @base-ui/react, dependencies, @base-ui/react, pdf-lib, @radix-ui/react-checkbox, tw-animate-css, pdf-lib, @radix-ui/react-checkbox (+1 more)

### Community 26 - "Family Access Implementation Plans"
Cohesion: 0.25
Nodes (8): Active-account acting context, Signed active-account cookie, Role capability model, Server authorization boundary, Drive file sharing helpers, Family management API, ManageFamily capability, Inline family-role editing

### Community 27 - "Mobile Share Target Design"
Cohesion: 0.25
Nodes (8): Existing Per-File OCR Pipeline, Manifest Share Target Declaration, Mobile PWA Share Target, Progressive Share Enhancement, Share-Only Service Worker, Shared File Cache Handoff, useSharedFiles Pickup Hook, UploadZone File Queue

### Community 28 - "No Receipt Expense Design"
Cohesion: 0.25
Nodes (8): Included Cash Lines View, Live Drive Receipt Link, ExpenseItem noReceipt Field, Government Report Invariance, Manual No-Receipt Marker, Receipt Links Rollup Data Flow, Step 4 No-Receipt UI, Working-Sheet Three-State Receipt Cell

### Community 29 - "PDF Export Progress Design"
Cohesion: 0.29
Nodes (7): Client NDJSON Stream Parser, PDF Dialog Stage Feedback, NDJSON PDF Streaming Route, PdfProgress Event, Report Progress Anonymity, Staged PDF Progress Feedback, Temp-Copy Finally Cleanup

### Community 30 - "Pharmacy Expense Classification"
Cohesion: 0.33
Nodes (6): GOV Expense Food Category, Health-Fund Pharmacy Exclusion, LLM Expense Classification, Retail Pharmacy Chain Matcher, Pharmacy Food Default Override, Store Name Normalization

### Community 31 - "Report Wizard PDF Plans"
Cohesion: 0.40
Nodes (5): Clickable wizard stepper, maxStep progress state, PDF report bundle, Temporary report copy, NDJSON PDF progress stream

### Community 32 - "Report Sheet Generation"
Cohesion: 0.40
Nodes (5): Label-anchored template lookup, Report generation API route, Report rollup, Drive smart chips in working sheet, No-receipt expense field

### Community 33 - "Wizard Step Reachability"
Cohesion: 0.50
Nodes (5): Clickable Wizard Navigation, First-Advance Gate Semantics, maxStep Reachability State, Persisted Wizard Reachability, Three-State Stepper UI

### Community 34 - "Web Share File Intake"
Cohesion: 0.50
Nodes (4): Share-only service worker, Shared files Cache Storage bucket, useSharedFiles callback hook, Web Share Target

### Community 35 - "Sumoo Application Icon"
Cohesion: 0.50
Nodes (4): Sumoo App Icon, Dark Navy Color Field, Rounded-Square App Icon Background, White Abstract Glyph

### Community 36 - "Runtime Verification Handoff"
Cohesion: 0.67
Nodes (3): Visual Runtime Verification Handoff, Static Verification Commands, Redesign Definition of Done

### Community 37 - "PDF Signature Scaling"
Cohesion: 0.67
Nodes (3): Fit-to-Page PDF Export, RTL Signature Positioning, Fit-Scaled Signature Geometry

### Community 38 - "Government Report Template"
Cohesion: 0.67
Nodes (3): Government Report Fixed Schema, Known Good Period Verification, Template Copy Report Generation

## Ambiguous Edges - Review These
- `Legacy Dependency Instructions` → `Next.js and Gemini Stack`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to

## Knowledge Gaps
- **279 isolated node(s):** `npx`, `handler`, `ShareTarget`, `ShareResult`, `ScanContext` (+274 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **54 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Legacy Dependency Instructions` and `Next.js and Gemini Stack`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `dependencies` connect `Runtime Package Dependencies` to `Bank Statement Parsing`, `NPM Build Configuration`, `Google Drive Import`, `Class Variant Authority`, `Class Name Composition`, `Command Menu Package`, `Gemini AI SDK`, `Google APIs Client`, `Image Processing Library`, `Lucide Icon Library`, `Next.js Framework`, `NextAuth Authentication`, `Theme Switching Library`, `CSV Parsing Library`, `Phosphor Icon Library`, `Radix UI Package`, `Radix Dialog Primitive`, `Radix Label Primitive`, `Radix Progress Component`, `Radix Select Component`, `Radix Slot Component`, `Radix Tabs Component`, `Radix Toast Component`, `React DOM Renderer`, `File Dropzone Uploads`, `Sharp Image Processing`, `Sonner Toast Notifications`, `Tailwind Class Merging`, `UUID Identifier Generation`, `Vaul Drawer Components`, `Zod Schema Validation`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `cn()` connect `Command Combobox Primitives` to `Bi-Monthly Report Processing`, `Application Page Entry Points`, `Receipt Table Controls`, `Upload and PDF Export`, `Receipt Comparison Interface`, `Google Drive Import`, `Report Wizard Matching`, `Application Session Providers`, `Account Menu Controls`, `Settings Form Controls`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `react` connect `Google Drive Import` to `Runtime Package Dependencies`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **What connects `npx`, `handler`, `ShareTarget` to the rest of the system?**
  _279 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Application API Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.06227106227106227 - nodes in this community are weakly interconnected._
- **Should `Google Workspace Storage` be split into smaller, more focused modules?**
  _Cohesion score 0.05934065934065934 - nodes in this community are weakly interconnected._