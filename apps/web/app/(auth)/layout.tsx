import Image from "next/image"
import Link from "next/link"

const SEALS = [
	{
		src: "/brand/who.png",
		alt: "World Health Organization",
		width: 480,
		height: 423,
		onDark: true,
	},
	{
		src: "/brand/ph.png",
		alt: "Republic of the Philippines",
		width: 330,
		height: 366,
		onDark: false,
	},
	{ src: "/brand/doh.png", alt: "Department of Health", width: 480, height: 480, onDark: false },
	{ src: "/brand/boq.png", alt: "Bureau of Quarantine", width: 480, height: 403, onDark: false },
] as const

const BENEFITS = [
	"Book at any of the 22 BOQ stations",
	"Pay online and get an e-Receipt",
	"Download QR-verified certificates",
] as const

/**
 * Sign in, register and password pages (UI-1): a navy BOQ panel beside the
 * form. On a phone the panel shrinks to the seal and name above the form.
 */
export default function AuthLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<div className="bg-background flex min-h-svh flex-col lg:flex-row">
			<aside className="bg-navy text-navy-foreground relative isolate flex flex-col justify-between gap-12 overflow-hidden px-6 py-6 sm:px-10 lg:w-[44%] lg:max-w-2xl lg:px-14 lg:py-14">
				{/* Same faded photo as the home page, so both feel like one site. */}
				<Image
					src="/brand/hero-vaccination.jpg"
					alt=""
					fill
					priority
					sizes="(min-width: 1024px) 44vw, 100vw"
					className="-z-20 object-cover opacity-70"
				/>
				<div
					aria-hidden="true"
					className="from-navy/90 via-navy/75 to-navy/90 absolute inset-0 -z-10 bg-gradient-to-b"
				/>
				<Link href="/" className="flex items-center gap-3 self-start">
					<Image
						src="/brand/boq.png"
						alt="Bureau of Quarantine seal"
						width={480}
						height={403}
						priority
						className="h-12 w-auto object-contain"
					/>
					<span className="flex flex-col leading-tight">
						<span className="text-base font-extrabold tracking-tight">Bureau of Quarantine</span>
						<span className="text-xs text-white/70">Quarantine Services and Payment System</span>
					</span>
				</Link>

				<div className="hidden max-w-md flex-col gap-5 lg:flex">
					<span aria-hidden="true" className="bg-gold h-[3px] w-12" />
					<h1 className="text-4xl leading-[1.1] font-extrabold tracking-tight">
						Your quarantine services, in one account.
					</h1>
					<p className="text-lg leading-relaxed text-white/75">
						Book appointments, pay online, and keep your receipts and certificates in one place.
					</p>
					<ul className="mt-2 flex flex-col gap-3">
						{BENEFITS.map(benefit => (
							<li key={benefit} className="flex items-center gap-3 text-white/90">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth={2.4}
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
									className="text-gold size-5 shrink-0"
								>
									<path d="M5 12l5 5 9-10" />
								</svg>
								{benefit}
							</li>
						))}
					</ul>
				</div>

				<ul aria-label="Partner agencies" className="hidden items-center gap-5 lg:flex">
					{SEALS.map(seal => (
						<li key={seal.src}>
							<Image
								src={seal.src}
								alt={seal.alt}
								width={seal.width}
								height={seal.height}
								className={
									seal.onDark
										? "h-9 w-auto object-contain brightness-0 invert"
										: "h-9 w-auto object-contain"
								}
							/>
						</li>
					))}
				</ul>
			</aside>

			<main className="flex flex-1 flex-col px-4 py-10 sm:px-8">
				<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
					{children}
				</div>
				<p className="text-muted-foreground mt-10 text-center text-xs">
					Your personal data is handled under the Data Privacy Act of 2012.{" "}
					<Link href="/" className="text-primary underline-offset-4 hover:underline">
						Back to home
					</Link>
				</p>
			</main>
		</div>
	)
}
