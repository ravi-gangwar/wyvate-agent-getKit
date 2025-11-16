// This file describes the database schema in a way that the AI can use
// to generate correct SQL queries. Keep it simple and descriptive.

const vendorVendormodelSchema = `
Table: vendor_vendormodel
Columns:
- store_name (text): Name of the vendor/store
- city (text): City where the vendor is located
- vendor_rating (numeric, nullable): Average rating of the vendor
- online (boolean): Whether the vendor is currently online/accepting orders
- latitude (real): Latitude of the vendor's location
- longitude (real): Longitude of the vendor's location

Usage notes:
- For nearby search, use latitude/longitude ranges with real numbers.
- Typical radius logic: latitude BETWEEN {lat-0.1} AND {lat+0.1} AND longitude BETWEEN {lng-0.1} AND {lng+0.1}.
- Always include LIMIT 10 in queries unless specifically requested otherwise.
`;

const vendorServiceSchema = `
Table: vendor_vendorservice (aliased as vvs in queries)
Important columns:
- id (integer): Primary key
- vendor_id_id (integer): Related vendor id
- vendor_category_id_id (integer): Category id
- vendor_service_id_id (integer): Service id
- price (numeric): Service price
- discount (numeric, nullable)
- discount_type (text, nullable)
- priority (integer): Priority for ordering
- approved (text): '1' means approved
- active (boolean): True means active
- eye_toggle (boolean): True means visible

Common filters:
- approved = '1'
- active = true
- price IS NOT NULL AND price > 0
- eye_toggle = true
`;

const categorySchema = `
Table: vendor_vendorcategory (vvc)
- id (integer)
- vendor_id_id (integer): Vendor id
- category_id_id (integer): Category id
- approved (text): '1' means approved
- active (boolean)
- priority (integer): Category priority

Table: admin_app_categorymodel (aacm)
- id (integer)
- name (text): Category name
`;

const serviceInfoSchema = `
Table: admin_app_servicemodel (aasm)
- id (integer)
- name (text): Service name
- veg (boolean): True if veg, false if non-veg
`;

const addonSchema = `
Table: vendor_addongroup (vag)
- id (integer)
- vendor_service_id_id (integer)
- name (text): Addon group name
- addon_group_type (text)
- max_select (integer)

Table: vendor_vendoraddongroup (vvag)
- id (integer)
- group_id_id (integer): References addon group

Table: vendor_vendoraddon (vva)
- id (integer)
- vendor_add_on_id_id (integer)
- price (numeric)
- approved (text): '1' means approved
- active (boolean)

Table: admin_app_addonmodel (aadm)
- id (integer)
- name (text): Addon name
`;

const offerSchema = `
Table: vendor_offermodel (vo)
- id (integer)
- percentage_bar (numeric)
- price_upto (numeric)
- new_user (boolean)
- start_date (date)
- expire_date (date, nullable)
- redeem_limit (integer)
- redeem_limit_per_user (integer)
- coupon_code (text)
- vendor_id_id (integer)
- active (boolean)
- created_at (timestamp)
- updated_at (timestamp)
- is_deleted (boolean)
- is_admin (boolean)
- coupon_name (text)
- min_order_amount (numeric)
- radius (numeric)
- buy (integer)
- get (integer)
- flat_discount_amount (numeric)
- type (text)
- days (text or array)
- end_time (time)
- start_time (time)
- trigger_service (boolean): true if this offer is a trigger-based offer (can be ignored for simple queries)

Table: vendor_offerservice (vos)
- id (integer)
- offer_id_id (integer)
- service_id_id (integer)
`;

const dbSchema = `
DATABASE SCHEMA OVERVIEW

1) Core vendor table
${vendorVendormodelSchema}

2) Services and categories
${vendorServiceSchema}
${categorySchema}
${serviceInfoSchema}

3) Addons
${addonSchema}

4) Offers and triggers
${offerSchema}

Guidance for AI when generating SQL:
- Always use actual values, not placeholders (no '?', use concrete numbers/strings).
- Prefer LIMIT 10 unless the user explicitly asks for more.
- For nearby vendor search, use latitude/longitude range filters on vendor_vendormodel.
- For menu/services, join vendor_vendorservice (vvs) with vendor_vendorcategory (vvc), admin_app_categorymodel (aacm), admin_app_servicemodel (aasm), addon tables, and offer tables as needed.
- To fetch services/items for a particular vendor, filter vendor_vendorservice by vendor_id_id = {vendor_id} and join with admin_app_servicemodel (aasm) to get service names and veg flag.
- Keep queries as simple as possible while still answering the user question.
`;

export default dbSchema;