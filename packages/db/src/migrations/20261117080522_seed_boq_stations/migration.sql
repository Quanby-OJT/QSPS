-- ADM-4a: the 22 BOQ stations from TOR §IV (passbook printer table).
-- Codes and regions are assumed (the TOR has neither); regions use the TOR's
-- own grouping (Metro Manila, Luzon, Visayas, Mindanao). All editable in
-- Location Management. Insert-only and safe to re-run.
INSERT INTO "locations" ("code", "name", "address", "region") VALUES
	('MNL', 'Manila', '25th and A.C. Delgado Sts., Port Area, Manila', 'Metro Manila'),
	('LUN', 'La Union', '2nd Floor PJC Bldg., Brgy. Tanqui, City of San Fernando, La Union', 'Luzon'),
	('LAO', 'Laoag', 'Robinsons Mall, Level 2 (old bldg.), Brgy. 1 San Francisco, San Nicolas, Ilocos Norte 2901', 'Luzon'),
	('TUG', 'Tuguegarao', 'Enrile Blvd., Caggay, Tuguegarao City, Cagayan 3500', 'Luzon'),
	('BTN', 'Bataan', 'Unit 203 RHBC Bldg., Damulog, Daan Pare, Orion, Bataan', 'Luzon'),
	('CRK', 'Clark', 'Kubo 3, San Isidro Resettlement, Brgy. San Isidro, Magalang, Pampanga 2011', 'Luzon'),
	('SBC', 'Subic', 'Unit 2, 3A Quay Global Commercial Building, Waterfront Road, Subic Bay Freeport Zone 2222', 'Luzon'),
	('BTG', 'Batangas', 'Carmel Compound, Purok 3, Rimas Ibaba, Bolbok, Batangas City', 'Luzon'),
	('LCN', 'Lucena', 'Lucena Fish Port Complex, Brgy. Dalahican, Lucena City', 'Luzon'),
	('TBC', 'Tabaco', 'Central Terminal Complex, Purok 7, Tabaco City', 'Luzon'),
	('PPS', 'Palawan', 'PGS Bldg., Rizal Ave. Extn., Brgy. Bancao-Bancao, Puerto Princesa City, Palawan', 'Luzon'),
	('ILO', 'Iloilo', '3rd Floor Unit C2, Festive Walk Iloilo, Megaworld Boulevard, Mandurriao, Iloilo City', 'Visayas'),
	('KLO', 'Kalibo', 'Sitio Talisay, Brgy. Nalook, Kalibo, Aklan (beside Kalibo International Airport Tower)', 'Visayas'),
	('BCD', 'Bacolod', '2nd Floor Simplicio A. Palanca Sea Port Terminal, BREDCO Port 2, Reclamation Area, Brgy. 10, Bacolod City 6100', 'Visayas'),
	('DGT', 'Dumaguete', '2nd Level Robinsons Place Dumaguete, Dumaguete City', 'Visayas'),
	('CEB', 'Cebu', 'General Maxilom Carreta Extension, Cebu City', 'Visayas'),
	('BHL', 'Bohol', 'Governor''s Mansion, Carlos P. Garcia Avenue North, Tagbilaran City, Bohol 6300', 'Visayas'),
	('TAC', 'Tacloban', 'Robinsons Place Marasbaras, 2nd Floor, Lingkod Pinoy Center, Tacloban City', 'Visayas'),
	('ZAM', 'Zamboanga', 'Kasanyangan Rd., Zamboanga City, Zamboanga del Sur', 'Mindanao'),
	('CDO', 'Cagayan de Oro', 'Lingkod Pinoy Center, 2nd Floor Robinsons Cagayan de Oro, Rosario Crescent cor. Florentino St., Limketkai Center, Cagayan de Oro City', 'Mindanao'),
	('DVO', 'Davao', 'Ramon Magsaysay Ave. cor. Chaves St., Davao City 8000', 'Mindanao'),
	('GES', 'General Santos', 'Bureau of Quarantine, Makar–Siguel Rd., General Santos City, South Cotabato', 'Mindanao')
ON CONFLICT ("code") DO NOTHING;