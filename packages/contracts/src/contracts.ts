/**
 * Central contract registry
 * Re-exports version routers
 */

// V1 contracts (routers)
export { v1Contract } from "./modules/v1/v1.contract.js"
export type { V1Contract } from "./modules/v1/v1.contract.js"

// Service catalog contracts + schemas
export { servicesContract } from "./modules/v1/services/services.contract.js"
export {
	ServiceCategorySchema,
	ServiceSchema,
	CreateServiceSchema,
	ServiceIdParamSchema,
	UpdateServiceRequestSchema,
	SetServiceActiveRequestSchema,
} from "./modules/v1/services/services.schema.js"
export type {
	ServiceCategory,
	Service,
	CreateServiceInput,
	UpdateServiceRequest,
} from "./modules/v1/services/services.schema.js"

// Booking contracts + schemas
export { bookingsContract } from "./modules/v1/bookings/bookings.contract.js"
export {
	BOOKING_STATUSES,
	BOOKING_KINDS,
	BOOKING_ITEM_STATUSES,
	REFERENCE_NUMBER_PATTERN,
	BookingStatusSchema,
	BookingKindSchema,
	BookingItemStatusSchema,
	ReferenceNumberSchema,
	BookingItemSchema,
	BookingSchema,
	CreateBookingSchema,
} from "./modules/v1/bookings/bookings.schema.js"
export type {
	BookingStatus,
	BookingKind,
	BookingItemStatus,
	BookingItem,
	Booking,
	CreateBookingInput,
} from "./modules/v1/bookings/bookings.schema.js"

// Payment contracts + schemas
export { paymentsContract } from "./modules/v1/payments/payments.contract.js"
export {
	PAYMENT_STATUSES,
	PaymentStatusSchema,
	PaymentCodeSchema,
	CreatePaymentSchema,
	PaymentCheckoutSchema,
	PaymentIdParamSchema,
	PaymentStatusResponseSchema,
	ReceiptTokenSchema,
	ReceiptTokenParamSchema,
	ReceiptVerificationSchema,
} from "./modules/v1/payments/payments.schema.js"
export type {
	PaymentStatus,
	CreatePaymentInput,
	PaymentCheckout,
	PaymentStatusResponse,
	ReceiptVerification,
} from "./modules/v1/payments/payments.schema.js"

// Processing contracts + schemas (PRC-1)
export { processingContract } from "./modules/v1/processing/processing.contract.js"
export {
	ASSESSMENT_OUTCOMES,
	MAX_ASSESSMENT_NOTES_LENGTH,
	MAX_CORRECTIONS,
	AssessmentOutcomeSchema,
	QueuePaymentStatusSchema,
	ProcessingQueueRequestSchema,
	QueueItemSchema,
	ProcessingQueueSchema,
	CheckInSchema,
	BookingItemIdParamSchema,
	RecordAssessmentSchema,
	AssessmentSchema,
	ProcessingItemSchema,
	CheckInResponseSchema,
} from "./modules/v1/processing/processing.schema.js"
export type {
	AssessmentOutcome,
	QueuePaymentStatus,
	ProcessingQueueRequest,
	QueueItem,
	ProcessingQueue,
	CheckInInput,
	BookingItemIdParam,
	RecordAssessmentInput,
	Assessment,
	ProcessingItem,
	CheckInResponse,
} from "./modules/v1/processing/processing.schema.js"

// Certificates contracts + schemas (CRT-1, CRT-2)
export { certificatesContract } from "./modules/v1/certificates/certificates.contract.js"
export {
	DOCUMENT_TYPES,
	VERIFICATION_CODE_LENGTH,
	DocumentTypeSchema,
	DocumentStatusSchema,
	IcvIssueDetailsSchema,
	IssueDocumentSchema,
	DocumentSummarySchema,
	MyDocumentsSchema,
	DocumentTokenSchema,
	DocumentTokenParamSchema,
	ManualVerificationSchema,
	DocumentVerificationSchema,
} from "./modules/v1/certificates/certificates.schema.js"
export type {
	DocumentType,
	DocumentStatus,
	IcvIssueDetails,
	IssueDocumentInput,
	DocumentSummary,
	MyDocuments,
	ManualVerificationInput,
	DocumentVerification,
} from "./modules/v1/certificates/certificates.schema.js"

// Schedule slot contracts + schemas
export { schedulesContract } from "./modules/v1/schedules/schedules.contract.js"
export {
	MAX_GENERATE_DAYS,
	BusinessDateSchema,
	BusinessMonthSchema,
	TimeWindowSchema,
	ScheduleSlotSchema,
	GenerateSlotsSchema,
	GenerateSlotsResponseSchema,
	ListSlotsRequestSchema,
	SlotIdParamSchema,
	UpdateSlotCapacityRequestSchema,
	SetSlotDisabledRequestSchema,
	DeleteSlotResponseSchema,
	SlotAvailabilitySchema,
} from "./modules/v1/schedules/schedules.schema.js"
export type {
	TimeWindow,
	ScheduleSlot,
	GenerateSlotsInput,
	GenerateSlotsResponse,
	ListSlotsRequest,
	UpdateSlotCapacityRequest,
	SetSlotDisabledRequest,
	SlotAvailability,
} from "./modules/v1/schedules/schedules.schema.js"

// RBAC catalog (shared constants, enums, types)
export * from "./modules/v1/rbac/rbac.catalog.js"

// Location management contracts + schemas
export { locationsContract } from "./modules/v1/locations/locations.contract.js"
export {
	LocationSchema,
	CreateLocationSchema,
	LocationCodeParamSchema,
	UpdateLocationRequestSchema,
	SetLocationActiveRequestSchema,
	DeleteLocationResponseSchema,
} from "./modules/v1/locations/locations.schema.js"
export type {
	Location,
	CreateLocationInput,
	UpdateLocationRequest,
} from "./modules/v1/locations/locations.schema.js"

// Policy management contracts + registry + schemas (ADM-6, ADM-8)
export { policiesContract } from "./modules/v1/policies/policies.contract.js"
export {
	POLICY_AREAS,
	POLICY_AREA_LABELS,
	POLICY_DEFINITIONS,
	POLICY_KEYS,
	POLICY_TEXT_FORMATS,
	getPolicyDefinition,
	isPolicyKey,
	policyValueSchema,
	validatePolicyValue,
} from "./modules/v1/policies/policies.registry.js"
export type {
	AnyPolicyValue,
	PolicyArea,
	PolicyDefinition,
	PolicyKey,
	PolicyTextFormat,
	PolicyType,
	PolicyValidation,
	PolicyValue,
	IntegerPolicyDefinition,
	BooleanPolicyDefinition,
	TextPolicyDefinition,
} from "./modules/v1/policies/policies.registry.js"
export {
	PolicyKeySchema,
	PolicyValueSchema,
	PolicySchema,
	UpdatePolicyRequestSchema,
} from "./modules/v1/policies/policies.schema.js"
export type { Policy, UpdatePolicyRequest } from "./modules/v1/policies/policies.schema.js"

// Written policies accepted at booking (ADM-9)
export { policyDocumentsContract } from "./modules/v1/policies/policy-documents.contract.js"
export {
	MAX_POLICY_TITLE_LENGTH,
	MAX_POLICY_BODY_LENGTH,
	MAX_POLICY_SERVICES,
	POLICY_DOCUMENT_STATES,
	PolicyEffectiveDateSchema,
	PolicyDocumentKeySchema,
	PolicyDocumentStateSchema,
	PolicyDocumentSummarySchema,
	PolicyDocumentSchema,
	CreatePolicyDocumentSchema,
	UpdatePolicyDocumentSchema,
	PolicyDocumentKeyParamSchema,
	ApplicablePoliciesRequestSchema,
} from "./modules/v1/policies/policy-documents.schema.js"
export type {
	PolicyDocumentState,
	PolicyDocumentSummary,
	PolicyDocument,
	CreatePolicyDocumentInput,
	UpdatePolicyDocumentInput,
	ApplicablePoliciesRequest,
} from "./modules/v1/policies/policy-documents.schema.js"

// Help desk contacts contract + schema (ADM-8)
export { supportContract } from "./modules/v1/support/support.contract.js"
export { SupportContactsSchema } from "./modules/v1/support/support.schema.js"
export type { SupportContacts } from "./modules/v1/support/support.schema.js"

// RBAC administration contract + schemas
export { rbacContract } from "./modules/v1/rbac/rbac.contract.js"
export {
	RoleSchema,
	CreateRoleSchema,
	UpdateRoleRequestSchema,
	SetRolePermissionsRequestSchema,
	RoleIdSchema,
	DeleteRoleResponseSchema,
	PermissionSchema,
	UserWithRolesSchema,
	AssignRoleRequestSchema,
	RemoveRoleRequestSchema,
	UserRoleMutationResponseSchema,
	AuditOutcomeSchema,
	AuditLogEntrySchema,
	AuditLogEntryDetailSchema,
	AuditLogFilterSchema,
	AuditExportFormatSchema,
	AuditLogIdParamSchema,
	ListAuditLogRequestSchema,
	ListAuditLogResponseSchema,
	ExportAuditLogRequestSchema,
	ExportAuditLogResponseSchema,
} from "./modules/v1/rbac/rbac.schema.js"
export type {
	Role,
	CreateRoleInput,
	UpdateRoleRequest,
	SetRolePermissionsRequest,
	PermissionCatalogEntry,
	UserWithRoles,
	AssignRoleRequest,
	RemoveRoleRequest,
	AuditOutcome,
	AuditLogEntry,
	AuditLogEntryDetail,
	AuditLogFilter,
	AuditExportFormat,
	ListAuditLogRequest,
	ListAuditLogResponse,
	ExportAuditLogRequest,
	ExportAuditLogResponse,
} from "./modules/v1/rbac/rbac.schema.js"

// Current-user access schemas
export { meContract } from "./modules/v1/me/me.contract.js"
export {
	MePermissionsSchema,
	ClientProfileSchema,
	UpdateClientProfileSchema,
	GENDER_OPTIONS,
} from "./modules/v1/me/me.schema.js"
export type {
	MePermissions,
	ClientProfile,
	UpdateClientProfileInput,
} from "./modules/v1/me/me.schema.js"

// Future versions:
// export { v2Contract, type V2Contract } from "./modules/v2/v2.contract.js"
// export const v2 = { ... }
// export type { Todo as V2Todo, ... } from "./modules/v2/..."

// Business timezone (PRD: schedules, cutoffs, and reports use Asia/Manila)
export { BUSINESS_TIMEZONE } from "./common/business-time.js"
export type { BusinessTimezone } from "./common/business-time.js"
export * from "./common/privacy-notice.js"
