import { Module } from "@nestjs/common"

import { env } from "@/config/env.config"

import { AnnouncementsModule } from "./announcements/announcements.module"
import { BookingsModule } from "./bookings/bookings.module"
import { DiagnosticsModule } from "./diagnostics/diagnostics.module"
import { FormsModule } from "./forms/forms.module"
import { HealthModule } from "./health/health.module"
import { LocationsModule } from "./locations/locations.module"
import { MeModule } from "./me/me.module"
import { PaymentsModule } from "./payments/payments.module"
import { PoliciesModule } from "./policies/policies.module"
import { ProcessingModule } from "./processing/processing.module"
import { RbacAdminModule } from "./rbac/rbac.module"
import { ReportsModule } from "./reports/reports.module"
import { SchedulesModule } from "./schedules/schedules.module"
import { ServicesModule } from "./services/services.module"
import { SupportModule } from "./support/support.module"
import { WalkInModule } from "./walk-in/walk-in.module"

@Module({
	imports: [
		// AUTH-4: the Gender and Development flash screen.
		AnnouncementsModule,
		BookingsModule,
		HealthModule,
		LocationsModule,
		MeModule,
		FormsModule,
		PaymentsModule,
		PoliciesModule,
		SupportModule,
		ProcessingModule,
		RbacAdminModule,
		ReportsModule,
		SchedulesModule,
		ServicesModule,
		// PRC-2: walk-in clients booked by a Processing Officer.
		WalkInModule,
		// Sentry diagnostics exist ONLY in development. Conditional import rather
		// than a runtime guard on the handler: the routes are then absent from the
		// router entirely (404), so there is no guard to misconfigure and no
		// deliberate-error endpoint sitting in a production build.
		...(env.NODE_ENV === "development" ? [DiagnosticsModule] : []),
	],
})
export class V1Module {}
