-- ============================================================================
-- ZeusX - Vision: bucket 'vision-uploads' accetta anche video sorgente
-- Data: 2026-07-28
-- Descrizione: Vision Studio ora supporta due modalità (vedi
-- frontend/app/api/generate-video/route.ts): "image-to-video" (foto -> spot)
-- e "video-to-video" (remix/restyle di un video esistente). Il bucket
-- 'vision-uploads', creato in 20260726000000_vision_credits_schema.sql per
-- le sole immagini, deve accettare anche i formati video sorgente e un
-- limite di dimensione più alto (i video pesano molto più di una foto).
-- ============================================================================

UPDATE storage.buckets
SET
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'],
    file_size_limit = 104857600 -- 100MB (era 20MB, sufficiente solo per immagini)
WHERE id = 'vision-uploads';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
