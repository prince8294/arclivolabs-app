"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const mongoStateAdapter_1 = require("./mongoStateAdapter");
const SCHEMA_VERSION = 4;
const DATA_DIR = config_1.config.dataDir ? path_1.default.resolve(config_1.config.dataDir) : path_1.default.resolve(__dirname, '../../data');
const DATA_FILE = path_1.default.join(DATA_DIR, 'db.json');
const BACKUP_FILE = path_1.default.join(DATA_DIR, 'db.json.bak');
const timezoneDate = (timezone, date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};
const defaultSettings = () => ({
    dailyLimit: 5,
    autoSendEnabled: false,
    isAutomationRunning: false,
    aiProvider: 'gemini',
    gmailConnected: false,
    gmailUserEmail: '',
    sentCountToday: 0,
    lastSentResetDate: timezoneDate('Asia/Kolkata'),
    businessTimezone: 'Asia/Kolkata',
    authSessionVersion: 1,
});
const defaultCompanyProfile = () => ({
    companyName: 'Arclivo Labs',
    ownerName: '',
    email: '',
    mobile: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    website: '',
    gstin: '',
    pan: '',
    bankName: '',
    bankAccountNumber: '',
    bankIfsc: '',
    upiId: '',
    logoBase64: '',
});
const defaultData = () => ({
    schemaVersion: SCHEMA_VERSION,
    leads: [],
    settings: defaultSettings(),
    oauth: {},
    oauthFlows: {},
    secrets: {},
    logs: [],
    emailRecords: [],
    suppressions: [],
    auditLogs: [],
    // Phase 2
    clients: [],
    projects: [],
    tasks: [],
    notes: [],
    activityLogs: [],
    // Phase 3
    companyProfile: defaultCompanyProfile(),
    proposals: [],
    invoices: [],
    payments: [],
    expenses: [],
    invoiceSequence: 0,
    proposalSequence: 0,
    // Phase 4
    dismissedReminders: [],
    snoozedReminders: [],
    chatHistory: [],
});
function clone(value) {
    if (value === undefined || value === null)
        return value;
    return JSON.parse(JSON.stringify(value));
}
class Store {
    data = defaultData();
    mutationQueue = Promise.resolve();
    mongoAdapter = config_1.config.persistenceDriver === 'mongodb'
        ? new mongoStateAdapter_1.MongoStateAdapter()
        : undefined;
    mongoRevision = 0;
    ready;
    constructor() {
        if (!['json', 'mongodb'].includes(config_1.config.persistenceDriver)) {
            throw new Error('PERSISTENCE_DRIVER must be either json or mongodb.');
        }
        this.ready = this.mongoAdapter ? this.initMongo() : Promise.resolve(this.initJson());
        void this.ready.catch(error => {
            logger_1.logger.error('store_initialization_failed', { message: error instanceof Error ? error.message : 'unknown' });
        });
    }
    encryptionKey() {
        if (!config_1.config.dataEncryptionKey)
            throw new Error('DATA_ENCRYPTION_KEY is required to store secrets.');
        const key = Buffer.from(config_1.config.dataEncryptionKey, 'base64');
        if (key.length !== 32)
            throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
        return key;
    }
    encrypt(value) {
        const iv = crypto_1.default.randomBytes(12);
        const cipher = crypto_1.default.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
        const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return {
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            data: data.toString('base64'),
        };
    }
    decrypt(value) {
        if (!value)
            return undefined;
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(value.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
    }
    migrate(raw) {
        const defaults = defaultData();
        const legacySettings = raw?.settings || {};
        const settings = {
            ...defaults.settings,
            ...legacySettings,
            dailyLimit: Number.isSafeInteger(legacySettings.dailyLimit) && legacySettings.dailyLimit > 0
                ? legacySettings.dailyLimit
                : defaults.settings.dailyLimit,
            businessTimezone: legacySettings.businessTimezone || 'Asia/Kolkata',
            authSessionVersion: legacySettings.authSessionVersion || 1,
        };
        delete settings.aiApiKey;
        const result = {
            ...defaults,
            ...raw,
            schemaVersion: SCHEMA_VERSION,
            settings,
            leads: Array.isArray(raw?.leads)
                ? raw.leads.map((lead) => ({
                    ...lead,
                    permissionSource: lead.permissionSource || 'legacy_csv_import',
                    permissionEvidence: lead.permissionEvidence || (lead.contactPermission
                        ? 'legacy affirmative permission flag'
                        : 'no affirmative permission'),
                    permissionRecordedAt: lead.permissionRecordedAt || lead.createdAt,
                    emailState: lead.emailState || (lead.status === 'sent'
                        ? 'sent'
                        : lead.status === 'failed'
                            ? 'failed'
                            : lead.status === 'ineligible'
                                ? 'suppressed'
                                : lead.emailDraft?.approved
                                    ? 'approved'
                                    : lead.emailDraft
                                        ? 'draft'
                                        : 'pending'),
                }))
                : [],
            oauth: raw?.oauth || {},
            oauthFlows: raw?.oauthFlows && typeof raw.oauthFlows === 'object' ? raw.oauthFlows : {},
            secrets: raw?.secrets || {},
            logs: Array.isArray(raw?.logs) ? raw.logs : [],
            emailRecords: Array.isArray(raw?.emailRecords) ? raw.emailRecords : [],
            suppressions: Array.isArray(raw?.suppressions) ? raw.suppressions : [],
            auditLogs: Array.isArray(raw?.auditLogs) ? raw.auditLogs : [],
            // Phase 2 – safe migration (empty arrays for existing installations)
            clients: Array.isArray(raw?.clients) ? raw.clients : [],
            projects: Array.isArray(raw?.projects) ? raw.projects : [],
            tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
            notes: Array.isArray(raw?.notes) ? raw.notes : [],
            activityLogs: Array.isArray(raw?.activityLogs) ? raw.activityLogs : [],
            // Phase 3 – safe migration
            companyProfile: raw?.companyProfile ? { ...defaultCompanyProfile(), ...raw.companyProfile } : defaultCompanyProfile(),
            proposals: Array.isArray(raw?.proposals) ? raw.proposals : [],
            invoices: Array.isArray(raw?.invoices) ? raw.invoices : [],
            payments: Array.isArray(raw?.payments) ? raw.payments : [],
            expenses: Array.isArray(raw?.expenses) ? raw.expenses : [],
            invoiceSequence: typeof raw?.invoiceSequence === 'number' ? raw.invoiceSequence : 0,
            proposalSequence: typeof raw?.proposalSequence === 'number' ? raw.proposalSequence : 0,
            // Phase 4
            dismissedReminders: Array.isArray(raw?.dismissedReminders) ? raw.dismissedReminders : [],
            snoozedReminders: Array.isArray(raw?.snoozedReminders) ? raw.snoozedReminders : [],
            chatHistory: Array.isArray(raw?.chatHistory) ? raw.chatHistory : [],
        };
        const legacyAiKey = typeof legacySettings.aiApiKey === 'string' ? legacySettings.aiApiKey : '';
        const legacyOAuth = raw?.oauth || {};
        if ((legacyAiKey || legacyOAuth.accessToken || legacyOAuth.refreshToken) && !config_1.config.dataEncryptionKey) {
            throw new Error('Legacy plaintext secrets exist. Set DATA_ENCRYPTION_KEY before starting the server.');
        }
        if (legacyAiKey && !result.secrets.aiApiKey)
            result.secrets.aiApiKey = this.encrypt(legacyAiKey);
        if (typeof legacyOAuth.accessToken === 'string')
            result.oauth.accessToken = this.encrypt(legacyOAuth.accessToken);
        if (typeof legacyOAuth.refreshToken === 'string')
            result.oauth.refreshToken = this.encrypt(legacyOAuth.refreshToken);
        for (const record of result.emailRecords) {
            if (record.state === 'sending') {
                record.state = 'delivery_unconfirmed';
                record.errorCategory = 'delivery_unconfirmed';
                record.errorMessage = 'Server restarted while delivery confirmation was pending.';
                record.updatedAt = new Date().toISOString();
            }
        }
        return result;
    }
    initJson() {
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        let source = DATA_FILE;
        try {
            if (!fs_1.default.existsSync(source) && fs_1.default.existsSync(BACKUP_FILE))
                source = BACKUP_FILE;
            if (fs_1.default.existsSync(source))
                this.data = this.migrate(JSON.parse(fs_1.default.readFileSync(source, 'utf8')));
            this.checkDailyResetInMemory();
            this.saveSync();
        }
        catch (primaryError) {
            if (source !== BACKUP_FILE && fs_1.default.existsSync(BACKUP_FILE)) {
                logger_1.logger.warn('store_recovering_from_backup');
                this.data = this.migrate(JSON.parse(fs_1.default.readFileSync(BACKUP_FILE, 'utf8')));
                this.saveSync();
                return;
            }
            throw primaryError;
        }
    }
    async initMongo() {
        const state = await this.mongoAdapter.initialize(defaultData());
        const migrated = this.migrate(state.data);
        this.data = migrated;
        this.mongoRevision = state.revision;
        if (JSON.stringify(migrated) !== JSON.stringify(state.data)) {
            this.mongoRevision = await this.mongoAdapter.save(clone(migrated), this.mongoRevision);
        }
    }
    saveSync() {
        const temp = `${DATA_FILE}.${process.pid}.tmp`;
        fs_1.default.writeFileSync(temp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
        const fd = fs_1.default.openSync(temp, 'r+');
        fs_1.default.fsyncSync(fd);
        fs_1.default.closeSync(fd);
        if (fs_1.default.existsSync(DATA_FILE))
            fs_1.default.copyFileSync(DATA_FILE, BACKUP_FILE);
        fs_1.default.renameSync(temp, DATA_FILE);
    }
    async mutate(operation) {
        let result;
        const run = this.mutationQueue.then(async () => {
            await this.ready;
            if (!this.mongoAdapter) {
                result = operation();
                this.saveSync();
                return;
            }
            for (let attempt = 1; attempt <= 5; attempt += 1) {
                const latest = await this.mongoAdapter.load();
                this.data = this.migrate(latest.data);
                this.mongoRevision = latest.revision;
                result = operation();
                try {
                    this.mongoRevision = await this.mongoAdapter.save(clone(this.data), this.mongoRevision);
                    return;
                }
                catch (error) {
                    const conflict = error instanceof Error && error.message.includes('changed concurrently');
                    if (!conflict || attempt === 5)
                        throw error;
                    logger_1.logger.warn('store_write_conflict_retry', { attempt });
                }
            }
        });
        this.mutationQueue = run.then(() => undefined).catch(error => {
            logger_1.logger.error('store_write_failed', { message: error instanceof Error ? error.message : 'unknown' });
        });
        await run;
        return clone(result);
    }
    async settled() {
        await this.ready;
        await this.mutationQueue;
        if (this.mongoAdapter) {
            const latest = await this.mongoAdapter.load();
            this.data = this.migrate(latest.data);
            this.mongoRevision = latest.revision;
        }
    }
    async healthCheck() {
        await this.ready;
        if (this.mongoAdapter)
            await this.mongoAdapter.ping();
        return { persistence: this.mongoAdapter ? 'mongodb' : 'json' };
    }
    checkDailyResetInMemory() {
        const today = timezoneDate(this.data.settings.businessTimezone || 'Asia/Kolkata');
        if (this.data.settings.lastSentResetDate !== today) {
            this.data.settings.sentCountToday = 0;
            this.data.settings.lastSentResetDate = today;
            return true;
        }
        return false;
    }
    async getLeads(query) {
        await this.settled();
        let result = [...this.data.leads];
        if (query?.status && query.status !== 'all')
            result = result.filter(lead => lead.status === query.status);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(lead => [lead.businessName, lead.email, lead.category, lead.city].some(value => value.toLowerCase().includes(q)));
        }
        return clone(result);
    }
    async getLeadById(id) {
        await this.settled();
        return clone(this.data.leads.find(lead => lead.id === id) || null);
    }
    async findLeadByEmail(email) {
        await this.settled();
        const normalized = email.toLowerCase().trim();
        return clone(this.data.leads.find(lead => lead.email.toLowerCase().trim() === normalized) || null);
    }
    async hasPriorDeliveryTo(email) {
        await this.settled();
        const normalized = email.toLowerCase().trim();
        return this.data.emailRecords.some(record => record.recipientEmail === normalized && record.state === 'sent');
    }
    async addLeads(newLeads) {
        return this.mutate(() => {
            const existing = new Set(this.data.leads.map(lead => lead.email.toLowerCase().trim()));
            const accepted = newLeads.filter(lead => {
                const email = lead.email.toLowerCase().trim();
                if (existing.has(email))
                    return false;
                existing.add(email);
                return true;
            });
            this.data.leads.push(...accepted);
            return accepted.length;
        });
    }
    async updateLead(id, updates) {
        return this.mutate(() => {
            const index = this.data.leads.findIndex(lead => lead.id === id);
            if (index === -1)
                return null;
            this.data.leads[index] = { ...this.data.leads[index], ...updates, updatedAt: new Date().toISOString() };
            return this.data.leads[index];
        });
    }
    async approveLead(id) {
        return this.mutate(() => {
            const lead = this.data.leads.find(item => item.id === id);
            if (!lead || !lead.emailDraft?.body || !lead.contactPermission || this.isSuppressedInMemory(lead.email))
                return null;
            lead.emailDraft.approved = true;
            lead.emailState = 'approved';
            lead.updatedAt = new Date().toISOString();
            this.ensureRecordInMemory(lead, 'approved');
            return lead;
        });
    }
    async deleteLead(id) {
        return this.mutate(() => {
            const before = this.data.leads.length;
            this.data.leads = this.data.leads.filter(lead => lead.id !== id);
            return before !== this.data.leads.length;
        });
    }
    async clearAllLeads() {
        await this.mutate(() => { this.data.leads = []; });
    }
    async getSettings() {
        await this.settled();
        if (this.checkDailyResetInMemory()) {
            return this.mutate(() => {
                this.checkDailyResetInMemory();
                return this.data.settings;
            });
        }
        return clone(this.data.settings);
    }
    async updateSettings(updates) {
        return this.mutate(() => {
            this.checkDailyResetInMemory();
            this.data.settings = { ...this.data.settings, ...updates };
            return this.data.settings;
        });
    }
    async rotateSessionVersion() {
        return this.mutate(() => {
            this.data.settings.authSessionVersion += 1;
            return this.data.settings.authSessionVersion;
        });
    }
    async getAiConfig() {
        await this.settled();
        return { provider: this.data.settings.aiProvider, apiKey: this.decrypt(this.data.secrets.aiApiKey) };
    }
    async saveAiApiKey(apiKey) {
        await this.mutate(() => { this.data.secrets.aiApiKey = this.encrypt(apiKey); });
    }
    async hasAiApiKey() {
        await this.settled();
        return !!this.data.secrets.aiApiKey;
    }
    async getOAuthTokens() {
        await this.settled();
        return {
            accessToken: this.decrypt(this.data.oauth.accessToken),
            refreshToken: this.decrypt(this.data.oauth.refreshToken),
            expiryDate: this.data.oauth.expiryDate,
            userEmail: this.data.oauth.userEmail,
        };
    }
    async saveOAuthTokens(tokens) {
        await this.mutate(() => {
            if (tokens.accessToken)
                this.data.oauth.accessToken = this.encrypt(tokens.accessToken);
            if (tokens.refreshToken)
                this.data.oauth.refreshToken = this.encrypt(tokens.refreshToken);
            if (tokens.expiryDate)
                this.data.oauth.expiryDate = tokens.expiryDate;
            if (tokens.userEmail) {
                this.data.oauth.userEmail = tokens.userEmail;
                this.data.settings.gmailConnected = true;
                this.data.settings.gmailUserEmail = tokens.userEmail;
            }
        });
    }
    async clearOAuthTokens() {
        await this.mutate(() => {
            this.data.oauth = {};
            this.data.settings.gmailConnected = false;
            this.data.settings.gmailUserEmail = '';
        });
    }
    async saveOAuthFlow(state, verifier, expiresAt) {
        await this.mutate(() => {
            const now = Date.now();
            for (const [key, flow] of Object.entries(this.data.oauthFlows)) {
                if (flow.expiresAt <= now)
                    delete this.data.oauthFlows[key];
            }
            this.data.oauthFlows[state] = { verifier: this.encrypt(verifier), expiresAt };
        });
    }
    async consumeOAuthFlow(state) {
        const stored = await this.mutate(() => {
            const flow = this.data.oauthFlows[state];
            if (flow)
                delete this.data.oauthFlows[state];
            return flow || null;
        });
        if (!stored)
            return null;
        return { verifier: this.decrypt(stored.verifier) || '', expiresAt: stored.expiresAt };
    }
    isSuppressedInMemory(email) {
        const normalized = email.toLowerCase().trim();
        return this.data.suppressions.some(item => item.email === normalized);
    }
    async isSuppressed(email) {
        await this.settled();
        return this.isSuppressedInMemory(email);
    }
    async getSuppressions() {
        await this.settled();
        return clone(this.data.suppressions);
    }
    async addSuppression(email, reason, source) {
        return this.mutate(() => {
            const normalized = email.toLowerCase().trim();
            const now = new Date().toISOString();
            let suppression = this.data.suppressions.find(item => item.email === normalized);
            if (suppression) {
                suppression.reason = reason;
                suppression.source = source;
                suppression.updatedAt = now;
            }
            else {
                suppression = {
                    id: `sup_${crypto_1.default.randomUUID()}`,
                    email: normalized,
                    reason,
                    source,
                    createdAt: now,
                    updatedAt: now,
                };
                this.data.suppressions.push(suppression);
            }
            for (const lead of this.data.leads.filter(item => item.email.toLowerCase() === normalized)) {
                lead.status = 'ineligible';
                lead.emailState = 'suppressed';
                lead.errorReason = `Suppressed: ${reason}`;
                if (lead.emailDraft)
                    lead.emailDraft.approved = false;
                lead.updatedAt = now;
                const record = this.data.emailRecords.find(item => item.leadId === lead.id);
                if (record && record.state !== 'sent') {
                    record.state = 'suppressed';
                    record.errorCategory = 'suppressed';
                    record.errorMessage = reason;
                    record.updatedAt = now;
                }
            }
            return suppression;
        });
    }
    async removeSuppression(id) {
        return this.mutate(() => {
            const before = this.data.suppressions.length;
            this.data.suppressions = this.data.suppressions.filter(item => item.id !== id);
            return before !== this.data.suppressions.length;
        });
    }
    ensureRecordInMemory(lead, state) {
        let record = this.data.emailRecords.find(item => item.leadId === lead.id);
        if (!record) {
            const now = new Date().toISOString();
            record = {
                id: `msg_${crypto_1.default.randomUUID()}`,
                queueId: `queue_${lead.id}`,
                idempotencyKey: `lead-send:${lead.id}`,
                leadId: lead.id,
                recipientEmail: lead.email.toLowerCase(),
                state,
                attemptCount: 0,
                createdAt: now,
                updatedAt: now,
            };
            this.data.emailRecords.push(record);
        }
        return record;
    }
    async claimEmail(leadId, automated = false) {
        return this.mutate(() => {
            this.checkDailyResetInMemory();
            if (automated && (!this.data.settings.isAutomationRunning || !this.data.settings.autoSendEnabled))
                return null;
            if (this.data.settings.sentCountToday >= this.data.settings.dailyLimit)
                return null;
            const now = Date.now();
            const lead = this.data.leads.find(candidate => {
                if (leadId && candidate.id !== leadId)
                    return false;
                if (candidate.status === 'sent' || candidate.status === 'ineligible')
                    return false;
                if (!candidate.contactPermission || !candidate.emailDraft?.approved || !candidate.emailDraft.body)
                    return false;
                if (this.isSuppressedInMemory(candidate.email))
                    return false;
                const recipientClaimed = this.data.emailRecords.some(record => record.leadId !== candidate.id &&
                    record.recipientEmail === candidate.email.toLowerCase().trim() &&
                    ['approved', 'queued', 'sending', 'sent', 'delivery_unconfirmed'].includes(record.state));
                if (recipientClaimed)
                    return false;
                const existing = this.data.emailRecords.find(record => record.leadId === candidate.id);
                if (!existing)
                    return true;
                if (['sent', 'sending', 'delivery_unconfirmed', 'suppressed', 'failed'].includes(existing.state))
                    return false;
                return !existing.nextAttemptAt || new Date(existing.nextAttemptAt).getTime() <= now;
            });
            if (!lead)
                return null;
            const record = this.ensureRecordInMemory(lead, 'queued');
            record.state = 'sending';
            record.attemptCount += 1;
            record.leaseExpiresAt = new Date(now + 2 * 60_000).toISOString();
            record.updatedAt = new Date(now).toISOString();
            record.errorCategory = undefined;
            record.errorMessage = undefined;
            lead.emailState = 'sending';
            lead.updatedAt = record.updatedAt;
            return { lead, record };
        });
    }
    async completeSend(recordId, gmailMessageId, gmailThreadId) {
        return this.mutate(() => {
            const record = this.data.emailRecords.find(item => item.id === recordId);
            if (!record || record.state !== 'sending')
                return null;
            const lead = this.data.leads.find(item => item.id === record.leadId);
            const now = new Date().toISOString();
            Object.assign(record, {
                state: 'sent',
                gmailMessageId,
                gmailThreadId,
                sentAt: now,
                updatedAt: now,
                leaseExpiresAt: undefined,
            });
            if (lead)
                Object.assign(lead, { status: 'sent', emailState: 'sent', sentAt: now, errorReason: undefined, updatedAt: now });
            this.checkDailyResetInMemory();
            this.data.settings.sentCountToday += 1;
            return record;
        });
    }
    async failSend(recordId, category, message, retryable, uncertain) {
        return this.mutate(() => {
            const record = this.data.emailRecords.find(item => item.id === recordId);
            if (!record)
                return null;
            const lead = this.data.leads.find(item => item.id === record.leadId);
            const now = new Date();
            record.errorCategory = category;
            record.errorMessage = message.slice(0, 500);
            record.updatedAt = now.toISOString();
            record.leaseExpiresAt = undefined;
            if (uncertain)
                record.state = 'delivery_unconfirmed';
            else if (retryable && record.attemptCount < 5) {
                record.state = 'queued';
                const delay = Math.min(60 * 60_000, 30_000 * 2 ** (record.attemptCount - 1));
                record.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
            }
            else
                record.state = 'failed';
            if (lead) {
                lead.emailState = record.state;
                lead.status = record.state === 'failed' ? 'failed' : 'pending';
                lead.errorReason = message.slice(0, 500);
                lead.updatedAt = record.updatedAt;
            }
            return record;
        });
    }
    async getEmailRecords() {
        await this.settled();
        return clone(this.data.emailRecords);
    }
    async resolveUnconfirmed(recordId, delivered, gmailMessageId) {
        return this.mutate(() => {
            const record = this.data.emailRecords.find(item => item.id === recordId);
            if (!record || record.state !== 'delivery_unconfirmed')
                return false;
            const lead = this.data.leads.find(item => item.id === record.leadId);
            const now = new Date().toISOString();
            if (delivered) {
                if (!gmailMessageId)
                    return false;
                Object.assign(record, { state: 'sent', gmailMessageId, sentAt: now });
                this.checkDailyResetInMemory();
                this.data.settings.sentCountToday += 1;
                if (lead)
                    Object.assign(lead, { status: 'sent', emailState: 'sent', sentAt: now, errorReason: undefined });
            }
            else {
                record.state = 'failed';
                if (lead)
                    Object.assign(lead, { status: 'failed', emailState: 'failed' });
            }
            record.updatedAt = now;
            if (lead)
                lead.updatedAt = now;
            return true;
        });
    }
    async addLog(log) {
        return this.mutate(() => {
            const entry = { ...log, id: `log_${crypto_1.default.randomUUID()}` };
            this.data.logs.unshift(entry);
            this.data.logs = this.data.logs.slice(0, 500);
            return entry;
        });
    }
    async getLogs(limit = 50) {
        await this.settled();
        return clone(this.data.logs.slice(0, Math.min(limit, 200)));
    }
    async addAuditLog(log) {
        await this.mutate(() => {
            this.data.auditLogs.unshift({ ...log, id: `audit_${crypto_1.default.randomUUID()}`, createdAt: new Date().toISOString() });
            this.data.auditLogs = this.data.auditLogs.slice(0, 1000);
        });
    }
    async getAuditLogs(limit = 100) {
        await this.settled();
        return clone(this.data.auditLogs.slice(0, Math.min(limit, 200)));
    }
    async getStats() {
        const settings = await this.getSettings();
        const leads = await this.getLeads();
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        await this.settled();
        const tasks = this.data.tasks;
        const projects = this.data.projects;
        const clients = this.data.clients.filter(c => !c.isArchived);
        const todayTasks = tasks.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate.slice(0, 10) === todayStr).length;
        const overdueTasks = tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now).length;
        // Phase 3 finance
        const invoices = this.data.invoices;
        const payments = this.data.payments;
        const totalInvoicedPaise = invoices.filter(i => !i.isVoid).reduce((s, i) => s + i.totalPaise, 0);
        const confirmedPaidPaise = payments.filter(p => p.confirmationStatus === 'confirmed').reduce((s, p) => s + p.confirmedAmountPaise, 0);
        const outstandingPaise = invoices.filter(i => !i.isVoid && i.status !== 'paid' && i.status !== 'void').reduce((s, i) => s + i.balancePaise, 0);
        const overdueInvoices = invoices.filter(i => !i.isVoid && i.status !== 'paid' && i.status !== 'void' && i.dueDate && new Date(i.dueDate) < now).length;
        return {
            totalLeads: leads.length,
            sentCount: leads.filter(lead => lead.status === 'sent').length,
            pendingCount: leads.filter(lead => lead.status === 'pending').length,
            failedCount: leads.filter(lead => lead.status === 'failed').length,
            ineligibleCount: leads.filter(lead => lead.status === 'ineligible').length,
            isAutomationRunning: settings.isAutomationRunning,
            autoSendEnabled: settings.autoSendEnabled,
            dailyLimit: settings.dailyLimit,
            sentToday: settings.sentCountToday,
            gmailConnected: settings.gmailConnected,
            // Phase 2
            totalClients: clients.length,
            activeClients: clients.filter(c => c.status === 'active' || c.status === 'project_ongoing').length,
            activeProjects: projects.filter(p => !p.isArchived && (p.status === 'in_progress' || p.status === 'planning' || p.status === 'testing')).length,
            completedProjects: projects.filter(p => p.status === 'completed').length,
            todayTasks,
            overdueTasks,
            // Phase 3
            totalInvoicedPaise,
            confirmedPaidPaise,
            outstandingPaise,
            overdueInvoices,
        };
    }
    // ─── Phase 2: Clients ──────────────────────────────────────────────────────
    async getClients(query) {
        await this.settled();
        let result = [...this.data.clients];
        if (!query?.includeArchived)
            result = result.filter(c => !c.isArchived);
        if (query?.status && query.status !== 'all')
            result = result.filter(c => c.status === query.status);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(c => [c.clientName, c.companyName, c.email, c.city, c.businessType].some(v => v?.toLowerCase().includes(q)));
        }
        return clone(result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    }
    async getClientById(id) {
        await this.settled();
        return clone(this.data.clients.find(c => c.id === id) || null);
    }
    async findClientByEmail(email) {
        await this.settled();
        const normalized = email.toLowerCase().trim();
        return clone(this.data.clients.find(c => c.email.toLowerCase().trim() === normalized) || null);
    }
    async addClient(client) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newClient = {
                ...client,
                id: `client_${crypto_1.default.randomUUID()}`,
                createdAt: now,
                updatedAt: now,
            };
            this.data.clients.push(newClient);
            this.data.activityLogs.unshift({
                id: `act_${crypto_1.default.randomUUID()}`,
                entityType: 'client',
                entityId: newClient.id,
                action: 'client_created',
                description: `Client "${newClient.clientName}" created`,
                createdAt: now,
            });
            this.data.activityLogs = this.data.activityLogs.slice(0, 500);
            return newClient;
        });
    }
    async updateClient(id, updates) {
        return this.mutate(() => {
            const idx = this.data.clients.findIndex(c => c.id === id);
            if (idx === -1)
                return null;
            const now = new Date().toISOString();
            this.data.clients[idx] = { ...this.data.clients[idx], ...updates, updatedAt: now };
            this.data.activityLogs.unshift({
                id: `act_${crypto_1.default.randomUUID()}`,
                entityType: 'client',
                entityId: id,
                action: 'client_updated',
                description: `Client "${this.data.clients[idx].clientName}" updated`,
                createdAt: now,
            });
            this.data.activityLogs = this.data.activityLogs.slice(0, 500);
            return this.data.clients[idx];
        });
    }
    async archiveClient(id) {
        return this.mutate(() => {
            const client = this.data.clients.find(c => c.id === id);
            if (!client)
                return false;
            const now = new Date().toISOString();
            client.isArchived = true;
            client.archivedAt = now;
            client.updatedAt = now;
            return true;
        });
    }
    async deleteClient(id) {
        return this.mutate(() => {
            const before = this.data.clients.length;
            this.data.clients = this.data.clients.filter(c => c.id !== id);
            // Also delete related projects (cascade soft)
            this.data.projects.filter(p => p.clientId === id).forEach(p => { p.isArchived = true; });
            return before !== this.data.clients.length;
        });
    }
    // ─── Phase 2: Projects ─────────────────────────────────────────────────────
    async getProjects(query) {
        await this.settled();
        let result = [...this.data.projects];
        if (!query?.includeArchived)
            result = result.filter(p => !p.isArchived);
        if (query?.status && query.status !== 'all')
            result = result.filter(p => p.status === query.status);
        if (query?.clientId)
            result = result.filter(p => p.clientId === query.clientId);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(p => [p.projectName, p.description, p.techStack].some(v => v?.toLowerCase().includes(q)));
        }
        return clone(result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    }
    async getProjectById(id) {
        await this.settled();
        return clone(this.data.projects.find(p => p.id === id) || null);
    }
    async addProject(project) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newProject = {
                ...project,
                id: `proj_${crypto_1.default.randomUUID()}`,
                milestones: [],
                createdAt: now,
                updatedAt: now,
            };
            this.data.projects.push(newProject);
            this.data.activityLogs.unshift({
                id: `act_${crypto_1.default.randomUUID()}`,
                entityType: 'project',
                entityId: newProject.id,
                action: 'project_created',
                description: `Project "${newProject.projectName}" created`,
                createdAt: now,
            });
            this.data.activityLogs = this.data.activityLogs.slice(0, 500);
            // If client exists, update client status
            const client = this.data.clients.find(c => c.id === project.clientId);
            if (client && client.status === 'active') {
                client.status = 'project_ongoing';
                client.updatedAt = now;
            }
            return newProject;
        });
    }
    async updateProject(id, updates) {
        return this.mutate(() => {
            const idx = this.data.projects.findIndex(p => p.id === id);
            if (idx === -1)
                return null;
            const now = new Date().toISOString();
            this.data.projects[idx] = { ...this.data.projects[idx], ...updates, updatedAt: now };
            this.data.activityLogs.unshift({
                id: `act_${crypto_1.default.randomUUID()}`,
                entityType: 'project',
                entityId: id,
                action: 'project_updated',
                description: `Project "${this.data.projects[idx].projectName}" updated`,
                createdAt: now,
            });
            this.data.activityLogs = this.data.activityLogs.slice(0, 500);
            return this.data.projects[idx];
        });
    }
    async archiveProject(id) {
        return this.mutate(() => {
            const project = this.data.projects.find(p => p.id === id);
            if (!project)
                return false;
            const now = new Date().toISOString();
            project.isArchived = true;
            project.archivedAt = now;
            project.updatedAt = now;
            return true;
        });
    }
    async deleteProject(id) {
        return this.mutate(() => {
            const before = this.data.projects.length;
            this.data.projects = this.data.projects.filter(p => p.id !== id);
            return before !== this.data.projects.length;
        });
    }
    // Milestones (embedded in project)
    async addMilestone(projectId, milestone) {
        return this.mutate(() => {
            const project = this.data.projects.find(p => p.id === projectId);
            if (!project)
                return null;
            const now = new Date().toISOString();
            const newMilestone = {
                ...milestone,
                id: `ms_${crypto_1.default.randomUUID()}`,
                projectId,
                createdAt: now,
                updatedAt: now,
            };
            project.milestones.push(newMilestone);
            project.updatedAt = now;
            this.recalcAutoProgress(project);
            return newMilestone;
        });
    }
    async updateMilestone(projectId, milestoneId, updates) {
        return this.mutate(() => {
            const project = this.data.projects.find(p => p.id === projectId);
            if (!project)
                return null;
            const idx = project.milestones.findIndex(m => m.id === milestoneId);
            if (idx === -1)
                return null;
            const now = new Date().toISOString();
            if (updates.isCompleted && !project.milestones[idx].isCompleted) {
                updates.completedAt = now;
            }
            project.milestones[idx] = { ...project.milestones[idx], ...updates, updatedAt: now };
            project.updatedAt = now;
            this.recalcAutoProgress(project);
            return project.milestones[idx];
        });
    }
    async deleteMilestone(projectId, milestoneId) {
        return this.mutate(() => {
            const project = this.data.projects.find(p => p.id === projectId);
            if (!project)
                return false;
            const before = project.milestones.length;
            project.milestones = project.milestones.filter(m => m.id !== milestoneId);
            this.recalcAutoProgress(project);
            project.updatedAt = new Date().toISOString();
            return before !== project.milestones.length;
        });
    }
    recalcAutoProgress(project) {
        if (project.progressMode !== 'auto')
            return;
        const tasks = this.data.tasks.filter(t => t.projectId === project.id);
        const milestones = project.milestones;
        const totalItems = tasks.length + milestones.length;
        if (totalItems === 0) {
            project.progress = 0;
            return;
        }
        const completed = tasks.filter(t => t.status === 'completed').length +
            milestones.filter(m => m.isCompleted).length;
        project.progress = Math.round((completed / totalItems) * 100);
    }
    // ─── Phase 2: Tasks ────────────────────────────────────────────────────────
    async getTasks(query) {
        await this.settled();
        let result = [...this.data.tasks];
        if (query?.status && query.status !== 'all')
            result = result.filter(t => t.status === query.status);
        if (query?.projectId)
            result = result.filter(t => t.projectId === query.projectId);
        if (query?.priority)
            result = result.filter(t => t.priority === query.priority);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(t => [t.title, t.description].some(v => v?.toLowerCase().includes(q)));
        }
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        if (query?.overdue)
            result = result.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now);
        if (query?.today)
            result = result.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate.slice(0, 10) === todayStr);
        return clone(result.sort((a, b) => {
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
            return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
        }));
    }
    async getTaskById(id) {
        await this.settled();
        return clone(this.data.tasks.find(t => t.id === id) || null);
    }
    async addTask(task) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newTask = {
                ...task,
                id: `task_${crypto_1.default.randomUUID()}`,
                createdAt: now,
                updatedAt: now,
            };
            this.data.tasks.push(newTask);
            this.data.activityLogs.unshift({
                id: `act_${crypto_1.default.randomUUID()}`,
                entityType: 'task',
                entityId: newTask.id,
                action: 'task_created',
                description: `Task "${newTask.title}" created`,
                createdAt: now,
            });
            this.data.activityLogs = this.data.activityLogs.slice(0, 500);
            if (newTask.projectId) {
                const proj = this.data.projects.find(p => p.id === newTask.projectId);
                if (proj)
                    this.recalcAutoProgress(proj);
            }
            return newTask;
        });
    }
    async updateTask(id, updates) {
        return this.mutate(() => {
            const idx = this.data.tasks.findIndex(t => t.id === id);
            if (idx === -1)
                return null;
            const now = new Date().toISOString();
            if (updates.status === 'completed' && this.data.tasks[idx].status !== 'completed') {
                updates.completedAt = now;
            }
            else if (updates.status && updates.status !== 'completed') {
                updates.completedAt = undefined;
            }
            this.data.tasks[idx] = { ...this.data.tasks[idx], ...updates, updatedAt: now };
            this.data.activityLogs.unshift({
                id: `act_${crypto_1.default.randomUUID()}`,
                entityType: 'task',
                entityId: id,
                action: 'task_updated',
                description: `Task "${this.data.tasks[idx].title}" updated`,
                createdAt: now,
            });
            this.data.activityLogs = this.data.activityLogs.slice(0, 500);
            const projectId = this.data.tasks[idx].projectId;
            if (projectId) {
                const proj = this.data.projects.find(p => p.id === projectId);
                if (proj)
                    this.recalcAutoProgress(proj);
            }
            return this.data.tasks[idx];
        });
    }
    async deleteTask(id) {
        return this.mutate(() => {
            const task = this.data.tasks.find(t => t.id === id);
            const projectId = task?.projectId;
            const before = this.data.tasks.length;
            this.data.tasks = this.data.tasks.filter(t => t.id !== id);
            if (projectId) {
                const proj = this.data.projects.find(p => p.id === projectId);
                if (proj)
                    this.recalcAutoProgress(proj);
            }
            return before !== this.data.tasks.length;
        });
    }
    // ─── Phase 2: Notes ────────────────────────────────────────────────────────
    async getNotes(entityType, entityId) {
        await this.settled();
        return clone(this.data.notes
            .filter(n => n.entityType === entityType && n.entityId === entityId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }
    async addNote(note) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newNote = { ...note, id: `note_${crypto_1.default.randomUUID()}`, createdAt: now, updatedAt: now };
            this.data.notes.push(newNote);
            return newNote;
        });
    }
    async updateNote(id, content) {
        return this.mutate(() => {
            const note = this.data.notes.find(n => n.id === id);
            if (!note)
                return null;
            note.content = content;
            note.updatedAt = new Date().toISOString();
            return note;
        });
    }
    async deleteNote(id) {
        return this.mutate(() => {
            const before = this.data.notes.length;
            this.data.notes = this.data.notes.filter(n => n.id !== id);
            return before !== this.data.notes.length;
        });
    }
    // ─── Phase 2: Activity Logs ────────────────────────────────────────────────
    async getActivityLogs(entityType, entityId, limit = 50) {
        await this.settled();
        let result = [...this.data.activityLogs];
        if (entityType)
            result = result.filter(a => a.entityType === entityType);
        if (entityId)
            result = result.filter(a => a.entityId === entityId);
        return clone(result.slice(0, Math.min(limit, 200)));
    }
    // ─── Phase 3: Company Profile ─────────────────────────────────────────────
    async getCompanyProfile() {
        await this.settled();
        return clone(this.data.companyProfile);
    }
    async updateCompanyProfile(updates) {
        return this.mutate(() => {
            this.data.companyProfile = { ...this.data.companyProfile, ...updates };
            return this.data.companyProfile;
        });
    }
    // ─── Phase 3: Proposals ──────────────────────────────────────────────────────
    nextProposalNumber() {
        this.data.proposalSequence++;
        return `ARCL-PROP-${String(this.data.proposalSequence).padStart(4, '0')}`;
    }
    async getProposals(query) {
        await this.settled();
        let result = [...this.data.proposals];
        if (query?.clientId)
            result = result.filter(p => p.clientId === query.clientId);
        if (query?.status && query.status !== 'all')
            result = result.filter(p => p.status === query.status);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(p => [p.title, p.proposalNumber].some(v => v?.toLowerCase().includes(q)));
        }
        return clone(result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    }
    async getProposalById(id) {
        await this.settled();
        return clone(this.data.proposals.find(p => p.id === id) || null);
    }
    async addProposal(proposal) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newProposal = {
                ...proposal,
                id: `prop_${crypto_1.default.randomUUID()}`,
                proposalNumber: this.nextProposalNumber(),
                statusHistory: [{ status: proposal.status, note: 'Proposal created', recordedAt: now }],
                createdAt: now,
                updatedAt: now,
            };
            this.data.proposals.push(newProposal);
            return newProposal;
        });
    }
    async updateProposal(id, updates) {
        return this.mutate(() => {
            const idx = this.data.proposals.findIndex(p => p.id === id);
            if (idx === -1)
                return null;
            const now = new Date().toISOString();
            const old = this.data.proposals[idx];
            // Track status changes
            if (updates.status && updates.status !== old.status) {
                const history = old.statusHistory || [];
                history.push({ status: updates.status, note: updates.notes || `Status changed to ${updates.status}`, recordedAt: now });
                updates.statusHistory = history;
                if (updates.status === 'sent' && !old.sentAt)
                    updates.sentAt = now;
                if (updates.status === 'accepted' && !old.acceptedAt)
                    updates.acceptedAt = now;
            }
            this.data.proposals[idx] = { ...old, ...updates, updatedAt: now };
            return this.data.proposals[idx];
        });
    }
    async deleteProposal(id) {
        return this.mutate(() => {
            const proposal = this.data.proposals.find(p => p.id === id);
            if (!proposal || proposal.status !== 'draft')
                return false; // only delete drafts
            const before = this.data.proposals.length;
            this.data.proposals = this.data.proposals.filter(p => p.id !== id);
            return before !== this.data.proposals.length;
        });
    }
    // ─── Phase 3: Invoices ───────────────────────────────────────────────────────
    nextInvoiceNumber() {
        this.data.invoiceSequence++;
        return `ARCL-INV-${String(this.data.invoiceSequence).padStart(4, '0')}`;
    }
    async getInvoices(query) {
        await this.settled();
        let result = [...this.data.invoices];
        if (query?.clientId)
            result = result.filter(i => i.clientId === query.clientId);
        if (query?.projectId)
            result = result.filter(i => i.projectId === query.projectId);
        if (query?.status && query.status !== 'all')
            result = result.filter(i => i.status === query.status);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(i => [i.title, i.invoiceNumber].some(v => v?.toLowerCase().includes(q)));
        }
        return clone(result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    }
    async getInvoiceById(id) {
        await this.settled();
        return clone(this.data.invoices.find(i => i.id === id) || null);
    }
    async addInvoice(invoice) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newInvoice = {
                ...invoice,
                id: `inv_${crypto_1.default.randomUUID()}`,
                invoiceNumber: this.nextInvoiceNumber(),
                paidPaise: 0,
                balancePaise: invoice.totalPaise,
                statusHistory: [{ status: invoice.status, note: 'Invoice created', recordedAt: now }],
                isVoid: false,
                createdAt: now,
                updatedAt: now,
            };
            this.data.invoices.push(newInvoice);
            return newInvoice;
        });
    }
    async updateInvoice(id, updates) {
        return this.mutate(() => {
            const idx = this.data.invoices.findIndex(i => i.id === id);
            if (idx === -1)
                return null;
            const old = this.data.invoices[idx];
            // Don't allow editing void invoices
            if (old.isVoid)
                return null;
            const now = new Date().toISOString();
            if (updates.status && updates.status !== old.status) {
                const history = old.statusHistory || [];
                history.push({ status: updates.status, note: `Status changed to ${updates.status}`, recordedAt: now });
                updates.statusHistory = history;
            }
            this.data.invoices[idx] = { ...old, ...updates, updatedAt: now };
            return this.data.invoices[idx];
        });
    }
    async voidInvoice(id, reason) {
        return this.mutate(() => {
            const inv = this.data.invoices.find(i => i.id === id);
            if (!inv || inv.isVoid)
                return null;
            const now = new Date().toISOString();
            inv.isVoid = true;
            inv.voidedAt = now;
            inv.voidReason = reason;
            inv.status = 'void';
            inv.statusHistory.push({ status: 'void', note: `Voided: ${reason}`, recordedAt: now });
            inv.updatedAt = now;
            return inv;
        });
    }
    recalcInvoiceBalance(invoiceId) {
        const invoice = this.data.invoices.find(i => i.id === invoiceId);
        if (!invoice || invoice.isVoid)
            return;
        const confirmedPayments = this.data.payments.filter(p => p.invoiceId === invoiceId && p.confirmationStatus === 'confirmed');
        const totalPaid = confirmedPayments.reduce((sum, p) => sum + p.confirmedAmountPaise, 0);
        invoice.paidPaise = totalPaid;
        invoice.balancePaise = invoice.totalPaise - totalPaid;
        const now = new Date().toISOString();
        if (invoice.balancePaise <= 0) {
            if (invoice.status !== 'paid') {
                invoice.status = 'paid';
                invoice.statusHistory.push({ status: 'paid', note: 'Fully paid', recordedAt: now });
            }
        }
        else if (totalPaid > 0) {
            if (invoice.status !== 'partially_paid') {
                invoice.status = 'partially_paid';
                invoice.statusHistory.push({ status: 'partially_paid', note: 'Partial payment received', recordedAt: now });
            }
        }
        invoice.updatedAt = now;
    }
    // ─── Phase 3: Payments ───────────────────────────────────────────────────────
    async getPayments(query) {
        await this.settled();
        let result = [...this.data.payments];
        if (query?.invoiceId)
            result = result.filter(p => p.invoiceId === query.invoiceId);
        if (query?.clientId)
            result = result.filter(p => p.clientId === query.clientId);
        if (query?.status)
            result = result.filter(p => p.confirmationStatus === query.status);
        if (query?.fromDate)
            result = result.filter(p => p.paymentDate >= query.fromDate);
        if (query?.toDate)
            result = result.filter(p => p.paymentDate <= query.toDate);
        return clone(result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }
    async getPaymentById(id) {
        await this.settled();
        return clone(this.data.payments.find(p => p.id === id) || null);
    }
    async addPayment(payment) {
        return this.mutate(() => {
            // Validate invoice exists and isn't void
            const invoice = this.data.invoices.find(i => i.id === payment.invoiceId);
            if (!invoice || invoice.isVoid)
                return null;
            // Prevent over-allocation: check remaining balance
            if (payment.confirmationStatus === 'confirmed') {
                const remaining = invoice.balancePaise;
                if (payment.amountPaise > remaining)
                    return null; // reject overpayment
            }
            // Prevent duplicate reference IDs on same invoice
            if (payment.referenceId?.trim()) {
                const exists = this.data.payments.some(p => p.invoiceId === payment.invoiceId && p.referenceId === payment.referenceId.trim() && p.confirmationStatus !== 'reversed');
                if (exists)
                    return null;
            }
            const now = new Date().toISOString();
            const newPayment = {
                ...payment,
                id: `pay_${crypto_1.default.randomUUID()}`,
                confirmedAmountPaise: payment.confirmationStatus === 'confirmed' ? payment.amountPaise : 0,
                createdAt: now,
                updatedAt: now,
            };
            if (payment.confirmationStatus === 'confirmed')
                newPayment.confirmedAt = now;
            this.data.payments.push(newPayment);
            this.recalcInvoiceBalance(payment.invoiceId);
            return newPayment;
        });
    }
    async confirmPayment(id) {
        return this.mutate(() => {
            const payment = this.data.payments.find(p => p.id === id);
            if (!payment || payment.confirmationStatus !== 'pending')
                return null;
            // Check that confirming won't exceed invoice balance
            const invoice = this.data.invoices.find(i => i.id === payment.invoiceId);
            if (!invoice || invoice.isVoid)
                return null;
            if (payment.amountPaise > invoice.balancePaise)
                return null;
            const now = new Date().toISOString();
            payment.confirmationStatus = 'confirmed';
            payment.confirmedAmountPaise = payment.amountPaise;
            payment.confirmedAt = now;
            payment.updatedAt = now;
            this.recalcInvoiceBalance(payment.invoiceId);
            return payment;
        });
    }
    async rejectPayment(id, reason) {
        return this.mutate(() => {
            const payment = this.data.payments.find(p => p.id === id);
            if (!payment || payment.confirmationStatus !== 'pending')
                return null;
            const now = new Date().toISOString();
            payment.confirmationStatus = 'rejected';
            payment.rejectedAt = now;
            payment.rejectionReason = reason;
            payment.updatedAt = now;
            return payment;
        });
    }
    async reversePayment(id, reason) {
        return this.mutate(() => {
            const payment = this.data.payments.find(p => p.id === id);
            if (!payment || payment.confirmationStatus !== 'confirmed')
                return null;
            const now = new Date().toISOString();
            payment.confirmationStatus = 'reversed';
            payment.confirmedAmountPaise = 0;
            payment.reversedAt = now;
            payment.reversalReason = reason;
            payment.updatedAt = now;
            this.recalcInvoiceBalance(payment.invoiceId);
            return payment;
        });
    }
    // ─── Phase 3: Expenses ───────────────────────────────────────────────────────
    async getExpenses(query) {
        await this.settled();
        let result = [...this.data.expenses];
        if (query?.category && query.category !== 'all')
            result = result.filter(e => e.category === query.category);
        if (query?.projectId)
            result = result.filter(e => e.projectId === query.projectId);
        if (query?.fromDate)
            result = result.filter(e => e.expenseDate >= query.fromDate);
        if (query?.toDate)
            result = result.filter(e => e.expenseDate <= query.toDate);
        if (query?.search?.trim()) {
            const q = query.search.toLowerCase().trim();
            result = result.filter(e => [e.title, e.description, e.category].some(v => v?.toLowerCase().includes(q)));
        }
        return clone(result.sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime()));
    }
    async getExpenseById(id) {
        await this.settled();
        return clone(this.data.expenses.find(e => e.id === id) || null);
    }
    async addExpense(expense) {
        return this.mutate(() => {
            const now = new Date().toISOString();
            const newExpense = {
                ...expense,
                id: `exp_${crypto_1.default.randomUUID()}`,
                createdAt: now,
                updatedAt: now,
            };
            this.data.expenses.push(newExpense);
            return newExpense;
        });
    }
    async updateExpense(id, updates) {
        return this.mutate(() => {
            const idx = this.data.expenses.findIndex(e => e.id === id);
            if (idx === -1)
                return null;
            const now = new Date().toISOString();
            this.data.expenses[idx] = { ...this.data.expenses[idx], ...updates, updatedAt: now };
            return this.data.expenses[idx];
        });
    }
    async deleteExpense(id) {
        return this.mutate(() => {
            const before = this.data.expenses.length;
            this.data.expenses = this.data.expenses.filter(e => e.id !== id);
            return before !== this.data.expenses.length;
        });
    }
    // ─── Phase 3: Finance Dashboard ──────────────────────────────────────────────
    async getFinanceDashboard(query) {
        await this.settled();
        const from = query?.fromDate || '2000-01-01';
        const to = query?.toDate || '2099-12-31';
        const invoices = this.data.invoices.filter(i => !i.isVoid && i.issueDate >= from && i.issueDate <= to);
        const payments = this.data.payments.filter(p => p.confirmationStatus === 'confirmed' && p.paymentDate >= from && p.paymentDate <= to);
        const expenses = this.data.expenses.filter(e => e.expenseDate >= from && e.expenseDate <= to);
        const allInvoices = this.data.invoices.filter(i => !i.isVoid);
        const now = new Date();
        const totalInvoicedPaise = invoices.reduce((s, i) => s + i.totalPaise, 0);
        const confirmedPaidPaise = payments.reduce((s, p) => s + p.confirmedAmountPaise, 0);
        const totalExpensesPaise = expenses.reduce((s, e) => s + e.amountPaise, 0);
        const outstandingPaise = allInvoices.filter(i => i.status !== 'paid' && i.status !== 'void').reduce((s, i) => s + i.balancePaise, 0);
        const overduePaise = allInvoices.filter(i => i.status !== 'paid' && i.status !== 'void' && i.dueDate && new Date(i.dueDate) < now).reduce((s, i) => s + i.balancePaise, 0);
        const cashSurplusPaise = confirmedPaidPaise - totalExpensesPaise;
        // Active projects with pending payments
        const projectsWithPending = this.data.projects
            .filter(p => !p.isArchived && p.status !== 'completed' && p.status !== 'cancelled')
            .map(p => {
            const projInvoices = allInvoices.filter(i => i.projectId === p.id);
            const projBalance = projInvoices.reduce((s, i) => s + i.balancePaise, 0);
            return { projectId: p.id, projectName: p.projectName, pendingPaise: projBalance };
        })
            .filter(p => p.pendingPaise > 0);
        return clone({
            totalInvoicedPaise,
            confirmedPaidPaise,
            outstandingPaise,
            overduePaise,
            totalExpensesPaise,
            cashSurplusPaise,
            overdueInvoiceCount: allInvoices.filter(i => i.status !== 'paid' && i.status !== 'void' && i.dueDate && new Date(i.dueDate) < now).length,
            projectsWithPending,
            period: { from, to },
        });
    }
    // ─── Phase 3: Project Financial Summary ──────────────────────────────────────
    async getProjectFinancials(projectId) {
        await this.settled();
        const project = this.data.projects.find(p => p.id === projectId);
        if (!project)
            return null;
        const invoices = this.data.invoices.filter(i => i.projectId === projectId && !i.isVoid);
        const payments = this.data.payments.filter(p => {
            const inv = this.data.invoices.find(i => i.id === p.invoiceId);
            return inv?.projectId === projectId && p.confirmationStatus === 'confirmed';
        });
        const expenses = this.data.expenses.filter(e => e.projectId === projectId);
        const contractValuePaise = project.budget * 100; // budget stored in INR in Phase 2
        const totalInvoicedPaise = invoices.reduce((s, i) => s + i.totalPaise, 0);
        const confirmedPaidPaise = payments.reduce((s, p) => s + p.confirmedAmountPaise, 0);
        const outstandingPaise = invoices.reduce((s, i) => s + i.balancePaise, 0);
        const totalExpensesPaise = expenses.reduce((s, e) => s + e.amountPaise, 0);
        const cashSurplusPaise = confirmedPaidPaise - totalExpensesPaise;
        return clone({
            projectId,
            projectName: project.projectName,
            contractValuePaise,
            totalInvoicedPaise,
            confirmedPaidPaise,
            outstandingPaise,
            totalExpensesPaise,
            cashSurplusPaise,
        });
    }
    // ─── Phase 4: Smart Business Reminders ────────────────────────────────────────
    async getReminders() {
        await this.settled();
        const now = new Date();
        const todayStr = timezoneDate(this.data.settings.businessTimezone || 'Asia/Kolkata', now);
        const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const in3DaysStr = timezoneDate(this.data.settings.businessTimezone || 'Asia/Kolkata', in3Days);
        const reminders = [];
        // 1. Task Overdue & Task Due Today
        for (const task of this.data.tasks) {
            if (task.status === 'completed')
                continue;
            if (task.dueDate) {
                const taskDue = task.dueDate.slice(0, 10);
                if (taskDue < todayStr) {
                    reminders.push({
                        id: `rem_task_overdue_${task.id}`,
                        type: 'task_overdue',
                        title: `Overdue Task: ${task.title}`,
                        description: `Task was due on ${taskDue}. Priority: ${task.priority.toUpperCase()}`,
                        severity: 'urgent',
                        targetType: 'task',
                        targetId: task.id,
                        targetRoute: 'tasks',
                        createdAt: now.toISOString(),
                        dueAt: task.dueDate,
                        dismissed: false,
                    });
                }
                else if (taskDue === todayStr) {
                    reminders.push({
                        id: `rem_task_due_${task.id}`,
                        type: 'task_due',
                        title: `Task Due Today: ${task.title}`,
                        description: `Scheduled for today. Priority: ${task.priority.toUpperCase()}`,
                        severity: task.priority === 'urgent' || task.priority === 'high' ? 'urgent' : 'warning',
                        targetType: 'task',
                        targetId: task.id,
                        targetRoute: 'tasks',
                        createdAt: now.toISOString(),
                        dueAt: task.dueDate,
                        dismissed: false,
                    });
                }
            }
        }
        // 2. Project Deadlines (overdue or within 3 days)
        for (const proj of this.data.projects) {
            if (proj.isArchived || proj.status === 'completed' || proj.status === 'cancelled')
                continue;
            if (proj.deadline) {
                const projDue = proj.deadline.slice(0, 10);
                if (projDue < todayStr) {
                    reminders.push({
                        id: `rem_proj_overdue_${proj.id}`,
                        type: 'project_deadline',
                        title: `Project Past Deadline: ${proj.projectName}`,
                        description: `Deadline was ${projDue}. Progress: ${proj.progress}%`,
                        severity: 'urgent',
                        targetType: 'project',
                        targetId: proj.id,
                        targetRoute: 'projects',
                        createdAt: now.toISOString(),
                        dueAt: proj.deadline,
                        dismissed: false,
                    });
                }
                else if (projDue <= in3DaysStr) {
                    reminders.push({
                        id: `rem_proj_upcoming_${proj.id}`,
                        type: 'project_deadline',
                        title: `Project Deadline Approaching: ${proj.projectName}`,
                        description: `Due on ${projDue} (${proj.progress}% completed).`,
                        severity: 'warning',
                        targetType: 'project',
                        targetId: proj.id,
                        targetRoute: 'projects',
                        createdAt: now.toISOString(),
                        dueAt: proj.deadline,
                        dismissed: false,
                    });
                }
            }
        }
        // 3. Invoices Overdue & Due Soon
        for (const inv of this.data.invoices) {
            if (inv.isVoid || inv.status === 'paid')
                continue;
            if (inv.dueDate) {
                const invDue = inv.dueDate.slice(0, 10);
                const client = this.data.clients.find(c => c.id === inv.clientId);
                const clientName = client?.clientName || 'Client';
                const balInr = Math.round(inv.balancePaise / 100);
                if (invDue < todayStr) {
                    reminders.push({
                        id: `rem_inv_overdue_${inv.id}`,
                        type: 'invoice_overdue',
                        title: `Overdue Invoice: ${inv.invoiceNumber} (₹${balInr.toLocaleString('en-IN')})`,
                        description: `${clientName} has not paid. Due date was ${invDue}.`,
                        severity: 'urgent',
                        targetType: 'invoice',
                        targetId: inv.id,
                        targetRoute: 'invoices',
                        createdAt: now.toISOString(),
                        dueAt: inv.dueDate,
                        dismissed: false,
                    });
                }
                else if (invDue <= in3DaysStr) {
                    reminders.push({
                        id: `rem_inv_due_${inv.id}`,
                        type: 'invoice_due',
                        title: `Invoice Due Soon: ${inv.invoiceNumber} (₹${balInr.toLocaleString('en-IN')})`,
                        description: `Payment due on ${invDue} from ${clientName}.`,
                        severity: 'warning',
                        targetType: 'invoice',
                        targetId: inv.id,
                        targetRoute: 'invoices',
                        createdAt: now.toISOString(),
                        dueAt: inv.dueDate,
                        dismissed: false,
                    });
                }
            }
        }
        // 4. Pending Payments requiring confirmation
        const pendingPayments = this.data.payments.filter(p => p.confirmationStatus === 'pending');
        for (const p of pendingPayments) {
            const inv = this.data.invoices.find(i => i.id === p.invoiceId);
            const amtInr = Math.round(p.amountPaise / 100);
            reminders.push({
                id: `rem_payment_pending_${p.id}`,
                type: 'payment_pending',
                title: `Payment Pending Confirmation: ₹${amtInr.toLocaleString('en-IN')}`,
                description: `Method: ${p.method.toUpperCase()} for ${inv?.invoiceNumber || 'Invoice'}. Ref: ${p.referenceId || 'N/A'}`,
                severity: 'warning',
                targetType: 'payment',
                targetId: p.id,
                targetRoute: 'payments',
                createdAt: now.toISOString(),
                dismissed: false,
            });
        }
        // 5. Expiring Proposals
        for (const prop of this.data.proposals) {
            if (prop.status === 'sent' && prop.validUntil) {
                const propValid = prop.validUntil.slice(0, 10);
                if (propValid <= in3DaysStr) {
                    reminders.push({
                        id: `rem_prop_exp_${prop.id}`,
                        type: 'proposal_expiry',
                        title: `Proposal Expiring: ${prop.proposalNumber}`,
                        description: `Valid until ${propValid}. Follow up with client.`,
                        severity: 'info',
                        targetType: 'proposal',
                        targetId: prop.id,
                        targetRoute: 'proposals',
                        createdAt: now.toISOString(),
                        dueAt: prop.validUntil,
                        dismissed: false,
                    });
                }
            }
        }
        // 6. Gmail Disconnected Alert
        if (!this.data.settings.gmailConnected) {
            reminders.push({
                id: 'rem_gmail_disconnected',
                type: 'gmail_disconnected',
                title: 'Gmail Not Connected',
                description: 'Connect your Gmail account in Settings to enable automated outreach and email sync.',
                severity: 'urgent',
                targetType: 'campaign',
                targetId: 'settings',
                targetRoute: 'settings',
                createdAt: now.toISOString(),
                dismissed: false,
            });
        }
        // Filter out dismissed & snoozed
        const dismissedSet = new Set(this.data.dismissedReminders || []);
        const snoozedMap = new Map((this.data.snoozedReminders || []).map(s => [s.id, s.snoozedUntil]));
        const filtered = reminders.filter(r => {
            if (dismissedSet.has(r.id))
                return false;
            const snoozedUntil = snoozedMap.get(r.id);
            if (snoozedUntil && new Date(snoozedUntil) > now)
                return false;
            return true;
        });
        const weight = { urgent: 3, warning: 2, info: 1 };
        return clone(filtered.sort((a, b) => weight[b.severity] - weight[a.severity]));
    }
    async dismissReminder(id) {
        return this.mutate(() => {
            if (!this.data.dismissedReminders)
                this.data.dismissedReminders = [];
            if (!this.data.dismissedReminders.includes(id)) {
                this.data.dismissedReminders.push(id);
            }
            return true;
        });
    }
    async snoozeReminder(id, snoozeUntil) {
        return this.mutate(() => {
            if (!this.data.snoozedReminders)
                this.data.snoozedReminders = [];
            const idx = this.data.snoozedReminders.findIndex(s => s.id === id);
            if (idx !== -1) {
                this.data.snoozedReminders[idx].snoozedUntil = snoozeUntil;
            }
            else {
                this.data.snoozedReminders.push({ id, snoozedUntil: snoozeUntil });
            }
            return true;
        });
    }
    // ─── Phase 4: AI Smart Daily Planner ─────────────────────────────────────────
    async generateDailyWorkPlan(targetDate) {
        await this.settled();
        const now = new Date();
        const dateStr = targetDate || timezoneDate(this.data.settings.businessTimezone || 'Asia/Kolkata', now);
        const overdueTasks = this.data.tasks.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate.slice(0, 10) < dateStr);
        const todayTasks = this.data.tasks.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate.slice(0, 10) === dateStr);
        const urgentProjects = this.data.projects.filter(p => !p.isArchived && p.status !== 'completed' && (p.priority === 'urgent' || (p.deadline && p.deadline.slice(0, 10) <= dateStr)));
        const pendingInvoices = this.data.invoices
            .filter(i => !i.isVoid && i.status !== 'paid')
            .map(i => {
            const client = this.data.clients.find(c => c.id === i.clientId);
            return {
                invoice: i,
                clientName: client?.clientName || 'Client',
                balancePaise: i.balancePaise,
            };
        })
            .filter(p => p.balancePaise > 0);
        const approvedDrafts = this.data.leads.filter(l => l.emailDraft?.approved && l.emailState === 'approved');
        const prioritySchedule = [
            {
                level: 1,
                title: '🚨 Critical & Overdue Deadlines',
                description: 'Items requiring immediate resolution to avoid project delays or client friction.',
                items: [
                    ...overdueTasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        subtitle: `Overdue since ${t.dueDate ? t.dueDate.slice(0, 10) : 'past'}. Priority: ${t.priority.toUpperCase()}`,
                        type: 'task',
                        badge: 'OVERDUE TASK',
                        targetId: t.id,
                        targetRoute: 'tasks',
                        isCompleted: false,
                    })),
                    ...pendingInvoices
                        .filter(i => i.invoice.dueDate && i.invoice.dueDate.slice(0, 10) < dateStr)
                        .map(i => ({
                        id: i.invoice.id,
                        title: `Follow up on overdue invoice: ${i.invoice.invoiceNumber}`,
                        subtitle: `${i.clientName} · Balance: ₹${Math.round(i.balancePaise / 100).toLocaleString('en-IN')}`,
                        type: 'invoice',
                        badge: 'OVERDUE INVOICE',
                        targetId: i.invoice.id,
                        targetRoute: 'invoices',
                    })),
                ],
            },
            {
                level: 2,
                title: '⚡ Today\'s Scheduled Commitments',
                description: 'Tasks and deliverables scheduled specifically for today.',
                items: [
                    ...todayTasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        subtitle: `Due today. Priority: ${t.priority.toUpperCase()}`,
                        type: 'task',
                        badge: 'DUE TODAY',
                        targetId: t.id,
                        targetRoute: 'tasks',
                        isCompleted: false,
                    })),
                    ...urgentProjects.map(p => ({
                        id: p.id,
                        title: `Urgent Project Work: ${p.projectName}`,
                        subtitle: `Deadline: ${p.deadline ? p.deadline.slice(0, 10) : 'ASAP'} · Progress: ${p.progress}%`,
                        type: 'project',
                        badge: 'URGENT PROJECT',
                        targetId: p.id,
                        targetRoute: 'projects',
                    })),
                ],
            },
            {
                level: 3,
                title: '💰 Revenue & Receivables Follow-Up',
                description: 'Verify pending bank/UPI transfers and send polite reminders for active invoices.',
                items: pendingInvoices
                    .filter(i => !i.invoice.dueDate || i.invoice.dueDate.slice(0, 10) >= dateStr)
                    .slice(0, 4)
                    .map(i => ({
                    id: i.invoice.id,
                    title: `Collect payment: ${i.invoice.invoiceNumber}`,
                    subtitle: `${i.clientName} · Outstanding: ₹${Math.round(i.balancePaise / 100).toLocaleString('en-IN')}`,
                    type: 'invoice',
                    badge: 'COLLECT PAYMENT',
                    targetId: i.invoice.id,
                    targetRoute: 'invoices',
                })),
            },
            {
                level: 4,
                title: '📋 Project Milestones & Development',
                description: 'Ongoing software and website development work across active client projects.',
                items: this.data.projects
                    .filter(p => !p.isArchived && p.status === 'in_progress')
                    .slice(0, 3)
                    .map(p => ({
                    id: p.id,
                    title: `Advance development on ${p.projectName}`,
                    subtitle: `Tech Stack: ${p.techStack || 'Web'} · Progress: ${p.progress}%`,
                    type: 'project',
                    badge: 'IN PROGRESS',
                    targetId: p.id,
                    targetRoute: 'projects',
                })),
            },
            {
                level: 5,
                title: '✉️ Growth & Lead Outreach',
                description: 'Review and send pending outreach drafts to bring in new client inquiries.',
                items: approvedDrafts.slice(0, 3).map(l => ({
                    id: l.id,
                    title: `Outreach draft approved for ${l.businessName}`,
                    subtitle: `Category: ${l.category} (${l.city}) · Ready for dispatch`,
                    type: 'lead',
                    badge: 'APPROVED DRAFT',
                    targetId: l.id,
                    targetRoute: 'emails',
                })),
            },
        ];
        const totalActions = prioritySchedule.reduce((sum, lvl) => sum + lvl.items.length, 0);
        const summary = overdueTasks.length > 0
            ? `You have ${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''} and ${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} scheduled for today. Focusing on Level 1 will clear your bottlenecks.`
            : `You have ${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} scheduled today and ${urgentProjects.length} urgent project${urgentProjects.length !== 1 ? 's' : ''}. A balanced plan of ${totalActions} actions is ready.`;
        return clone({
            date: dateStr,
            generatedAt: now.toISOString(),
            summary,
            overdueTasks,
            todayTasks,
            urgentProjects,
            pendingInvoices,
            prioritySchedule,
        });
    }
    // ─── Phase 4: Business Recommendations ───────────────────────────────────────
    async getBusinessRecommendations() {
        await this.settled();
        const now = new Date();
        const todayStr = timezoneDate(this.data.settings.businessTimezone || 'Asia/Kolkata', now);
        const recs = [];
        // Overdue tasks
        const overdueTasks = this.data.tasks.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate.slice(0, 10) < todayStr);
        if (overdueTasks.length > 0) {
            recs.push({
                id: 'rec_overdue_tasks',
                title: `${overdueTasks.length} Overdue Task${overdueTasks.length !== 1 ? 's' : ''} Pending Action`,
                explanation: `You have ${overdueTasks.length} task${overdueTasks.length !== 1 ? 's' : ''} past deadline. Completing or rescheduling them will keep your commitments clean.`,
                priority: 'urgent',
                category: 'task',
                actionLabel: 'Review Tasks',
                targetRoute: 'tasks',
            });
        }
        // Overdue invoices
        const overdueInvoices = this.data.invoices.filter(i => !i.isVoid && i.status !== 'paid' && i.dueDate && i.dueDate.slice(0, 10) < todayStr);
        if (overdueInvoices.length > 0) {
            const overduePaise = overdueInvoices.reduce((s, i) => s + i.balancePaise, 0);
            recs.push({
                id: 'rec_overdue_invoices',
                title: `₹${Math.round(overduePaise / 100).toLocaleString('en-IN')} in Overdue Invoices`,
                explanation: `${overdueInvoices.length} invoice${overdueInvoices.length !== 1 ? 's are' : ' is'} past due date. Follow up with the client to maintain positive cash flow.`,
                priority: 'urgent',
                category: 'finance',
                actionLabel: 'View Invoices',
                targetRoute: 'invoices',
            });
        }
        // Pending payment confirmation
        const pendingPayments = this.data.payments.filter(p => p.confirmationStatus === 'pending');
        if (pendingPayments.length > 0) {
            recs.push({
                id: 'rec_pending_payments',
                title: `${pendingPayments.length} Client Payment${pendingPayments.length !== 1 ? 's' : ''} Awaiting Confirmation`,
                explanation: `Confirm received payments to automatically update your invoice balances and accounting metrics.`,
                priority: 'high',
                category: 'finance',
                actionLabel: 'Confirm Payments',
                targetRoute: 'payments',
            });
        }
        // Approved email outreach drafts waiting
        const approvedDrafts = this.data.leads.filter(l => l.emailDraft?.approved && l.emailState === 'approved');
        if (approvedDrafts.length > 0) {
            recs.push({
                id: 'rec_approved_drafts',
                title: `${approvedDrafts.length} Approved Outreach Email${approvedDrafts.length !== 1 ? 's' : ''} Ready`,
                explanation: `You have approved email drafts ready to send. Start automation or trigger sending to generate new leads.`,
                priority: 'medium',
                category: 'sales',
                actionLabel: 'View Outreach',
                targetRoute: 'emails',
            });
        }
        // Proposals waiting
        const sentProposals = this.data.proposals.filter(p => p.status === 'sent');
        if (sentProposals.length > 0) {
            recs.push({
                id: 'rec_sent_proposals',
                title: `${sentProposals.length} Sent Proposal${sentProposals.length !== 1 ? 's' : ''} Awaiting Decision`,
                explanation: `Follow up on open quotations to convert them into active client projects and generate advance deposits.`,
                priority: 'medium',
                category: 'sales',
                actionLabel: 'View Proposals',
                targetRoute: 'proposals',
            });
        }
        // Unassigned project tasks
        const activeProjects = this.data.projects.filter(p => !p.isArchived && p.status === 'in_progress');
        const projectWithNoTasks = activeProjects.filter(p => !this.data.tasks.some(t => t.projectId === p.id && t.status !== 'completed'));
        if (projectWithNoTasks.length > 0) {
            recs.push({
                id: 'rec_project_tasks',
                title: `${projectWithNoTasks.length} Active Project${projectWithNoTasks.length !== 1 ? 's' : ''} Without Pending Tasks`,
                explanation: `Break down "${projectWithNoTasks[0].projectName}" into specific milestones and action tasks to maintain momentum.`,
                priority: 'low',
                category: 'project',
                actionLabel: 'Open Project',
                targetRoute: 'projects',
                targetId: projectWithNoTasks[0].id,
            });
        }
        return clone(recs);
    }
    // ─── Phase 4: Business Insights ──────────────────────────────────────────────
    async getBusinessInsights(fromDate, toDate) {
        await this.settled();
        const from = fromDate || '2000-01-01';
        const to = toDate || '2099-12-31';
        const now = new Date();
        const todayStr = timezoneDate(this.data.settings.businessTimezone || 'Asia/Kolkata', now);
        const invoices = this.data.invoices.filter(i => !i.isVoid && i.issueDate >= from && i.issueDate <= to);
        const payments = this.data.payments.filter(p => p.confirmationStatus === 'confirmed' && p.paymentDate >= from && p.paymentDate <= to);
        const expenses = this.data.expenses.filter(e => e.expenseDate >= from && e.expenseDate <= to);
        const allInvoices = this.data.invoices.filter(i => !i.isVoid);
        const totalInvoicedPaise = invoices.reduce((s, i) => s + i.totalPaise, 0);
        const confirmedPaidPaise = payments.reduce((s, p) => s + p.confirmedAmountPaise, 0);
        const totalExpensesPaise = expenses.reduce((s, e) => s + e.amountPaise, 0);
        const outstandingPaise = allInvoices.filter(i => i.status !== 'paid' && i.status !== 'void').reduce((s, i) => s + i.balancePaise, 0);
        const overduePaise = allInvoices.filter(i => i.status !== 'paid' && i.status !== 'void' && i.dueDate && i.dueDate < todayStr).reduce((s, i) => s + i.balancePaise, 0);
        const cashSurplusPaise = confirmedPaidPaise - totalExpensesPaise;
        const collectionRatePercent = totalInvoicedPaise > 0 ? Math.round((confirmedPaidPaise / totalInvoicedPaise) * 100) : 0;
        // Leads
        const totalLeads = this.data.leads.length;
        const qualifiedLeads = this.data.leads.filter(l => l.contactPermission).length;
        const emailsSent = this.data.leads.filter(l => l.status === 'sent').length;
        const clientsFromLeads = this.data.clients.filter(c => c.leadId).length;
        const conversionRatePercent = totalLeads > 0 ? Math.round((clientsFromLeads / totalLeads) * 100) : 0;
        // Projects
        const totalProjects = this.data.projects.length;
        const activeProjects = this.data.projects.filter(p => !p.isArchived && (p.status === 'in_progress' || p.status === 'planning')).length;
        const completedProjects = this.data.projects.filter(p => p.status === 'completed').length;
        const onHoldProjects = this.data.projects.filter(p => p.status === 'on_hold').length;
        const activeProjsWithProgress = this.data.projects.filter(p => !p.isArchived && p.status !== 'completed');
        const averageProgressPercent = activeProjsWithProgress.length > 0
            ? Math.round(activeProjsWithProgress.reduce((s, p) => s + p.progress, 0) / activeProjsWithProgress.length)
            : 0;
        // Tasks
        const totalTasks = this.data.tasks.length;
        const completedTasks = this.data.tasks.filter(t => t.status === 'completed').length;
        const overdueTasks = this.data.tasks.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate.slice(0, 10) < todayStr).length;
        const completionRatePercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        // Upcoming Deadlines
        const upcomingDeadlines = [];
        for (const p of this.data.projects) {
            if (!p.isArchived && p.status !== 'completed' && p.deadline) {
                upcomingDeadlines.push({ title: p.projectName, deadline: p.deadline, type: 'project', targetId: p.id });
            }
        }
        for (const i of allInvoices) {
            if (i.status !== 'paid' && i.dueDate) {
                upcomingDeadlines.push({ title: `${i.invoiceNumber} (${i.title})`, deadline: i.dueDate, type: 'invoice', targetId: i.id });
            }
        }
        for (const t of this.data.tasks) {
            if (t.status !== 'completed' && t.dueDate) {
                upcomingDeadlines.push({ title: t.title, deadline: t.dueDate, type: 'task', targetId: t.id });
            }
        }
        upcomingDeadlines.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
        return clone({
            period: { from, to, label: fromDate && toDate ? `${fromDate} to ${toDate}` : 'All Time' },
            financials: {
                totalInvoicedPaise,
                confirmedPaidPaise,
                outstandingPaise,
                overduePaise,
                totalExpensesPaise,
                cashSurplusPaise,
                collectionRatePercent,
            },
            leads: {
                totalLeads,
                qualifiedLeads,
                emailsSent,
                conversionRatePercent,
            },
            projects: {
                totalProjects,
                activeProjects,
                completedProjects,
                onHoldProjects,
                averageProgressPercent,
            },
            tasks: {
                totalTasks,
                completedTasks,
                overdueTasks,
                completionRatePercent,
            },
            upcomingDeadlines: upcomingDeadlines.slice(0, 8),
        });
    }
    // ─── Phase 4: Global Search ──────────────────────────────────────────────────
    async globalSearch(query, category) {
        await this.settled();
        const q = query.toLowerCase().trim();
        if (!q)
            return [];
        const results = [];
        // Search Clients
        if (!category || category === 'all' || category === 'clients') {
            for (const c of this.data.clients) {
                if ([c.clientName, c.companyName, c.email, c.mobile, c.city, c.notes].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'client',
                        id: c.id,
                        title: c.clientName,
                        subtitle: `${c.companyName ? c.companyName + ' · ' : ''}${c.email || c.mobile || ''}`,
                        badge: c.status.replace('_', ' ').toUpperCase(),
                        targetRoute: 'clients',
                    });
                }
            }
        }
        // Search Projects
        if (!category || category === 'all' || category === 'projects') {
            for (const p of this.data.projects) {
                if ([p.projectName, p.techStack, p.description, p.notes].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'project',
                        id: p.id,
                        title: p.projectName,
                        subtitle: `${p.techStack ? p.techStack + ' · ' : ''}Progress: ${p.progress}%`,
                        badge: p.status.replace('_', ' ').toUpperCase(),
                        targetRoute: 'projects',
                    });
                }
            }
        }
        // Search Tasks
        if (!category || category === 'all' || category === 'tasks') {
            for (const t of this.data.tasks) {
                if ([t.title, t.description, t.notes].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'task',
                        id: t.id,
                        title: t.title,
                        subtitle: `Priority: ${t.priority.toUpperCase()}${t.dueDate ? ' · Due: ' + t.dueDate.slice(0, 10) : ''}`,
                        badge: t.status.replace('_', ' ').toUpperCase(),
                        targetRoute: 'tasks',
                    });
                }
            }
        }
        // Search Invoices
        if (!category || category === 'all' || category === 'invoices') {
            for (const i of this.data.invoices) {
                if ([i.invoiceNumber, i.title, i.notes].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'invoice',
                        id: i.id,
                        title: `${i.invoiceNumber} — ${i.title}`,
                        subtitle: `Total: ₹${Math.round(i.totalPaise / 100).toLocaleString('en-IN')}${i.balancePaise > 0 ? ' · Bal: ₹' + Math.round(i.balancePaise / 100).toLocaleString('en-IN') : ''}`,
                        badge: i.status.replace('_', ' ').toUpperCase(),
                        targetRoute: 'invoices',
                    });
                }
            }
        }
        // Search Proposals
        if (!category || category === 'all' || category === 'proposals') {
            for (const prop of this.data.proposals) {
                if ([prop.proposalNumber, prop.title, prop.notes].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'proposal',
                        id: prop.id,
                        title: `${prop.proposalNumber} — ${prop.title}`,
                        subtitle: `Value: ₹${Math.round(prop.totalPaise / 100).toLocaleString('en-IN')} · ${prop.estimatedDuration || ''}`,
                        badge: prop.status.toUpperCase(),
                        targetRoute: 'proposals',
                    });
                }
            }
        }
        // Search Leads
        if (!category || category === 'all' || category === 'leads') {
            for (const l of this.data.leads) {
                if ([l.businessName, l.email, l.category, l.city, l.website].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'lead',
                        id: l.id,
                        title: l.businessName,
                        subtitle: `${l.category} · ${l.city} · ${l.email}`,
                        badge: l.status.toUpperCase(),
                        targetRoute: 'leads',
                    });
                }
            }
        }
        // Search Payments
        if (!category || category === 'all' || category === 'payments') {
            for (const pay of this.data.payments) {
                if ([pay.referenceId, pay.method, pay.notes].some(v => v?.toLowerCase().includes(q))) {
                    results.push({
                        entityType: 'payment',
                        id: pay.id,
                        title: `Payment: ₹${Math.round(pay.amountPaise / 100).toLocaleString('en-IN')}`,
                        subtitle: `Ref: ${pay.referenceId || 'N/A'} · Method: ${pay.method.toUpperCase()} (${pay.paymentDate.slice(0, 10)})`,
                        badge: pay.confirmationStatus.toUpperCase(),
                        targetRoute: 'payments',
                    });
                }
            }
        }
        return clone(results.slice(0, 30));
    }
    // ─── Phase 4: Data Backup & Safety Export ─────────────────────────────────────
    async exportDataBackup() {
        await this.settled();
        const backupData = clone(this.data);
        // Redact sensitive secrets from the export
        delete backupData.secrets;
        delete backupData.oauth;
        return {
            schemaVersion: SCHEMA_VERSION,
            exportFormat: 'arclivo_backup_v4',
            exportedAt: new Date().toISOString(),
            summary: {
                leadsCount: backupData.leads.length,
                clientsCount: backupData.clients.length,
                projectsCount: backupData.projects.length,
                tasksCount: backupData.tasks.length,
                proposalsCount: backupData.proposals.length,
                invoicesCount: backupData.invoices.length,
                paymentsCount: backupData.payments.length,
                expensesCount: backupData.expenses.length,
            },
            data: backupData,
        };
    }
    // ─── Phase 4: AI CEO Chat History ───────────────────────────────────────────
    async getCeoChatHistory() {
        await this.settled();
        return clone(this.data.chatHistory || []);
    }
    async addCeoChatMessage(msg) {
        return this.mutate(() => {
            if (!this.data.chatHistory)
                this.data.chatHistory = [];
            const newMsg = {
                ...msg,
                id: `chat_${crypto_1.default.randomUUID()}`,
                timestamp: new Date().toISOString(),
            };
            this.data.chatHistory.push(newMsg);
            // Keep last 100 messages to prevent unbounded growth
            if (this.data.chatHistory.length > 100) {
                this.data.chatHistory = this.data.chatHistory.slice(-100);
            }
            return newMsg;
        });
    }
    async clearCeoChatHistory() {
        return this.mutate(() => {
            this.data.chatHistory = [];
            return true;
        });
    }
}
exports.store = new Store();
