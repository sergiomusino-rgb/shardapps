// ─── Component Registry — test (Fase 3: Generic UI Engine) ─────────────────
// Eseguibile direttamente con `node --test src/lib/creator/component-registry.test.ts`
// (Node 22+/24 esegue TypeScript nativamente via type-stripping — stesso
// approccio già usato da app-specification.test.ts/site-schema.test.ts in
// questo repo, stessa convenzione: import ESM con estensione .ts esplicita
// sui moduli locali, vedi la nota tecnica in app-specification.ts).
//
// NOTA sul perimetro di questi test: `ComponentRegistry<TProps>` (la classe
// generica) è testata qui end-to-end con renderer finti (funzioni pure che
// ritornano una stringa, non JSX). I 9 renderer REALI dei componenti di
// sezione vivono in frontend/src/components/creator/sections/index.tsx, un
// file .tsx con JSX vero — Node's type-stripping esegue lo spogliamento dei
// TIPI, non la trasformazione JSX, quindi quel file non può essere eseguito
// direttamente da `node --test` (stesso vincolo già documentato in
// app-specification.ts per i moduli con import di valore da site-schema.ts).
// Per questo: (a) qui si verifica il CONTRATTO dei "9 type legacy" come dato
// puro (nessun import da site-schema.ts, che romperebbe l'esecuzione isolata
// per lo stesso motivo — vedi app-specification.ts, "Nota tecnica sulle
// scelte di import"); (b) la wiring REALE dei 9 componenti nel Registry è
// verificata da `npx tsc --noEmit` (sections/index.tsx tipizza ogni renderer
// contro SectionRendererPropsFor<T> e registra con KNOWN_SECTION_TYPES,
// unica fonte condivisa con site-schema.ts — un disallineamento lì sarebbe
// un errore di tipo, non silenzioso) più la verifica manuale riportata nel
// report di Fase 3.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ComponentRegistry, type ComponentRenderer } from './component-registry.ts';

// Stesso elenco di KNOWN_SECTION_TYPES (site-schema.ts) e della
// registrazione reale in sections/index.tsx — duplicato qui deliberatamente
// (vedi nota sopra sul perché non può essere importato a runtime da Node),
// non un valore inventato: i tre punti devono restare sincronizzati a mano.
const LEGACY_SECTION_TYPES = ['hero', 'about', 'gallery', 'list', 'form', 'contact', 'reviews', 'cta', 'text'];

describe('ComponentRegistry — register/get/has/list', () => {
  test('registra un componente e lo recupera con get()', () => {
    const registry = new ComponentRegistry<unknown>();
    const renderer = () => 'HERO';
    registry.register('hero', renderer);

    assert.equal(registry.get('hero'), renderer);
  });

  test("has() riflette esattamente cosa è stato registrato", () => {
    const registry = new ComponentRegistry<unknown>();
    assert.equal(registry.has('hero'), false);
    registry.register('hero', () => 'HERO');
    assert.equal(registry.has('hero'), true);
    assert.equal(registry.has('about'), false);
  });

  test("get() su un type sconosciuto ritorna undefined (mai un'eccezione)", () => {
    const registry = new ComponentRegistry<unknown>();
    assert.equal(registry.get('non-esiste'), undefined);
    assert.equal(registry.has('non-esiste'), false);
  });

  test("list() ritorna tutti i type registrati, nell'ordine di registrazione", () => {
    const registry = new ComponentRegistry<unknown>();
    registry.register('hero', () => 'HERO');
    registry.register('about', () => 'ABOUT');
    registry.register('gallery', () => 'GALLERY');

    assert.deepEqual(registry.list(), ['hero', 'about', 'gallery']);
  });

  test('list() su un registry vuoto ritorna un array vuoto', () => {
    const registry = new ComponentRegistry<unknown>();
    assert.deepEqual(registry.list(), []);
  });
});

// Registri usati nei test sotto: `TProps = unknown` (i renderer finti
// ignorano le props, non è quello sotto test qui — è il meccanismo di
// register/get/has/list/collisione/fallback della classe). Ogni renderer
// finto dichiara comunque un parametro (`_props: unknown`) perché il tipo
// `ComponentRenderer<TProps>` richiede una funzione a 1 argomento: chiamarla
// sempre con un argomento esplicito (`undefined`) tiene i call site coerenti
// col contratto reale, quello che SitePreview.tsx userà davvero.
function fakeRenderer(value: string): ComponentRenderer<unknown> {
  return () => value;
}

describe('ComponentRegistry — collisioni', () => {
  test('register() due volte sullo stesso type lancia (collisione accidentale impedita)', () => {
    const registry = new ComponentRegistry<unknown>();
    registry.register('hero', fakeRenderer('HERO_V1'));

    assert.throws(
      () => registry.register('hero', fakeRenderer('HERO_V2')),
      /già registrato/,
    );
    // Il primo renderer resta quello attivo: la register() fallita non ha
    // sovrascritto nulla.
    assert.equal(registry.get('hero')?.(undefined), 'HERO_V1');
  });

  test('{ allowOverride: true } permette una sostituzione deliberata', () => {
    const registry = new ComponentRegistry<unknown>();
    registry.register('hero', fakeRenderer('HERO_V1'));
    registry.register('hero', fakeRenderer('HERO_V2'), { allowOverride: true });

    assert.equal(registry.get('hero')?.(undefined), 'HERO_V2');
  });

  test('register() con type vuoto lancia', () => {
    const registry = new ComponentRegistry<unknown>();
    assert.throws(() => registry.register('', fakeRenderer('X')));
  });
});

describe('Contratto Fase 3 — i 9 componenti legacy', () => {
  test('tutti e 9 i type legacy sono registrabili senza collisioni tra loro', () => {
    const registry = new ComponentRegistry<unknown>();
    for (const type of LEGACY_SECTION_TYPES) {
      registry.register(type, fakeRenderer(`RENDERED:${type}`));
    }
    assert.deepEqual(registry.list().sort(), [...LEGACY_SECTION_TYPES].sort());
    for (const type of LEGACY_SECTION_TYPES) {
      assert.equal(registry.has(type), true);
      assert.equal(registry.get(type)?.(undefined), `RENDERED:${type}`);
    }
  });

  test('il contratto è esattamente questi 9 valori, non un sottoinsieme/soprainsieme', () => {
    assert.deepEqual(
      [...LEGACY_SECTION_TYPES].sort(),
      ['about', 'contact', 'cta', 'form', 'gallery', 'hero', 'list', 'reviews', 'text'],
    );
  });
});

describe('Fallback per type sconosciuto (requisito Fase 3, punto 6)', () => {
  // Stesso identico pattern usato da SitePreview.tsx::SectionRenderer:
  // `registry.get(type) ?? fallback`. Verificato qui con renderer finti
  // (nessun JSX necessario) — la selezione del fallback è pura logica,
  // indipendente da cosa il fallback/i renderer restituiscono realmente.
  function resolveRenderer<TProps>(
    registry: ComponentRegistry<TProps>,
    type: string,
    fallback: ComponentRenderer<TProps>,
  ): ComponentRenderer<TProps> {
    return registry.get(type) ?? fallback;
  }

  test('un type sconosciuto risolve al fallback, non lancia e non è undefined', () => {
    const registry = new ComponentRegistry<unknown>();
    registry.register('hero', fakeRenderer('HERO'));
    const fallback = fakeRenderer('FALLBACK');

    const resolved = resolveRenderer(registry, 'tipo-mai-visto', fallback);
    assert.equal(resolved, fallback);
    assert.equal(resolved(undefined), 'FALLBACK');
  });

  test('un type noto NON usa mai il fallback', () => {
    const registry = new ComponentRegistry<unknown>();
    const heroRenderer = fakeRenderer('HERO');
    registry.register('hero', heroRenderer);
    const fallback = fakeRenderer('FALLBACK');

    const resolved = resolveRenderer(registry, 'hero', fallback);
    assert.equal(resolved, heroRenderer);
    assert.notEqual(resolved, fallback);
  });

  test('un registry completamente vuoto (nessuna entry) risolve comunque al fallback per qualunque type', () => {
    const registry = new ComponentRegistry<unknown>();
    const fallback: ComponentRenderer<unknown> = () => null;
    for (const type of LEGACY_SECTION_TYPES) {
      assert.equal(resolveRenderer(registry, type, fallback), fallback);
    }
  });
});

describe('Isolamento tra istanze', () => {
  test('due ComponentRegistry indipendenti non condividono stato', () => {
    const registryA = new ComponentRegistry<unknown>();
    const registryB = new ComponentRegistry<unknown>();
    registryA.register('hero', fakeRenderer('A'));

    assert.equal(registryA.has('hero'), true);
    assert.equal(registryB.has('hero'), false);
    assert.deepEqual(registryB.list(), []);
  });
});
