-- PAY-5: the payment channels listed in TOR §VIII.2. Every channel starts
-- disabled with no provider: an administrator enables it in Payment Channels,
-- picks the gateway that serves it and sets its convenience fee. Names are
-- editable there too. Insert-only and safe to re-run.
INSERT INTO "payment_channels" ("code", "name") VALUES
	('linkbiz', 'Landbank Link.Biz'),
	('gcash', 'GCash'),
	('maya', 'Maya'),
	('card', 'Visa / Mastercard'),
	('bancnet', 'BancNet'),
	('grabpay', 'GrabPay'),
	('seven-eleven', '7-Eleven')
ON CONFLICT ("code") DO NOTHING;
