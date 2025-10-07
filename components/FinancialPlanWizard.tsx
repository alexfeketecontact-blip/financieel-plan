"use client";

import React, { useMemo, useState } from "react";

/* ---------- Types ---------- */
type RevenueDriver = { name: string; startMonth: number; units: number; price: number; monthlyGrowthPct: number; };
type VarCost = { name: string; pctOfSales: number; };
type PayrollItem = { role: string; grossPerMonth: number; onCostPct: number; startMonth: number; };
type OpexItem = { name: string; amountYear1: number; indexPctPerYear: number; startMonth: number; };
type CapexItem = { name: string; amount: number; startMonth: number; deprMonths: number; };
type DebtItem = { name: string; amount: number; rate: number; termMonths: number; graceMonths?: number; method: "annuity"|"linear"; startMonth: number; };
type Taxes = { citRatePct: number; citPaymentMonth: 3|6|11|12; };
type WorkingCapital = { dsoDays: number; dpoDays: number; dioDays: number; };

const months = Array.from({ length: 36 }, (_, i) => i + 1);
const yBuckets = [{ y:1, start:1, end:12 }, { y:2, start:13, end:24 }, { y:3, start:25, end:36 }];

const fmt = (v:number) => v.toLocaleString("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const toCSV = (rows:(string|number)[][]) => rows.map(r=>r.map(c => (typeof c==="string" && (c.includes(",")||c.includes("\n")||c.includes("\"")))?`"${c.replace(/"/g,'""')}"`:String(c)).join(",")).join("\n");
const dl = (name:string, content:string) => { const b = new Blob([content], { type:"text/csv;charset=utf-8;" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download=name; a.click(); URL.revokeObjectURL(u); };

/* ---------- Kernberekening ---------- */
function buildPlan(p:{
  openingCash:number; equity:number;
  revenueDrivers:RevenueDriver[]; varCosts:VarCost[]; payroll:PayrollItem[]; opex:OpexItem[];
  capex:CapexItem[]; debts:DebtItem[]; taxes:Taxes; wc:WorkingCapital;
}) {
  const rev = months.map(m => p.revenueDrivers.reduce((t,d)=>{
    if(m<d.startMonth) return t;
    const tmo = m - d.startMonth; const g = Math.pow(1 + (d.monthlyGrowthPct||0), tmo);
    return t + d.units * d.price * g;
  },0));

  const varRate = p.varCosts.reduce((a,v)=>a+(v.pctOfSales||0),0);
  const varCostsM = rev.map(r=>r*varRate);

  const payrollM = months.map(m => p.payroll.filter(x=>m>=x.startMonth).reduce((s,x)=>s + x.grossPerMonth*(1+(x.onCostPct||0)),0));

  const opexM = months.map(()=>0);
  p.opex.forEach(o=>{
    yBuckets.forEach(({y,start,end})=>{
      const idx = y-1; const amountYear = o.amountYear1 * Math.pow(1+(o.indexPctPerYear||0), idx);
      for(let mm=start; mm<=end; mm++){ if(mm>=o.startMonth) opexM[mm-1]+=amountYear/12; }
    });
  });

  const capexM = months.map(()=>0), deprM = months.map(()=>0);
  p.capex.forEach(c=>{
    if(c.startMonth>=1 && c.startMonth<=36) capexM[c.startMonth-1]+=c.amount;
    const md = c.amount / c.deprMonths;
    for(let i=0;i<c.deprMonths;i++){ const mm=c.startMonth+i; if(mm>=1 && mm<=36) deprM[mm-1]+=md; }
  });

  const interestM = months.map(()=>0), principalM = months.map(()=>0), outstanding:number[] = Array(36).fill(0);
  p.debts.forEach(d=>{
    const r = d.rate/12; let bal = d.amount;
    const n = d.termMonths; const ann = r>0 ? (bal*r)/(1-Math.pow(1+r,-n)) : bal/n;
    for(let i=1;i<=36;i++){
      if(i<d.startMonth) continue; const k = i-d.startMonth+1; if(k>d.termMonths) continue;
      const int = bal*r; const inGrace = (d.graceMonths||0)>0 && k<= (d.graceMonths||0);
      const prin = inGrace ? 0 : (d.method==="annuity" ? (ann - int) : (d.amount/d.termMonths));
      interestM[i-1]+=int; principalM[i-1]+=prin; bal = Math.max(0, bal-prin); outstanding[i-1]=bal;
    }
  });

  const gross = rev.map((r,i)=>r - varCostsM[i]);
  const ebit = months.map((_,i)=> gross[i] - payrollM[i] - opexM[i] - deprM[i]);
  const ebt  = ebit.map((v,i)=> v - interestM[i]);

  const taxYear = [0,0,0];
  yBuckets.forEach(({y,start,end})=>{
    const profit = ebt.slice(start-1,end).reduce((a,b)=>a+b,0);
    taxYear[y-1] = profit>0 ? profit*(p.taxes.citRatePct||0.25) : 0;
  });
  const taxM = months.map(()=>0);
  if(taxYear[0]>0) taxM[12+(p.taxes.citPaymentMonth-1)] = taxYear[0];
  if(taxYear[1]>0) taxM[24+(p.taxes.citPaymentMonth-1)] = taxYear[1];

  // simpele DSO/DPO benadering
  let ar=0, ap=0; const dso=p.wc.dsoDays||0, dpo=p.wc.dpoDays||0; const wcDeltaM = months.map((_,i)=>{
    const newAR = rev[i], colAR = dso>0 ? (30/dso)*ar : ar, deltaAR = newAR - colAR; ar = Math.max(0, ar+deltaAR);
    const newAP = varCostsM[i], payAP = dpo>0 ? (30/dpo)*ap : ap, deltaAP = newAP - payAP; ap = Math.max(0, ap+deltaAP);
    return deltaAR - deltaAP;
  });

  const cashflow = months.map((_,i)=> ebit[i] + deprM[i] - principalM[i] - capexM[i] - taxM[i] - wcDeltaM[i]);
  const cash = months.map(()=>0); cash[0] = p.openingCash + cashflow[0]; for(let i=1;i<36;i++) cash[i] = cash[i-1] + cashflow[i];

  const pl = yBuckets.map(({start,end})=>{
    const sum = (arr:number[])=>arr.slice(start-1,end).reduce((a,b)=>a+b,0);
    const sales=sum(rev), vc=sum(varCostsM), gm=sales-vc, pay=sum(payrollM), op=sum(opexM), dep=sum(deprM), intst=sum(interestM);
    const ebitY=gm - pay - op - dep, ebtY=ebitY - intst, taxExp=Math.max(0, ebtY)*(p.taxes.citRatePct||0.25), result=ebtY - taxExp;
    return { sales, vc, gm, pay, op, dep, intst, ebit:ebitY, ebt:ebtY, taxExpense:taxExp, result };
  });

  const snapshots = [12,24,36].map(m=>{
    const totalCapex = capexM.slice(0,m).reduce((a,b)=>a+b,0);
    const totalDepr  = deprM.slice(0,m).reduce((a,b)=>a+b,0);
    const fixedAssetsNet = Math.max(0,totalCapex-totalDepr);
    const debtOutstanding = outstanding[m-1]||0;
    const profitToDate = ebt.slice(0,m).reduce((a,b)=>a+b,0) - Math.max(0, ebt.slice(0,m).reduce((a,b)=>a+b,0))*(p.taxes.citRatePct||0.25);
    const equityTotal = p.equity + profitToDate;
    return { assets:{ fixedAssetsNet, cash: cash[m-1] }, liab:{ debt: debtOutstanding, equity: equityTotal } };
  });

  return { rev, varCostsM, payrollM, opexM, capexM, deprM, interestM, principalM, ebit, ebt, taxM, cashflow, cash, pl, snapshots, taxYear };
}

/* ---------- UI ---------- */
function Section({title, children}:{title:string; children:React.ReactNode}) {
  return <div className="bg-white rounded-2xl shadow p-5 mb-5"><h2 className="text-xl font-semibold mb-3">{title}</h2>{children}</div>;
}

export default function FinancialPlanWizard(){
  const [meta,setMeta] = useState({ company:"Mijn SRL", openingCash:25000, equity:25000 });
  const [revenueDrivers,setRevenueDrivers] = useState<RevenueDriver[]>([{ name:"Retainers", startMonth:2, units:10, price:2000, monthlyGrowthPct:0.03 }]);
  const [varCosts,setVarCosts] = useState<VarCost[]>([{ name:"Subcontracting", pctOfSales:0.25 }]);
  const [payroll,setPayroll] = useState<PayrollItem[]>([{ role:"Bestuurder", grossPerMonth:3500, onCostPct:0.3, startMonth:1 }]);
  const [opex,setOpex] = useState<OpexItem[]>([
    { name:"Huur", amountYear1:14400, indexPctPerYear:0.02, startMonth:1 },
    { name:"Software", amountYear1:4800, indexPctPerYear:0.02, startMonth:1 },
  ]);
  const [capex,setCapex] = useState<CapexItem[]>([{ name:"IT", amount:30000, startMonth:1, deprMonths:36 }]);
  const [debts,setDebts] = useState<DebtItem[]>([{ name:"Banklening", amount:75000, rate:0.055, termMonths:60, graceMonths:6, method:"annuity", startMonth:1 }]);
  const [taxes,setTaxes] = useState<Taxes>({ citRatePct:0.25, citPaymentMonth:11 });
  const [wc,setWc] = useState<WorkingCapital>({ dsoDays:45, dpoDays:30, dioDays:0 });
  const [step,setStep] = useState(1);

  const calc = useMemo(()=>buildPlan({
    openingCash:meta.openingCash, equity:meta.equity, revenueDrivers, varCosts, payroll, opex, capex, debts, taxes, wc
  }),[meta,revenueDrivers,varCosts,payroll,opex,capex,debts,taxes,wc]);

  const exportCSV = ()=>{
    const plRows:(string|number)[][] = [
      ["", "Jaar 1","Jaar 2","Jaar 3"],
      ["Opbrengsten", ...calc.pl.map(y=>Math.round(y.sales))],
      ["Variabele kosten", ...calc.pl.map(y=>Math.round(y.vc))],
      ["Brutowinst", ...calc.pl.map(y=>Math.round(y.gm))],
      ["Bezoldigingen", ...calc.pl.map(y=>Math.round(y.pay))],
      ["Bedrijfskosten", ...calc.pl.map(y=>Math.round(y.op))],
      ["Afschrijvingen", ...calc.pl.map(y=>Math.round(y.dep))],
      ["Financiële kosten", ...calc.pl.map(y=>Math.round(y.intst))],
      ["EBIT", ...calc.pl.map(y=>Math.round(y.ebit))],
      ["EBT", ...calc.pl.map(y=>Math.round(y.ebt))],
      ["Belastingen (expense)", ...calc.pl.map(y=>Math.round(y.taxExpense))],
      ["Resultaat na belasting", ...calc.pl.map(y=>Math.round(y.result))],
    ];
    const cashRows:(string|number)[][] = [["Maand","Cashflow","Cumulatief cash"]];
    months.forEach((m,i)=>cashRows.push([m, Math.round(calc.cashflow[i]), Math.round((meta.openingCash||0)+calc.cash[i])]));
    const balRows:(string|number)[][] = [
      ["Snapshot (maand)", 12,24,36],
      ["Vaste activa (netto)", ...calc.snapshots.map(s=>Math.round(s.assets.fixedAssetsNet))],
      ["Cash", ...calc.snapshots.map(s=>Math.round(s.assets.cash))],
      ["Schulden", ...calc.snapshots.map(s=>Math.round(s.liab.debt))],
      ["Eigen vermogen", ...calc.snapshots.map(s=>Math.round(s.liab.equity))],
    ];
    dl("profit_and_loss.csv", toCSV(plRows));
    dl("cashflow.csv", toCSV(cashRows));
    dl("balance_snapshots.csv", toCSV(balRows));
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-neutral-50 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Financieel Plan Wizard – 3 jaar</h1>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-xl border" onClick={()=>window.print()}>Print / PDF</button>
          <button className="px-3 py-2 rounded-xl border" onClick={exportCSV}>Exporteer CSV</button>
        </div>
      </div>

      <Section title={`Stap ${step} van 6`}>
        {step===1 && (
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm mb-1">Bedrijfsnaam</label><input className="w-full border rounded-xl p-2" value={meta.company} onChange={e=>setMeta({...meta, company:e.target.value})}/></div>
            <div><label className="block text-sm mb-1">Opening cash (€)</label><input type="number" className="w-full border rounded-xl p-2" value={meta.openingCash} onChange={e=>setMeta({...meta, openingCash:Number(e.target.value)})}/></div>
            <div><label className="block text-sm mb-1">Eigen vermogen bij start (€)</label><input type="number" className="w-full border rounded-xl p-2" value={meta.equity} onChange={e=>setMeta({...meta, equity:Number(e.target.value)})}/></div>
          </div>
        )}

        {step===2 && (
          <div>
            <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Omzetdrivers</h3>
              <button className="px-3 py-1 rounded-xl border" onClick={()=>setRevenueDrivers([...revenueDrivers,{name:"Nieuwe lijn",startMonth:1,units:1,price:100,monthlyGrowthPct:0}])}>+ Voeg toe</button></div>
            {revenueDrivers.map((d,i)=>(
              <div key={i} className="grid md:grid-cols-5 gap-3 mb-3">
                <input className="border rounded-xl p-2" value={d.name} onChange={e=>{const a=[...revenueDrivers]; a[i].name=e.target.value; setRevenueDrivers(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={d.startMonth} onChange={e=>{const a=[...revenueDrivers]; a[i].startMonth=Number(e.target.value); setRevenueDrivers(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={d.units} onChange={e=>{const a=[...revenueDrivers]; a[i].units=Number(e.target.value); setRevenueDrivers(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={d.price} onChange={e=>{const a=[...revenueDrivers]; a[i].price=Number(e.target.value); setRevenueDrivers(a);}}/>
                <input type="number" step="0.01" className="border rounded-xl p-2" value={d.monthlyGrowthPct} onChange={e=>{const a=[...revenueDrivers]; a[i].monthlyGrowthPct=Number(e.target.value); setRevenueDrivers(a);}}/>
              </div>
            ))}
          </div>
        )}

        {step===3 && (
          <div>
            <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Variabele kosten (% van omzet)</h3>
              <button className="px-3 py-1 rounded-xl border" onClick={()=>setVarCosts([...varCosts,{name:"Nieuwe VC", pctOfSales:0.1}])}>+ Voeg toe</button></div>
            {varCosts.map((v,i)=>(
              <div key={i} className="grid md:grid-cols-2 gap-3 mb-3">
                <input className="border rounded-xl p-2" value={v.name} onChange={e=>{const a=[...varCosts]; a[i].name=e.target.value; setVarCosts(a);}}/>
                <input type="number" step="0.01" className="border rounded-xl p-2" value={v.pctOfSales} onChange={e=>{const a=[...varCosts]; a[i].pctOfSales=Number(e.target.value); setVarCosts(a);}}/>
              </div>
            ))}
          </div>
        )}

        {step===4 && (
          <div>
            <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Bezoldigingen</h3>
              <button className="px-3 py-1 rounded-xl border" onClick={()=>setPayroll([...payroll,{role:"Nieuw",grossPerMonth:3000,onCostPct:0.3,startMonth:1}])}>+ Voeg toe</button></div>
            {payroll.map((p,i)=>(
              <div key={i} className="grid md:grid-cols-4 gap-3 mb-3">
                <input className="border rounded-xl p-2" value={p.role} onChange={e=>{const a=[...payroll]; a[i].role=e.target.value; setPayroll(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={p.grossPerMonth} onChange={e=>{const a=[...payroll]; a[i].grossPerMonth=Number(e.target.value); setPayroll(a);}}/>
                <input type="number" step="0.01" className="border rounded-xl p-2" value={p.onCostPct} onChange={e=>{const a=[...payroll]; a[i].onCostPct=Number(e.target.value); setPayroll(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={p.startMonth} onChange={e=>{const a=[...payroll]; a[i].startMonth=Number(e.target.value); setPayroll(a);}}/>
              </div>
            ))}
          </div>
        )}

        {step===5 && (
          <div>
            <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">OPEX (jaarbedragen, gelijkmatig per maand)</h3>
              <button className="px-3 py-1 rounded-xl border" onClick={()=>setOpex([...opex,{name:"Nieuwe kost",amountYear1:1200,indexPctPerYear:0.02,startMonth:1}])}>+ Voeg toe</button></div>
            {opex.map((o,i)=>(
              <div key={i} className="grid md:grid-cols-4 gap-3 mb-3">
                <input className="border rounded-xl p-2" value={o.name} onChange={e=>{const a=[...opex]; a[i].name=e.target.value; setOpex(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={o.amountYear1} onChange={e=>{const a=[...opex]; a[i].amountYear1=Number(e.target.value); setOpex(a);}}/>
                <input type="number" step="0.01" className="border rounded-xl p-2" value={o.indexPctPerYear} onChange={e=>{const a=[...opex]; a[i].indexPctPerYear=Number(e.target.value); setOpex(a);}}/>
                <input type="number" className="border rounded-xl p-2" value={o.startMonth} onChange={e=>{const a=[...opex]; a[i].startMonth=Number(e.target.value); setOpex(a);}}/>
              </div>
            ))}
          </div>
        )}

        {step===6 && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div><label className="block text-sm mb-1">CIT tarief</label><input type="number" step="0.01" className="w-full border rounded-xl p-2" value={taxes.citRatePct} onChange={e=>setTaxes({...taxes, citRatePct:Number(e.target.value)})}/></div>
              <div><label className="block text-sm mb-1">CIT betaalmaand</label>
                <select className="w-full border rounded-xl p-2" value={taxes.citPaymentMonth} onChange={e=>setTaxes({...taxes, citPaymentMonth:Number(e.target.value) as any})}>
                  <option value={11}>November</option><option value={12}>December</option><option value={6}>Juni</option><option value={3}>Maart</option>
                </select></div>
              <div><label className="block text-sm mb-1">DSO (dagen)</label><input type="number" className="w-full border rounded-xl p-2" value={wc.dsoDays} onChange={e=>setWc({...wc, dsoDays:Number(e.target.value)})}/></div>
              <div><label className="block text-sm mb-1">DPO (dagen)</label><input type="number" className="w-full border rounded-xl p-2" value={wc.dpoDays} onChange={e=>setWc({...wc, dpoDays:Number(e.target.value)})}/></div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-neutral-100 rounded-xl p-4"><div className="text-sm text-neutral-600">Omzet Y1–Y3</div><div className="text-2xl font-bold">{fmt(calc.pl[0].sales+calc.pl[1].sales+calc.pl[2].sales)}</div></div>
              <div className="bg-neutral-100 rounded-xl p-4"><div className="text-sm text-neutral-600">EBIT Y1</div><div className="text-2xl font-bold">{fmt(calc.pl[0].ebit)}</div></div>
              <div className="bg-neutral-100 rounded-xl p-4"><div className="text-sm text-neutral-600">Cash einde Y3</div><div className="text-2xl font-bold">{fmt((meta.openingCash||0)+calc.cash[35])}</div></div>
            </div>

            <div className="overflow-x-auto">
              <h3 className="font-semibold mb-2">Resultatenrekening (samenvatting)</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th className="py-2">Post</th><th>J1</th><th>J2</th><th>J3</th></tr></thead>
                <tbody>
                  {["Opbrengsten","Variabele kosten","Brutowinst","Bezoldigingen","Bedrijfskosten","Afschrijvingen","Financiële kosten","EBIT","EBT","Belastingen (expense)","Resultaat na belasting"].map((label,idx)=>(
                    <tr key={label} className="border-b">
                      <td className="py-1">{label}</td>
                      <td>{fmt([calc.pl[0].sales,calc.pl[0].vc,calc.pl[0].gm,calc.pl[0].pay,calc.pl[0].op,calc.pl[0].dep,calc.pl[0].intst,calc.pl[0].ebit,calc.pl[0].ebt,calc.pl[0].taxExpense,calc.pl[0].result][idx])}</td>
                      <td>{fmt([calc.pl[1].sales,calc.pl[1].vc,calc.pl[1].gm,calc.pl[1].pay,calc.pl[1].op,calc.pl[1].dep,calc.pl[1].intst,calc.pl[1].ebit,calc.pl[1].ebt,calc.pl[1].taxExpense,calc.pl[1].result][idx])}</td>
                      <td>{fmt([calc.pl[2].sales,calc.pl[2].vc,calc.pl[2].gm,calc.pl[2].pay,calc.pl[2].op,calc.pl[2].dep,calc.pl[2].intst,calc.pl[2].ebit,calc.pl[2].ebt,calc.pl[2].taxExpense,calc.pl[2].result][idx])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <h3 className="font-semibold mb-2">Kasplanning (maandelijks)</h3>
              <table className="w-full text-xs">
                <thead><tr className="text-left border-b"><th className="py-2">Maand</th><th>Cashflow</th><th>Cumulatief cash</th></tr></thead>
                <tbody>{months.map((m,i)=>(
                  <tr key={m} className="border-b"><td className="py-1">{m}</td><td>{fmt(calc.cashflow[i])}</td><td>{fmt((meta.openingCash||0)+calc.cash[i])}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <div className="flex justify-between">
        <button disabled={step===1} className="px-4 py-2 rounded-xl border disabled:opacity-50" onClick={()=>setStep(s=>Math.max(1,s-1))}>Terug</button>
        <button disabled={step===6} className="px-4 py-2 rounded-xl border disabled:opacity-50" onClick={()=>setStep(s=>Math.min(6,s+1))}>Volgende</button>
      </div>

      <style>{`@media print { button, input, select { display: none !important; } table { page-break-inside: avoid; } }`}</style>
    </div>
  );
}
