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

// Booking contracts + schemas (BKG-1, BKG-3: several services in one checkout)
export { bookingsContract } from "./modules/v1/bookings/bookings.contract.js"
export {
	BOOKING_STATUSES,
	BOOKING_KINDS,
	BOOKING_ITEM_STATUSES,
	MAX_BOOKING_ITEMS,
	REFERENCE_NUMBER_PATTERN,
	BookingStatusSchema,
	BookingKindSchema,
	BookingItemStatusSchema,
	ReferenceNumberSchema,
	BookingItemSchema,
	BookingSchema,
	CreateBookingItemSchema,
	CreateBookingSchema,
} from "./modules/v1/bookings/bookings.schema.js"
export type {
	BookingStatus,
	BookingKind,
	BookingItemStatus,
	BookingItem,
	Booking,
	CreateBookingItemInput,
	CreateBookingInput,
} from "./modules/v1/bookings/bookings.schema.js"

// Form Template contracts + schemas (FRM-1)
export { formsContract } from "./modules/v1/forms/forms.contract.js"
export {
	FORM_FIELD_TYPES,
	FormFieldTypeSchema,
	CHOICE_FIELD_TYPES,
	FORM_TEMPLATE_STATUSES,
	FormTemplateStatusSchema,
	MAX_FORM_FIELDS,
	MAX_FIELD_OPTIONS,
	FormFieldInputSchema,
	FormFieldsInputSchema,
	FormFieldSchema,
	FormTemplateSummarySchema,
	FormTemplateSchema,
	FormServiceSummarySchema,
	FormServiceIdParamSchema,
	FormTemplateIdParamSchema,
	SaveFormFieldsSchema,
	SetFormTemplateActiveSchema,
	DeleteFormTemplateResultSchema,
} from "./modules/v1/forms/forms.schema.js"
export type {
	FormFieldType,
	FormTemplateStatus,
	FormFieldInput,
	FormField,
	FormTemplateSummary,
	FormTemplate,
	FormServiceSummary,
	SaveFormFieldsInput,
	SetFormTemplateActiveInput,
} from "./modules/v1/forms/forms.schema.js"

// Payment contracts + schemas
export { paymentChannelsContract, paymentsContract } from "./modules/v1/payments/payments.contract.js"
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
	MAX_CONVENIENCE_FEE_CENTAVOS,
	PaymentChannelSchema,
	PaymentChannelSettingsSchema,
	UpdatePaymentChannelSchema,
	CheckoutChannelsParamSchema,
	CheckoutChannelSchema,
	CheckoutChannelsSchema,
} from "./modules/v1/payments/payments.schema.js"
export type {
	PaymentStatus,
	CreatePaymentInput,
	PaymentCheckout,
	PaymentStatusResponse,
	ReceiptVerification,
	PaymentChannel,
	PaymentChannelSettings,
	UpdatePaymentChannelInput,
	CheckoutChannel,
	CheckoutChannels,
} from "./modules/v1/payments/payments.schema.js"

// Cashier contracts + schemas (PAY-4)
export { cashierContract } from "./modules/v1/payments/cashier.contract.js"
export {
	TENDER_TYPES,
	TenderTypeSchema,
	MAX_AMOUNT_RECEIVED_CENTAVOS,
	CashierSearchSchema,
	isReferenceNumber,
	CashierBookingIdParamSchema,
	CashierBookingItemSchema,
	CashierBookingSchema,
	CashierSearchResultSchema,
	CollectOnsiteSchema,
	CollectOnsiteResultSchema,
} from "./modules/v1/payments/cashier.schema.js"
export type {
	TenderType,
	CashierSearchInput,
	CashierBookingItem,
	CashierBooking,
	CashierSearchResult,
	CollectOnsiteInput,
	CollectOnsiteResult,
} from "./modules/v1/payments/cashier.schema.js"

// Walk-in contracts + schemas (PRC-2)
export { walkInContract } from "./modules/v1/bookings/walk-in.contract.js"
export {
	MIN_WALK_IN_LOOKUP_LENGTH,
	MAX_WALK_IN_LOOKUP_RESULTS,
	WalkInClientLookupSchema,
	WalkInClientSchema,
	CreateWalkInClientSchema,
	WalkInSlotsRequestSchema,
	WalkInSlotSchema,
	WalkInSlotsSchema,
	CreateWalkInBookingSchema,
} from "./modules/v1/bookings/walk-in.schema.js"
export type {
	WalkInClientLookup,
	WalkInClient,
	CreateWalkInClientInput,
	WalkInSlotsRequest,
	WalkInSlot,
	WalkInSlots,
	CreateWalkInBookingInput,
} from "./modules/v1/bookings/walk-in.schema.js"

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
	ASSESSMENT_KINDS,
	AssessmentKindSchema,
	MIN_OVERRIDE_REASON_LENGTH,
	APPROVAL_QUEUE_VIEWS,
	ApprovalQueueViewSchema,
	ApprovalQueueRequestSchema,
	ApprovalQueueItemSchema,
	ApprovalQueueSchema,
	APPROVAL_DECISIONS,
	ApprovalDecisionSchema,
	DecideApprovalSchema,
	OverrideItemSchema,
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
	AssessmentKind,
	ApprovalQueueView,
	ApprovalQueueRequest,
	ApprovalQueueItem,
	ApprovalQueue,
	ApprovalDecision,
	DecideApprovalInput,
	OverrideItemInput,
} from "./modules/v1/processing/processing.schema.js"

// Certificates contracts + schemas (CRT-1, CRT-2, CRT-3)
export { certificatesContract } from "./modules/v1/certificates/certificates.contract.js"
export {
	DOCUMENT_TYPES,
	SERVICE_DOCUMENT_TYPES,
	VACCINATION_DOCUMENT_TYPES,
	MAX_EXEMPTION_REASON_LENGTH,
	VERIFICATION_CODE_LENGTH,
	DocumentTypeSchema,
	DocumentStatusSchema,
	IcvIssueDetailsSchema,
	MedicalExemptionDetailsSchema,
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
	MedicalExemptionDetails,
	IssueDocumentInput,
	DocumentSummary,
	MyDocuments,
	ManualVerificationInput,
	DocumentVerification,
} from "./modules/v1/certificates/certificates.schema.js"

// Schedule slot contracts + schemas (SCH-1, SCH-2)
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
	BulkUpdateCapacityRequestSchema,
	BulkUpdateCapacityResponseSchema,
	BlockScheduleDateRequestSchema,
	BlockScheduleDateResponseSchema,
	UnblockScheduleDateRequestSchema,
	UnblockScheduleDateResponseSchema,
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
	BulkUpdateCapacityRequest,
	BulkUpdateCapacityResponse,
	BlockScheduleDateRequest,
	BlockScheduleDateResponse,
	UnblockScheduleDateRequest,
	UnblockScheduleDateResponse,
	SlotAvailability,
} from "./modules/v1/schedules/schedules.schema.js"

// RBAC catalog (shared constants, enums, types)
export * from "./modules/v1/rbac/rbac.catalog.js"

// Location management contracts + schemas
export { locationsContract } from "./modules/v1/locations/locations.contract.js"
export {
	MAX_CARD_OFFSET_MM,
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

// Current-user access, profile and SMS settings schemas (AUTH-1, NTF-2)
export { meContract } from "./modules/v1/me/me.contract.js"
export {
	MePermissionsSchema,
	ClientProfileSchema,
	UpdateClientProfileSchema,
	GENDER_OPTIONS,
	SmsChannelSchema,
	SmsSettingsSchema,
	RequestSmsCodeSchema,
	VerifySmsCodeSchema,
	UpdateSmsPreferencesSchema,
	SmsCodeSentSchema,
} from "./modules/v1/me/me.schema.js"
export type {
	MePermissions,
	ClientProfile,
	UpdateClientProfileInput,
	SmsChannel,
	SmsSettings,
	RequestSmsCodeInput,
	VerifySmsCodeInput,
	UpdateSmsPreferencesInput,
} from "./modules/v1/me/me.schema.js"

// Future versions:
// export { v2Contract, type V2Contract } from "./modules/v2/v2.contract.js"
// export const v2 = { ... }
// export type { Todo as V2Todo, ... } from "./modules/v2/..."

// Business timezone (PRD: schedules, cutoffs, and reports use Asia/Manila)
export { BUSINESS_TIMEZONE } from "./common/business-time.js"
export type { BusinessTimezone } from "./common/business-time.js"
export * from "./common/privacy-notice.js"

// FRM-2: answering a Service's questionnaire while booking.
export {
	checkFormAnswers,
	FORM_UPLOAD_CONTENT_TYPES,
	FORM_UPLOAD_KEY_PATTERN,
	FORM_UPLOAD_MAX_BYTES,
	FORM_UPLOAD_TYPES,
	FormAnswersSchema,
	FormAnswerValueSchema,
	MAX_TEXT_ANSWER_LENGTH,
	type AnswerCheck,
	type CheckedField,
	type FormAnswers,
	type FormAnswerValue,
	type FormUploadContentType,
} from "./modules/v1/forms/form-answers.js"
export {
	BookingFormRequestSchema,
	BookingFormSchema,
	BookingItemFormInputSchema,
	FormSubmissionSchema,
	FormUploadInputSchema,
	FormUploadSchema,
	UpdateBookingItemFormSchema,
	type BookingForm,
	type BookingItemFormInput,
	type FormSubmission,
	type FormUpload,
	type UpdateBookingItemFormInput,
} from "./modules/v1/bookings/bookings.schema.js"
