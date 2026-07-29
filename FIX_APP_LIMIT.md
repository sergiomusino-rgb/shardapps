# Correzione app_limit per il tuo account

## Problema
Il tuo account mostra "-2 slot disponibili" perché `app_limit` nel database non è stato impostato correttamente durante il setup iniziale.

## Soluzione

Esegui questa query SQL su **Supabase SQL Editor**:

```sql
-- Fix app_limit in base al piano
UPDATE tenants
SET app_limit = CASE 
  WHEN plan = 'starter' THEN 1
  WHEN plan = 'pro' THEN 5
  WHEN plan = 'business' THEN 100
  ELSE 1
END
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';
```

## Verifica

Dopo aver eseguito la query, verifica con:

```sql
SELECT id, plan, app_limit FROM tenants WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';
```

Risultato atteso:
- Se piano STARTER: `app_limit = 1`
- Se piano PRO: `app_limit = 5`
- Se piano BUSINESS: `app_limit = 100`

## Perché è successo

Durante la creazione iniziale del sistema di billing, il campo `app_limit` non veniva popolato automaticamente in base al piano Stripe. Ora il codice è stato corretto per impostare il limite corretto al checkout, ma i dati esistenti vanno aggiornati manualmente.
