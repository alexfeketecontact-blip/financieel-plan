export default function FinancialPlanWizard() {
  return (
    <div className="p-6 bg-neutral-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-2">Financieel Plan Wizard – 3 jaar</h1>
      <p className="mb-4">Hier vul je omzet, kosten, personeel en leningen in. 
      Het systeem rekent automatisch een 3-jaars plan uit met resultaatrekening, kasplanning en balans.</p>
      <div className="bg-white rounded-2xl shadow p-6">
        <p className="mb-2 font-semibold">📊 Voorbeeld (simulatie):</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Omzet 2025: €240.000</li>
          <li>Kosten: €150.000</li>
          <li>Winst: €90.000</li>
          <li>Cash eind jaar 3: €52.000</li>
        </ul>
        <p className="mt-4 text-sm text-neutral-500">→ In de echte versie kun je alle parameters zelf invullen, exporteren naar CSV en printen als PDF.</p>
      </div>
    </div>
  );
}
