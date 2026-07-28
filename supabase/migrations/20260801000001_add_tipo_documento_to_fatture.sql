-- Distingue fatture da ricevute sullo stesso documento: intestazione PDF
-- diversa (FATTURA/RICEVUTA) e regole di validazione diverse (P.IVA cliente
-- obbligatoria solo per fattura), senza duplicare tabelle o logica.
ALTER TABLE fatture
  ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'fattura'
  CHECK (tipo_documento IN ('fattura', 'ricevuta'));
