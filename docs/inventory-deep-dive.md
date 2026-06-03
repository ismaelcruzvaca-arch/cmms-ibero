# MRO Inventory & Supply Chain — Deep Research

**Date:** 2026-05-25
**Scope:** IBM Maximo MAS, SAP MM/PM (S/4HANA), HxGN Octave Attune EAM, IFS Cloud EAM vs GEMA CMMS
**Focus:** Inventory Management, MRO Spare Parts, Supply Chain

---

## 1. Executive Summary

Inventory management is the backbone of any credible CMMS. Without it, work orders generate paper trails of parts usage but no actual stock visibility, no replenishment intelligence, and no cost capture. Enterprise EAMs (Maximo, SAP, HxGN, IFS) all ship mature inventory modules covering the full lifecycle: item master → stock levels → receiving → issuing → counting → replenishment → valuation.

GEMA currently has **material_requests** (requisitions linked to work orders) and an **epicor_outbox** pattern for sending requests to Epicor ERP — but no stock tracking, no warehouse management, no purchasing, and no supplier integration. The gap is the single largest missing domain in GEMA's feature set, estimated at **4+ sprints** to reach parity with mid-tier EAMs.

This document provides a feature-level comparison across all four enterprise platforms plus a concrete schema, replenishment logic, and integration design to guide GEMA's inventory module build-out.

---

## 2. Feature Comparison Table

### 2.1 Item Master & Catalog

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Item master (part numbers) | Item Master (ITEMNUM) | Material Master (MATNR) | Item catalog | Parts catalog | `spare_parts` (part_num PK) | ✅ Done |
| Item types (rotating, non-rotating, consumable) | Item type classification | Material type + valuation class | Item categories | Part commodities | Not built | 🔴 High |
| UOM (unit of measure) | UOM conversion | Base UOM + alternative | UOM | UOM | `uom` column in spare_parts | 🟡 Med |
| BOM per asset | Rotating Items / BOM | BOM (CS03) | Asset-parts link | Item/equipment relation | `asset_spare_parts` table | ✅ Done |
| Serial number tracking | Serial mgmt (SERIALNUM) | Serial number in MM | Serial tracking | Serial management | `track_serial` flag | 🟡 Med |
| Lot / batch tracking | Lot management | Batch management | Lot tracking | Batch tracking | `track_lots` flag | 🟡 Med |
| Condition codes (serviceable/unserviceable/condemned) | Condition codes (CONDITION) | Stock types + quality | Condition status | Quality status | Not built | 🔴 High |
| Status / lifecycle (active, inactive, obsolete) | Item status | Material status | Status codes | Status control | Not built | 🟡 Med |
| Substitute parts / cross-reference | Substitute items (SUBSTITUTE) | Material substitution | Alternate parts | Substitute part | Not built | 🟡 Med |

### 2.2 Stock Control

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Warehouse / storeroom | Storeroom (LOCATIONS) | Plant + Storage Location | Store/warehouse | Warehouse | `storerooms` table | ✅ Done |
| Bin locations | Bin (BINNUM) | Storage Bin | Bin management | Bin locations | `storeroom_bins` table | ✅ Done |
| Stock balance (qty on hand) | BALANCE (stored in INVBALANCES) | MARD (stock table) | Stock levels | Stock balance | Not built | 🔴 High |
| Reserved stock | INVRESERVED | Reservations table | Reserved qty | Reservations | `qty_reserved` needed | 🔴 High |
| Stock on order | On-order qty (PORETURN) | Stock in transit | PO stock flag | On order | `qty_on_order` needed | 🔴 High |
| Available qty (ATP) | Computed ATP | ATP quantity | Available stock | Available ATP | Not built | 🔴 High |
| Multi-site/plant inventory | Multi-site (SITEID) | Cross-plant (MARD) | Multi-site | Multi-warehouse | Single-site | 🟡 Low |
| Stock status per location | Balance condition | Stock types per loc | Status per bin | Stock segment | Not built | 🔴 High |
| Negative stock control | Configurable block | Blocked negative stock | Not allowed | Warning config | Not built | 🟡 Med |

### 2.3 Replenishment & Reorder

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Min/max stock levels | Min/Max qty (MINLEVEL/MAXLEVEL) | Min/max in MRP | Min/max levels | Min/max stock | Not built | 🔴 High |
| Reorder point | ROP (REORDERPOINT) | Reorder point (MARC) | Reorder point | ROP planning | Not built | 🔴 High |
| Reorder quantity | Order qty safety | Lot-sizing (EX, FX, TB) | Reorder qty | Order qty policy | Not built | 🔴 High |
| Safety stock | Safety stock | Safety stock (MARC) | Safety stock | Safety stock | Not built | 🔴 High |
| Lead time | Lead time days | In-house + GR processing | Lead time | Lead time | Not built | 🔴 High |
| ABC classification | ABC analysis | ABC indicator | ABC classification | ABC class | Not built | 🔴 High |
| Forecast-based replenishment | Demand forecasting | Forecast consumption | Trend analysis | Requirement planning | Not built | 🟡 Med |
| MRP / DRP | MRP module | MRP (total planning) | Requirements calc | IFS MRP | Not built | 🟡 Med |
| Supplier managed inventory (SMI) | SMI module | Consignment + SMI | Vendor-managed | Supplier collab | Not built | 🟡 Med |
| EOQ (economic order qty) | EOQ calculation | Lot-size calc | Not built-in | EOQ formulas | Not built | 🟡 Med |

### 2.4 Receiving

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Goods receipt (PO-based) | RECEIPT transaction | Goods receipt (MIGO) | Receive PO | GR process | Not built | 🔴 High |
| Inspection on receipt | Receipt inspection | QM inspection lot | Inspection step | Quality check | Not built | 🟡 Med |
| Put-away to bin | Bin assignment | Storage bin auto | Bin put-away | Bin assignment | Not built | 🟡 Med |
| Receipt for non-PO / direct | Direct receipt | Goods receipt w/o PO | Ad-hoc receipt | Direct receipt | Not built | 🟡 Med |
| Over/under delivery tolerance | Tolerance rules | Over-delivery tolerance | Tolerance config | Tolerance control | Not built | 🟡 Low |
| ASN (advanced ship notice) | EDI integration | ASN inbound | Supplier portal | E-procurement | Not built | 🟡 Low |

### 2.5 Issuing & Returns

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Issue to work order | ISSUE transaction | Goods issue to order (MB1A) | Issue to WO | Parts issue | `ISSUE` in transactions | ✅ Partial |
| Direct issue (no req) | DIRECTISSUE | Cons. from stock (261) | Direct issue | Direct issue | `DIRECT_ISSUE` type | 🟡 Med |
| Return from work order | RETURN transaction | Return from order | Return to store | Return parts | `RETURN` in transactions | 🟡 Med |
| Reason codes for issue | Reason code | Movement type | Reason code | Reason codes | `reason_code` column | 🟡 Med |
| Issue to employee / tool | Tool/employee issue | Issue to cost center | Issue to person | Employee issue | Not built | 🟡 Low |
| Counter / METER linked issue | Meter-based issue | Counter reading | Meter linkage | Meter-based | Not built | 🟡 Low |

### 2.6 Transfers & Adjustments

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Stock transfer between stores | TRANSFER transaction | Transfer posting (MB1B) | Store transfer | Transfer order | Not built | 🔴 High |
| Stock adjustment (gain/loss) | ADJUST transaction | Physical inv posting | Stock adjust | Adjustment | Not built | 🔴 High |
| Scrap / disposal | Scrap transaction | Scrap posting | Disposal | Scrap process | Not built | 🟡 Med |
| Reclassification | Reclassify item | Reclassification | Recategorize | Reclassify | Not built | 🟡 Med |

### 2.7 Cycle Counting & Physical Inventory

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Physical inventory (annual) | Physical count | Annual PI (MI01) | Physical count | Periodic count | Not built | 🔴 High |
| Cycle counting (continuous) | Cycle counting | Cycle counting (MI31) | Cycle counting | ABC cycle count | Not built | 🔴 High |
| Count sheet / batch | Count sheet print | Count batch (MI31) | Count sheets | Count batches | Not built | 🟡 Med |
| Zero-count / blind count | Blind count | Zero-count option | Blind count | Blind count | Not built | 🟡 Med |
| Count approval workflow | Approval process | Count difference post | Approval step | Count approval | Not built | 🟡 Med |
| Count adjustment posting | Auto-adjust | Difference posting | Auto adjust | Adjustment posting | Not built | 🟡 Med |

### 2.8 Valuation & Costing

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Moving average price | Avg cost | Moving average (V) | Avg cost | Moving avg | Not built | 🔴 High |
| Standard cost | Std cost | Standard price (S) | Standard cost | Std cost | Not built | 🔴 High |
| Last purchase price | Last PO cost | Last purchase price | Last cost | Last price | Not built | 🟡 Med |
| FIFO / LIFO | Not native | FIFO/LIFO valuation | Not native | FIFO option | Not built | 🟡 Low |
| Cost of goods sold (COGS) | Issue cost | COGS posting | COGS calc | COGS tracking | Not built | 🟡 Med |
| WO actual parts cost | Sum of issues | Cost calc in PM | Cost per WO | WO costing | Not built | 🔴 High |
| Landed cost | Add-on cost | Customs + freight | Not native | IFS landed | Not built | 🟡 Low |

### 2.9 Procurement & Supplier

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Purchase orders | PO (PURCHORDER) | MM purchase order | PO management | IFS Procurement | Not built | 🔴 High |
| Purchase requisitions | Req creation | PR (ME51N) | Requisitions | Requisitions | `material_requests` | ✅ Done |
| RFQ (request for quote) | RFQ process | RFQ (ME41) | Quote process | RFQ | Not built | 🟡 Med |
| Supplier master | Company master | Supplier (LFA1) | Supplier list | Supplier catalog | Not built | 🔴 High |
| Approved supplier list | Approved vendors | Source list | Approved supp. | ASL | Not built | 🔴 High |
| Quota arrangement | N/A | Quota arrangement | Allocation | Supplier split | Not built | 🟡 Med |
| Contract management | Purchasing contracts | Outline agreements | Contract pricing | IFS Contracts | Not built | 🟡 Med |
| Subcontracting / external processing | Service PO | Subcontracting | External service | Subcontract mgmt | Not built | 🟡 Low |
| Consignment stock | Consignment module | Consignment (K) | Consignment | Supplier stock | Not built | 🟡 Med |
| Supplier collaboration portal | Supplier portal | Supplier self-service | Vendor portal | Supplier collab | Not built | 🟡 Low |

### 2.10 Kitting & Assembly

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Kit / assembly definition | Kit items (KIT) | BOM explosion | Kit assembly | Kitting | Not built | 🟡 Med |
| Kit issue / unpackage | Kit issue transaction | Kit to order | Kit issue | Kit processing | Not built | 🟡 Med |
| Rotable / repairable tracking | Rotating items (ROTASSET) | Repairable via PM | Rotable mgmt | MRO Rotables | Not built | 🔴 High |
| Core return / exchange | Core tracking | Returnable packaging | Core return | Exchange process | Not built | 🟡 Med |

### 2.11 Reporting & Analytics

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Stock status report | Inventory status | Stock overview (MB52) | Stock report | Stock evaluation | Not built | 🔴 High |
| Slow-moving / obsolete | Slow mover report | Slow-moving analysis | Obsolete report | Inventory aging | Not built | 🟡 Med |
| Stockout / shortage report | Stockout tracking | Shortage report | Stockout alert | Shortage monitoring | Not built | 🔴 High |
| Inventory valuation report | Valuation report | Inv. val (MB5L) | Valuation | Valuation report | Not built | 🔴 High |
| Turnover ratio (inventory turns) | Turns report | Inventory controlling | Turnover | Turns analysis | Not built | 🟡 Med |
| Reorder exception report | ROP monitor | MRP list | Reorder alert | Reorder notification | Not built | 🟡 Med |

### 2.12 Integration with Work Orders

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| WO → material request | Reservations from WO | PM order reservation | WO parts | WO requirement | `material_requests` FK | ✅ Done |
| Reservation → issue | Auto-issue on status | GI auto to PM order | Issue from WO | Auto issue | Partial via `ISSUE` | 🟡 Med |
| Estimated vs actual parts cost | WO cost reporting | PM order costs | Cost comparison | Cost analysis | Not built | 🔴 High |
| Return unused from WO | Return transaction | Return to stock (262) | Return from WO | Return processing | `RETURN` type | 🟡 Med |
| WO parts actual cost post | Cost rollup | PM order settlement | Cost summary | WO cost allocation | Not built | 🔴 High |
| Planned parts in job plan | Job plan materials | Maintenance BOM | Template parts | Job plan materials | job_plan_materials in PM engine | ✅ Done |

### 2.13 Surplus & Disposal

| Feature | Maximo MAS | SAP MM/PM | HxGN Attune | IFS Cloud | GEMA | Priority |
|---|---|---|---|---|---|---|
| Surplus identification | Slow-mover analysis | Surplus stock | Surplus management | Excess stock ID | Not built | 🟡 Med |
| Disposal / write-off process | Disposal workflow | Scrapping process | Disposal | Write-off | Not built | 🟡 Med |
| Reorder recommendation | Reorder report | MRP proposals | Reorder warning | Suggestion list | Not built | 🟡 Med |

---

### Legend
- ✅ Done = Implemented in GEMA
- ✅ Partial = Partially implemented
- 🔴 High = Must have for inventory MVP
- 🟡 Med = Important for Phase 2
- 🟡 Low = Nice to have / Phase 3

---

## 3. GEMA Current State

### 3.1 What Already Exists

GEMA has the following inventory-related tables and features built:

| Component | Table / Code | Status |
|---|---|---|
| **Spare parts catalog** | `spare_parts` (part_num PK, description, uom, track_lots, track_serial) | ✅ Done |
| **Asset-BOM linking** | `asset_spare_parts` (asset_id ↔ part_num N:N) | ✅ Done |
| **Storeroom (warehouse)** | `storerooms` (warehouse_code, name, site_id) | ✅ Done |
| **Bin locations** | `storeroom_bins` (storeroom_id, bin_num) | ✅ Done |
| **Material requests (requisitions)** | `material_requests` (work_order_id, part_num, line_desc, requested_qty, req_num, req_line, is_non_stock) | ✅ Done |
| **Inventory transactions** | `inventory_transactions` (type: ISSUE/RETURN/DIRECT_ISSUE/RECEIPT, part_num, qty, storeroom_id, bin_id, lot_num, serial_num, reason_code, work_order_id) | ✅ Done |
| **Transaction type enum** | `transaction_type_enum` (ISSUE, RETURN, DIRECT_ISSUE, RECEIPT) | ✅ Done |
| **User profiles** | `user_profiles` (id, full_name, role, erp_employee_num) | ✅ Done |
| **Epicor Outbox** | `epicor_outbox` (event_type, payload, status, retry_count) for MATERIAL_REQUEST_CREATE | ✅ Done |
| **Trigger: material request → outbox** | `enqueue_material_request()` function | ✅ Done |
| **PM Engine material inheritance** | job_plan_materials → material_requests on PM generation | ✅ Done |

### 3.2 What's Missing Completely

| Missing Component | Business Impact | Effort |
|---|---|---|
| **Stock balance tracking** | No way to know current qty on hand | 🔴 Critical |
| **Reorder points / min-max** | No automatic replenishment triggers | 🔴 Critical |
| **ABC classification** | No inventory stratification for counting/control | 🔴 Critical |
| **Receiving process** | Can't record goods receipt against PO | 🔴 Critical |
| **Purchase orders** | No PO creation, no PO lifecycle | 🔴 Critical |
| **Suppliers** | No supplier master, no ASL | 🔴 Critical |
| **Cycle counting** | No continuous count schedules | 🔴 Critical |
| **Physical inventory** | No annual/full count process | 🔴 Critical |
| **Stock valuation** | No unit cost, no COGS, no valuation method | 🔴 Critical |
| **WO cost integration** | No estimated vs actual parts cost, no cost rollup | 🔴 Critical |
| **Stock transfers** | Can't move stock between storerooms/bins | 🔴 Critical |
| **Stock adjustments** | Can't correct count discrepancies | 🔴 Critical |
| **Reserved/allocated stock** | No ATP calculation without reservations | 🔴 Critical |
| **Condition codes** | Can't track serviceable vs unserviceable stock | 🔴 High |
| **Returnable/rotable tracking** | No repairable spare lifecycle | 🔴 High |
| **Consignment stock** | No supplier-owned stock tracking | 🟡 Med |
| **Kitting** | No kit/assembly definition or issue | 🟡 Med |
| **Serial number tracking** | track_serial flag exists but no actual serial tracking logic | 🟡 Med |
| **Lot/batch tracking** | track_lots flag exists but no lot tracking implementation | 🟡 Med |

### 3.3 Existing Schema (Current `inventory_transactions`)

```sql
CREATE TABLE public.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type transaction_type_enum NOT NULL,
  part_num TEXT REFERENCES public.spare_parts(part_num) ON DELETE SET NULL,
  qty NUMERIC NOT NULL CHECK (qty != 0),
  storeroom_id UUID REFERENCES public.storerooms(id) ON DELETE SET NULL,
  bin_id UUID REFERENCES public.storeroom_bins(id) ON DELETE SET NULL,
  lot_num TEXT,
  serial_num TEXT,
  reason_code TEXT,
  work_order_id TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Key issue:** The `inventory_transactions` table records movements but there is **no `inventory_balances`** table to aggregate current stock levels. To know the qty on hand of any part, you'd need to `SUM(qty)` from `inventory_transactions` — which is an O(n) scan and doesn't support reserved/on-order tracking.

---

## 4. Recommended Inventory Schema for GEMA

### 4.1 `item_master` — Enhanced spare parts catalog

```sql
CREATE TYPE item_type_enum AS ENUM (
  'CONSUMABLE',       -- Consumible (se consume al usar)
  'ROTABLE',          -- Rotativo (reparable, se intercambia)
  'NON_ROTABLE',      -- No rotativo (se repara pero no intercambia)
  'TOOL',             -- Herramienta
  'ASSEMBLY',         -- Kit / ensamble
  'SERVICE'           -- Servicio (no físico)
);

CREATE TYPE abc_class_enum AS ENUM ('A', 'B', 'C');

CREATE TYPE item_status_enum AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'OBSOLETE',
  'DISCONTINUED'
);

CREATE TYPE condition_code_enum AS ENUM (
  'SERVICEABLE',      -- Nuevo o reparado, apto para uso
  'UNSERVICEABLE',    -- Dañado, requiere reparación
  'CONDEMNED'         -- Irreparable, descarte
);

-- Extend spare_parts OR create new item_master view/table
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS item_type item_type_enum NOT NULL DEFAULT 'CONSUMABLE',
  ADD COLUMN IF NOT EXISTS abc_class abc_class_enum,
  ADD COLUMN IF NOT EXISTS min_stock NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock NUMERIC,
  ADD COLUMN IF NOT EXISTS reorder_point NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS safety_stock NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_status item_status_enum NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS unit_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC,      -- Moving average cost
  ADD COLUMN IF NOT EXISTS last_unit_cost NUMERIC,  -- Last purchase price
  ADD COLUMN IF NOT EXISTS std_cost NUMERIC,        -- Standard cost
  ADD COLUMN IF NOT EXISTS valuation_method TEXT DEFAULT 'AVERAGE'
    CHECK (valuation_method IN ('AVERAGE', 'STANDARD', 'FIFO')),
  ADD COLUMN IF NOT EXISTS condition_code condition_code_enum DEFAULT 'SERVICEABLE',
  ADD COLUMN IF NOT EXISTS is_consignment BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supplier_id UUID,        -- FK to suppliers
  ADD COLUMN IF NOT EXISTS commodity_group TEXT,    -- Commodity classification
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
```

### 4.2 `inventory_balances` — Current stock snapshot

```sql
CREATE TABLE public.inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_num TEXT NOT NULL REFERENCES public.spare_parts(part_num) ON DELETE CASCADE,
  storeroom_id UUID NOT NULL REFERENCES public.storerooms(id) ON DELETE CASCADE,
  bin_id UUID REFERENCES public.storeroom_bins(id) ON DELETE SET NULL,
  condition_code condition_code_enum NOT NULL DEFAULT 'SERVICEABLE',
  qty_on_hand NUMERIC NOT NULL DEFAULT 0,
  qty_reserved NUMERIC NOT NULL DEFAULT 0,
  qty_on_order NUMERIC NOT NULL DEFAULT 0,
  qty_in_transit NUMERIC NOT NULL DEFAULT 0,
  qty_available NUMERIC GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED,
  lot_num TEXT,
  serial_num TEXT,
  last_count_date TIMESTAMPTZ,
  last_move_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(part_num, storeroom_id, bin_id, condition_code)
);

CREATE INDEX idx_invbal_part ON public.inventory_balances(part_num);
CREATE INDEX idx_invbal_storeroom ON public.inventory_balances(storeroom_id);
CREATE INDEX idx_invbal_available ON public.inventory_balances(qty_available)
  WHERE qty_available < 0;
```

### 4.3 `inventory_transactions` — Enhanced (extend existing)

```sql
-- Add columns to existing inventory_transactions
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS qty_before NUMERIC,
  ADD COLUMN IF NOT EXISTS qty_after NUMERIC,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS condition_code condition_code_enum,
  ADD COLUMN IF NOT EXISTS reference_type TEXT
    CHECK (reference_type IN ('PO', 'WO', 'TRANSFER', 'COUNT', 'ADJUST')),
  ADD COLUMN IF NOT EXISTS reference_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID;
```

### 4.4 `purchase_orders` — PO master

```sql
CREATE TYPE po_status_enum AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED'
);

CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,
  supplier_id UUID REFERENCES public.suppliers(id),
  storeroom_id UUID REFERENCES public.storerooms(id),
  status po_status_enum NOT NULL DEFAULT 'DRAFT',
  order_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_date TIMESTAMPTZ,
  received_date TIMESTAMPTZ,
  total_cost NUMERIC,
  currency TEXT DEFAULT 'MXN',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Synced from Epicor
  epicor_po_num INT,
  sync_status TEXT DEFAULT 'LOCAL' CHECK (sync_status IN ('LOCAL', 'PENDING_SYNC', 'SYNCED'))
);

CREATE INDEX idx_po_status ON public.purchase_orders(status);
CREATE INDEX idx_po_supplier ON public.purchase_orders(supplier_id);
```

### 4.5 `po_lines` — PO line items

```sql
CREATE TABLE public.po_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  line_num INT NOT NULL,
  part_num TEXT REFERENCES public.spare_parts(part_num) ON DELETE SET NULL,
  line_desc TEXT NOT NULL,
  qty_ordered NUMERIC NOT NULL CHECK (qty_ordered > 0),
  qty_received NUMERIC NOT NULL DEFAULT 0,
  qty_accepted NUMERIC NOT NULL DEFAULT 0,
  qty_rejected NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL,
  line_total NUMERIC GENERATED ALWAYS AS (unit_price * qty_ordered) STORED,
  tax_amount NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  expected_date TIMESTAMPTZ,
  storeroom_id UUID REFERENCES public.storerooms(id),
  bin_id UUID REFERENCES public.storeroom_bins(id),
  received_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(po_id, line_num)
);

CREATE INDEX idx_polines_po ON public.po_lines(po_id);
CREATE INDEX idx_polines_part ON public.po_lines(part_num);
```

### 4.6 `suppliers` — Supplier master

```sql
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  lead_time_days INT DEFAULT 0,
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  payment_terms TEXT,
  currency TEXT DEFAULT 'MXN',
  notes TEXT,
  min_order_amount NUMERIC DEFAULT 0,
  -- Epicor integration
  epicor_vendor_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.7 `supplier_parts` — Approved parts per supplier

```sql
CREATE TABLE public.supplier_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  part_num TEXT NOT NULL REFERENCES public.spare_parts(part_num) ON DELETE CASCADE,
  supplier_part_num TEXT,       -- Supplier's internal part number
  unit_price NUMERIC,            -- Last/negotiated price
  lead_time_days INT,
  min_order_qty NUMERIC DEFAULT 1,
  is_preferred BOOLEAN DEFAULT FALSE,
  UNIQUE(supplier_id, part_num)
);
```

### 4.8 `cycle_count_schedules` — Cycle count plan

```sql
CREATE TYPE count_status_enum AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'APPROVED'
);

CREATE TABLE public.cycle_count_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_num TEXT NOT NULL REFERENCES public.spare_parts(part_num) ON DELETE CASCADE,
  storeroom_id UUID NOT NULL REFERENCES public.storerooms(id) ON DELETE CASCADE,
  bin_id UUID REFERENCES public.storeroom_bins(id) ON DELETE SET NULL,
  abc_class abc_class_enum,
  count_frequency_days INT NOT NULL,
  last_count_date TIMESTAMPTZ,
  next_count_date TIMESTAMPTZ GENERATED ALWAYS AS
    (last_count_date + (count_frequency_days || ' days')::INTERVAL) STORED,
  assigned_to UUID,               -- Who should count it
  status count_status_enum NOT NULL DEFAULT 'PENDING',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ccs_next ON public.cycle_count_schedules(next_count_date)
  WHERE is_active = true AND status = 'PENDING';
CREATE INDEX idx_ccs_part ON public.cycle_count_schedules(part_num);
```

### 4.9 `cycle_count_sheets` — Count record

```sql
CREATE TABLE public.cycle_count_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.cycle_count_schedules(id),
  part_num TEXT NOT NULL REFERENCES public.spare_parts(part_num),
  storeroom_id UUID NOT NULL REFERENCES public.storerooms(id),
  bin_id UUID REFERENCES public.storeroom_bins(id),
  expected_qty NUMERIC NOT NULL,      -- System qty before count
  counted_qty NUMERIC,                 -- Actual physical count
  variance NUMERIC GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  variance_reason TEXT,
  counted_by UUID,
  counted_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  is_blind BOOLEAN DEFAULT FALSE,     -- Count without seeing expected qty
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.10 `stock_transfers` — Inter-storeroom transfers

```sql
CREATE TYPE transfer_status_enum AS ENUM (
  'PENDING',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED'
);

CREATE TABLE public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_num TEXT NOT NULL UNIQUE,
  part_num TEXT NOT NULL REFERENCES public.spare_parts(part_num),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  from_storeroom_id UUID NOT NULL REFERENCES public.storerooms(id),
  to_storeroom_id UUID NOT NULL REFERENCES public.storerooms(id),
  from_bin_id UUID REFERENCES public.storeroom_bins(id),
  to_bin_id UUID REFERENCES public.storeroom_bins(id),
  status transfer_status_enum NOT NULL DEFAULT 'PENDING',
  requested_by UUID,
  approved_by UUID,
  received_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

---

## 5. Replenishment Logic

### 5.1 Min/Max Reorder (Simple — MVP)

```sql
-- Find items that need reordering
SELECT
  sp.part_num,
  sp.description,
  sp.min_stock,
  sp.max_stock,
  sp.reorder_point,
  sp.reorder_qty,
  ib.qty_on_hand,
  ib.qty_reserved,
  (ib.qty_on_hand - ib.qty_reserved) AS qty_available,
  sp.lead_time_days,
  -- Recommended order qty
  CASE
    WHEN sp.reorder_qty IS NOT NULL THEN sp.reorder_qty
    WHEN sp.max_stock IS NOT NULL THEN GREATEST(sp.max_stock - (ib.qty_on_hand - ib.qty_reserved), 0)
    ELSE sp.reorder_point * 2
  END AS suggested_order_qty
FROM public.spare_parts sp
JOIN public.inventory_balances ib ON ib.part_num = sp.part_num
WHERE sp.item_status = 'ACTIVE'
  AND (ib.qty_on_hand - ib.qty_reserved) <= sp.reorder_point;
```

**Algorithm:**
1. Compute `qty_available = qty_on_hand - qty_reserved`
2. If `qty_available <= reorder_point`:
   - If `reorder_qty` is set → order `reorder_qty`
   - Else if `max_stock` is set → order `max_stock - qty_available`
   - Else → order `reorder_point × 2` (fallback)
3. Generate a `purchase_orders` row in DRAFT status
4. Create `epicor_outbox` event for downstream processing

### 5.2 Lead Time Safety Stock

```sql
-- Safety stock based on lead time and average daily usage
WITH daily_usage AS (
  SELECT
    part_num,
    (SUM(ABS(qty)) / 90.0) AS avg_daily_usage  -- Last 90 days
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND created_at >= NOW() - INTERVAL '90 days'
  GROUP BY part_num
)
SELECT
  sp.part_num,
  sp.lead_time_days,
  du.avg_daily_usage,
  -- Safety stock: z-score × sqrt(lead_time) × avg_daily_usage
  -- z = 1.65 (95% service level), 2.33 (99%)
  ROUND(1.65 * SQRT(sp.lead_time_days) * du.avg_daily_usage) AS suggested_safety_stock,
  -- Reorder point: (avg_daily_usage × lead_time_days) + safety_stock
  ROUND((du.avg_daily_usage * sp.lead_time_days) +
    (1.65 * SQRT(sp.lead_time_days) * du.avg_daily_usage)) AS suggested_reorder_point
FROM daily_usage du
JOIN spare_parts sp ON sp.part_num = du.part_num
WHERE sp.lead_time_days > 0 AND du.avg_daily_usage > 0;
```

**Formula used:**

```
Safety Stock = Z × σ_d × √(LT)
Reorder Point = (d_avg × LT) + Safety Stock
```

Where:
- `Z` = Service level factor (1.65 for 95%, 2.33 for 99%)
- `σ_d` = Standard deviation of daily demand (approximated as 0.5 × avg_daily_usage for simplicity)
- `LT` = Lead time in days
- `d_avg` = Average daily usage (last 90 days rolling)

### 5.3 ABC Classification Logic

```sql
-- ABC classification based on annual consumption value
WITH annual_value AS (
  SELECT
    it.part_num,
    SUM(ABS(it.qty) * COALESCE(sp.unit_cost, sp.last_unit_cost, 0)) AS annual_consumption_value
  FROM inventory_transactions it
  JOIN spare_parts sp ON sp.part_num = it.part_num
  WHERE it.transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND it.created_at >= NOW() - INTERVAL '365 days'
  GROUP BY it.part_num
),
cumulative AS (
  SELECT
    part_num,
    annual_consumption_value,
    SUM(annual_consumption_value) OVER (ORDER BY annual_consumption_value DESC) AS running_total,
    SUM(annual_consumption_value) OVER () AS grand_total
  FROM annual_value
)
SELECT
  part_num,
  annual_consumption_value,
  ROUND(100.0 * running_total / grand_total, 1) AS cumulative_percent,
  CASE
    WHEN running_total / grand_total <= 0.80 THEN 'A'
    WHEN running_total / grand_total <= 0.95 THEN 'B'
    ELSE 'C'
  END AS abc_class
FROM cumulative
ORDER BY annual_consumption_value DESC;
```

**ABC rules for cycle counting:**

| Class | % of Items | % of Value | Count Frequency | Tolerancia de Variación |
|---|---|---|---|---|
| **A** | ~10-20% | ~80% | **Monthly** (every 30 days) | ±0.5% |
| **B** | ~30% | ~15% | **Quarterly** (every 90 days) | ±1.0% |
| **C** | ~50-60% | ~5% | **Annually** (every 365 days) | ±2.0% |

### 5.4 Updating Inventory Balances (Trigger)

```sql
-- After INSERT on inventory_transactions, update inventory_balances
CREATE OR REPLACE FUNCTION update_inventory_balances()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory_balances (
    part_num, storeroom_id, bin_id, condition_code,
    qty_on_hand, last_move_date
  ) VALUES (
    NEW.part_num, NEW.storeroom_id, NEW.bin_id,
    COALESCE(NEW.condition_code, 'SERVICEABLE'),
    NEW.qty, NOW()
  )
  ON CONFLICT (part_num, storeroom_id, bin_id, condition_code)
  DO UPDATE SET
    qty_on_hand = inventory_balances.qty_on_hand + NEW.qty,
    last_move_date = NOW(),
    updated_at = NOW();

  -- Update unit cost on RECEIPT (moving average)
  IF NEW.transaction_type = 'RECEIPT' AND NEW.unit_cost IS NOT NULL THEN
    UPDATE spare_parts
    SET unit_cost = (
      (COALESCE(unit_cost, 0) * qty_on_hand + NEW.unit_cost * ABS(NEW.qty))
      /
      (qty_on_hand + ABS(NEW.qty))
    ),
    last_unit_cost = NEW.unit_cost
    WHERE part_num = NEW.part_num;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 6. Integration with Work Orders

### 6.1 WO → Material Request → Reservation → Issue → Actual Cost

```
Work Order
    │
    ├── Job Plan Materials (template)
    │       │
    │       └── INHERIT → material_requests (on PM generation)
    │
    ├── Manual material_requests (user adds)
    │       │
    │       ├── part_num + requested_qty
    │       └── is_non_stock = true (description only)
    │
    ├── Reservation (implicit or explicit)
    │       │
    │       ├── Sets qty_reserved in inventory_balances
    │       └── Decreases qty_available (ATP)
    │
    ├── Issue (inventory_transactions: ISSUE)
    │       │
    │       ├── Decreases qty_on_hand in inventory_balances
    │       ├── Decreases qty_reserved
    │       └── unit_cost captured for WO costing
    │
    ├── Return (inventory_transactions: RETURN)
    │       │
    │       ├── Increases qty_on_hand
    │       └── Reverses cost in WO
    │
    └── WO Cost Summary
            │
            ├── estimated_parts_cost = SUM(material_requests.requested_qty * part.unit_cost)
            ├── actual_parts_cost = SUM(ISSUE transactions.unit_cost * qty)
            └── variance = actual - estimated
```

### 6.2 Schema Changes Needed on Work Orders

```sql
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS estimated_parts_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_parts_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_labor_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_labor_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC GENERATED ALWAYS AS
    (COALESCE(actual_parts_cost, 0) + COALESCE(actual_labor_cost, 0)) STORED;
```

### 6.3 WO Cost Rollup Function

```sql
CREATE OR REPLACE FUNCTION rollup_work_order_cost(wo_id TEXT)
RETURNS void AS $$
BEGIN
  -- Actual parts cost = sum of all ISSUE transactions for this WO
  UPDATE work_orders
  SET actual_parts_cost = (
    SELECT COALESCE(SUM(ABS(qty) * unit_cost), 0)
    FROM inventory_transactions
    WHERE work_order_id = wo_id
      AND transaction_type = 'ISSUE'
  ),
  -- Estimated parts cost = sum of all material requests × unit cost
  estimated_parts_cost = (
    SELECT COALESCE(SUM(mr.requested_qty * COALESCE(sp.unit_cost, sp.last_unit_cost, 0)), 0)
    FROM material_requests mr
    LEFT JOIN spare_parts sp ON sp.part_num = mr.part_num
    WHERE mr.work_order_id = wo_id
  )
  WHERE id = wo_id;
END;
$$ LANGUAGE plpgsql;
```

### 6.4 Lifecycle Gating (FSM Integration)

The inventory module should enforce gating at specific WO lifecycle transitions:

Transition | Inventory Gate
---|---
`WAPPR → APPROVED` | All material_requests must have valid part_num (or is_non_stock = true)
`APPROVED → INPRG` | Available stock must be sufficient for critical parts (failure_class items) or PO must exist
`INPRG → COMP` | All issued materials must be accounted for (no open returns)
`COMP → CLOSED` | Cost rollup must be complete, all returns processed

---

## 7. Integration with Epicor Outbox

### 7.1 Current Outbox Pattern

GEMA's `epicor_outbox` table already implements the Transactional Outbox Pattern:

```sql
CREATE TABLE epicor_outbox (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,    -- e.g., 'MATERIAL_REQUEST_CREATE'
  payload JSONB NOT NULL,      -- { material_request_id, work_order_id, part_num, ... }
  status TEXT NOT NULL DEFAULT 'PENDING',
  retry_count INT DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);
```

Currently only `MATERIAL_REQUEST_CREATE` is enqueued. The inventory expansion requires additional event types.

### 7.2 New Outbox Event Types

| Event Type | Trigger | Payload Includes |
|---|---|---|
| `MATERIAL_REQUEST_CREATE` | INSERT on material_requests | `{ material_request_id, work_order_id, part_num, requested_qty, line_desc }` |
| `STOCK_INVENTORY_UPDATE` | INSERT on inventory_transactions (RECEIPT/ADJUST/COUNT) | `{ part_num, transaction_type, qty_after, storeroom_id, timestamp }` |
| `STOCK_LEVEL_SYNC` | Scheduled (nightly) or manual | `{ part_num, qty_on_hand, qty_reserved, storeroom_id, timestamp }` |
| `PO_CREATE` | INSERT on purchase_orders | `{ po_number, supplier_code, lines: [{ part_num, qty, price }], expected_date }` |
| `PO_STATUS_CHANGE` | UPDATE on purchase_orders.status | `{ po_number, old_status, new_status, timestamp }` |
| `INVENTORY_ADJUSTMENT` | INSERT on inventory_transactions (ADJUST) | `{ part_num, qty_before, qty_after, reason_code, timestamp }` |
| `CYCLE_COUNT_COMPLETE` | UPDATE on cycle_count_sheets.status | `{ part_num, expected_qty, counted_qty, variance, storeroom }` |
| `SUPPLIER_UPDATE` | INSERT/UPDATE on suppliers | `{ supplier_code, name, is_approved, lead_time }` |

### 7.3 Stock Level Sync Function

```sql
CREATE OR REPLACE FUNCTION enqueue_stock_level_sync()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT part_num, qty_on_hand, qty_reserved, storeroom_id
    FROM inventory_balances
    WHERE qty_on_hand > 0 OR qty_reserved > 0
  LOOP
    INSERT INTO epicor_outbox (event_type, payload)
    VALUES (
      'STOCK_LEVEL_SYNC',
      jsonb_build_object(
        'part_num', r.part_num,
        'qty_on_hand', r.qty_on_hand,
        'qty_reserved', r.qty_reserved,
        'qty_available', r.qty_on_hand - r.qty_reserved,
        'storeroom_code', (SELECT warehouse_code FROM storerooms WHERE id = r.storeroom_id),
        'timestamp', NOW()
      )
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### 7.4 Epicor Webhook → Inventory Update

The existing `epicor-webhook` Supabase function should be extended to handle inventory sync from Epicor:

```typescript
// In supabase/functions/epicor-webhook/index.ts
// New event handlers for inventory sync:

async function handleStockSync(payload: any) {
  // Epicor sends current stock levels for parts
  // → Update inventory_balances.qty_on_hand
  // → Only if GEMA is in "Epicor-master" mode for stock
}

async function handlePOFromEpicor(payload: any) {
  // Epicor sends PO that was created from a material request
  // → Update purchase_orders with Epicor PO number
  // → Link material_requests.req_num / req_line
  // → Update inventory_balances.qty_on_order
}

async function handleReceiptConfirmation(payload: any) {
  // Epicor confirms receipt was processed
  // → Create RECEIPT inventory_transaction in GEMA
  // → Update inventory_balances
}
```

### 7.5 Sync Modes

| Mode | Direction | Description |
|---|---|---|
| **Epicor-master stock** | Epicor → GEMA | GEMA reads stock levels from Epicor (read-only). GEMA issues are pushed as material requests; receipts come from Epicor. |
| **GEMA-master stock** | GEMA → Epicor | GEMA is the system of record for inventory. All transactions push to Epicor. Selected for plants running GEMA as primary for MRO. |
| **Hybrid** | Bidirectional | GEMA manages storeroom/bin level inventory; Epicor manages financial/corporate stock. Stock levels sync nightly. |

---

## 8. Roadmap Estimate — Phases to Implement Full Inventory Module

### Phase 0: Foundation (MVP) — 1 Sprint

**Goal:** Core stock tracking — know what you have and where.

| Task | Tables / Code | Effort |
|---|---|---|
| Create `inventory_balances` table | Migration | 1 day |
| Add columns to `spare_parts` (min_stock, max_stock, reorder_point, etc.) | Migration | 1 day |
| Add columns to `inventory_transactions` (unit_cost, reference_type, qty_before/after) | Migration | 1 day |
| Trigger: `update_inventory_balances()` on INSERT transactions | PL/pgSQL | 1 day |
| Backfill: create initial inventory_balances from existing transactions | Migration script | 1 day |
| Seed transaction type: adjust `transaction_type_enum` to add TRANSFER, ADJUST, COUNT | Migration | 0.5 day |
| Simple stock status page (read-only: part, location, qty_on_hand, qty_reserved) | React | 3 days |
| **Total Phase 0** | | **~7-8 days (1 sprint)** |

### Phase 1: Replenishment & Purchasing — 2 Sprints

**Goal:** Create purchase orders, track receipts, auto-replenish.

| Task | Tables / Code | Effort |
|---|---|---|
| Create `suppliers` table | Migration | 1 day |
| Create `supplier_parts` table | Migration | 0.5 day |
| Create `purchase_orders` table | Migration | 1 day |
| Create `po_lines` table | Migration | 0.5 day |
| Supplier CRUD UI | React | 3 days |
| PO creation UI (manual) | React | 4 days |
| PO line item management UI | React | 3 days |
| Goods receipt transaction flow (receive PO → create RECEIPT → update balances) | React + PL/pgSQL | 3 days |
| Reorder point check (manual trigger + UI) | SQL + React | 2 days |
| Min/max compliance report | SQL + React | 2 days |
| Epicor Outbox: STOCK_LEVEL_SYNC, PO_CREATE, PO_STATUS_CHANGE | PL/pgSQL | 2 days |
| **Total Phase 1** | | **~22 days (2 sprints)** |

### Phase 2: ABC, Cycle Counting & Physical Inventory — 1 Sprint

**Goal:** Inventory accuracy through continuous counting.

| Task | Tables / Code | Effort |
|---|---|---|
| Create `cycle_count_schedules` table | Migration | 0.5 day |
| Create `cycle_count_sheets` table | Migration | 0.5 day |
| ABC classification query + UI | SQL + React | 2 days |
| Cycle count schedule generation (auto per ABC class) | PL/pgSQL | 1 day |
| Count sheet assignment and tracking UI | React | 4 days |
| Count entry (mobile-friendly) | React | 3 days |
| Count approval workflow | React + DB | 2 days |
| Variance posting (adjust on approval) | PL/pgSQL | 1 day |
| Epicor Outbox: CYCLE_COUNT_COMPLETE | PL/pgSQL | 1 day |
| **Total Phase 2** | | **~15 days (1 sprint)** |

### Phase 3: Valuation, Transfers & Costing — 1 Sprint

**Goal:** Financial-grade inventory with WO cost integration.

| Task | Tables / Code | Effort |
|---|---|---|
| Moving average cost trigger on RECEIPT | PL/pgSQL | 1 day |
| Cost columns on work_orders (estimated_parts_cost, actual_parts_cost) | Migration | 0.5 day |
| WO cost rollup function + trigger | PL/pgSQL | 1 day |
| Issue at unit cost → actual_parts_cost updated | Transaction logic | 1 day |
| Create `stock_transfers` table | Migration | 0.5 day |
| Transfer workflow (issue from source → receive at destination) | React + DB | 4 days |
| Inventory valuation report (cost × qty) | SQL + React | 2 days |
| Stockout / shortage alerts | SQL + Notification | 1 day |
| **Total Phase 3** | | **~11 days (1 sprint)** |

### Phase 4: Advanced — 2 Sprints

**Goal:** Consignment, kitting, serial/lot tracking, supplier collaboration.

| Task | Tables / Code | Effort |
|---|---|---|
| Consignment stock (is_consignment flag + special receipts) | PL/pgSQL | 2 days |
| Kit/assembly definition and explosion | Tables + logic | 3 days |
| Serial number tracking (actual tracking, not just flag) | Tables + UI | 4 days |
| Lot/batch tracking (receive lot → issue from lot) | Tables + UI | 3 days |
| Condition code lifecycle (serviceable → unserviceable → condemned) | Workflow | 2 days |
| Returnable / rotable tracking (repair cycle) | Workflow + UI | 4 days |
| Supplier collaboration portal / ASN | Extension | 4 days |
| Inventory dashboard (stock turns, fill rate, stockout %) | React + Charts | 3 days |
| **Total Phase 4** | | **~25 days (2 sprints)** |

### Summary Roadmap

```
Phase 0: Foundation (MVP)          Sprint 1    → Jul 2026
Phase 1: Replenishment & Purchasing Sprint 2-3  → Aug 2026
Phase 2: ABC & Cycle Counting      Sprint 4    → Sep 2026
Phase 3: Valuation & Costing       Sprint 5    → Sep/Oct 2026
Phase 4: Advanced Features         Sprint 6-7  → Oct/Nov 2026
```

**Total: ~7 sprints (5 months) for full inventory module parity with mid-tier EAM.**

### Architectural Principles

1. **Offline-First**: All inventory tables must be syncable via RxDB (needs `_deleted`, `_last_modified` columns and corresponding RxDB schemas).
2. **Epicor Integration**: Every state change produces an `epicor_outbox` event. GEMA never writes directly to Epicor.
3. **Audit Trail**: `inventory_transactions` is append-only. Never UPDATE or DELETE transactions — only INSERT. Corrections are new ADJUST transactions.
4. **Cost Consistency**: Unit cost is a function of valuation method (moving average by default). Never allow manual override of unit_cost without audit trail.
5. **Lifecycle Gating**: Inventory constraints gate at specific WO lifecycle transitions (see 6.4), not at arbitrary states.

---

*Document generated: 2026-05-25*
