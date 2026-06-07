/**
 * Router minimalista basado en `location.hash`.
 *
 * Decisión de MVP: evitar añadir `react-router` como dependencia.
 * Sólo necesitamos dos rutas (`home` e `inspector`) y la API es
 * trivial: leer/escribir el hash y notificar a los suscriptores.
 *
 * El cambio de hash se sincroniza con `hashchange` y, cuando el
 * usuario navega a `#`, la ruta cae al default (`home`).
 */

import { useEffect, useState } from 'react';

export type Route = 'home' | 'inspector';

const DEFAULT_ROUTE: Route = 'home';

function readHash(): Route {
  if (typeof window === 'undefined') return DEFAULT_ROUTE;
  const raw = window.location.hash.replace(/^#/, '');
  return raw === 'inspector' ? 'inspector' : DEFAULT_ROUTE;
}

function writeHash(route: Route): void {
  if (typeof window === 'undefined') return;
  const target = `#${route}`;
  if (window.location.hash !== target) {
    window.location.hash = route;
  }
}

/** Hook que devuelve la ruta activa y un setter para cambiarla. */
export function useRoute(): readonly [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(readHash);
  useEffect(() => {
    const handler = () => setRoute(readHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return [route, writeHash] as const;
}
