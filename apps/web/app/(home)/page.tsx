import Image from "next/image"
import Link from "next/link"

import { PublicHeader } from "@/core/components/public-header"
import { SiteFooter } from "@/core/components/site-footer"
import { linkButton } from "@/core/lib/link-button"
import { getSession, SessionUnavailableError } from "@/services/better-auth/auth-server"
import { Reveal } from "@/features/home/reveal"

const STEPS = [
	{
		title: "Book a slot",
		text: "Pick the service, the station and an open date and time. You get a reference number right away.",
		icon: "M3 9h18M8 3v4M16 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
	},
	{
		title: "Pay online",
		text: "Pay before your slot's hold ends. Your e-Receipt arrives with its own QR code.",
		icon: "M2 10h20M6 15h4M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
	},
	{
		title: "Visit the station",
		text: "Show your reference number. Staff check you in and complete your assessment.",
		icon: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
	},
	{
		title: "Get your document",
		text: "Download your certificate from My Documents. Its QR code proves it came from BOQ.",
		icon: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 14l2 2 4-4",
	},
] as const

/** Services as listed on BOQ's official ICV site (icv.boq.ph). */
const SERVICES = [
	{
		title: "Vaccination",
		items: ["Yellow fever", "Polio vaccine", "MMR (measles, mumps and rubella)"],
	},
	{
		title: "International certification",
		items: ["Duplicate or re-issuance of an ICV", "International certificate for COVID-19"],
	},
	{
		title: "Physical examination",
		items: ["PE for Filipino nationals", "PE for foreign nationals", "Seminars"],
	},
] as const

const FACTS = [
	{ value: "22", label: "BOQ stations nationwide" },
	{ value: "Online", label: "booking and payment, with an e-Receipt" },
	{ value: "QR", label: "verified certificates anyone can check" },
] as const

function StrokeIcon({ d, className }: { d: string; className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d={d} />
		</svg>
	)
}

/** A decorative sample of the certificate the system issues. */
function SampleCertificate() {
	return (
		<div
			aria-hidden="true"
			className="w-full max-w-md overflow-hidden rounded-2xl bg-white text-[#0a2540] shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
		>
			<div className="bg-primary flex items-center gap-3 px-6 py-4 text-white">
				<Image
					src="/brand/boq.png"
					alt=""
					width={480}
					height={403}
					className="h-9 w-auto object-contain"
				/>
				<div className="flex flex-col">
					<span className="text-xs tracking-wider text-white/80 uppercase">
						International Certificate of Vaccination
					</span>
					<span className="text-sm font-bold">Yellow fever</span>
				</div>
			</div>
			<div className="flex gap-5 p-6">
				<dl className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
					<div>
						<dt className="text-xs text-[#5b6b82]">Document No.</dt>
						<dd className="font-mono font-bold">ICV-MNL-2026-000001</dd>
					</div>
					<div>
						<dt className="text-xs text-[#5b6b82]">Holder</dt>
						<dd className="font-semibold">Juan Dela Cruz</dd>
					</div>
					<div>
						<dt className="text-xs text-[#5b6b82]">Issuing station</dt>
						<dd className="font-semibold">Manila</dd>
					</div>
					<dd className="self-start rounded-full bg-[#e3f4ea] px-2.5 py-1 text-xs font-bold text-[#146c3a]">
						Valid
					</dd>
				</dl>
				<div className="relative size-28 shrink-0">
					{/* A slow scan line over the QR code: "scan to verify". */}
					<span className="motion-safe:animate-scan absolute inset-x-0 top-0 h-[3px] rounded-full bg-[#1557b0]/70 opacity-0 shadow-[0_0_12px_2px_rgba(21,87,176,0.45)]" />
					<svg viewBox="0 0 21 21" className="size-28" shapeRendering="crispEdges">
						<rect width="21" height="21" fill="#fff" />
						<g fill="#0a2540">
							<path
								fillRule="evenodd"
								d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2z"
							/>
							<path d="M8 0h1v2H8zM10 1h2v1h-2zM9 3h2v2H9zM12 4h1v3h-1zM8 6h2v1H8zM0 8h2v1H0zM3 8h3v1H3zM8 8h3v2H8zM12 8h2v1h-2zM15 8h1v2h-1zM17 8h4v1h-4zM1 10h3v1H1zM5 10h2v2H5zM11 10h3v1h-3zM16 11h3v1h-3zM0 12h2v1H0zM8 12h2v3H8zM12 12h1v2h-1zM14 13h3v1h-3zM19 12h2v3h-2zM10 15h2v1h-2zM14 15h1v3h-1zM16 16h3v1h-3zM8 17h2v2H8zM11 17h2v1h-2zM17 18h1v3h-1zM10 19h3v2h-3zM15 19h1v2h-1zM19 19h2v2h-2z" />
						</g>
					</svg>
				</div>
			</div>
			<div className="border-t px-6 py-3 text-xs text-[#5b6b82]">
				Scan to confirm it with BOQ records
			</div>
		</div>
	)
}

/** Public home page (UI-1). */
export default async function Home() {
	let session: Awaited<ReturnType<typeof getSession>> = null
	try {
		session = await getSession()
	} catch (error) {
		if (!(error instanceof SessionUnavailableError)) throw error
	}
	const isLoggedIn = session !== null

	return (
		<>
			<PublicHeader isLoggedIn={isLoggedIn} />

			<main className="flex-1">
				<section className="bg-navy text-navy-foreground relative isolate overflow-hidden">
					{/* Background photo, faded under navy so the text stays readable (UI-1). */}
					<Image
						src="/brand/hero-vaccination.jpg"
						alt=""
						fill
						priority
						sizes="100vw"
						className="-z-20 object-cover opacity-70"
					/>
					<div
						aria-hidden="true"
						className="from-navy via-navy/80 to-navy/30 absolute inset-0 -z-10 bg-gradient-to-r"
					/>
					<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-14 px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
						<div className="flex min-w-0 flex-[1_1_480px] flex-col gap-6">
							<p className="text-gold motion-safe:animate-rise flex items-center gap-2.5 text-sm font-semibold tracking-wider uppercase">
								<span aria-hidden="true" className="bg-gold h-0.5 w-7" />
								Department of Health · Bureau of Quarantine
							</p>
							<h1 className="motion-safe:animate-rise text-4xl leading-[1.05] font-extrabold tracking-tight [animation-delay:100ms] sm:text-5xl lg:text-6xl">
								Quarantine services, booked and paid online.
							</h1>
							<p className="motion-safe:animate-rise max-w-xl text-lg leading-relaxed text-white/75 [animation-delay:200ms]">
								Book a vaccination, medical exam or permit at any BOQ station, pay online, and
								receive documents anyone can verify with a QR code.
							</p>
							<div className="motion-safe:animate-rise mt-2 flex flex-wrap gap-3 [animation-delay:300ms]">
								<Link
									href={isLoggedIn ? "/book" : "/register"}
									className={linkButton({ variant: "gold", size: "lg" })}
								>
									Book an appointment
								</Link>
								<Link href="/verify" className={linkButton({ variant: "onDark", size: "lg" })}>
									Verify a document
								</Link>
							</div>
						</div>
						<div className="motion-safe:animate-rise flex min-w-0 flex-[1_1_400px] justify-center [animation-delay:400ms]">
							<div className="motion-safe:animate-float w-full max-w-md">
								<SampleCertificate />
							</div>
						</div>
					</div>
					<div aria-hidden="true" className="bg-gold h-1" />
				</section>

				<section aria-label="At a glance" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
					<ul className="grid rounded-b-2xl border border-t-0 sm:grid-cols-3">
						{FACTS.map(fact => (
							<li
								key={fact.label}
								className="border-b px-8 py-7 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
							>
								<p className="text-primary text-4xl font-extrabold">{fact.value}</p>
								<p className="text-muted-foreground">{fact.label}</p>
							</li>
						))}
					</ul>
				</section>

				<section className="mx-auto flex max-w-6xl flex-col gap-12 px-4 pt-24 pb-6 sm:px-6 lg:px-8">
					<div className="flex max-w-2xl flex-col gap-3">
						<p className="text-primary text-sm font-bold tracking-wider uppercase">How it works</p>
						<h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
							From booking to certificate in four steps.
						</h2>
					</div>
					<ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
						{STEPS.map((step, index) => (
							<li key={step.title}>
								<Reveal delay={index * 100} className="h-full">
									<div className="bg-card flex h-full flex-col gap-3.5 rounded-2xl border p-7 transition-[translate,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-lg">
										<div className="flex items-center justify-between">
											<span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
												<StrokeIcon d={step.icon} className="size-6" />
											</span>
											<span className="text-muted-foreground text-sm font-bold">0{index + 1}</span>
										</div>
										<h3 className="text-xl font-bold">{step.title}</h3>
										<p className="text-muted-foreground leading-relaxed">{step.text}</p>
									</div>
								</Reveal>
							</li>
						))}
					</ol>
				</section>

				<section
					id="services"
					className="mx-auto flex max-w-6xl scroll-mt-8 flex-col gap-10 px-4 py-24 sm:px-6 lg:px-8"
				>
					<div className="flex flex-col gap-3">
						<p className="text-primary text-sm font-bold tracking-wider uppercase">Services</p>
						<h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
							What you can book
						</h2>
					</div>
					<ul className="grid gap-5 md:grid-cols-3">
						{SERVICES.map((service, index) => (
							<li key={service.title}>
								<Reveal delay={index * 100} className="h-full">
									<div className="bg-muted flex h-full flex-col gap-4 rounded-2xl p-7 transition-[translate,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-lg">
										<h3 className="text-lg font-bold">{service.title}</h3>
										<ul className="flex flex-col gap-2.5">
											{service.items.map(item => (
												<li key={item} className="text-muted-foreground flex items-start gap-2.5">
													<StrokeIcon
														d="M5 12l5 5 9-10"
														className="text-primary mt-1 size-4 shrink-0"
													/>
													<span>{item}</span>
												</li>
											))}
										</ul>
									</div>
								</Reveal>
							</li>
						))}
					</ul>
				</section>

				<section className="mx-auto mb-24 max-w-6xl px-4 sm:px-6 lg:px-8">
					<div className="bg-navy text-navy-foreground relative isolate flex flex-wrap items-center gap-8 overflow-hidden rounded-3xl p-10 sm:p-12">
						<Image
							src="/brand/band-travel.jpg"
							alt=""
							fill
							sizes="(min-width: 1152px) 1152px, 100vw"
							className="-z-20 object-cover opacity-70"
						/>
						<div
							aria-hidden="true"
							className="from-navy via-navy/75 to-navy/25 absolute inset-0 -z-10 bg-gradient-to-r"
						/>
						<div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
							<h2 className="text-2xl font-extrabold sm:text-3xl">Is this certificate genuine?</h2>
							<p className="leading-relaxed text-white/75">
								Scan its QR code, or enter the document number and the 8-character code printed
								under the QR. No account needed.
							</p>
						</div>
						<Link
							href="/verify"
							className={linkButton({ variant: "gold", size: "lg", className: "px-7" })}
						>
							Verify a document
						</Link>
					</div>
				</section>
			</main>

			<SiteFooter />
		</>
	)
}
