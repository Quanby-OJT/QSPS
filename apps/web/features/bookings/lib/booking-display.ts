import type {
	Booking,
	BookingItemStatus,
	ClientBookingStatus,
	DocumentStatus,
	DocumentType,
	PaymentStatus,
} from "@repo/contracts"

import { dateLabel, manilaDateKey, manilaTime } from "@/features/schedules/lib/calendar"

export function manilaDateTimeLabel(value: Date): string {
	return `${dateLabel(manilaDateKey(value))} · ${manilaTime(value)}`
}

export function clientStatusBadgeVariant(
	status: ClientBookingStatus
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "Paid":
			return "default"
		case "Pending":
			return "secondary"
		case "Cancelled":
			return "destructive"
	}
}

export function itemStatusLabel(status: BookingItemStatus): string {
	switch (status) {
		case "booked":
			return "Booked"
		case "checked_in":
			return "Checked in"
		case "in_assessment":
			return "In assessment"
		case "pending_head_approval":
			return "Pending head approval"
		case "returned":
			return "Returned for correction"
		case "cleared":
			return "Cleared"
		case "issued":
			return "Document issued"
		case "rejected":
			return "Rejected"
		case "no_show":
			return "No show"
	}
}

export function itemStatusBadgeVariant(
	status: BookingItemStatus
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "issued":
		case "cleared":
			return "default"
		case "booked":
		case "checked_in":
		case "in_assessment":
		case "pending_head_approval":
			return "secondary"
		case "rejected":
		case "no_show":
			return "destructive"
		case "returned":
			return "outline"
	}
}

export function paymentStatusLabel(status: PaymentStatus): string {
	switch (status) {
		case "succeeded":
			return "Succeeded"
		case "initiated":
			return "Initiated"
		case "pending":
			return "Pending"
		case "failed":
			return "Failed"
		case "expired":
			return "Expired"
		case "refunded":
			return "Refunded"
	}
}

export function documentTypeLabel(type: DocumentType): string {
	switch (type) {
		case "icv-record":
			return "International Certificate of Vaccination (ICV)"
		case "medical-exemption":
			return "Medical Exemption Certificate"
		case "sanitary-permit":
			return "Sanitary Permit"
		case "ship-sanitation":
			return "Ship Sanitation Certificate"
		case "food-safety-training":
			return "Food Safety Training Certificate"
		case "haccp":
			return "HACCP Certificate"
		case "pe-medical-certificate":
			return "Physical Examination Medical Certificate"
		case "human-remains":
			return "Human Remains Certificate"
		case "biological-certification":
			return "Biological Substance Certification"
		case "biological-permit":
			return "Biological Substance Permit"
		case "food-export-certificate":
			return "Food Export Certificate"
		case "water-analysis-certificate":
			return "Water Analysis Certificate"
	}
}

export function documentStatusLabel(status: DocumentStatus): string {
	switch (status) {
		case "valid":
			return "Valid"
		case "revoked":
			return "Revoked"
		case "superseded":
			return "Superseded"
	}
}

export function cancelReasonLabel(reason: Booking["cancelReason"]): string | null {
	switch (reason) {
		case "client_cancelled":
			return "Cancelled by you"
		case "hold_expired":
			return "Payment hold expired"
		case "no_show":
			return "Missed onsite payment arrival cutoff"
		case null:
			return null
		default:
			return reason
	}
}
