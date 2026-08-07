export default function BlockedPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">
          ZEUSX
        </h1>

        <div className="text-6xl">&#x26D4;</div>

        <h2 className="text-2xl font-bold text-white">App non disponibile</h2>

        <p className="text-slate-400 leading-relaxed">
          Questa app e stata sospesa dall&apos;amministratore.<br />
          Contatta il tuo gestionale per riattivare l&apos;accesso.
        </p>

        <p className="text-slate-500 text-sm">
          Se pensi sia un errore, verifica con l&apos;amministratore.
        </p>
      </div>
    </div>
  );
}
