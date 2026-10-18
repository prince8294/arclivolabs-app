"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvService = void 0;
const store_1 = require("../models/store");
class CsvService {
    /**
     * Simple and robust CSV line splitter handling quoted strings with commas
     */
    static parseCsvContent(content) {
        const rows = [];
        let currentRow = [];
        let currentCell = '';
        let insideQuotes = false;
        // Normalize newlines
        const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];
            if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                    // Escaped quote
                    currentCell += '"';
                    i++;
                }
                else {
                    // Toggle quote state
                    insideQuotes = !insideQuotes;
                }
            }
            else if (char === ',' && !insideQuotes) {
                currentRow.push(currentCell.trim());
                currentCell = '';
            }
            else if (char === '\n' && !insideQuotes) {
                currentRow.push(currentCell.trim());
                if (currentRow.some(cell => cell.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentCell = '';
            }
            else {
                currentCell += char;
            }
        }
        if (currentCell.length > 0 || currentRow.length > 0) {
            currentRow.push(currentCell.trim());
            if (currentRow.some(cell => cell.length > 0)) {
                rows.push(currentRow);
            }
        }
        return rows;
    }
    /**
     * RFC 5322 compatible email validation
     */
    static isValidEmail(email) {
        if (!email || email.length > 254)
            return false;
        const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
        if (!emailRegex.test(email))
            return false;
        // Reject disposable/invalid TLDs or dummy placeholder domains
        const parts = email.split('@');
        if (parts.length !== 2)
            return false;
        const domain = parts[1].toLowerCase();
        if (domain.includes('example.com') || domain.includes('test.com') || !domain.includes('.')) {
            return false;
        }
        return true;
    }
    /**
     * Checks if contact permission is affirmatively granted
     */
    static hasContactPermission(val) {
        if (!val)
            return false;
        const clean = val.toLowerCase().trim();
        return ['yes', 'true', '1', 'y', 'opted-in', 'opt-in', 'granted', 'lawful', 'consent'].includes(clean);
    }
    /**
     * Ingest and validate CSV text
     */
    static async importCsv(csvContent) {
        const rows = this.parseCsvContent(csvContent);
        if (rows.length < 2) {
            return {
                totalProcessed: 0,
                importedCount: 0,
                duplicateCount: 0,
                invalidCount: 0,
                ineligibleCount: 0,
                errors: ['CSV file is empty or missing headers.'],
                importedLeads: [],
            };
        }
        // Map headers
        const headerRow = rows[0].map(h => h.toLowerCase().trim().replace(/[\s_-]+/g, ' '));
        const findIndex = (names) => {
            return headerRow.findIndex(h => names.some(n => h === n || h.includes(n)));
        };
        const businessNameIdx = findIndex(['business name', 'company', 'name', 'business']);
        const emailIdx = findIndex(['email', 'email address', 'contact email']);
        const websiteIdx = findIndex(['website', 'site', 'url', 'web']);
        const categoryIdx = findIndex(['category', 'industry', 'niche', 'type']);
        const cityIdx = findIndex(['city', 'location', 'town']);
        const permissionIdx = findIndex(['contact permission', 'permission', 'consent', 'optin', 'opt in']);
        const permissionSourceIdx = findIndex(['permission source', 'consent source', 'source']);
        const permissionEvidenceIdx = findIndex(['permission evidence', 'consent evidence', 'evidence']);
        if (emailIdx === -1) {
            return {
                totalProcessed: 0,
                importedCount: 0,
                duplicateCount: 0,
                invalidCount: 0,
                ineligibleCount: 0,
                errors: ['Missing required column: "Email". CSV must include Business Name, Email, Website, Category, City, Contact Permission.'],
                importedLeads: [],
            };
        }
        const errors = [];
        const leadsToInsert = [];
        const seenEmailsInCsv = new Set();
        let duplicateCount = 0;
        let invalidCount = 0;
        let ineligibleCount = 0;
        const now = new Date().toISOString();
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const businessName = businessNameIdx !== -1 ? (row[businessNameIdx] || '').trim() : '';
            const email = (row[emailIdx] || '').trim().toLowerCase();
            const website = websiteIdx !== -1 ? (row[websiteIdx] || '').trim() : '';
            const category = categoryIdx !== -1 ? (row[categoryIdx] || '').trim() : 'General';
            const city = cityIdx !== -1 ? (row[cityIdx] || '').trim() : 'Various';
            const permissionRaw = permissionIdx !== -1 ? (row[permissionIdx] || '').trim() : '';
            const permissionSource = permissionSourceIdx !== -1
                ? (row[permissionSourceIdx] || '').trim()
                : 'csv_import';
            const permissionEvidence = permissionEvidenceIdx !== -1
                ? (row[permissionEvidenceIdx] || '').trim()
                : permissionRaw;
            if (!email && !businessName) {
                continue; // skip completely empty rows
            }
            // Email validation
            if (!this.isValidEmail(email)) {
                invalidCount++;
                errors.push(`Row ${i + 1}: Invalid or unverified email syntax "${email || '(empty)'}"`);
                continue;
            }
            // In-batch duplicate check
            if (seenEmailsInCsv.has(email)) {
                duplicateCount++;
                errors.push(`Row ${i + 1}: Duplicate email in CSV file "${email}"`);
                continue;
            }
            seenEmailsInCsv.add(email);
            // Existing database duplicate check
            const existing = await store_1.store.findLeadByEmail(email);
            if (existing) {
                duplicateCount++;
                errors.push(`Row ${i + 1}: Duplicate email already exists in system "${email}" (${existing.businessName})`);
                continue;
            }
            if (await store_1.store.hasPriorDeliveryTo(email)) {
                duplicateCount++;
                errors.push(`Row ${i + 1}: Prior delivery record prevents re-sending to "${email}"`);
                continue;
            }
            // Check permission
            const hasPermission = this.hasContactPermission(permissionRaw);
            let status = 'pending';
            let errorReason = undefined;
            const suppressed = await store_1.store.isSuppressed(email);
            if (suppressed || !hasPermission) {
                status = 'ineligible';
                errorReason = suppressed
                    ? 'Contact is on the suppression list'
                    : 'No documented contact permission / opted out';
                ineligibleCount++;
            }
            const lead = {
                id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
                businessName: businessName || 'Valued Business',
                email,
                website,
                category,
                city,
                contactPermission: hasPermission,
                permissionSource: permissionSource || 'csv_import',
                permissionEvidence: permissionEvidence || 'No evidence supplied',
                permissionRecordedAt: now,
                status,
                emailState: suppressed ? 'suppressed' : 'pending',
                errorReason,
                createdAt: now,
                updatedAt: now,
            };
            leadsToInsert.push(lead);
        }
        let importedLeads = leadsToInsert;
        if (leadsToInsert.length > 0) {
            const insertedCount = await store_1.store.addLeads(leadsToInsert);
            if (insertedCount !== leadsToInsert.length) {
                duplicateCount += leadsToInsert.length - insertedCount;
                const current = await store_1.store.getLeads();
                const ids = new Set(current.map(lead => lead.id));
                importedLeads = leadsToInsert.filter(lead => ids.has(lead.id));
            }
        }
        return {
            totalProcessed: rows.length - 1,
            importedCount: importedLeads.length,
            duplicateCount,
            invalidCount,
            ineligibleCount,
            errors: errors.slice(0, 30), // return top 30 errors for display
            importedLeads,
        };
    }
}
exports.CsvService = CsvService;
