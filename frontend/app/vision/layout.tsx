// Riusa esattamente la stessa shell (sidebar, header con orologio e
// selettore lingua, AuthGuard) di app/dashboard/layout.tsx: Vision AI deve
// avere lo stesso "chrome" di tutte le altre pagine ZeusX invece di un
// layout standalone a sé stante.
export const dynamic = 'force-dynamic';

import DashboardLayoutClient from '../dashboard/DashboardLayoutClient';

export default function VisionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
