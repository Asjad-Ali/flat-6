import { formatDate } from '../domain/dates';
import { formatPKR } from '../domain/money';
import type { ReportData, ReportExpense } from './data';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function splitText(e: ReportExpense): string {
  if (e.splits.length === 0) return '—';
  if (e.splitMode === 'equal') return `Equally: ${e.splits.map((s) => esc(s.name)).join(', ')}`;
  return e.splits.map((s) => `${esc(s.name)} ${formatPKR(s.amount)}`).join(', ');
}

function balanceCell(balance: number): string {
  if (balance > 0) return `<td class="num pos">+${formatPKR(balance)}<br><small>Gets back</small></td>`;
  if (balance < 0) return `<td class="num neg">−${formatPKR(-balance)}<br><small>Owes</small></td>`;
  return `<td class="num">Rs. 0<br><small>Settled</small></td>`;
}

/** Builds a printable A4 HTML report. Pure: no I/O, so it is easy to test. */
export function buildReportHtml(d: ReportData): string {
  const expenseRows = d.expenses
    .map(
      (e, i) => `<tr>
        <td>${i + 1}</td>
        <td class="nowrap">${formatDate(e.date)}</td>
        <td><b>${esc(e.title)}</b><br><small>${esc(e.category)}${e.description ? ` · ${esc(e.description)}` : ''}</small></td>
        <td>${e.paidByName ? esc(e.paidByName) : '<i>not set</i>'}${e.createdByName ? `<br><small>added by ${esc(e.createdByName)}</small>` : ''}</td>
        <td><small>${splitText(e)}</small></td>
        <td class="num">${formatPKR(e.amount)}</td>
      </tr>`,
    )
    .join('');

  const settlementRows = d.settlements
    .map(
      (s) => `<tr>
        <td class="nowrap">${formatDate(s.date)}</td>
        <td>${esc(s.fromName)} → ${esc(s.toName)}${s.note ? `<br><small>${esc(s.note)}</small>` : ''}</td>
        <td class="num">${formatPKR(s.amount)}</td>
      </tr>`,
    )
    .join('');

  const memberRows = d.members
    .map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${formatPKR(m.paid)}</td><td class="num">${formatPKR(m.share)}</td></tr>`)
    .join('');

  const balanceRows = d.balances
    .map((b) => `<tr><td>${esc(b.name)}${b.isActive ? '' : ' (former)'}</td><td class="num">${formatPKR(b.paid)}</td><td class="num">${formatPKR(b.share)}</td>${balanceCell(b.balance)}</tr>`)
    .join('');

  const planRows = d.plan
    .map((p) => `<tr><td><b>${esc(p.fromName)}</b> pays <b>${esc(p.toName)}</b></td><td class="num neg">${formatPKR(p.amount)}</td></tr>`)
    .join('');

  const categoryRows = d.categories
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.count}</td><td class="num">${formatPKR(c.total)}</td></tr>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flat Expense Report – ${esc(d.period.label)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
  h1 { font-size: 20px; margin: 0; color: #3730a3; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #3730a3; border-bottom: 2px solid #e0e7ff; padding-bottom: 3px; }
  .sub { color: #64748b; margin-top: 2px; }
  .cards { display: flex; gap: 8px; margin-top: 12px; }
  .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .card .k { color: #64748b; font-size: 10px; }
  .card .v { font-size: 15px; font-weight: 800; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #eef2ff; color: #3730a3; font-size: 10px; padding: 5px 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .pos { color: #16a34a; font-weight: 700; }
  .neg { color: #dc2626; font-weight: 700; }
  small { color: #64748b; }
  .empty { color: #94a3b8; font-style: italic; padding: 6px; }
  tfoot td { font-weight: 800; border-top: 2px solid #e5e7eb; }
  .foot { margin-top: 18px; color: #94a3b8; font-size: 9px; text-align: center; }
</style></head>
<body>
  <h1>Flat Expense Report</h1>
  <div class="sub">${esc(d.period.label)} · Generated ${formatDate(d.generatedOn, 'long')}</div>

  <div class="cards">
    <div class="card"><div class="k">Total expenses</div><div class="v">${formatPKR(d.total)}</div></div>
    <div class="card"><div class="k">Expenses</div><div class="v">${d.expenses.length}</div></div>
    <div class="card"><div class="k">Paid back between members</div><div class="v">${formatPKR(d.settlements.reduce((a, s) => a + s.amount, 0))}</div></div>
  </div>

  <h2>Who pays whom (to settle everyone now)</h2>
  ${d.plan.length ? `<table><tbody>${planRows}</tbody></table>` : '<div class="empty">Everyone is settled up.</div>'}

  <h2>Current balances</h2>
  ${d.balances.length ? `<table><thead><tr><th>Member</th><th class="num">Paid</th><th class="num">Share</th><th class="num">Balance</th></tr></thead><tbody>${balanceRows}</tbody></table>` : '<div class="empty">No members.</div>'}

  <h2>Expenses (${d.expenses.length})</h2>
  ${d.expenses.length ? `<table><thead><tr><th>#</th><th>Date</th><th>Expense</th><th>Paid by</th><th>Split</th><th class="num">Amount</th></tr></thead><tbody>${expenseRows}</tbody><tfoot><tr><td colspan="5">Total</td><td class="num">${formatPKR(d.total)}</td></tr></tfoot></table>` : '<div class="empty">No expenses in this period.</div>'}

  <h2>Paid vs share in this period</h2>
  ${d.members.length ? `<table><thead><tr><th>Member</th><th class="num">Paid for group</th><th class="num">Own share</th></tr></thead><tbody>${memberRows}</tbody></table>` : '<div class="empty">No expenses in this period.</div>'}

  <h2>By category</h2>
  ${d.categories.length ? `<table><thead><tr><th>Category</th><th class="num">Entries</th><th class="num">Total</th></tr></thead><tbody>${categoryRows}</tbody></table>` : '<div class="empty">No expenses in this period.</div>'}

  <h2>Payments between members (${d.settlements.length})</h2>
  ${d.settlements.length ? `<table><thead><tr><th>Date</th><th>Payment</th><th class="num">Amount</th></tr></thead><tbody>${settlementRows}</tbody></table>` : '<div class="empty">No payments in this period.</div>'}

  <div class="foot">Flat Expense Manager</div>
</body></html>`;
}
