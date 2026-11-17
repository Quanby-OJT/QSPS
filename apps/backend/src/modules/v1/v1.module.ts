import { Module } from "@nestjs/common"

import { env } from "@/config/env.config"

import { BookingsModule } from "./bookings/bookings.module"
import { DiagnosticsModule } from "./diagnostics/diagnostics.module"
import { HealthModule } from "./health/health.module"
import { LocationsModule } from "./locations/locations.module"
import { MeModule } from "./me/me.module"
import { RbacAdminModule } from "./rbac/rbac.module"
import { SchedulesModule } from "./schedules/schedules.module"
import { ServicesModule } from "./services/services.module"

@Module({
	imports: [
		BookingsModule,
		HealthModule,
		LocationsModule,
		MeModule,
		RbacAdminModule,
		SchedulesModule,
		ServicesModule,
		// Sentry diagnostics exist ONLY in development. Conditional import rather
		// than a runtime guard on the handler: the routes are then absent from the
		// router entirely (404), so there is no guard to misconfigure and no
		// deliberate-error endpoint sitting in a production build.
		...(env.NODE_ENV === "development" ? [DiagnosticsModule] : []),
	],
})
export class V1Module {}
