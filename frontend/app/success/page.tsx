import { Suspense } from 'react';
import SuccessContent from './SuccessContent';

export default function Page() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-400">Caricamento in corso...</p>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}