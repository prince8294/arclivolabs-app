export type LeadStatus = 'pending' | 'sent' | 'failed' | 'ineligible';

export type EmailState =
  | 'pending'
  | 'draft'
  | 'approved'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'paused'
  | 'suppressed'
  | 'delivery_unconfirmed';

export type ErrorCategory =
  | 'authentication'
  | 'rate_limit'
  | 'temporary'
  | 'permanent'
  | 'validation'
  | 'suppressed'
  | 'permission'
  | 'delivery_unconfirmed'
  | 'unknown';

export interface IEmailDraft {
  subject: string;
  body: string;
  generatedAt?: string;
  approved: boolean;
  customized?: boolean;
}

export interface ILead {
  id: string;
  businessName: string;
  email: string;
  website: string;
  category: string;
  city: string;
  contactPermission: boolean;
  permissionSource?: string;
  permissionEvidence?: string;
  permissionRecordedAt?: string;
  status: LeadStatus;
  emailState?: EmailState;
  emailDraft?: IEmailDraft;
  sentAt?: string;
  errorReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ISettings {
  dailyLimit: number;
  autoSendEnabled: boolean;
  isAutomationRunning: boolean;
  aiProvider: 'gemini' | 'openai' | 'anthropic';
  gmailConnected: boolean;
  gmailUserEmail: string;
  sentCountToday: number;
  lastSentResetDate: string;
  businessTimezone: string;
  authSessionVersion: number;
}

export interface IOAuthTokens {
  accessToken?: string;
  refreshToken?: string;
  expiryDate?: number;
  userEmail?: string;
}

export interface IEmailRecord {
  id: string;
  queueId: string;
  idempotencyKey: string;
  leadId: string;
  recipientEmail: string;
  state: EmailState;
  attemptCount: number;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  nextAttemptAt?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export interface ISuppression {
  id: string;
  email: string;
  reason: string;
  source: 'manual' | 'opt_out' | 'bounce' | 'complaint' | 'import';
  createdAt: string;
  updatedAt: string;
}

export interface IAuditLog {
  id: string;
  action: string;
  actor: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface IEmailLog {
  id: string;
  leadId: string;
  recipientEmail: string;
  businessName: string;
  subject: string;
  status: 'sent' | 'failed';
  sentAt: string;
  messageId?: string;
  error?: string;
}

export interface IStats {
  totalLeads: number;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
  ineligibleCount: number;
  isAutomationRunning: boolean;
  autoSendEnabled: boolean;
  dailyLimit: number;
  sentToday: number;
  gmailConnected: boolean;
  // Phase 2 dashboard stats
  totalClients?: number;
  activeClients?: number;
  activeProjects?: number;
  completedProjects?: number;
  todayTasks?: number;
  overdueTasks?: number;
  // Phase 3 financial stats
  totalInvoicedPaise?: number;
  confirmedPaidPaise?: number;
  outstandingPaise?: number;
  overdueInvoices?: number;
}

// ─── Phase 2 Types ───────────────────────────────────────────────────────────

export type ClientStatus = 'new' | 'active' | 'project_ongoing' | 'completed' | 'inactive';

export interface IClient {
  id: string;
  clientName: string;
  companyName: string;
  email: string;
  mobile: string;
  whatsapp: string;
  businessType: string;
  website: string;
  city: string;
  source: string;
  status: ClientStatus;
  notes: string;
  leadId?: string; // original lead if converted
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  isArchived?: boolean;
}

export type ProjectStatus = 'planning' | 'in_progress' | 'on_hold' | 'testing' | 'completed' | 'cancelled';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ProjectType =
  | 'business_website'
  | 'ecommerce_website'
  | 'web_application'
  | 'mobile_application'
  | 'ai_automation'
  | 'crm_development'
  | 'seo_digital_marketing'
  | 'website_maintenance'
  | 'other';

export interface IMilestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate?: string;
  completedAt?: string;
  isCompleted: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface IProject {
  id: string;
  projectName: string;
  clientId: string;
  projectType: ProjectType;
  description: string;
  techStack: string;
  budget: number;
  startDate: string;
  deadline: string;
  completedAt?: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  progress: number; // 0-100
  progressMode: 'manual' | 'auto'; // auto = task-based, manual = owner-set
  notes: string;
  milestones: IMilestone[];
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
  archivedAt?: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'on_hold';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface IChecklistItem {
  id: string;
  text: string;
  isChecked: boolean;
}

export interface ITask {
  id: string;
  title: string;
  description: string;
  projectId?: string; // optional link to project
  dueDate?: string;
  priority: TaskPriority;
  status: TaskStatus;
  checklist: IChecklistItem[];
  notes: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface INote {
  id: string;
  entityType: 'client' | 'project' | 'task';
  entityId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface IActivityLog {
  id: string;
  entityType: 'client' | 'project' | 'task' | 'lead';
  entityId: string;
  action: string;
  description: string;
  createdAt: string;
}

// ─── Phase 3 Types ─────────────────────────────────────────────────────────────

export interface ICompanyProfile {
  companyName: string;
  ownerName: string;
  email: string;
  mobile: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  website: string;
  gstin: string;          // optional, blank if not registered
  pan: string;            // optional
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  upiId: string;
  logoBase64: string;     // optional, stored as base64 data URL
}

// ─── Proposals ────────────────────────────────────────────────────────────────

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface IProposalService {
  id: string;
  serviceName: string;       // e.g. "Website Development"
  description: string;
  quantityLabel: string;     // e.g. "1 Website", "3 Months"
  amountPaise: number;       // integer paise
}

export interface IPaymentMilestoneEntry {
  id: string;
  label: string;             // e.g. "Advance (50%)"
  percentage: number;        // 0-100
  amountPaise: number;       // integer paise
  dueCondition: string;      // e.g. "Upon project start"
}

export interface IProposal {
  id: string;
  proposalNumber: string;      // e.g. ARCL-PROP-0001
  clientId: string;
  projectId?: string;          // optional link
  title: string;
  introduction: string;        // brief intro / cover message
  services: IProposalService[];
  subtotalPaise: number;       // sum of services, integer paise
  discountPaise: number;       // discount, integer paise
  totalPaise: number;          // subtotal - discount, integer paise
  currency: string;            // 'INR'
  estimatedDuration: string;   // e.g. "4-6 weeks"
  validUntil: string;          // YYYY-MM-DD
  deliverables: string[];
  terms: string;
  paymentMilestones: IPaymentMilestoneEntry[];
  status: ProposalStatus;
  statusHistory: { status: ProposalStatus; note: string; recordedAt: string }[];
  convertedToProjectId?: string;
  convertedToInvoiceId?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  acceptedAt?: string;
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';

export interface IInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPaise: number;       // integer paise per unit
  totalPaise: number;      // quantity × unitPaise, integer paise
}

export interface IInvoice {
  id: string;
  invoiceNumber: string;       // e.g. ARCL-INV-0001
  clientId: string;
  projectId?: string;
  proposalId?: string;         // if created from proposal
  title: string;
  items: IInvoiceItem[];
  subtotalPaise: number;
  discountPaise: number;
  taxLabel: string;            // e.g. "GST 18%" or "" if no tax
  taxPercent: number;          // e.g. 18, or 0
  taxAmountPaise: number;
  totalPaise: number;
  paidPaise: number;           // sum of CONFIRMED payments
  balancePaise: number;        // total - paid
  currency: string;            // 'INR'
  issueDate: string;
  dueDate: string;
  paymentInstructions: string;
  notes: string;
  status: InvoiceStatus;
  statusHistory: { status: InvoiceStatus; note: string; recordedAt: string }[];
  isVoid: boolean;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export type PaymentMethod = 'upi' | 'bank_transfer' | 'cash' | 'cheque' | 'other';
export type PaymentConfirmationStatus = 'pending' | 'confirmed' | 'rejected' | 'reversed';

export interface IPayment {
  id: string;
  invoiceId: string;
  clientId: string;
  amountPaise: number;          // amount claimed / received
  confirmedAmountPaise: number; // only when status = 'confirmed'
  currency: string;             // 'INR'
  method: PaymentMethod;
  referenceId: string;          // UPI txn ID, cheque no, etc.
  paymentDate: string;          // YYYY-MM-DD
  confirmationStatus: PaymentConfirmationStatus;
  confirmedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  reversedAt?: string;
  reversalReason?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Expenses ──────────────────────────────────────────────────────────────────

export type ExpenseCategory =
  | 'domain'
  | 'hosting_vps'
  | 'software_subscription'
  | 'ai_api'
  | 'internet'
  | 'marketing'
  | 'travel'
  | 'project_expenses'
  | 'equipment'
  | 'other';

export interface IExpense {
  id: string;
  title: string;
  description: string;
  category: ExpenseCategory | string;  // allow custom
  amountPaise: number;     // integer paise
  currency: string;        // 'INR'
  expenseDate: string;     // YYYY-MM-DD
  projectId?: string;      // optional link
  receiptBase64?: string;  // optional receipt image
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 4 Types: AI CEO Assistant, Planner, Reminders, Insights ───────────

export interface ICeoChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: string[];
  calculatedStats?: Record<string, any>;
  suggestedActions?: { label: string; action: string; targetId?: string; targetRoute?: string }[];
  isDeterministic?: boolean;
}

export interface ICeoChatResponse {
  reply: string;
  sources: string[];
  calculatedStats?: Record<string, any>;
  suggestedActions?: { label: string; action: string; targetId?: string; targetRoute?: string }[];
  isDeterministic: boolean;
}

export interface IDailyWorkPlan {
  date: string;
  generatedAt: string;
  summary: string;
  overdueTasks: ITask[];
  todayTasks: ITask[];
  urgentProjects: IProject[];
  pendingInvoices: { invoice: IInvoice; clientName: string; balancePaise: number }[];
  prioritySchedule: {
    level: 1 | 2 | 3 | 4 | 5;
    title: string;
    description: string;
    items: {
      id: string;
      title: string;
      subtitle: string;
      type: 'task' | 'project' | 'invoice' | 'lead';
      badge: string;
      targetId: string;
      targetRoute: string;
      isCompleted?: boolean;
    }[];
  }[];
}

export type ReminderType =
  | 'project_deadline'
  | 'task_due'
  | 'task_overdue'
  | 'payment_pending'
  | 'invoice_due'
  | 'invoice_overdue'
  | 'proposal_expiry'
  | 'client_followup'
  | 'campaign_issue'
  | 'gmail_disconnected';

export interface IBusinessReminder {
  id: string;
  type: ReminderType;
  title: string;
  description: string;
  severity: 'urgent' | 'warning' | 'info';
  targetType: 'project' | 'task' | 'invoice' | 'payment' | 'proposal' | 'client' | 'campaign';
  targetId: string;
  targetRoute: string;
  createdAt: string;
  dueAt?: string;
  dismissed: boolean;
  snoozedUntil?: string;
}

export interface IBusinessRecommendation {
  id: string;
  title: string;
  explanation: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  category: 'finance' | 'project' | 'task' | 'sales';
  actionLabel: string;
  targetRoute: string;
  targetId?: string;
}

export interface IBusinessInsights {
  period: { from: string; to: string; label: string };
  financials: {
    totalInvoicedPaise: number;
    confirmedPaidPaise: number;
    outstandingPaise: number;
    overduePaise: number;
    totalExpensesPaise: number;
    cashSurplusPaise: number;
    collectionRatePercent: number;
  };
  leads: {
    totalLeads: number;
    qualifiedLeads: number;
    emailsSent: number;
    conversionRatePercent: number;
  };
  projects: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    onHoldProjects: number;
    averageProgressPercent: number;
  };
  tasks: {
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
    completionRatePercent: number;
  };
  upcomingDeadlines: {
    title: string;
    deadline: string;
    type: 'project' | 'invoice' | 'task';
    targetId: string;
  }[];
}

export interface ISearchResult {
  entityType: 'client' | 'project' | 'task' | 'lead' | 'invoice' | 'proposal' | 'payment';
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  targetRoute: string;
  score?: number;
}


