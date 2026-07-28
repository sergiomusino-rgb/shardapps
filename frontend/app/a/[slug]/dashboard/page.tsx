'use client';

// Rotta protetta delle nuove app (auth_mode='supabase'). Riusa lo stesso
// componente gestionale delle app legacy (ViewerProFinal in ../app/page.tsx):
// il componente stesso riconosce da quale route è montato (vedi il guard su
// usePathname()) e costruisce la sessione da Supabase Auth invece che da
// localStorage. Il gate di autenticazione vero e proprio (utente loggato +
// membership app_users attiva) è già garantito da ../layout.tsx prima che
// questa pagina venga montata.
//
// Comandi AI (app_type='comandi_ai') ha uno schema fisso e una dashboard
// amministrativa dedicata (catalogo, dati azienda, storico ordini): salta
// interamente il motore a tabelle dinamiche.
import GeneratedAppDashboardPage from '../app/page';
import { useAppInfo } from '../AppInfoContext';
import ComandiInstanceDashboard from '@/components/comandi/ComandiInstanceDashboard';

export default function AppDashboardPage() {
  const appInfo = useAppInfo();

  if (appInfo.appType === 'comandi_ai') {
    return <ComandiInstanceDashboard slug={appInfo.slug} tenantId={appInfo.tenantId} />;
  }

  return <GeneratedAppDashboardPage />;
}
