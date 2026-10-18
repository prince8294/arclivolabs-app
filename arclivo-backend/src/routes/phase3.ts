import { Router, Request, Response } from 'express';
import { requireOwner } from '../middleware/security';
import { store } from '../models/store';
import {
  ProposalStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentConfirmationStatus,
  IProposalService,
  IPaymentMilestoneEntry,
  IInvoiceItem,
} from '../models/types';

const router = Router();
router.use(requireOwner);

const safeError = (res: Response, error: unknown, status = 500): void => {
  if (status >= 500) res.status(status).json({ error: 'Internal server error.' });
  else res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
};

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;

const safePaise = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

const safePercent = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const VALID_PROPOSAL_STATUSES: ProposalStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'];
const VALID_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'];
const VALID_PAYMENT_METHODS: PaymentMethod[] = ['upi', 'bank_transfer', 'cash', 'cheque', 'other'];
const VALID_CONFIRMATION_STATUSES: PaymentConfirmationStatus[] = ['pending', 'confirmed', 'rejected', 'reversed'];

// ─── Company Profile ────────────────────────────────────────────────────────

router.get('/company-profile', async (_req: Request, res: Response) => {
  res.json(await store.getCompanyProfile());
});

router.put('/company-profile', async (req: Request, res: Response) => {
  const body = req.body || {};
  const updates: Record<string, any> = {};
  const strFields = ['companyName', 'ownerName', 'email', 'mobile', 'address', 'city', 'state', 'pincode', 'website', 'gstin', 'pan', 'bankName', 'bankAccountNumber', 'bankIfsc', 'upiId'];
  for (const field of strFields) {
    if (typeof body[field] === 'string') updates[field] = body[field].trim().slice(0, 500);
  }
  if (typeof body.logoBase64 === 'string') updates.logoBase64 = body.logoBase64.slice(0, 500_000);
  const profile = await store.updateCompanyProfile(updates);
  res.json({ success: true, profile });
});

// ─── Proposals ──────────────────────────────────────────────────────────────

router.get('/proposals', async (req: Request, res: Response) => {
  const { clientId, status, search } = req.query as Record<string, string>;
  const proposals = await store.getProposals({ clientId, status, search });
  res.json({ proposals, total: proposals.length });
});

router.get('/proposals/:id', async (req: Request, res: Response) => {
  const proposal = await store.getProposalById(req.params.id);
  if (!proposal) { res.status(404).json({ error: 'Proposal not found.' }); return; }
  const client = await store.getClientById(proposal.clientId);
  const project = proposal.projectId ? await store.getProjectById(proposal.projectId) : null;
  res.json({ proposal, client, project });
});

router.post('/proposals', async (req: Request, res: Response) => {
  const b = req.body;
  const clientId = text(b.clientId, 100);
  const title = text(b.title, 500);
  if (!clientId || !title) { res.status(400).json({ error: 'Client ID and title are required.' }); return; }
  const client = await store.getClientById(clientId);
  if (!client) { res.status(404).json({ error: 'Client not found.' }); return; }

  const services: IProposalService[] = Array.isArray(b.services) ? b.services.map((s: any, i: number) => ({
    id: `svc_${Date.now()}_${i}`,
    serviceName: typeof s.serviceName === 'string' ? s.serviceName.trim().slice(0, 200) : '',
    description: typeof s.description === 'string' ? s.description.trim().slice(0, 2000) : '',
    quantityLabel: typeof s.quantityLabel === 'string' ? s.quantityLabel.trim().slice(0, 100) : '1',
    amountPaise: safePaise(s.amountPaise) ?? 0,
  })) : [];

  const subtotalPaise = services.reduce((s, svc) => s + svc.amountPaise, 0);
  const discountPaise = safePaise(b.discountPaise) ?? 0;
  if (discountPaise > subtotalPaise) { res.status(400).json({ error: 'Discount cannot exceed proposal subtotal.' }); return; }
  const totalPaise = subtotalPaise - discountPaise;

  const paymentMilestones: IPaymentMilestoneEntry[] = Array.isArray(b.paymentMilestones) ? b.paymentMilestones.map((m: any, i: number) => ({
    id: `pms_${Date.now()}_${i}`,
    label: typeof m.label === 'string' ? m.label.trim().slice(0, 200) : '',
    percentage: safePercent(m.percentage) ?? 0,
    amountPaise: safePaise(m.amountPaise) ?? 0,
    dueCondition: typeof m.dueCondition === 'string' ? m.dueCondition.trim().slice(0, 500) : '',
  })) : [];

  const deliverables: string[] = Array.isArray(b.deliverables) ? b.deliverables.filter((d: any) => typeof d === 'string').map((d: string) => d.trim().slice(0, 500)) : [];

  const proposal = await store.addProposal({
    clientId,
    projectId: typeof b.projectId === 'string' ? b.projectId.trim() : undefined,
    title,
    introduction: typeof b.introduction === 'string' ? b.introduction.trim().slice(0, 5000) : '',
    services,
    subtotalPaise,
    discountPaise,
    totalPaise,
    currency: 'INR',
    estimatedDuration: typeof b.estimatedDuration === 'string' ? b.estimatedDuration.trim().slice(0, 200) : '',
    validUntil: typeof b.validUntil === 'string' ? b.validUntil.trim().slice(0, 10) : '',
    deliverables,
    terms: typeof b.terms === 'string' ? b.terms.trim().slice(0, 10000) : '',
    paymentMilestones,
    status: 'draft',
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 5000) : '',
  });
  res.status(201).json({ success: true, proposal });
});

router.put('/proposals/:id', async (req: Request, res: Response) => {
  const b = req.body;
  const updates: Record<string, any> = {};

  if (typeof b.title === 'string') updates.title = b.title.trim().slice(0, 500);
  if (typeof b.introduction === 'string') updates.introduction = b.introduction.trim().slice(0, 5000);
  if (typeof b.estimatedDuration === 'string') updates.estimatedDuration = b.estimatedDuration.trim().slice(0, 200);
  if (typeof b.validUntil === 'string') updates.validUntil = b.validUntil.trim().slice(0, 10);
  if (typeof b.terms === 'string') updates.terms = b.terms.trim().slice(0, 10000);
  if (typeof b.notes === 'string') updates.notes = b.notes.trim().slice(0, 5000);
  if (typeof b.projectId === 'string') updates.projectId = b.projectId.trim();
  if (typeof b.convertedToProjectId === 'string') updates.convertedToProjectId = b.convertedToProjectId.trim();
  if (typeof b.convertedToInvoiceId === 'string') updates.convertedToInvoiceId = b.convertedToInvoiceId.trim();

  if (Array.isArray(b.services)) {
    const services = b.services.map((s: any, i: number) => ({
      id: s.id || `svc_${Date.now()}_${i}`,
      serviceName: typeof s.serviceName === 'string' ? s.serviceName.trim().slice(0, 200) : '',
      description: typeof s.description === 'string' ? s.description.trim().slice(0, 2000) : '',
      quantityLabel: typeof s.quantityLabel === 'string' ? s.quantityLabel.trim().slice(0, 100) : '1',
      amountPaise: safePaise(s.amountPaise) ?? 0,
    }));
    updates.services = services;
    updates.subtotalPaise = services.reduce((s: number, svc: any) => s + svc.amountPaise, 0);
    if (safePaise(b.discountPaise) !== null) updates.discountPaise = safePaise(b.discountPaise);
    if ((updates.discountPaise ?? 0) > updates.subtotalPaise) { res.status(400).json({ error: 'Discount cannot exceed proposal subtotal.' }); return; }
    updates.totalPaise = updates.subtotalPaise - (updates.discountPaise ?? 0);
  }

  if (Array.isArray(b.deliverables)) {
    updates.deliverables = b.deliverables.filter((d: any) => typeof d === 'string').map((d: string) => d.trim().slice(0, 500));
  }
  if (Array.isArray(b.paymentMilestones)) {
    updates.paymentMilestones = b.paymentMilestones.map((m: any, i: number) => ({
      id: m.id || `pms_${Date.now()}_${i}`,
      label: typeof m.label === 'string' ? m.label.trim().slice(0, 200) : '',
      percentage: safePercent(m.percentage) ?? 0,
      amountPaise: safePaise(m.amountPaise) ?? 0,
      dueCondition: typeof m.dueCondition === 'string' ? m.dueCondition.trim().slice(0, 500) : '',
    }));
  }
  if (typeof b.status === 'string' && VALID_PROPOSAL_STATUSES.includes(b.status)) updates.status = b.status;

  const result = await store.updateProposal(req.params.id, updates);
  if (!result) { res.status(404).json({ error: 'Proposal not found.' }); return; }
  res.json({ success: true, proposal: result });
});

router.post('/proposals/:id/duplicate', async (req: Request, res: Response) => {
  const original = await store.getProposalById(req.params.id);
  if (!original) { res.status(404).json({ error: 'Proposal not found.' }); return; }
  const copy = await store.addProposal({
    clientId: original.clientId,
    projectId: original.projectId,
    title: `${original.title} (Copy)`,
    introduction: original.introduction,
    services: original.services.map((s, i) => ({ ...s, id: `svc_${Date.now()}_${i}` })),
    subtotalPaise: original.subtotalPaise,
    discountPaise: original.discountPaise,
    totalPaise: original.totalPaise,
    currency: original.currency,
    estimatedDuration: original.estimatedDuration,
    validUntil: original.validUntil,
    deliverables: [...original.deliverables],
    terms: original.terms,
    paymentMilestones: original.paymentMilestones.map((m, i) => ({ ...m, id: `pms_${Date.now()}_${i}` })),
    status: 'draft',
    notes: original.notes,
  });
  res.status(201).json({ success: true, proposal: copy });
});

router.delete('/proposals/:id', async (req: Request, res: Response) => {
  const result = await store.deleteProposal(req.params.id);
  if (!result) { res.status(400).json({ error: 'Only draft proposals can be deleted.' }); return; }
  res.json({ success: true });
});

// ─── Invoices ───────────────────────────────────────────────────────────────

router.get('/invoices', async (req: Request, res: Response) => {
  const { clientId, projectId, status, search } = req.query as Record<string, string>;
  const invoices = await store.getInvoices({ clientId, projectId, status, search });
  res.json({ invoices, total: invoices.length });
});

router.get('/invoices/:id', async (req: Request, res: Response) => {
  const invoice = await store.getInvoiceById(req.params.id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found.' }); return; }
  const client = await store.getClientById(invoice.clientId);
  const project = invoice.projectId ? await store.getProjectById(invoice.projectId) : null;
  const payments = await store.getPayments({ invoiceId: invoice.id });
  res.json({ invoice, client, project, payments });
});

router.post('/invoices', async (req: Request, res: Response) => {
  const b = req.body;
  const clientId = text(b.clientId, 100);
  const title = text(b.title, 500);
  if (!clientId || !title) { res.status(400).json({ error: 'Client ID and title are required.' }); return; }
  const client = await store.getClientById(clientId);
  if (!client) { res.status(404).json({ error: 'Client not found.' }); return; }

  const items: IInvoiceItem[] = Array.isArray(b.items) ? b.items.map((item: any, i: number) => {
    const rawQty = Number(item.quantity);
    const qty = Number.isSafeInteger(rawQty) && rawQty > 0 && rawQty <= 1_000_000 ? rawQty : 1;
    const unitPaise = safePaise(item.unitPaise) ?? 0;
    return {
      id: `itm_${Date.now()}_${i}`,
      description: typeof item.description === 'string' ? item.description.trim().slice(0, 1000) : '',
      quantity: qty,
      unitPaise,
      totalPaise: qty * unitPaise,
    };
  }) : [];

  const subtotalPaise = items.reduce((s, itm) => s + itm.totalPaise, 0);
  const discountPaise = safePaise(b.discountPaise) ?? 0;
  const taxPercent = safePercent(b.taxPercent) ?? 0;
  if (discountPaise > subtotalPaise) { res.status(400).json({ error: 'Discount cannot exceed invoice subtotal.' }); return; }
  const taxableAmount = subtotalPaise - discountPaise;
  const taxAmountPaise = Math.round(taxableAmount * taxPercent / 100);
  const totalPaise = taxableAmount + taxAmountPaise;

  const invoice = await store.addInvoice({
    clientId,
    projectId: typeof b.projectId === 'string' ? b.projectId.trim() : undefined,
    proposalId: typeof b.proposalId === 'string' ? b.proposalId.trim() : undefined,
    title,
    items,
    subtotalPaise,
    discountPaise,
    taxLabel: typeof b.taxLabel === 'string' ? b.taxLabel.trim().slice(0, 100) : '',
    taxPercent,
    taxAmountPaise,
    totalPaise,
    currency: 'INR',
    issueDate: typeof b.issueDate === 'string' ? b.issueDate.trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
    dueDate: typeof b.dueDate === 'string' ? b.dueDate.trim().slice(0, 10) : '',
    paymentInstructions: typeof b.paymentInstructions === 'string' ? b.paymentInstructions.trim().slice(0, 5000) : '',
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 5000) : '',
    status: 'draft',
  });
  res.status(201).json({ success: true, invoice });
});

router.put('/invoices/:id', async (req: Request, res: Response) => {
  const b = req.body;
  const updates: Record<string, any> = {};

  if (typeof b.title === 'string') updates.title = b.title.trim().slice(0, 500);
  if (typeof b.issueDate === 'string') updates.issueDate = b.issueDate.trim().slice(0, 10);
  if (typeof b.dueDate === 'string') updates.dueDate = b.dueDate.trim().slice(0, 10);
  if (typeof b.paymentInstructions === 'string') updates.paymentInstructions = b.paymentInstructions.trim().slice(0, 5000);
  if (typeof b.notes === 'string') updates.notes = b.notes.trim().slice(0, 5000);
  if (typeof b.taxLabel === 'string') updates.taxLabel = b.taxLabel.trim().slice(0, 100);

  if (Array.isArray(b.items)) {
    const items = b.items.map((item: any, i: number) => {
      const rawQty = Number(item.quantity);
      const qty = Number.isSafeInteger(rawQty) && rawQty > 0 && rawQty <= 1_000_000 ? rawQty : 1;
      const unitPaise = safePaise(item.unitPaise) ?? 0;
      return { id: item.id || `itm_${Date.now()}_${i}`, description: typeof item.description === 'string' ? item.description.trim().slice(0, 1000) : '', quantity: qty, unitPaise, totalPaise: qty * unitPaise };
    });
    updates.items = items;
    updates.subtotalPaise = items.reduce((s: number, itm: any) => s + itm.totalPaise, 0);
    const dp = safePaise(b.discountPaise) ?? 0;
    updates.discountPaise = dp;
    const tp = safePercent(b.taxPercent) ?? 0;
    updates.taxPercent = tp;
    if (dp > updates.subtotalPaise) { res.status(400).json({ error: 'Discount cannot exceed invoice subtotal.' }); return; }
    const taxable = updates.subtotalPaise - dp;
    updates.taxAmountPaise = Math.round(taxable * tp / 100);
    updates.totalPaise = taxable + updates.taxAmountPaise;
    // Recalculate balance
    const current = await store.getInvoiceById(req.params.id);
    if (current) updates.balancePaise = updates.totalPaise - current.paidPaise;
  }

  if (typeof b.status === 'string' && VALID_INVOICE_STATUSES.includes(b.status) && b.status !== 'void') {
    updates.status = b.status;
  }

  const result = await store.updateInvoice(req.params.id, updates);
  if (!result) { res.status(404).json({ error: 'Invoice not found or is voided.' }); return; }
  res.json({ success: true, invoice: result });
});

router.post('/invoices/:id/void', async (req: Request, res: Response) => {
  const reason = text(req.body.reason, 1000) || 'Voided by owner';
  const result = await store.voidInvoice(req.params.id, reason);
  if (!result) { res.status(404).json({ error: 'Invoice not found or already voided.' }); return; }
  res.json({ success: true, invoice: result });
});

router.post('/invoices/from-proposal/:proposalId', async (req: Request, res: Response) => {
  const proposal = await store.getProposalById(req.params.proposalId);
  if (!proposal) { res.status(404).json({ error: 'Proposal not found.' }); return; }
  if (proposal.status !== 'accepted') { res.status(400).json({ error: 'Only accepted proposals can generate invoices.' }); return; }

  const items: IInvoiceItem[] = proposal.services.map((svc, i) => ({
    id: `itm_${Date.now()}_${i}`,
    description: `${svc.serviceName}${svc.description ? ' — ' + svc.description : ''}`,
    quantity: 1,
    unitPaise: svc.amountPaise,
    totalPaise: svc.amountPaise,
  }));

  const invoice = await store.addInvoice({
    clientId: proposal.clientId,
    projectId: proposal.projectId,
    proposalId: proposal.id,
    title: `Invoice for ${proposal.title}`,
    items,
    subtotalPaise: proposal.subtotalPaise,
    discountPaise: proposal.discountPaise,
    taxLabel: '',
    taxPercent: 0,
    taxAmountPaise: 0,
    totalPaise: proposal.totalPaise,
    currency: 'INR',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    paymentInstructions: '',
    notes: '',
    status: 'draft',
  });

  // Mark proposal
  await store.updateProposal(proposal.id, { convertedToInvoiceId: invoice.id });
  res.status(201).json({ success: true, invoice });
});

// ─── Payments ───────────────────────────────────────────────────────────────

router.get('/payments', async (req: Request, res: Response) => {
  const { invoiceId, clientId, status } = req.query as Record<string, string>;
  const payments = await store.getPayments({ invoiceId, clientId, status });
  res.json({ payments, total: payments.length });
});

router.get('/payments/:id', async (req: Request, res: Response) => {
  const payment = await store.getPaymentById(req.params.id);
  if (!payment) { res.status(404).json({ error: 'Payment not found.' }); return; }
  const invoice = await store.getInvoiceById(payment.invoiceId);
  const client = await store.getClientById(payment.clientId);
  res.json({ payment, invoice, client });
});

router.post('/payments', async (req: Request, res: Response) => {
  const b = req.body;
  const invoiceId = text(b.invoiceId, 100);
  const amountPaise = safePaise(b.amountPaise);
  if (!invoiceId || amountPaise === null || amountPaise <= 0) {
    res.status(400).json({ error: 'Invoice ID and a positive amount are required.' }); return;
  }
  const invoice = await store.getInvoiceById(invoiceId);
  if (!invoice || invoice.isVoid) { res.status(404).json({ error: 'Active invoice not found.' }); return; }
  const clientId = invoice.clientId;

  const method = VALID_PAYMENT_METHODS.includes(b.method) ? b.method : 'other';
  const confirmationStatus: PaymentConfirmationStatus =
    VALID_CONFIRMATION_STATUSES.includes(b.confirmationStatus) ? b.confirmationStatus : 'pending';

  const payment = await store.addPayment({
    invoiceId,
    clientId,
    amountPaise,
    currency: 'INR',
    method,
    referenceId: typeof b.referenceId === 'string' ? b.referenceId.trim().slice(0, 200) : '',
    paymentDate: typeof b.paymentDate === 'string' ? b.paymentDate.trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
    confirmationStatus,
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : '',
  });

  if (!payment) { res.status(400).json({ error: 'Payment rejected. Invoice may be void, or amount exceeds balance, or duplicate reference.' }); return; }
  res.status(201).json({ success: true, payment });
});

router.post('/payments/:id/confirm', async (req: Request, res: Response) => {
  const result = await store.confirmPayment(req.params.id);
  if (!result) { res.status(400).json({ error: 'Payment cannot be confirmed. May exceed invoice balance or is not pending.' }); return; }
  const invoice = await store.getInvoiceById(result.invoiceId);
  res.json({ success: true, payment: result, invoice });
});

router.post('/payments/:id/reject', async (req: Request, res: Response) => {
  const reason = text(req.body.reason, 1000) || 'Rejected by owner';
  const result = await store.rejectPayment(req.params.id, reason);
  if (!result) { res.status(400).json({ error: 'Payment is not in pending status.' }); return; }
  res.json({ success: true, payment: result });
});

router.post('/payments/:id/reverse', async (req: Request, res: Response) => {
  const reason = text(req.body.reason, 1000) || 'Reversed by owner';
  const result = await store.reversePayment(req.params.id, reason);
  if (!result) { res.status(400).json({ error: 'Only confirmed payments can be reversed.' }); return; }
  const invoice = await store.getInvoiceById(result.invoiceId);
  res.json({ success: true, payment: result, invoice });
});

// ─── Expenses ───────────────────────────────────────────────────────────────

router.get('/expenses', async (req: Request, res: Response) => {
  const { category, projectId, search, fromDate, toDate } = req.query as Record<string, string>;
  const expenses = await store.getExpenses({ category, projectId, search, fromDate, toDate });
  res.json({ expenses, total: expenses.length });
});

router.get('/expenses/:id', async (req: Request, res: Response) => {
  const expense = await store.getExpenseById(req.params.id);
  if (!expense) { res.status(404).json({ error: 'Expense not found.' }); return; }
  const project = expense.projectId ? await store.getProjectById(expense.projectId) : null;
  res.json({ expense, project });
});

router.post('/expenses', async (req: Request, res: Response) => {
  const b = req.body;
  const title = text(b.title, 500);
  const amountPaise = safePaise(b.amountPaise);
  if (!title || amountPaise === null || amountPaise <= 0) {
    res.status(400).json({ error: 'Title and positive amount are required.' }); return;
  }
  const expense = await store.addExpense({
    title,
    description: typeof b.description === 'string' ? b.description.trim().slice(0, 2000) : '',
    category: typeof b.category === 'string' ? b.category.trim().slice(0, 100) : 'other',
    amountPaise,
    currency: 'INR',
    expenseDate: typeof b.expenseDate === 'string' ? b.expenseDate.trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
    projectId: typeof b.projectId === 'string' ? b.projectId.trim() : undefined,
    receiptBase64: typeof b.receiptBase64 === 'string' ? b.receiptBase64.slice(0, 500_000) : undefined,
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : '',
  });
  res.status(201).json({ success: true, expense });
});

router.put('/expenses/:id', async (req: Request, res: Response) => {
  const b = req.body;
  const updates: Record<string, any> = {};
  if (typeof b.title === 'string') updates.title = b.title.trim().slice(0, 500);
  if (typeof b.description === 'string') updates.description = b.description.trim().slice(0, 2000);
  if (typeof b.category === 'string') updates.category = b.category.trim().slice(0, 100);
  if (safePaise(b.amountPaise) !== null) updates.amountPaise = safePaise(b.amountPaise);
  if (typeof b.expenseDate === 'string') updates.expenseDate = b.expenseDate.trim().slice(0, 10);
  if (typeof b.projectId === 'string') updates.projectId = b.projectId.trim();
  if (typeof b.notes === 'string') updates.notes = b.notes.trim().slice(0, 2000);
  if (typeof b.receiptBase64 === 'string') updates.receiptBase64 = b.receiptBase64.slice(0, 500_000);
  const result = await store.updateExpense(req.params.id, updates);
  if (!result) { res.status(404).json({ error: 'Expense not found.' }); return; }
  res.json({ success: true, expense: result });
});

router.delete('/expenses/:id', async (req: Request, res: Response) => {
  const result = await store.deleteExpense(req.params.id);
  if (!result) { res.status(404).json({ error: 'Expense not found.' }); return; }
  res.json({ success: true });
});

// ─── Finance Dashboard ──────────────────────────────────────────────────────

router.get('/finance/dashboard', async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query as Record<string, string>;
  res.json(await store.getFinanceDashboard({ fromDate, toDate }));
});

router.get('/finance/project/:projectId', async (req: Request, res: Response) => {
  const result = await store.getProjectFinancials(req.params.projectId);
  if (!result) { res.status(404).json({ error: 'Project not found.' }); return; }
  res.json(result);
});

// ─── Reports / Export ───────────────────────────────────────────────────────

router.get('/finance/reports/invoices', async (req: Request, res: Response) => {
  const { fromDate, toDate, clientId } = req.query as Record<string, string>;
  let invoices = await store.getInvoices({ clientId });
  if (fromDate) invoices = invoices.filter(i => i.issueDate >= fromDate);
  if (toDate) invoices = invoices.filter(i => i.issueDate <= toDate);
  // CSV export
  if (req.query.format === 'csv') {
    const header = 'Invoice Number,Client ID,Title,Issue Date,Due Date,Subtotal,Discount,Tax,Total,Paid,Balance,Status\n';
    const rows = invoices.map(i =>
      `${i.invoiceNumber},${i.clientId},"${i.title}",${i.issueDate},${i.dueDate},${(i.subtotalPaise / 100).toFixed(2)},${(i.discountPaise / 100).toFixed(2)},${(i.taxAmountPaise / 100).toFixed(2)},${(i.totalPaise / 100).toFixed(2)},${(i.paidPaise / 100).toFixed(2)},${(i.balancePaise / 100).toFixed(2)},${i.status}`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices_report.csv"');
    res.send(header + rows);
    return;
  }
  res.json({ invoices, total: invoices.length });
});

router.get('/finance/reports/payments', async (req: Request, res: Response) => {
  const { fromDate, toDate, clientId } = req.query as Record<string, string>;
  let payments = await store.getPayments({ clientId });
  if (fromDate) payments = payments.filter(p => p.paymentDate >= fromDate);
  if (toDate) payments = payments.filter(p => p.paymentDate <= toDate);
  if (req.query.format === 'csv') {
    const header = 'Payment ID,Invoice ID,Client ID,Amount,Method,Reference,Date,Status\n';
    const rows = payments.map(p =>
      `${p.id},${p.invoiceId},${p.clientId},${(p.amountPaise / 100).toFixed(2)},${p.method},${p.referenceId},${p.paymentDate},${p.confirmationStatus}`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payments_report.csv"');
    res.send(header + rows);
    return;
  }
  res.json({ payments, total: payments.length });
});

router.get('/finance/reports/expenses', async (req: Request, res: Response) => {
  const { fromDate, toDate, category, projectId } = req.query as Record<string, string>;
  const expenses = await store.getExpenses({ category, projectId, fromDate, toDate });
  if (req.query.format === 'csv') {
    const header = 'Title,Category,Amount,Date,Project ID,Description\n';
    const rows = expenses.map(e =>
      `"${e.title}",${e.category},${(e.amountPaise / 100).toFixed(2)},${e.expenseDate},${e.projectId || ''},"${e.description}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses_report.csv"');
    res.send(header + rows);
    return;
  }
  res.json({ expenses, total: expenses.length });
});

// ─── HTML Document Generation (for PDF preview / sharing) ───────────────────

const formatINR = (paise: number): string => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

router.get('/proposals/:id/html', async (req: Request, res: Response) => {
  const proposal = await store.getProposalById(req.params.id);
  if (!proposal) { res.status(404).json({ error: 'Proposal not found.' }); return; }
  const client = await store.getClientById(proposal.clientId);
  const company = await store.getCompanyProfile();

  const servicesRows = proposal.services.map(s => `<tr><td>${escapeHtml(s.serviceName)}</td><td>${escapeHtml(s.description)}</td><td>${escapeHtml(s.quantityLabel)}</td><td class="right">${formatINR(s.amountPaise)}</td></tr>`).join('');
  const deliverablesHtml = proposal.deliverables.map(d => `<li>${escapeHtml(d)}</li>`).join('');
  const milestonesHtml = proposal.paymentMilestones.map(m => `<tr><td>${escapeHtml(m.label)}</td><td>${m.percentage}%</td><td class="right">${formatINR(m.amountPaise)}</td><td>${escapeHtml(m.dueCondition)}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#0F172A;margin:0;padding:24px;font-size:13px;line-height:1.5}
.header{display:flex;justify-content:space-between;border-bottom:3px solid #0284C7;padding-bottom:16px;margin-bottom:24px}
.company{font-size:18px;font-weight:700;color:#0284C7}
.company-sub{font-size:12px;color:#64748B;margin-top:4px}
.title{font-size:20px;font-weight:700;margin-bottom:8px}
.meta{display:flex;gap:40px;margin-bottom:16px}
.meta-item{font-size:12px;color:#64748B}.meta-item strong{color:#0F172A;display:block}
.section{margin-top:20px;margin-bottom:12px;font-size:14px;font-weight:700;color:#0284C7;border-bottom:1px solid #E2E8F0;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#F0F9FF;text-align:left;padding:8px;font-size:12px;border-bottom:2px solid #BAE6FD}
td{padding:8px;border-bottom:1px solid #F1F5F9;font-size:12px}
.right{text-align:right}
.totals{margin-top:12px;text-align:right}
.totals td{padding:4px 8px;font-size:13px}
.total-row{font-weight:700;font-size:15px;color:#0284C7}
.terms{font-size:11px;color:#64748B;white-space:pre-wrap}
ul{padding-left:20px}li{margin-bottom:4px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#E0F2FE;color:#0369A1}
</style></head><body>
<div class="header">
  <div><div class="company">${escapeHtml(company.companyName || 'Arclivo Labs')}</div>
  <div class="company-sub">${escapeHtml([company.address, company.city, company.state, company.pincode].filter(Boolean).join(', '))}<br/>
  ${escapeHtml([company.email, company.mobile].filter(Boolean).join(' | '))}${company.website ? '<br/>' + escapeHtml(company.website) : ''}</div></div>
  <div style="text-align:right"><div class="title">PROPOSAL</div>
  <div class="meta-item"><strong>${escapeHtml(proposal.proposalNumber)}</strong></div>
  <div class="badge">${escapeHtml(proposal.status.toUpperCase())}</div></div>
</div>
<div class="meta">
  <div class="meta-item"><strong>Client</strong>${escapeHtml(client?.clientName || 'N/A')}${client?.companyName ? '<br/>' + escapeHtml(client.companyName) : ''}${client?.email ? '<br/>' + escapeHtml(client.email) : ''}</div>
  <div class="meta-item"><strong>Date</strong>${new Date(proposal.createdAt).toLocaleDateString('en-IN')}</div>
  <div class="meta-item"><strong>Valid Until</strong>${proposal.validUntil || 'N/A'}</div>
  <div class="meta-item"><strong>Est. Duration</strong>${proposal.estimatedDuration || 'N/A'}</div>
</div>
${proposal.introduction ? `<p>${escapeHtml(proposal.introduction)}</p>` : ''}
<div class="section">Scope of Work</div>
<table><thead><tr><th>Service</th><th>Description</th><th>Qty</th><th class="right">Amount</th></tr></thead><tbody>${servicesRows}</tbody></table>
<table class="totals"><tr><td>Subtotal:</td><td class="right">${formatINR(proposal.subtotalPaise)}</td></tr>
${proposal.discountPaise > 0 ? `<tr><td>Discount:</td><td class="right">-${formatINR(proposal.discountPaise)}</td></tr>` : ''}
<tr class="total-row"><td>Total:</td><td class="right">${formatINR(proposal.totalPaise)}</td></tr></table>
${proposal.deliverables.length > 0 ? `<div class="section">Deliverables</div><ul>${deliverablesHtml}</ul>` : ''}
${proposal.paymentMilestones.length > 0 ? `<div class="section">Payment Schedule</div><table><thead><tr><th>Milestone</th><th>%</th><th class="right">Amount</th><th>Condition</th></tr></thead><tbody>${milestonesHtml}</tbody></table>` : ''}
${proposal.terms ? `<div class="section">Terms & Conditions</div><div class="terms">${escapeHtml(proposal.terms)}</div>` : ''}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/invoices/:id/html', async (req: Request, res: Response) => {
  const invoice = await store.getInvoiceById(req.params.id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found.' }); return; }
  const client = await store.getClientById(invoice.clientId);
  const company = await store.getCompanyProfile();
  const payments = await store.getPayments({ invoiceId: invoice.id });

  const itemsRows = invoice.items.map(i => `<tr><td>${escapeHtml(i.description)}</td><td class="right">${i.quantity}</td><td class="right">${formatINR(i.unitPaise)}</td><td class="right">${formatINR(i.totalPaise)}</td></tr>`).join('');
  const paymentsRows = payments.filter(p => p.confirmationStatus === 'confirmed').map(p => `<tr><td>${new Date(p.paymentDate).toLocaleDateString('en-IN')}</td><td>${escapeHtml(p.method.replace('_', ' ').toUpperCase())}</td><td>${escapeHtml(p.referenceId || '-')}</td><td class="right">${formatINR(p.confirmedAmountPaise)}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#0F172A;margin:0;padding:24px;font-size:13px;line-height:1.5}
.header{display:flex;justify-content:space-between;border-bottom:3px solid #0284C7;padding-bottom:16px;margin-bottom:24px}
.company{font-size:18px;font-weight:700;color:#0284C7}
.company-sub{font-size:12px;color:#64748B;margin-top:4px}
.title{font-size:20px;font-weight:700;margin-bottom:8px}
.meta{display:flex;gap:40px;margin-bottom:16px}
.meta-item{font-size:12px;color:#64748B}.meta-item strong{color:#0F172A;display:block}
.section{margin-top:20px;margin-bottom:12px;font-size:14px;font-weight:700;color:#0284C7;border-bottom:1px solid #E2E8F0;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#F0F9FF;text-align:left;padding:8px;font-size:12px;border-bottom:2px solid #BAE6FD}
td{padding:8px;border-bottom:1px solid #F1F5F9;font-size:12px}
.right{text-align:right}
.totals{margin-top:12px;text-align:right}
.totals td{padding:4px 8px;font-size:13px}
.total-row{font-weight:700;font-size:15px;color:#0284C7}
.balance-row{font-weight:700;font-size:16px;color:#DC2626}
.paid-row{color:#16A34A;font-weight:600}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700}
.badge-paid{background:#DCFCE7;color:#16A34A}.badge-draft{background:#F1F5F9;color:#64748B}
.badge-issued{background:#E0F2FE;color:#0369A1}.badge-overdue{background:#FEE2E2;color:#DC2626}
.badge-void{background:#F1F5F9;color:#94A3B8;text-decoration:line-through}
.terms{font-size:11px;color:#64748B;white-space:pre-wrap}
${company.gstin ? '.gstin{font-size:11px;color:#64748B;margin-top:2px}' : ''}
</style></head><body>
<div class="header">
  <div><div class="company">${escapeHtml(company.companyName || 'Arclivo Labs')}</div>
  <div class="company-sub">${escapeHtml([company.address, company.city, company.state, company.pincode].filter(Boolean).join(', '))}<br/>
  ${escapeHtml([company.email, company.mobile].filter(Boolean).join(' | '))}${company.website ? '<br/>' + escapeHtml(company.website) : ''}
  ${company.gstin ? '<br/>GSTIN: ' + escapeHtml(company.gstin) : ''}</div></div>
  <div style="text-align:right"><div class="title">TAX INVOICE</div>
  <div class="meta-item"><strong>${escapeHtml(invoice.invoiceNumber)}</strong></div>
  <div class="badge badge-${invoice.status === 'paid' ? 'paid' : invoice.status === 'overdue' ? 'overdue' : invoice.status === 'void' ? 'void' : invoice.status === 'issued' ? 'issued' : 'draft'}">${invoice.status.replace('_', ' ').toUpperCase()}</div></div>
</div>
<div class="meta">
  <div class="meta-item"><strong>Bill To</strong>${escapeHtml(client?.clientName || 'N/A')}${client?.companyName ? '<br/>' + escapeHtml(client.companyName) : ''}${client?.email ? '<br/>' + escapeHtml(client.email) : ''}${client?.mobile ? '<br/>' + escapeHtml(client.mobile) : ''}</div>
  <div class="meta-item"><strong>Issue Date</strong>${invoice.issueDate || 'N/A'}</div>
  <div class="meta-item"><strong>Due Date</strong>${invoice.dueDate || 'N/A'}</div>
</div>
<div class="section">Items</div>
<table><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead><tbody>${itemsRows}</tbody></table>
<table class="totals">
<tr><td>Subtotal:</td><td class="right">${formatINR(invoice.subtotalPaise)}</td></tr>
${invoice.discountPaise > 0 ? `<tr><td>Discount:</td><td class="right">-${formatINR(invoice.discountPaise)}</td></tr>` : ''}
${invoice.taxAmountPaise > 0 ? `<tr><td>${invoice.taxLabel || 'Tax'} (${invoice.taxPercent}%):</td><td class="right">${formatINR(invoice.taxAmountPaise)}</td></tr>` : ''}
<tr class="total-row"><td>Total:</td><td class="right">${formatINR(invoice.totalPaise)}</td></tr>
${invoice.paidPaise > 0 ? `<tr class="paid-row"><td>Paid:</td><td class="right">-${formatINR(invoice.paidPaise)}</td></tr>` : ''}
<tr class="balance-row"><td>Balance Due:</td><td class="right">${formatINR(invoice.balancePaise)}</td></tr>
</table>
${paymentsRows ? `<div class="section">Payment History</div><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="right">Amount</th></tr></thead><tbody>${paymentsRows}</tbody></table>` : ''}
${invoice.paymentInstructions ? `<div class="section">Payment Instructions</div><div class="terms">${escapeHtml(invoice.paymentInstructions)}</div>` : ''}
${company.bankName ? `<div class="section">Bank Details</div><table><tr><td><strong>Bank:</strong> ${escapeHtml(company.bankName)}</td><td><strong>A/C:</strong> ${escapeHtml(company.bankAccountNumber)}</td><td><strong>IFSC:</strong> ${escapeHtml(company.bankIfsc)}</td></tr>${company.upiId ? `<tr><td colspan="3"><strong>UPI:</strong> ${escapeHtml(company.upiId)}</td></tr>` : ''}</table>` : ''}
${invoice.notes ? `<div class="section">Notes</div><div class="terms">${escapeHtml(invoice.notes)}</div>` : ''}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/payments/:id/receipt-html', async (req: Request, res: Response) => {
  const payment = await store.getPaymentById(req.params.id);
  if (!payment) { res.status(404).json({ error: 'Payment not found.' }); return; }
  const invoice = await store.getInvoiceById(payment.invoiceId);
  const client = await store.getClientById(payment.clientId);
  const company = await store.getCompanyProfile();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#0F172A;margin:0;padding:24px;font-size:13px;line-height:1.5}
.header{text-align:center;border-bottom:3px solid #16A34A;padding-bottom:16px;margin-bottom:24px}
.company{font-size:18px;font-weight:700;color:#0284C7}
.title{font-size:22px;font-weight:700;color:#16A34A;margin-top:8px}
.meta{display:flex;gap:40px;margin-bottom:16px;justify-content:center}
.meta-item{font-size:12px;color:#64748B;text-align:center}.meta-item strong{color:#0F172A;display:block}
table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:10px;border-bottom:1px solid #F1F5F9;font-size:13px}
.amount{font-size:28px;font-weight:700;color:#16A34A;text-align:center;margin:20px 0}
.badge{display:inline-block;padding:4px 16px;border-radius:12px;font-size:12px;font-weight:700;background:#DCFCE7;color:#16A34A}
.footer{text-align:center;font-size:11px;color:#94A3B8;margin-top:32px}
</style></head><body>
<div class="header">
  <div class="company">${escapeHtml(company.companyName || 'Arclivo Labs')}</div>
  <div class="title">PAYMENT RECEIPT</div>
  <div class="badge">${payment.confirmationStatus.toUpperCase()}</div>
</div>
<div class="amount">${formatINR(payment.amountPaise)}</div>
<div class="meta">
  <div class="meta-item"><strong>Date</strong>${new Date(payment.paymentDate).toLocaleDateString('en-IN')}</div>
  <div class="meta-item"><strong>Method</strong>${escapeHtml(payment.method.replace('_', ' ').toUpperCase())}</div>
  ${payment.referenceId ? `<div class="meta-item"><strong>Reference</strong>${escapeHtml(payment.referenceId)}</div>` : ''}
</div>
<table>
<tr><td><strong>Received From:</strong></td><td>${escapeHtml(client?.clientName || 'N/A')}${client?.companyName ? ' (' + escapeHtml(client.companyName) + ')' : ''}</td></tr>
<tr><td><strong>Against Invoice:</strong></td><td>${escapeHtml(invoice?.invoiceNumber || 'N/A')} — ${escapeHtml(invoice?.title || '')}</td></tr>
<tr><td><strong>Invoice Total:</strong></td><td>${invoice ? formatINR(invoice.totalPaise) : 'N/A'}</td></tr>
<tr><td><strong>Amount Received:</strong></td><td>${formatINR(payment.amountPaise)}</td></tr>
<tr><td><strong>Remaining Balance:</strong></td><td>${invoice ? formatINR(invoice.balancePaise) : 'N/A'}</td></tr>
${payment.notes ? `<tr><td><strong>Notes:</strong></td><td>${escapeHtml(payment.notes)}</td></tr>` : ''}
</table>
<div class="footer">${escapeHtml(company.companyName || 'Arclivo Labs')} · ${escapeHtml([company.email, company.mobile, company.website].filter(Boolean).join(' · '))}</div>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

export default router;
