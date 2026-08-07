export default function BrandFooter() {
  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start leading-none pointer-events-none">
      <div className="bg-slate-900/80 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg shadow-xl">
        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest block">SHARDAPPS</span>
        <span className="text-[9px] text-indigo-500 font-medium">by MUSINO</span>
      </div>
    </div>
  );
}